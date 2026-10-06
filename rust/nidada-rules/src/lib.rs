//! Reglas de *Nidada*, compartidas por el servidor de juego y el cliente.
//!
//! Puras por diseño (invariante 4 de `docs/implementacion-android.md`): sin Godot, sin red,
//! sin reloj del sistema y sin aleatoriedad propia. El instante actual y las semillas
//! entran como argumentos. Así la misma fórmula da el mismo resultado en los dos lados.
//!
//! Los tiempos se miden en segundos Unix reales. Las reglas del diseño se expresan en
//! horas *de juego*; `time_scale` convierte unas en otras (`docs/diseno-juego.md`, 3.4).

pub mod breeding;
pub mod friend_code;
pub mod needs;
pub mod rng;
pub mod species;
pub mod traits;

pub use breeding::{BreedRefusal, Breeder, BreedingEvent, BreedingState};
pub use needs::{Action, ActionRefusal, PetState, Snapshot, Stage};
pub use rng::SplitMix64;
pub use species::{Element, Rarity, Species};
pub use traits::{Pattern, Traits};

/// Segundos reales que dura una hora de juego con la escala dada.
pub fn real_secs_per_game_hour(time_scale: f64) -> f64 {
    3600.0 / time_scale
}

/// Horas de juego transcurridas entre dos instantes reales.
pub fn game_hours_between(from: i64, to: i64, time_scale: f64) -> f64 {
    (to - from) as f64 / real_secs_per_game_hour(time_scale)
}

/// Instante real que está `hours` horas de juego después de `from`.
pub fn after_game_hours(from: i64, hours: f64, time_scale: f64) -> i64 {
    from + (hours * real_secs_per_game_hour(time_scale)).round() as i64
}

/// Longitud máxima del nombre de una mascota, en caracteres (diseño 3.3).
pub const MAX_NAME_CHARS: usize = 16;

/// Valida y normaliza el nombre que elige el dueño. Devuelve el nombre recortado.
pub fn validate_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    let len = name.chars().count();
    if len == 0 || len > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_rules() {
        assert_eq!(validate_name("  Chispi "), Some("Chispi".into()));
        assert_eq!(validate_name("Ñandú"), Some("Ñandú".into()));
        assert_eq!(validate_name(""), None);
        assert_eq!(validate_name("   "), None);
        assert_eq!(validate_name("abcdefghijklmnopq"), None); // 17
        assert_eq!(
            validate_name("abcdefghijklmnop"),
            Some("abcdefghijklmnop".into())
        ); // 16
        assert_eq!(validate_name("a\nb"), None);
    }

    #[test]
    fn time_scale_conversions() {
        assert_eq!(game_hours_between(0, 3600, 1.0), 1.0);
        assert_eq!(game_hours_between(0, 30, 120.0), 1.0);
        assert_eq!(after_game_hours(1000, 72.0, 120.0), 1000 + 2160);
    }
}
