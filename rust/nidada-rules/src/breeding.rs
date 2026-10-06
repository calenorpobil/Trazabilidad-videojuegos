//! Cría entre jugadores (diseño 6). Sólo reglas: quién puede criar y qué transiciones de
//! la máquina de estados son legales. Las llamadas a la librería las hace el servidor.

use crate::game_hours_between;
use crate::needs::{BREED_MIN_WELLBEING, PetState, Stage};

/// Horas de juego entre dos crías de la misma mascota.
pub const BREED_COOLDOWN_HOURS: f64 = 48.0;
/// Crías como máximo en la vida de una mascota.
pub const MAX_BIRTHS: u32 = 3;

/// Lo que hace falta saber de una mascota para decidir si puede criar.
#[derive(Debug, Clone, Copy)]
pub struct Breeder<'a> {
    pub owner: &'a str,
    pub state: PetState,
    pub last_bred_at: Option<i64>,
    pub births: u32,
    /// Ya participa en otra cría en curso.
    pub busy: bool,
}

/// Motivo por el que no se permite una cría. `First` y `Second` dicen de qué mascota.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreedRefusal {
    SameOwner,
    NotAdult(Which),
    Cooldown(Which),
    BirthLimit(Which),
    Busy(Which),
    NoCookie,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Which {
    First,
    Second,
}

/// Las seis condiciones del diseño 6.1, en ese orden. `first` es la mascota de quien
/// propone; `free_cookies`, las galletas de quien propone no reservadas por otra cría.
pub fn check(
    first: &Breeder,
    second: &Breeder,
    free_cookies: u32,
    now: i64,
    time_scale: f64,
) -> Result<(), BreedRefusal> {
    if first.owner == second.owner {
        return Err(BreedRefusal::SameOwner);
    }
    for (which, b) in [(Which::First, first), (Which::Second, second)] {
        if b.state.stage != Stage::Adult || b.state.wellbeing < BREED_MIN_WELLBEING {
            return Err(BreedRefusal::NotAdult(which));
        }
    }
    for (which, b) in [(Which::First, first), (Which::Second, second)] {
        if let Some(at) = b.last_bred_at
            && game_hours_between(at, now, time_scale) < BREED_COOLDOWN_HOURS
        {
            return Err(BreedRefusal::Cooldown(which));
        }
    }
    for (which, b) in [(Which::First, first), (Which::Second, second)] {
        if b.births >= MAX_BIRTHS {
            return Err(BreedRefusal::BirthLimit(which));
        }
    }
    if free_cookies == 0 {
        return Err(BreedRefusal::NoCookie);
    }
    for (which, b) in [(Which::First, first), (Which::Second, second)] {
        if b.busy {
            return Err(BreedRefusal::Busy(which));
        }
    }
    Ok(())
}

/// Estados de una cría (diseño 6.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreedingState {
    Proposed,
    Paying,
    Hatching,
    Born,
    Expired,
    Cancelled,
    Refunding,
}

/// Lo que le pasa a una cría. Los fallos llevan si son reintentables, como `ChainError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreedingEvent {
    Accepted,
    RejectedOrTimedOut,
    PaymentSettled,
    PaymentFailed { retryable: bool },
    BirthSettled,
    BirthFailed { retryable: bool },
    RefundSettled,
    RefundFailed,
}

impl BreedingState {
    /// Transición legal, o `None`. Un fallo reintentable deja la cría en el mismo estado:
    /// el servidor reintenta con clave nueva (diseño 6.4).
    pub fn next(self, event: BreedingEvent) -> Option<BreedingState> {
        use BreedingEvent as E;
        use BreedingState as S;
        Some(match (self, event) {
            (S::Proposed, E::Accepted) => S::Paying,
            (S::Proposed, E::RejectedOrTimedOut) => S::Expired,
            (S::Paying, E::PaymentSettled) => S::Hatching,
            (S::Paying, E::PaymentFailed { retryable: true }) => S::Paying,
            (S::Paying, E::PaymentFailed { retryable: false }) => S::Cancelled,
            (S::Hatching, E::BirthSettled) => S::Born,
            (S::Hatching, E::BirthFailed { retryable: true }) => S::Hatching,
            (S::Hatching, E::BirthFailed { retryable: false }) => S::Refunding,
            (S::Refunding, E::RefundSettled) => S::Cancelled,
            // El diseño no dice qué pasa si la devolución falla: se queda pendiente de
            // reintento o de revisión humana, nunca se da por hecha.
            (S::Refunding, E::RefundFailed) => S::Refunding,
            _ => return None,
        })
    }

