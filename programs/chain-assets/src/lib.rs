//! `chain-assets`: el programa mínimo que tiene los poderes sobre los activos de cada juego
//! (propuesta, 4.7).
//!
//! No lleva saldos ni reimplementa tokens: los activos son mints Token-2022 y este programa sólo
//! los controla por CPI. Tampoco contiene lógica de juego. La PDA `Game` es *mint authority*,
//! autoridad de actualización de los metadatos y *permanent delegate* de todos los activos de su
//! juego; la autoridad del juego sólo tiene poder a través de ella. Por eso rotarla es una
//! instrucción y no un recorrido por todos los mints.
//!
//! Invariante 1: toda transacción tiene una sola firma requerida, la de la autoridad, que además
//! paga. La PDA del juego y el mint (también PDA) firman por CPI con sus semillas, y eso no es una
//! firma de la transacción.

use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz");

#[program]
pub mod chain_assets {
    use super::*;

    /// Crea la cuenta `Game` de un juego y fija su autoridad, que es quien firma y paga.
    ///
    /// `game_id` cumple `[a-z0-9-]{1,32}`, igual que en el backend. No se puede repetir: la
    /// PDA ya existiría y `init` fallaría.
    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: String) -> Result<()> {
        instructions::initialize_game::initialize_game_handler(ctx, game_id)
    }

    /// Cambia la autoridad del juego. La firma la autoridad actual y la nueva debe ser distinta.
    /// Los mints no cambian, porque sus poderes los tiene la PDA del juego.
    pub fn rotate_authority(ctx: Context<RotateAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::rotate_authority::rotate_authority_handler(ctx, new_authority)
    }

    /// Crea un tipo de objeto: un mint Token-2022 PDA, de 0 decimales, con `MetadataPointer`
    /// apuntando a sí mismo, `PermanentDelegate` y `TokenMetadata`. Las cualidades y la colección
    /// van en `additional_metadata`. Límites iguales al contrato HTTP, 4.3.
    pub fn create_item(ctx: Context<CreateItem>, args: CreateItemArgs) -> Result<()> {
        instructions::create_item::create_item_handler(ctx, args)
    }

    /// Entrega `amount` unidades de un tipo a un tenedor: crea su cuenta de token asociada si
    /// hace falta, pagada por la autoridad, y emite con `MintTo` firmando la PDA del juego. El
    /// tenedor no firma. `amount` es mayor que cero y el tipo debe ser de este juego.
    pub fn grant(ctx: Context<Grant>, amount: u64) -> Result<()> {
        instructions::grant::grant_handler(ctx, amount)
    }

    /// Mueve `amount` unidades entre dos tenedores con `TransferChecked`, firmando la PDA del
    /// juego como delegado permanente: el emisor no firma. Crea la cuenta del receptor si hace
    /// falta. `amount` es mayor que cero, emisor y receptor son distintos, y el saldo
    /// insuficiente lo rechaza Token-2022.
    pub fn transfer(ctx: Context<TransferItem>, amount: u64) -> Result<()> {
        instructions::transfer::transfer_handler(ctx, amount)
    }
}
