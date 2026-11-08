use anchor_lang::prelude::*;

/// Semilla de la PDA `Game`: `["game", game_id]`.
pub const GAME_SEED: &[u8] = b"game";
/// Semilla del mint de un tipo: `["item", game, item_seed]`.
pub const ITEM_SEED: &[u8] = b"item";

/// Límites del contrato HTTP, 4.3, y de la propuesta, 4.3. Si cambian allí, cambian aquí.
pub const GAME_ID_MAX: usize = 32;
pub const NAME_MAX: usize = 32;
pub const SYMBOL_MAX: usize = 10;
pub const URI_MAX: usize = 200;
pub const QUALITIES_MAX: usize = 8;
pub const QUALITY_KEY_MAX: usize = 32;
pub const QUALITY_VALUE_MAX: usize = 64;
/// La clave `collection` está reservada: la escribe el backend con el `collection_id`.
pub const COLLECTION_KEY: &str = "collection";

/// Un juego. Su PDA tiene los poderes sobre todos sus activos.
#[account]
#[derive(InitSpace)]
pub struct Game {
    /// Única clave que puede operar en nombre del juego. También paga.
    pub authority: Pubkey,
    #[max_len(32)]
    pub game_id: String,
    pub bump: u8,
}
