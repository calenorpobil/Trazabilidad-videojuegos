use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::{
    Field, TokenMetadata,
};
use anchor_spl::token_interface::spl_pod::optional_keys::OptionalNonZeroPubkey;
use anchor_spl::token_interface::{
    token_metadata_initialize, token_metadata_update_field, Mint, Token2022,
    TokenMetadataInitialize, TokenMetadataUpdateField,
};

use crate::error::ChainAssetsError;
use crate::events::ItemCreated;
use crate::state::*;

/// Una cualidad del tipo: un par clave-valor de `additional_metadata`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Quality {
    pub key: String,
    pub value: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateItemArgs {
    /// Semilla del mint. La calcula el backend a partir del `item_id`; el programa no la
    /// interpreta.
    pub item_seed: [u8; 32],
    pub name: String,
    pub symbol: String,
    /// Puede ir vacía (contrato, 4.3).
    pub uri: String,
    /// `collection_id` del catálogo. Se guarda bajo la clave reservada `collection`.
    pub collection: String,
    pub qualities: Vec<Quality>,
}

#[derive(Accounts)]
#[instruction(args: CreateItemArgs)]
pub struct CreateItem<'info> {
    /// Autoridad del juego: firma y paga la cuenta del mint y la renta de sus metadatos.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GAME_SEED, game.game_id.as_bytes()],
        bump = game.bump,
        has_one = authority,
    )]
    pub game: Account<'info, Game>,

    /// El mint es una PDA: firma su propio `CreateAccount` por CPI y no añade una firma a la
    /// transacción (propuesta, 4.2). Anchor inicializa el puntero de metadatos y el delegado
    /// permanente antes que el mint, en la misma instrucción.
    #[account(
        init,
        payer = authority,
        seeds = [ITEM_SEED, game.key().as_ref(), args.item_seed.as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = game,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = game,
        extensions::metadata_pointer::metadata_address = mint,
        extensions::permanent_delegate::delegate = game,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn create_item_handler(ctx: Context<CreateItem>, args: CreateItemArgs) -> Result<()> {
    validate(&args)?;

    let CreateItemArgs {
        item_seed,
        name,
        symbol,
        uri,
        collection,
        qualities,
    } = args;
    let game = &ctx.accounts.game;
    let mint_info = ctx.accounts.mint.to_account_info();

    // Todas las claves propias, la reservada primero.
    let mut additional = Vec::with_capacity(qualities.len() + 1);
    additional.push((COLLECTION_KEY.to_string(), collection));
    additional.extend(qualities.into_iter().map(|q| (q.key, q.value)));

    // `TokenMetadata` es TLV de longitud variable: ni `InitializeTokenMetadata` ni `UpdateField`
    // transfieren lamports al redimensionar (propuesta, 13, puntos 4 y 7). Se calcula el tamaño
    // final, con todas las claves, y se paga la diferencia de renta antes de escribir nada.
    let metadata = TokenMetadata {
        update_authority: OptionalNonZeroPubkey::try_from(Some(game.key()))?,
        mint: mint_info.key(),
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        additional_metadata: additional.clone(),
    };
    let final_len = mint_info.data_len() + metadata.tlv_size_of()?;
    let required = Rent::get()?.minimum_balance(final_len);
    let top_up = required.saturating_sub(mint_info.lamports());
    if top_up > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: mint_info.clone(),
                },
            ),
            top_up,
        )?;
    }

    // La PDA del juego firma como autoridad de acuñación y de actualización.
    let game_id = game.game_id.as_bytes();
    let bump = [game.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[GAME_SEED, game_id, &bump]];
    let game_info = game.to_account_info();
    let token_program = ctx.accounts.token_program.key();

    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_program,
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: game_info.clone(),
                mint_authority: game_info.clone(),
                mint: mint_info.clone(),
            },
            signer_seeds,
        ),
        name,
        symbol,
        uri,
    )?;

    for (key, value) in additional {
        token_metadata_update_field(
            CpiContext::new_with_signer(
                token_program,
                TokenMetadataUpdateField {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: mint_info.clone(),
                    update_authority: game_info.clone(),
                },
                signer_seeds,
            ),
            Field::Key(key),
            value,
        )?;
    }

    emit!(ItemCreated {
        game: game.key(),
        mint: mint_info.key(),
        item_seed,
    });
    Ok(())
}

/// Límites del contrato HTTP, 4.3, contados en caracteres como allí.
fn validate(args: &CreateItemArgs) -> Result<()> {
    let len = |s: &str| s.chars().count();
    require!(
        (1..=NAME_MAX).contains(&len(&args.name)),
        ChainAssetsError::InvalidName
    );
    require!(
        (1..=SYMBOL_MAX).contains(&len(&args.symbol)),
        ChainAssetsError::InvalidSymbol
    );
    require!(len(&args.uri) <= URI_MAX, ChainAssetsError::InvalidUri);
    require!(
        (1..=QUALITY_VALUE_MAX).contains(&len(&args.collection)),
        ChainAssetsError::InvalidCollection
    );
    require!(
        args.qualities.len() <= QUALITIES_MAX,
        ChainAssetsError::TooManyQualities
    );
    for (i, q) in args.qualities.iter().enumerate() {
        require!(
            (1..=QUALITY_KEY_MAX).contains(&len(&q.key)),
            ChainAssetsError::InvalidQualityKey
        );
        require!(
            (1..=QUALITY_VALUE_MAX).contains(&len(&q.value)),
            ChainAssetsError::InvalidQualityValue
        );
        require!(
            q.key != COLLECTION_KEY,
            ChainAssetsError::ReservedQualityKey
        );
        require!(
            args.qualities[..i].iter().all(|p| p.key != q.key),
            ChainAssetsError::DuplicateQualityKey
        );
    }
    Ok(())
}