    pub fn is_final(self) -> bool {
        matches!(
            self,
            BreedingState::Born | BreedingState::Expired | BreedingState::Cancelled
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::needs::{Snapshot, state_at};
    use crate::species::Species;

    const HOUR: i64 = 3600;

    fn adult() -> PetState {
        let snap = Snapshot {
            growth_hours: 100.0,
            ..Snapshot::newborn(0)
        };
        state_at(Species::Brasa, &snap, 0, 1.0)
    }

    fn breeder(owner: &str) -> Breeder<'_> {
        Breeder {
            owner,
            state: adult(),
            last_bred_at: None,
            births: 0,
            busy: false,
        }
    }

    #[test]
    fn two_healthy_adults_of_different_owners_can_breed() {
        assert_eq!(check(&breeder("a"), &breeder("b"), 1, 0, 1.0), Ok(()));
    }

    #[test]
    fn rule_1_never_with_yourself() {
        assert_eq!(
            check(&breeder("a"), &breeder("a"), 1, 0, 1.0),
            Err(BreedRefusal::SameOwner)
        );
    }

    #[test]
    fn rule_2_both_adult_and_well() {
        let mut young = breeder("b");
        young.state.stage = Stage::Young;
        assert_eq!(
            check(&breeder("a"), &young, 1, 0, 1.0),
            Err(BreedRefusal::NotAdult(Which::Second))
        );
        let mut sad = breeder("a");
        sad.state.wellbeing = 59.0;
        assert_eq!(
            check(&sad, &breeder("b"), 1, 0, 1.0),
            Err(BreedRefusal::NotAdult(Which::First))
        );
    }

    #[test]
    fn rule_3_cooldown_of_48_game_hours() {
        let mut recent = breeder("b");
        recent.last_bred_at = Some(0);
        assert_eq!(
            check(&breeder("a"), &recent, 1, 47 * HOUR, 1.0),
            Err(BreedRefusal::Cooldown(Which::Second))
        );
        assert_eq!(check(&breeder("a"), &recent, 1, 48 * HOUR, 1.0), Ok(()));
        // Con escala 120, 48 h de juego son 24 min reales.
        assert_eq!(check(&breeder("a"), &recent, 1, 24 * 60, 120.0), Ok(()));
    }

    #[test]
    fn rule_4_at_most_three_births() {
        let mut tired = breeder("a");
        tired.births = 3;
        assert_eq!(
            check(&tired, &breeder("b"), 1, 0, 1.0),
            Err(BreedRefusal::BirthLimit(Which::First))
        );
    }

    #[test]
    fn rule_5_needs_a_free_cookie() {
        assert_eq!(
            check(&breeder("a"), &breeder("b"), 0, 0, 1.0),
            Err(BreedRefusal::NoCookie)
        );
    }

    #[test]
    fn rule_6_not_in_another_breeding() {
        let mut busy = breeder("b");
        busy.busy = true;
        assert_eq!(
            check(&breeder("a"), &busy, 1, 0, 1.0),
            Err(BreedRefusal::Busy(Which::Second))
        );
    }

    #[test]
    fn happy_path_reaches_born() {
        use BreedingEvent as E;
        let s = BreedingState::Proposed;
        let s = s.next(E::Accepted).unwrap();
        let s = s.next(E::PaymentSettled).unwrap();
        let s = s.next(E::BirthSettled).unwrap();
        assert_eq!(s, BreedingState::Born);
        assert!(s.is_final());
    }

    #[test]
    fn failures_follow_design_table() {
        use BreedingEvent as E;
        use BreedingState as S;
        assert_eq!(S::Proposed.next(E::RejectedOrTimedOut), Some(S::Expired));
        assert_eq!(
            S::Paying.next(E::PaymentFailed { retryable: true }),
            Some(S::Paying)
        );
        assert_eq!(
            S::Paying.next(E::PaymentFailed { retryable: false }),
            Some(S::Cancelled)
        );
        assert_eq!(
            S::Hatching.next(E::BirthFailed { retryable: true }),
            Some(S::Hatching)
        );
        assert_eq!(
            S::Hatching.next(E::BirthFailed { retryable: false }),
            Some(S::Refunding)
        );
        assert_eq!(S::Refunding.next(E::RefundSettled), Some(S::Cancelled));
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        use BreedingEvent as E;
        use BreedingState as S;
        // Nunca se da una cría sin haber cobrado.
        assert_eq!(S::Proposed.next(E::BirthSettled), None);
        assert_eq!(S::Paying.next(E::BirthSettled), None);
        // Los estados finales no se mueven.
        for s in [S::Born, S::Expired, S::Cancelled] {
            assert_eq!(s.next(E::Accepted), None);
            assert_eq!(s.next(E::PaymentSettled), None);
        }
    }
}
