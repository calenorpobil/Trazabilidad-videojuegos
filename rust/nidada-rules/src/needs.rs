//! Necesidades, crecimiento y etapas de vida (diseño 3.4 y 3.5).
//!
//! Modelo de instantáneas (`docs/plan-juego.md`, sección 3): el servidor guarda los
//! valores en un instante y todo lo demás se deriva. Ni el servidor ni el cliente
//! simulan paso a paso.

use crate::species::Species;
use crate::{after_game_hours, game_hours_between};

/// Puntos por hora de juego que pierde cada necesidad (diseño 3.5).
pub const HUNGER_DECAY: f64 = 4.0;
pub const MOOD_DECAY: f64 = 3.0;
pub const ENERGY_DECAY: f64 = 2.0;

/// Las crías bajan necesidades al doble de ritmo (diseño 3.4).
pub const BABY_DECAY_FACTOR: f64 = 2.0;
/// Horas de crecimiento al final de la etapa de cría.
pub const BABY_HOURS: f64 = 24.0;

/// Por debajo de este bienestar la mascota deja de crecer.
pub const GROWTH_MIN_WELLBEING: f64 = 30.0;
/// Bienestar mínimo para criar. En J1, bienestar actual y no media de 24 h.
pub const BREED_MIN_WELLBEING: f64 = 60.0;

/// Efectos de las acciones. Provisionales: el diseño no los fija (plan, 2.3).
pub const FEED_HUNGER: f64 = 35.0;
pub const PLAY_MOOD: f64 = 25.0;
pub const PLAY_COOLDOWN_HOURS: f64 = 0.5;
pub const SLEEP_HOURS: f64 = 2.0;

pub const MAX_NEED: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    Baby,
    Young,
    Adult,
}

impl Stage {
    pub fn of(species: Species, growth_hours: f64) -> Stage {
        if growth_hours < BABY_HOURS {
            Stage::Baby
        } else if growth_hours < species.growth_hours() {
            Stage::Young
        } else {
            Stage::Adult
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Stage::Baby => "baby",
            Stage::Young => "young",
            Stage::Adult => "adult",
        }
    }
}

/// Estado guardado de una mascota. Es lo único que se persiste.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Snapshot {
    pub hunger: f64,
    pub mood: f64,
    pub energy: f64,
    /// Horas de juego acumuladas con bienestar suficiente.
    pub growth_hours: f64,
    /// Instante real (Unix, segundos) en que se tomaron los valores.
    pub at: i64,
    /// Hasta cuándo duerme. En el pasado si está despierta.
    pub sleep_until: i64,
    /// Desde cuándo se puede volver a jugar.
    pub play_ready_at: i64,
}

impl Snapshot {
    /// Una cría recién llegada: necesidades llenas, sin crecimiento.
    pub fn newborn(now: i64) -> Snapshot {
        Snapshot {
            hunger: MAX_NEED,
            mood: MAX_NEED,
            energy: MAX_NEED,
            growth_hours: 0.0,
            at: now,
            sleep_until: now,
            play_ready_at: now,
        }
    }
}

/// Estado derivado en un instante. Nunca se persiste.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PetState {
    pub hunger: f64,
    pub mood: f64,
    pub energy: f64,
    pub wellbeing: f64,
    pub growth_hours: f64,
    pub stage: Stage,
    pub sleeping: bool,
    pub can_play: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Feed,
    Play,
    Sleep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionRefusal {
    Sleeping,
    PlayCooldown,
}

impl ActionRefusal {
    /// Mensaje para el jugador, sin tecnicismos.
    pub fn message(self) -> &'static str {
        match self {
            ActionRefusal::Sleeping => "Está durmiendo. Déjala descansar.",
            ActionRefusal::PlayCooldown => "Acaba de jugar. Inténtalo un poco más tarde.",
        }
    }
}

/// Valores de las tres necesidades `h` horas de juego después de la instantánea.
fn needs_after(snap: &Snapshot, species: Species, h: f64, sleep_end_h: f64) -> (f64, f64, f64) {
    let k = if Stage::of(species, snap.growth_hours) == Stage::Baby {
        BABY_DECAY_FACTOR
    } else {
        1.0
    };
    let hunger = (snap.hunger - HUNGER_DECAY * k * h).max(0.0);
    let mood = (snap.mood - MOOD_DECAY * k * h).max(0.0);
    let awake_h = (h - sleep_end_h).max(0.0);
    let energy = (snap.energy - ENERGY_DECAY * k * awake_h).max(0.0);
    (hunger, mood, energy)
}

