//! Generador determinista para las tiradas del juego.
//!
//! SplitMix64: diez líneas, sin dependencias y con salida idéntica en cualquier
//! plataforma. No es criptográfico ni lo necesita: decide el color de una cría. Lo que
//! importa es que la misma semilla dé siempre la misma tirada (diseño 6.3: reintentar no
//! vuelve a tirar).

#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Entero en `0..n`. El sesgo del módulo es despreciable para los `n` del juego.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vectores de referencia de SplitMix64 con semilla 0. Si cambian, cambian todas las
    /// crías ya tiradas: el generador no se toca.
    #[test]
    fn reference_vectors() {
        let mut r = SplitMix64::new(0);
        assert_eq!(r.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(r.next_u64(), 0x6E78_9E6A_A1B9_65F4);
        assert_eq!(r.next_u64(), 0x06C4_5D18_8009_454F);
    }
}
