use anchor_lang::prelude::*;

use crate::error::ChainAssetsError;
use crate::events::GameInitialized;
use crate::state::{Game, GAME_ID_MAX, GAME_SEED};

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct InitializeGame<'info> {
    /// Autoridad del juego: firma y paga. Es la única firma de la transacción.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Un `game_id` de más de 32 bytes no llega al handler: la derivación de la PDA falla antes,
    /// porque una semilla no puede pasar de 32 bytes.
    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED, game_id.as_bytes()],
        bump,
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_game_handler(ctx: Context<InitializeGame>, game_id: String) -> Result<()> {
    require!(is_valid_game_id(&game_id), ChainAssetsError::InvalidGameId);

    let game = &mut ctx.accounts.game;
    game.authority = ctx.accounts.authority.key();
    game.game_id = game_id;
    game.bump = ctx.bumps.game;

    emit!(GameInitialized {
        game: game.key(),
        game_id: game.game_id.clone(),
        authority: game.authority,
    });
    Ok(())
}

/// `[a-z0-9-]{1,32}`, la misma regla que `GAME_ID_PATTERN` en `backend/src/keys.ts`.
pub fn is_valid_game_id(game_id: &str) -> bool {
    (1..=GAME_ID_MAX).contains(&game_id.len())
        && game_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
