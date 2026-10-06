//! GDExtension de *Nidada*: una capa fina sobre `nidada-rules` para que el cliente dibuje
//! sin preguntar al servidor cada segundo.
//!
//! No llama a la red, no guarda nada y no decide nada (`docs/implementacion-android.md`,
//! sección 8). Lo que calcula aquí es una predicción; cuando el servidor responde, manda
//! el servidor.

use godot::prelude::*;
use nidada_rules::{PetState, Snapshot, Species, needs};

struct NidadaExtension;

#[gdextension]
unsafe impl ExtensionLibrary for NidadaExtension {}

/// Vista de una mascota construida con la instantánea que manda el servidor.
///
/// Uso desde GDScript: `PetView.create(...)`, luego `refresh(ahora)` en cada fotograma y
/// leer los valores.
#[derive(GodotClass)]
#[class(base = RefCounted, no_init)]
pub struct PetView {
    species: Species,
    snapshot: Snapshot,
    time_scale: f64,
    state: PetState,
}

#[godot_api]
impl PetView {
    /// `null` si la especie no existe o la escala no es positiva.
    #[func]
    #[allow(clippy::too_many_arguments)]
    fn create(
        species_key: GString,
        hunger: f64,
        mood: f64,
        energy: f64,
        growth_hours: f64,
        at: i64,
        sleep_until: i64,
        play_ready_at: i64,
        time_scale: f64,
    ) -> Option<Gd<PetView>> {
        let species = Species::from_key(&species_key.to_string())?;
        if time_scale <= 0.0 {
            return None;
        }
        let snapshot = Snapshot {
            hunger,
            mood,
            energy,
            growth_hours,
            at,
            sleep_until,
            play_ready_at,
        };
        let state = needs::state_at(species, &snapshot, at, time_scale);
        Some(Gd::from_object(PetView {
            species,
            snapshot,
            time_scale,
            state,
        }))
    }

    /// Recalcula el estado en el instante `now` (segundos Unix, ya corregidos con el reloj
    /// del servidor).
    #[func]
    fn refresh(&mut self, now: i64) {
        self.state = needs::state_at(self.species, &self.snapshot, now, self.time_scale);
    }

    #[func]
    fn species_key(&self) -> GString {
        self.species.key().into()
    }

    #[func]
    fn hunger(&self) -> f64 {
        self.state.hunger
    }

    #[func]
    fn mood(&self) -> f64 {
        self.state.mood
    }

    #[func]
    fn energy(&self) -> f64 {
        self.state.energy
    }

    #[func]
    fn wellbeing(&self) -> f64 {
        self.state.wellbeing
    }

    #[func]
    fn growth_hours(&self) -> f64 {
        self.state.growth_hours
    }

    /// Fracción de 0 a 1 del camino hasta adulta.
    #[func]
    fn growth_progress(&self) -> f64 {
        (self.state.growth_hours / self.species.growth_hours()).min(1.0)
    }

    /// `baby`, `young` o `adult`.
    #[func]
    fn stage(&self) -> GString {
        self.state.stage.key().into()
    }

    #[func]
    fn is_sleeping(&self) -> bool {
        self.state.sleeping
    }

    #[func]
    fn can_play(&self) -> bool {
        self.state.can_play
    }

    /// Si está creciendo: bienestar por encima del umbral.
    #[func]
    fn is_growing(&self) -> bool {
        self.state.wellbeing >= needs::GROWTH_MIN_WELLBEING
    }
}

/// Datos del catálogo para mostrar. No sabe nada de identificadores de objeto: ese mapa
/// es del servidor.
#[derive(GodotClass)]
#[class(base = RefCounted, no_init)]
pub struct SpeciesCatalog;

#[godot_api]
impl SpeciesCatalog {
    #[func]
    fn display_name(key: GString) -> GString {
        Species::from_key(&key.to_string())
            .map_or("", Species::display_name)
            .into()
    }

    /// `common`, `rare`, o vacío si la especie no existe.
    #[func]
    fn rarity(key: GString) -> GString {
        Species::from_key(&key.to_string())
            .map_or("", |s| match s.rarity() {
                nidada_rules::Rarity::Common => "common",
                nidada_rules::Rarity::Rare => "rare",
            })
            .into()
    }

    /// Elementos unidos por `+`, como la cualidad `element` del diseño (3.2).
    #[func]
    fn element(key: GString) -> GString {
        let Some(species) = Species::from_key(&key.to_string()) else {
            return GString::new();
        };
        let joined = species
            .elements()
            .iter()
            .map(|e| match e {
                nidada_rules::Element::Fire => "fire",
                nidada_rules::Element::Water => "water",
                nidada_rules::Element::Plant => "plant",
                nidada_rules::Element::Air => "air",
            })
            .collect::<Vec<_>>()
            .join("+");
        GString::from(joined.as_str())
    }
}
