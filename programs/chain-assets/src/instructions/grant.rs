use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, Token2022, TokenAccount};

use crate::error::ChainAssetsError;
use crate::events::ItemGranted;
use crate::state::{Game, GAME_SEED};

#[derive(Accounts)]
pub struct Grant<'info> {
    /// Autoridad del juego: firma y paga la cuenta de token del tenedor si hay que crearla.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GAME_SEED, game.game_id.as_bytes()],
        bump = game.bump,
        has_one = authority,
    )]
    pub game: Account<'info, Game>,

    /// El tipo debe ser de este juego. Se comprueba con `mint::authority = game` y no con las
    /// semillas `["item", game, item_seed]`, por dos motivos:
    ///
    /// 1. Es el poder que se ejerce: `MintTo` lo firma la PDA `Game` como autoridad de
    ///    acuñación. Un tipo creado por otro juego tiene como autoridad otra PDA y falla aquí,
    ///    con un error claro, antes de llegar a Token-2022.
    /// 2. Las semillas obligarían a mandar los 32 bytes de `item_seed` en cada `grant`, y el
    ///    tamaño de `create_item` + `grant` en una transacción va justo (P7).
    ///
    /// Cualquiera puede crear fuera de este programa un mint cuya autoridad sea esta PDA, porque
    /// `InitializeMint` no exige su firma. Emitir de ese mint sólo lo puede pedir la autoridad del
    /// juego, que firma, y no toca los activos de ningún otro juego ni de ningún jugador.
    #[account(
        mut,
        mint::authority = game,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: propietario de la cuenta de token. Es una clave cualquiera que elige el backend y
    /// no firma (propuesta, 4.2). La cuenta asociada se deriva de ella.
    pub holder: UncheckedAccount<'info>,

    /// Cuenta de token asociada del tenedor. Se crea si no existe y la paga la autoridad. Si ya
    /// existe, Anchor comprueba su mint, su propietario, su programa y su dirección.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program,
    )]
    pub holder_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn grant_handler(ctx: Context<Grant>, amount: u64) -> Result<()> {
    require!(amount > 0, ChainAssetsError::InvalidAmount);

    let game = &ctx.accounts.game;
    let game_id = game.game_id.as_bytes();
    let bump = [game.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[GAME_SEED, game_id, &bump]];

    // La PDA del juego firma como autoridad de acuñación.
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.holder_token.to_account_info(),
                authority: game.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(ItemGranted {
        game: game.key(),
        mint: ctx.accounts.mint.key(),
        holder: ctx.accounts.holder.key(),
        amount,
    });
    Ok(())
}
