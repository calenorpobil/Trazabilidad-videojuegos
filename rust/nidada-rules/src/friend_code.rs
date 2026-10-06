//! Código de amigo (diseño 5): seis caracteres que un jugador le dicta a otro.
//!
//! Está aquí y no en el servidor para que el cliente valide el formato antes de enviar
//! nada, con exactamente la misma regla.

use crate::rng::SplitMix64;

pub const LEN: usize = 6;

/// 31 símbolos: sin `0/O` ni `1/I/L`, que se confunden al dictarlos o copiarlos a mano.
/// 31^6 ≈ 887 millones de códigos.
pub const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

pub fn generate(rng: &mut SplitMix64) -> String {
    (0..LEN)
        .map(|_| ALPHABET[rng.below(ALPHABET.len() as u64) as usize] as char)
        .collect()
}

/// Forma canónica de lo que escribe el jugador: ignora espacios y guiones y acepta
/// minúsculas. `None` si no es un código válido.
pub fn normalize(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let valid = code.len() == LEN && code.bytes().all(|b| ALPHABET.contains(&b));
    valid.then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_codes_are_valid() {
        let mut rng = SplitMix64::new(9);
        for _ in 0..1000 {
            let code = generate(&mut rng);
            assert_eq!(normalize(&code), Some(code.clone()));
        }
    }

    #[test]
    fn normalization_is_forgiving_with_format() {
        assert_eq!(normalize("k7m2qx"), Some("K7M2QX".into()));
        assert_eq!(normalize(" K7M 2QX "), Some("K7M2QX".into()));
        assert_eq!(normalize("K7M-2QX"), Some("K7M2QX".into()));
    }

    #[test]
    fn rejects_wrong_length_and_ambiguous_symbols() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("K7M2Q"), None);
        assert_eq!(normalize("K7M2QXZ"), None);
        for bad in [
            "K7M2Q0", "K7M2QO", "K7M2Q1", "K7M2QI", "K7M2QL", "K7M2Q!", "K7M2QÑ",
        ] {
            assert_eq!(normalize(bad), None, "{bad}");
        }
    }

    #[test]
    fn alphabet_has_no_ambiguous_symbols() {
        assert_eq!(ALPHABET.len(), 31);
        for b in b"01OIL" {
            assert!(!ALPHABET.contains(b));
        }
    }
}