fn wellbeing(needs: (f64, f64, f64)) -> f64 {
    (needs.0 + needs.1 + needs.2) / 3.0
}

/// Estado de la mascota en el instante `now`.
pub fn state_at(species: Species, snap: &Snapshot, now: i64, time_scale: f64) -> PetState {
    let h = game_hours_between(snap.at, now, time_scale).max(0.0);
    let sleep_end_h = game_hours_between(snap.at, snap.sleep_until, time_scale).max(0.0);
    let needs = needs_after(snap, species, h, sleep_end_h);

    // El bienestar no sube nunca entre dos instantáneas: crece sólo durante el tramo
    // inicial en que sigue por encima del umbral. Se encuentra por bisección.
    let above =
        |x: f64| wellbeing(needs_after(snap, species, x, sleep_end_h)) >= GROWTH_MIN_WELLBEING;
    let grown = if !above(0.0) {
        0.0
    } else if above(h) {
        h
    } else {
        let (mut lo, mut hi) = (0.0, h);
        for _ in 0..50 {
            let mid = (lo + hi) / 2.0;
            if above(mid) { lo = mid } else { hi = mid }
        }
        lo
    };
    let growth_hours = snap.growth_hours + grown;

    PetState {
        hunger: needs.0,
        mood: needs.1,
        energy: needs.2,
        wellbeing: wellbeing(needs),
        growth_hours,
        stage: Stage::of(species, growth_hours),
        sleeping: now < snap.sleep_until,
        can_play: now >= snap.play_ready_at,
    }
}

