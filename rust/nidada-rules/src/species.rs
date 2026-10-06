//! Catálogo de especies y tabla de cruce (diseño 3.2 y 6.3).

use crate::rng::SplitMix64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Element {
    Fire,
    Water,
    Plant,
    Air,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rarity {
    Common,
    Rare,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Species {
    Brasa,
    Gota,
    Musgo,
    Pluma,
    Vaho,
    Ceniza,
    Chispa,
    Cienaga,
    Bruma,
    Polen,
}

impl Species {
    pub const ALL: [Species; 10] = [
        Species::Brasa,
        Species::Gota,
        Species::Musgo,
        Species::Pluma,
        Species::Vaho,
        Species::Ceniza,
        Species::Chispa,
        Species::Cienaga,
        Species::Bruma,
        Species::Polen,
    ];

    pub const COMMON: [Species; 4] = [
        Species::Brasa,
        Species::Gota,
        Species::Musgo,
        Species::Pluma,
    ];

    /// Clave estable para persistencia y para el protocolo con el cliente.
    pub fn key(self) -> &'static str {
        match self {
            Species::Brasa => "brasa",
            Species::Gota => "gota",
            Species::Musgo => "musgo",
            Species::Pluma => "pluma",
            Species::Vaho => "vaho",
            Species::Ceniza => "ceniza",
            Species::Chispa => "chispa",
            Species::Cienaga => "cienaga",
            Species::Bruma => "bruma",
            Species::Polen => "polen",
        }
    }

    pub fn from_key(key: &str) -> Option<Species> {
        Species::ALL.into_iter().find(|s| s.key() == key)
    }

    /// Nombre que ve el jugador.
    pub fn display_name(self) -> &'static str {
        match self {
            Species::Cienaga => "Ciénaga",
            Species::Brasa => "Brasa",
            Species::Gota => "Gota",
            Species::Musgo => "Musgo",
            Species::Pluma => "Pluma",
            Species::Vaho => "Vaho",
            Species::Ceniza => "Ceniza",
            Species::Chispa => "Chispa",
            Species::Bruma => "Bruma",
            Species::Polen => "Polen",
        }
    }

    /// Uno o dos elementos. Las raras son la unión de sus dos progenitores comunes.
    pub fn elements(self) -> &'static [Element] {
        use Element::*;
        match self {
            Species::Brasa => &[Fire],
            Species::Gota => &[Water],
            Species::Musgo => &[Plant],
            Species::Pluma => &[Air],
            Species::Vaho => &[Fire, Water],
            Species::Ceniza => &[Fire, Plant],
            Species::Chispa => &[Fire, Air],
            Species::Cienaga => &[Water, Plant],
            Species::Bruma => &[Water, Air],
            Species::Polen => &[Plant, Air],
        }
    }

    pub fn rarity(self) -> Rarity {
        if self.elements().len() == 1 {
            Rarity::Common
        } else {
            Rarity::Rare
        }
    }

    /// Horas de juego hasta adulta: 72 en comunes, 96 en raras.
    pub fn growth_hours(self) -> f64 {
        match self.rarity() {
            Rarity::Common => 72.0,
            Rarity::Rare => 96.0,
        }
    }

    /// La rara que nace de dos comunes distintas. `None` si no son dos comunes distintas.
    fn rare_from(a: Species, b: Species) -> Option<Species> {
        if a == b || a.rarity() != Rarity::Common || b.rarity() != Rarity::Common {
            return None;
        }
        let (ea, eb) = (a.elements()[0], b.elements()[0]);
        Species::ALL.into_iter().find(|s| {
            let e = s.elements();
            e.len() == 2 && e.contains(&ea) && e.contains(&eb)
        })
    }

    /// Especie de la cría (diseño 6.3). La tirada sólo se usa si hay al menos una rara.
    pub fn cross(a: Species, b: Species, rng: &mut SplitMix64) -> Species {
        if a == b {
            return a;
        }
        if let Some(rare) = Species::rare_from(a, b) {
            return rare;
        }
        if rng.below(2) == 0 { a } else { b }
    }

    /// Dos comunes distintas al azar para un jugador nuevo (diseño 3.2).
    pub fn starters(rng: &mut SplitMix64) -> [Species; 2] {
        let first = rng.below(4) as usize;
        let second = (first + 1 + rng.below(3) as usize) % 4;
        [Species::COMMON[first], Species::COMMON[second]]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Species::*;

    #[test]
    fn keys_round_trip() {
        for s in Species::ALL {
            assert_eq!(Species::from_key(s.key()), Some(s));
        }
        assert_eq!(Species::from_key("dragon"), None);
    }

    #[test]
    fn rarity_and_growth_match_design_table() {
        for s in [Brasa, Gota, Musgo, Pluma] {
            assert_eq!(s.rarity(), Rarity::Common);
            assert_eq!(s.growth_hours(), 72.0);
        }
        for s in [Vaho, Ceniza, Chispa, Cienaga, Bruma, Polen] {
            assert_eq!(s.rarity(), Rarity::Rare);
            assert_eq!(s.growth_hours(), 96.0);
        }
    }

    /// Tabla 3.2 del diseño, columna «Cómo se obtiene», escrita a mano.
    #[test]
    fn common_crosses_match_design_table() {
        let table = [
            (Brasa, Gota, Vaho),
            (Brasa, Musgo, Ceniza),
            (Brasa, Pluma, Chispa),
            (Gota, Musgo, Cienaga),
            (Gota, Pluma, Bruma),
            (Musgo, Pluma, Polen),
        ];
        let mut rng = SplitMix64::new(1);
        for (a, b, child) in table {
            assert_eq!(Species::cross(a, b, &mut rng), child, "{a:?} x {b:?}");
            assert_eq!(Species::cross(b, a, &mut rng), child, "{b:?} x {a:?}");
        }
    }

    #[test]
    fn same_species_breeds_true() {
        let mut rng = SplitMix64::new(7);
        for s in Species::ALL {
            assert_eq!(Species::cross(s, s, &mut rng), s);
        }
    }

    #[test]
    fn rare_parent_gives_one_of_the_parents_both_ways() {
        let mut seen = std::collections::HashSet::new();
        for seed in 0..64 {
            let child = Species::cross(Vaho, Musgo, &mut SplitMix64::new(seed));
            assert!(child == Vaho || child == Musgo);
            seen.insert(child);
        }
        assert_eq!(
            seen.len(),
            2,
            "en 64 tiradas deben salir los dos progenitores"
        );
    }

    #[test]
    fn starters_are_two_distinct_commons() {
        for seed in 0..200 {
            let [a, b] = Species::starters(&mut SplitMix64::new(seed));
            assert_ne!(a, b);
            assert_eq!(a.rarity(), Rarity::Common);
            assert_eq!(b.rarity(), Rarity::Common);
        }
    }
}
