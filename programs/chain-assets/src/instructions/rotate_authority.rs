use anchor_lang::prelude::*;

use crate::error::ChainAssetsError;
use crate::events::AuthorityRotated;
use crate::state::{Game, GAME_SEED};

#[derive(Accounts)]
pub struct RotateAuthority<'info> {
    /// Autoridad actual: firma y paga la comisión.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.as_bytes()],
        bump = game.bump,
        has_one = authority,
    )]
    pub game: Account<'info, Game>,
}

pub fn rotate_authority_handler(
    ctx: Context<RotateAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require_keys_neq!(
        new_authority,
        game.authority,
        ChainAssetsError::SameAuthority
    );

    let old_authority = game.authority;
    game.authority = new_authority;

    emit!(AuthorityRotated {
        game: game.key(),
        old_authority,
        new_authority,
    });
    Ok(())
}
