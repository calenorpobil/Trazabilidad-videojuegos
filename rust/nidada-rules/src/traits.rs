//! Rasgos individuales y su herencia (diseño 3.3). Cosméticos, no certificados.

use crate::rng::SplitMix64;

/// Número de tonos de color.
pub const COLORS: u8 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Pattern {
    Plain,
    Spots,
    Stripes,
}

impl Pattern {
    pub const ALL: [Pattern; 3] = [Pattern::Plain, Pattern::Spots, Pattern::Stripes];

    pub fn key(self) -> &'static str {
        match self {
            Pattern::Plain => "plain",
            Pattern::Spots => "spots",
            Pattern::Stripes => "stripes",
        }
    }

    pub fn from_key(key: &str) -> Option<Pattern> {
        Pattern::ALL.into_iter().find(|p| p.key() == key)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Traits {
    /// Tono en `0..COLORS`.
    pub color: u8,
    pub pattern: Pattern,
}

impl Traits {
    /// Rasgos al azar, para las mascotas iniciales.
    pub fn random(rng: &mut SplitMix64) -> Traits {
        Traits {
            color: rng.below(COLORS as u64) as u8,
            pattern: Pattern::ALL[rng.below(3) as usize],
        }
    }

    /// Color: 45 % de un progenitor, 45 % del otro, 10 % mutación.
    /// Patrón: 47,5 % / 47,5 % / 5 % de mutación. Tiradas en milésimas.
    pub fn inherit(a: Traits, b: Traits, rng: &mut SplitMix64) -> Traits {
        let color = match rng.below(1000) {
            0..450 => a.color,
            450..900 => b.color,
            _ => rng.below(COLORS as u64) as u8,
        };
        let pattern = match rng.below(1000) {
            0..475 => a.pattern,
            475..950 => b.pattern,
            _ => Pattern::ALL[rng.below(3) as usize],
        };
        Traits { color, pattern }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_keys_round_trip() {
        for p in Pattern::ALL {
            assert_eq!(Pattern::from_key(p.key()), Some(p));
        }
    }

    /// Vector fijo: misma semilla, mismos rasgos. Es la garantía de que reintentar una
    /// cría no vuelve a tirar.
    #[test]
    fn inheritance_is_deterministic() {
        let a = Traits {
            color: 0,
            pattern: Pattern::Plain,
        };
        let b = Traits {
            color: 5,
            pattern: Pattern::Stripes,
        };
        let first = Traits::inherit(a, b, &mut SplitMix64::new(42));
        for _ in 0..10 {
            assert_eq!(Traits::inherit(a, b, &mut SplitMix64::new(42)), first);
        }
    }

    #[test]
    fn inheritance_frequencies_are_close_to_design() {
        let a = Traits {
            color: 0,
            pattern: Pattern::Plain,
        };
        let b = Traits {
            color: 1,
            pattern: Pattern::Spots,
        };
        let n = 20_000;
        let (mut from_a, mut from_b) = (0, 0);
        let mut rng = SplitMix64::new(3);
        for _ in 0..n {
            let t = Traits::inherit(a, b, &mut rng);
            assert!(t.color < COLORS);
            match t.color {
                0 => from_a += 1,
                1 => from_b += 1,
                _ => {}
            }
        }
        // Cada progenitor: 45 % + 10 %/6 de mutación que cae en su color ≈ 46,7 %.
        let expected = 0.45 + 0.10 / 6.0;
        for got in [from_a, from_b] {
            let p = got as f64 / n as f64;
            assert!((p - expected).abs() < 0.02, "p = {p}");
        }
    }
}