/// Aplica una acción en `now` y devuelve la instantánea nueva. Materializa primero el
/// estado derivado, para que el crecimiento hasta ahora quede guardado.
pub fn apply(
    species: Species,
    snap: &Snapshot,
    action: Action,
    now: i64,
    time_scale: f64,
) -> Result<Snapshot, ActionRefusal> {
    let state = state_at(species, snap, now, time_scale);
    if state.sleeping {
        return Err(ActionRefusal::Sleeping);
    }
    let mut next = Snapshot {
        hunger: state.hunger,
        mood: state.mood,
        energy: state.energy,
        growth_hours: state.growth_hours,
        at: now,
        sleep_until: snap.sleep_until,
        play_ready_at: snap.play_ready_at,
    };
    match action {
        Action::Feed => next.hunger = (next.hunger + FEED_HUNGER).min(MAX_NEED),
        Action::Play => {
            if !state.can_play {
                return Err(ActionRefusal::PlayCooldown);
            }
            next.mood = (next.mood + PLAY_MOOD).min(MAX_NEED);
            next.play_ready_at = after_game_hours(now, PLAY_COOLDOWN_HOURS, time_scale);
        }
        Action::Sleep => {
            next.energy = MAX_NEED;
            next.sleep_until = after_game_hours(now, SLEEP_HOURS, time_scale);
        }
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3600;

    fn adult_snapshot() -> Snapshot {
        Snapshot {
            growth_hours: 100.0,
            ..Snapshot::newborn(0)
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn stages_follow_growth() {
        assert_eq!(Stage::of(Species::Brasa, 0.0), Stage::Baby);
        assert_eq!(Stage::of(Species::Brasa, 24.0), Stage::Young);
        assert_eq!(Stage::of(Species::Brasa, 72.0), Stage::Adult);
        assert_eq!(Stage::of(Species::Vaho, 72.0), Stage::Young);
        assert_eq!(Stage::of(Species::Vaho, 96.0), Stage::Adult);
    }

    #[test]
    fn needs_at_zero_are_the_snapshot() {
        let s = state_at(Species::Gota, &adult_snapshot(), 0, 1.0);
        assert_eq!(
            (s.hunger, s.mood, s.energy, s.wellbeing),
            (100.0, 100.0, 100.0, 100.0)
        );
    }

    #[test]
    fn adult_needs_after_ten_hours() {
        let s = state_at(Species::Gota, &adult_snapshot(), 10 * HOUR, 1.0);
        assert!(close(s.hunger, 60.0));
        assert!(close(s.mood, 70.0));
        assert!(close(s.energy, 80.0));
        assert!(close(s.wellbeing, 70.0));
        assert!(close(s.growth_hours, 110.0));
    }

    #[test]
    fn babies_decay_twice_as_fast() {
        let s = state_at(Species::Gota, &Snapshot::newborn(0), 10 * HOUR, 1.0);
        assert!(close(s.hunger, 20.0));
        assert!(close(s.mood, 40.0));
        assert!(close(s.energy, 60.0));
    }

    #[test]
    fn needs_floor_at_zero() {
        let s = state_at(Species::Gota, &adult_snapshot(), 1000 * HOUR, 1.0);
        assert_eq!((s.hunger, s.mood, s.energy), (0.0, 0.0, 0.0));
    }

    #[test]
    fn time_scale_speeds_everything_up() {
        // 10 horas de juego son 300 s reales con escala 120.
        let s = state_at(Species::Gota, &adult_snapshot(), 300, 120.0);
        assert!(close(s.hunger, 60.0));
    }

    #[test]
    fn energy_holds_while_sleeping() {
        let snap = apply(Species::Gota, &adult_snapshot(), Action::Sleep, 0, 1.0).unwrap();
        let during = state_at(Species::Gota, &snap, HOUR, 1.0);
        assert!(during.sleeping);
        assert_eq!(during.energy, 100.0);
        assert!(close(during.hunger, 96.0));
        let after = state_at(Species::Gota, &snap, 3 * HOUR, 1.0);
        assert!(!after.sleeping);
        assert!(close(after.energy, 98.0)); // 1 h despierta tras 2 h de sueño
    }

    #[test]
    fn growth_stops_when_wellbeing_drops_below_threshold() {
        // Adulta: el bienestar baja 3 puntos/h (media de 4, 3 y 2) desde 100.
        // Cruza 30 a las 70/3 h ≈ 23,33 h, mientras ninguna necesidad toca 0.
        let s = state_at(Species::Gota, &adult_snapshot(), 40 * HOUR, 1.0);
        assert!(
            (s.growth_hours - (100.0 + 70.0 / 3.0)).abs() < 1e-3,
            "{}",
            s.growth_hours
        );
    }

    #[test]
    fn neglected_pet_does_not_grow() {
        let snap = Snapshot {
            hunger: 0.0,
            mood: 0.0,
            energy: 50.0,
            ..adult_snapshot()
        };
        let s = state_at(Species::Gota, &snap, 5 * HOUR, 1.0);
        assert_eq!(s.growth_hours, 100.0);
    }

    #[test]
    fn feed_caps_at_max_and_keeps_growth() {
        let snap = apply(
            Species::Gota,
            &adult_snapshot(),
            Action::Feed,
            10 * HOUR,
            1.0,
        )
        .unwrap();
        assert!(close(snap.hunger, 95.0));
        assert!(close(snap.growth_hours, 110.0));
        assert_eq!(snap.at, 10 * HOUR);
        let again = apply(Species::Gota, &snap, Action::Feed, 10 * HOUR, 1.0).unwrap();
        assert_eq!(again.hunger, 100.0);
    }

    #[test]
    fn play_has_cooldown() {
        let snap = Snapshot {
            mood: 50.0,
            ..adult_snapshot()
        };
        let snap = apply(Species::Gota, &snap, Action::Play, 0, 1.0).unwrap();
        assert!(close(snap.mood, 75.0));
        assert_eq!(
            apply(Species::Gota, &snap, Action::Play, 10 * 60, 1.0),
            Err(ActionRefusal::PlayCooldown)
        );
        assert!(apply(Species::Gota, &snap, Action::Play, 30 * 60, 1.0).is_ok());
    }

    #[test]
    fn nothing_can_be_done_while_sleeping() {
        let snap = apply(Species::Gota, &adult_snapshot(), Action::Sleep, 0, 1.0).unwrap();
        for action in [Action::Feed, Action::Play, Action::Sleep] {
            assert_eq!(
                apply(Species::Gota, &snap, action, HOUR, 1.0),
                Err(ActionRefusal::Sleeping)
            );
        }
    }
}
