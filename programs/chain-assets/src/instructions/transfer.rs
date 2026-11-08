use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, Token2022, TokenAccount, TransferChecked,
};

use crate::error::ChainAssetsError;
use crate::events::ItemTransferred;
use crate::state::{Game, GAME_SEED};

/// Cuentas de `transfer`. Se llama `TransferItem` y no `Transfer` para no chocar con la
/// `Transfer` del programa del sistema que usa `create_item`.
#[derive(Accounts)]
pub struct TransferItem<'info> {
    /// Autoridad del juego: firma y paga la cuenta de token del receptor si hay que crearla.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GAME_SEED, game.game_id.as_bytes()],
        bump = game.bump,
        has_one = authority,
    )]
    pub game: Account<'info, Game>,

    /// El tipo debe ser de este juego, con la misma comprobación que en `grant` y por los mismos
    /// motivos. Aquí la PDA no actúa como autoridad de acuñación sino como delegado permanente,
    /// pero `create_item` fija las dos a la vez, así que un tipo de otro juego falla igual.
    #[account(
        mint::authority = game,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Cuenta de token del emisor. El emisor no firma: mueve el saldo la PDA `Game`, delegado
    /// permanente del mint (propuesta, 4.2 y 12.3).
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub from_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: propietario de la cuenta de token del receptor. Clave cualquiera, no firma.
    pub to_holder: UncheckedAccount<'info>,

    /// Cuenta de token asociada del receptor. Se crea si no existe y la paga la autoridad.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = to_holder,
        associated_token::token_program = token_program,
    )]
    pub to_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn transfer_handler(ctx: Context<TransferItem>, amount: u64) -> Result<()> {
    require!(amount > 0, ChainAssetsError::InvalidAmount);
    // Emisor y receptor se comparan por el propietario de la cuenta, que es el tenedor. Si las
    // dos son la misma cuenta asociada, Anchor ya lo rechaza antes de llegar aquí
    // (`ConstraintDuplicateMutableAccount`); esto cubre un origen que no es la cuenta asociada.
    require_keys_neq!(
        ctx.accounts.from_token.owner,
        ctx.accounts.to_holder.key(),
        ChainAssetsError::SameHolder
    );

    let game = &ctx.accounts.game;
    let game_id = game.game_id.as_bytes();
    let bump = [game.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[GAME_SEED, game_id, &bump]];

    // La PDA del juego firma como delegado permanente. El saldo insuficiente lo rechaza
    // Token-2022; el programa no lleva saldos.
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.from_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.to_token.to_account_info(),
                authority: game.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    emit!(ItemTransferred {
        game: game.key(),
        mint: ctx.accounts.mint.key(),
        from: ctx.accounts.from_token.owner,
        to: ctx.accounts.to_holder.key(),
        amount,
    });
    Ok(())
}
