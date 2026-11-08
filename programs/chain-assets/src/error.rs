use anchor_lang::prelude::*;

#[error_code]
pub enum ChainAssetsError {
    #[msg("game_id debe cumplir [a-z0-9-] y tener de 1 a 32 caracteres")]
    InvalidGameId,
    #[msg("La nueva autoridad es igual a la actual")]
    SameAuthority,
    #[msg("name debe tener de 1 a 32 caracteres")]
    InvalidName,
    #[msg("symbol debe tener de 1 a 10 caracteres")]
    InvalidSymbol,
    #[msg("uri admite como máximo 200 caracteres")]
    InvalidUri,
    #[msg("collection debe tener de 1 a 64 caracteres")]
    InvalidCollection,
    #[msg("Como máximo 8 cualidades")]
    TooManyQualities,
    #[msg("Cada clave de cualidad tiene de 1 a 32 caracteres")]
    InvalidQualityKey,
    #[msg("Cada valor de cualidad tiene de 1 a 64 caracteres")]
    InvalidQualityValue,
    #[msg("La clave collection está reservada")]
    ReservedQualityKey,
    #[msg("Clave de cualidad repetida")]
    DuplicateQualityKey,
    #[msg("amount debe ser mayor que cero")]
    InvalidAmount,
    #[msg("El emisor y el receptor son el mismo tenedor")]
    SameHolder,
}
