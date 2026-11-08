//! Tests de `chain-assets` con LiteSVM, sin red. Cargan el `.so` de `anchor build`.
//!
//! Cada instrucción tiene al menos un test negativo: otro firmante, valores fuera de límite y
//! tipo de otro juego (propuesta, 4.7). `grant` y `transfer` añaden cantidad cero, emisor igual a
//! receptor y saldo insuficiente. Toda transacción que construyen comprueba el invariante 1:
//! una sola firma requerida.

use {
    anchor_lang::{
        error::ErrorCode, prelude::Pubkey, solana_program::instruction::Instruction,
        system_program, AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{self, get_associated_token_address_with_program_id},
        token_2022::spl_token_2022::{
            self,
            extension::{
                metadata_pointer::MetadataPointer, permanent_delegate::PermanentDelegate,
                BaseStateWithExtensions, StateWithExtensions,
            },
            state::{Account as TokenAccountState, Mint},
        },
        token_2022_extensions::spl_token_metadata_interface::state::TokenMetadata,
    },
    chain_assets::{
        error::ChainAssetsError,
        instructions::{CreateItemArgs, Quality},
        state::{Game, GAME_SEED, ITEM_SEED},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// Anchor numera los errores propios a partir de 6000.
const ANCHOR_ERROR_OFFSET: u32 = 6000;
/// `ConstraintHasOne`: la cuenta firmante no es la autoridad del juego.
const CONSTRAINT_HAS_ONE: u32 = 2001;
/// `TokenError::InsufficientFunds` de Token-2022.
const TOKEN_INSUFFICIENT_FUNDS: u32 = 1;
/// Tamaño máximo de una transacción de Solana (paquete IPv6 menos cabeceras).
const PACKET_DATA_SIZE: usize = 1232;

struct Sent {
    size: usize,
    compute_units: u64,
}

struct Env {
    svm: LiteSVM,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../target/deploy/chain_assets.so"
        ));
        svm.add_program(chain_assets::id(), bytes).unwrap();
        Self { svm }
    }

    fn funded(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        kp
    }

    /// Firma con `payer` y nadie más: si la instrucción pidiera otra firma, falla.
    fn send(&mut self, ix: Instruction, payer: &Keypair) -> Result<Sent, String> {
        self.send_all(&[ix], payer)
    }

    /// Varias instrucciones en una sola transacción, con la misma comprobación del invariante 1.
    fn send_all(&mut self, ixs: &[Instruction], payer: &Keypair) -> Result<Sent, String> {
        let msg =
            Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &self.svm.latest_blockhash());
        let msg = VersionedMessage::Legacy(msg);
        // Invariante 1: exactamente una firma requerida.
        assert_eq!(
            msg.header().num_required_signatures,
            1,
            "más de un firmante"
        );
        let size = 1 + 64 + msg.serialize().len();
        let tx = VersionedTransaction::try_new(msg, &[payer]).map_err(|e| format!("{e:?}"))?;
        let result = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        match result {
            Ok(meta) => Ok(Sent {
                size,
                compute_units: meta.compute_units_consumed,
            }),
            Err(failed) => Err(format!("{:?} {:?}", failed.err, failed.meta.logs)),
        }
    }

    fn game(&self, game: &Pubkey) -> Game {
        let account = self.svm.get_account(game).unwrap();
        Game::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn token(&self, holder: &Pubkey, mint: &Pubkey) -> TokenAccountState {
        let account = self.svm.get_account(&ata(holder, mint)).unwrap();
        assert_eq!(account.owner, spl_token_2022::ID);
        StateWithExtensions::<TokenAccountState>::unpack(&account.data)
            .unwrap()
            .base
    }

    fn balance(&self, holder: &Pubkey, mint: &Pubkey) -> u64 {
        self.token(holder, mint).amount
    }

    fn supply(&self, mint: &Pubkey) -> u64 {
        let account = self.svm.get_account(mint).unwrap();
        StateWithExtensions::<Mint>::unpack(&account.data)
            .unwrap()
            .base
            .supply
    }
}

fn ata(holder: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(holder, mint, &spl_token_2022::ID)
}

fn game_pda(game_id: &str) -> Pubkey {
    Pubkey::find_program_address(&[GAME_SEED, game_id.as_bytes()], &chain_assets::id()).0
}

fn item_pda(game: &Pubkey, seed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[ITEM_SEED, game.as_ref(), seed], &chain_assets::id()).0
}

fn initialize_game_ix(authority: &Pubkey, game_id: &str) -> Instruction {
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::InitializeGame {
            game_id: game_id.to_string(),
        }
        .data(),
        chain_assets::accounts::InitializeGame {
            authority: *authority,
            game: game_pda(game_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn rotate_ix(authority: &Pubkey, game: &Pubkey, new_authority: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::RotateAuthority {
            new_authority: *new_authority,
        }
        .data(),
        chain_assets::accounts::RotateAuthority {
            authority: *authority,
            game: *game,
        }
        .to_account_metas(None),
    )
}

fn create_item_ix(authority: &Pubkey, game: &Pubkey, args: CreateItemArgs) -> Instruction {
    let mint = item_pda(game, &args.item_seed);
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::CreateItem { args }.data(),
        chain_assets::accounts::CreateItem {
            authority: *authority,
            game: *game,
            mint,
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn grant_ix(
    authority: &Pubkey,
    game: &Pubkey,
    mint: &Pubkey,
    holder: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::Grant { amount }.data(),
        chain_assets::accounts::Grant {
            authority: *authority,
            game: *game,
            mint: *mint,
            holder: *holder,
            holder_token: ata(holder, mint),
            token_program: spl_token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn transfer_ix(
    authority: &Pubkey,
    game: &Pubkey,
    mint: &Pubkey,
    from: &Pubkey,
    to: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::Transfer { amount }.data(),
        chain_assets::accounts::TransferItem {
            authority: *authority,
            game: *game,
            mint: *mint,
            from_token: ata(from, mint),
            to_holder: *to,
            to_token: ata(to, mint),
            token_program: spl_token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn sword(seed: u8) -> CreateItemArgs {
    CreateItemArgs {
        item_seed: [seed; 32],
        name: "Espada de hierro".into(),
        symbol: "SWORD".into(),
        uri: "https://ejemplo.test/espada.json".into(),
        collection: "col_7Hs2aaaaaaaaaaaa".into(),
        qualities: vec![
            Quality {
                key: "rarity".into(),
                value: "common".into(),
            },
            Quality {
                key: "damage".into(),
                value: "12".into(),
            },
        ],
    }
}

/// El caso máximo del contrato: 8 pares de 32 y 64 caracteres, `uri` de 200, `name` de 32.
fn max_item(seed: u8) -> CreateItemArgs {
    CreateItemArgs {
        item_seed: [seed; 32],
        name: "n".repeat(32),
        symbol: "s".repeat(10),
        uri: "u".repeat(200),
        collection: "col_7Hs2aaaaaaaaaaaa".into(),
        qualities: (0..8)
            .map(|i| Quality {
                key: format!("{i}").repeat(32),
                value: "v".repeat(64),
            })
            .collect(),
    }
}

fn custom(err: ChainAssetsError) -> String {
    format!("Custom({})", ANCHOR_ERROR_OFFSET + err as u32)
}

fn anchor(err: ErrorCode) -> String {
    format!("Custom({})", err as u32)
}

fn assert_fails_with(result: Result<Sent, String>, code: &str) {
    match result {
        Ok(_) => panic!("se esperaba un fallo con {code}"),
        Err(e) => assert!(e.contains(code), "se esperaba {code}, llegó: {e}"),
    }
}

/// Un tenedor: una clave cualquiera que no firma ni tiene fondos (propuesta, 4.2).
fn holder() -> Pubkey {
    Keypair::new().pubkey()
}

/// Juego listo para usar: devuelve el entorno, la autoridad y la PDA.
fn setup(game_id: &str) -> (Env, Keypair, Pubkey) {
    let mut env = Env::new();
    let authority = env.funded();
    env.send(initialize_game_ix(&authority.pubkey(), game_id), &authority)
        .unwrap();
    (env, authority, game_pda(game_id))
}

// --- initialize_game ---------------------------------------------------------------------

#[test]
fn initialize_game_stores_authority_and_id() {
    let (env, authority, game) = setup("nidada-1");
    let state = env.game(&game);
    assert_eq!(state.authority, authority.pubkey());
    assert_eq!(state.game_id, "nidada-1");
    assert_eq!(
        game,
        Pubkey::find_program_address(&[GAME_SEED, b"nidada-1"], &chain_assets::id()).0
    );
}

#[test]
fn initialize_game_cannot_repeat() {
    let (mut env, _, _) = setup("demo");
    let other = env.funded();
    // La PDA ya existe: ni siquiera otra autoridad puede quedársela.
    assert!(env
        .send(initialize_game_ix(&other.pubkey(), "demo"), &other)
        .is_err());
}

#[test]
fn initialize_game_rejects_invalid_ids() {
    let mut env = Env::new();
    let authority = env.funded();
    for bad in ["", "Demo", "demo_1", "demo 1", "ñ"] {
        assert_fails_with(
            env.send(initialize_game_ix(&authority.pubkey(), bad), &authority),
            &custom(ChainAssetsError::InvalidGameId),
        );
    }
    // 32 caracteres es el máximo; 33 no llega al handler (semilla de más de 32 bytes).
    assert!(env
        .send(
            initialize_game_ix(&authority.pubkey(), &"a".repeat(32)),
            &authority
        )
        .is_ok());
}

#[test]
fn initialize_game_rejects_seed_longer_than_32() {
    // `find_program_address` no admite la semilla, así que se construye a mano con otra PDA.
    let mut env = Env::new();
    let authority = env.funded();
    let long = "a".repeat(33);
    let mut ix = initialize_game_ix(&authority.pubkey(), "a");
    ix.data = chain_assets::instruction::InitializeGame { game_id: long }.data();
    assert!(env.send(ix, &authority).is_err());
}

// --- rotate_authority --------------------------------------------------------------------

#[test]
fn rotate_authority_changes_authority() {
    let (mut env, authority, game) = setup("demo");
    let next = env.funded();
    env.send(
        rotate_ix(&authority.pubkey(), &game, &next.pubkey()),
        &authority,
    )
    .unwrap();
    assert_eq!(env.game(&game).authority, next.pubkey());

    // La antigua ya no tiene poder; la nueva sí.
    assert_fails_with(
        env.send(
            create_item_ix(&authority.pubkey(), &game, sword(1)),
            &authority,
        ),
        &format!("Custom({CONSTRAINT_HAS_ONE})"),
    );
    env.send(create_item_ix(&next.pubkey(), &game, sword(1)), &next)
        .unwrap();
}

#[test]
fn rotate_authority_rejects_other_signer() {
    let (mut env, _, game) = setup("demo");
    let stranger = env.funded();
    assert_fails_with(
        env.send(
            rotate_ix(&stranger.pubkey(), &game, &stranger.pubkey()),
            &stranger,
        ),
        &format!("Custom({CONSTRAINT_HAS_ONE})"),
    );
}

#[test]
fn rotate_authority_rejects_same_authority() {
    let (mut env, authority, game) = setup("demo");
    assert_fails_with(
        env.send(
            rotate_ix(&authority.pubkey(), &game, &authority.pubkey()),
            &authority,
        ),
        &custom(ChainAssetsError::SameAuthority),
    );
}

// --- create_item -------------------------------------------------------------------------

#[test]
fn create_item_builds_pda_mint_with_three_extensions() {
    let (mut env, authority, game) = setup("demo");
    let args = sword(7);
    let mint = item_pda(&game, &args.item_seed);
    env.send(create_item_ix(&authority.pubkey(), &game, args), &authority)
        .unwrap();

    let account = env.svm.get_account(&mint).unwrap();
    assert_eq!(account.owner, spl_token_2022::ID);
    assert!(
        account.lamports
            >= env
                .svm
                .minimum_balance_for_rent_exemption(account.data.len())
    );

    let state = StateWithExtensions::<Mint>::unpack(&account.data).unwrap();
    assert_eq!(state.base.decimals, 0);
    assert_eq!(state.base.supply, 0);
    assert_eq!(
        Option::<Pubkey>::from(state.base.mint_authority),
        Some(game)
    );
    assert_eq!(Option::<Pubkey>::from(state.base.freeze_authority), None);

    let pointer = state.get_extension::<MetadataPointer>().unwrap();
    assert_eq!(Option::<Pubkey>::from(pointer.metadata_address), Some(mint));
    assert_eq!(Option::<Pubkey>::from(pointer.authority), Some(game));

    let delegate = state.get_extension::<PermanentDelegate>().unwrap();
    assert_eq!(Option::<Pubkey>::from(delegate.delegate), Some(game));

    let metadata = state.get_variable_len_extension::<TokenMetadata>().unwrap();
    assert_eq!(metadata.name, "Espada de hierro");
    assert_eq!(metadata.symbol, "SWORD");
    assert_eq!(metadata.uri, "https://ejemplo.test/espada.json");
    assert_eq!(metadata.mint, mint);
    assert_eq!(
        Option::<Pubkey>::from(metadata.update_authority),
        Some(game)
    );
    assert_eq!(
        metadata.additional_metadata,
        vec![
            ("collection".to_string(), "col_7Hs2aaaaaaaaaaaa".to_string()),
            ("rarity".to_string(), "common".to_string()),
            ("damage".to_string(), "12".to_string()),
        ]
    );
}

#[test]
fn create_item_allows_empty_uri_and_no_qualities() {
    let (mut env, authority, game) = setup("demo");
    let mut args = sword(2);
    args.uri.clear();
    args.qualities.clear();
    env.send(create_item_ix(&authority.pubkey(), &game, args), &authority)
        .unwrap();
}

#[test]
fn create_item_rejects_other_signer() {
    let (mut env, _, game) = setup("demo");
    let stranger = env.funded();
    assert_fails_with(
        env.send(
            create_item_ix(&stranger.pubkey(), &game, sword(1)),
            &stranger,
        ),
        &format!("Custom({CONSTRAINT_HAS_ONE})"),
    );
}

#[test]
fn create_item_rejects_game_of_other_authority() {
    // Dos juegos: la autoridad de A no puede crear tipos en B.
    let (mut env, authority_a, _) = setup("game-a");
    let authority_b = env.funded();
    env.send(
        initialize_game_ix(&authority_b.pubkey(), "game-b"),
        &authority_b,
    )
    .unwrap();
    assert_fails_with(
        env.send(
            create_item_ix(&authority_a.pubkey(), &game_pda("game-b"), sword(1)),
            &authority_a,
        ),
        &format!("Custom({CONSTRAINT_HAS_ONE})"),
    );
}

#[test]
fn create_item_cannot_repeat_seed() {
    let (mut env, authority, game) = setup("demo");
    env.send(
        create_item_ix(&authority.pubkey(), &game, sword(1)),
        &authority,
    )
    .unwrap();
    assert!(env
        .send(
            create_item_ix(&authority.pubkey(), &game, sword(1)),
            &authority
        )
        .is_err());
}

#[test]
fn create_item_same_seed_in_two_games_are_different_mints() {
    let (mut env, authority, game_a) = setup("game-a");
    env.send(
        initialize_game_ix(&authority.pubkey(), "game-b"),
        &authority,
    )
    .unwrap();
    let game_b = game_pda("game-b");
    env.send(
        create_item_ix(&authority.pubkey(), &game_a, sword(1)),
        &authority,
    )
    .unwrap();
    env.send(
        create_item_ix(&authority.pubkey(), &game_b, sword(1)),
        &authority,
    )
    .unwrap();
    assert_ne!(item_pda(&game_a, &[1; 32]), item_pda(&game_b, &[1; 32]));
}

#[test]
fn create_item_rejects_out_of_limit_values() {
    let (mut env, authority, game) = setup("demo");
    let cases: Vec<(Box<dyn Fn(&mut CreateItemArgs)>, ChainAssetsError)> = vec![
        (Box::new(|a| a.name.clear()), ChainAssetsError::InvalidName),
        (
            Box::new(|a| a.name = "n".repeat(33)),
            ChainAssetsError::InvalidName,
        ),
        (
            Box::new(|a| a.symbol.clear()),
            ChainAssetsError::InvalidSymbol,
        ),
        (
            Box::new(|a| a.symbol = "s".repeat(11)),
            ChainAssetsError::InvalidSymbol,
        ),
        (
            Box::new(|a| a.uri = "u".repeat(201)),
            ChainAssetsError::InvalidUri,
        ),
        (
            Box::new(|a| a.collection.clear()),
            ChainAssetsError::InvalidCollection,
        ),
        (
            Box::new(|a| {
                a.qualities = (0..9)
                    .map(|i| Quality {
                        key: format!("k{i}"),
                        value: "v".into(),
                    })
                    .collect()
            }),
            ChainAssetsError::TooManyQualities,
        ),
        (
            Box::new(|a| a.qualities[0].key.clear()),
            ChainAssetsError::InvalidQualityKey,
        ),
        (
            Box::new(|a| a.qualities[0].key = "k".repeat(33)),
            ChainAssetsError::InvalidQualityKey,
        ),
        (
            Box::new(|a| a.qualities[0].value.clear()),
            ChainAssetsError::InvalidQualityValue,
        ),
        (
            Box::new(|a| a.qualities[0].value = "v".repeat(65)),
            ChainAssetsError::InvalidQualityValue,
        ),
        (
            Box::new(|a| a.qualities[0].key = "collection".into()),
            ChainAssetsError::ReservedQualityKey,
        ),
        (
            Box::new(|a| a.qualities[1].key = "rarity".into()),
            ChainAssetsError::DuplicateQualityKey,
        ),
    ];
    for (i, (mutate, expected)) in cases.into_iter().enumerate() {
        let mut args = sword(100 + i as u8);
        mutate(&mut args);
        assert_fails_with(
            env.send(create_item_ix(&authority.pubkey(), &game, args), &authority),
            &custom(expected),
        );
    }
}

#[test]
fn create_item_counts_characters_not_bytes() {
    // 32 caracteres con tilde son 64 bytes: el contrato habla de caracteres.
    let (mut env, authority, game) = setup("demo");
    let mut args = sword(3);
    args.name = "á".repeat(32);
    env.send(create_item_ix(&authority.pubkey(), &game, args), &authority)
        .unwrap();
}

/// P7, medido sin red: tamaño y unidades de cómputo de `create_item` en el caso máximo.
/// Con `grant` en la misma transacción, ver `create_item_and_grant_size_and_compute`.
#[test]
fn create_item_max_case_size_and_compute() {
    let (mut env, authority, game) = setup("demo");
    let typical = env
        .send(
            create_item_ix(&authority.pubkey(), &game, sword(1)),
            &authority,
        )
        .unwrap();
    println!(
        "create_item típico: {} bytes, {} CU",
        typical.size, typical.compute_units
    );

    let ix = create_item_ix(&authority.pubkey(), &game, max_item(2));
    let msg = Message::new_with_blockhash(
        &[ix.clone()],
        Some(&authority.pubkey()),
        &env.svm.latest_blockhash(),
    );
    let size = 1 + 64 + VersionedMessage::Legacy(msg).serialize().len();
    println!("create_item máximo: {size} bytes (límite {PACKET_DATA_SIZE})");
    // LiteSVM no aplica el límite de paquete: se ejecuta igualmente para medir el cómputo.
    let max = env.send(ix, &authority).unwrap();
    println!("create_item máximo: {} CU", max.compute_units);
}

// --- grant -------------------------------------------------------------------------------

/// Crea el tipo `sword(seed)` en `game` y devuelve su mint.
fn new_item(env: &mut Env, authority: &Keypair, game: &Pubkey, seed: u8) -> Pubkey {
    env.send(
        create_item_ix(&authority.pubkey(), game, sword(seed)),
        authority,
    )
    .unwrap();
    item_pda(game, &[seed; 32])
}

/// Juego con un tipo creado: entorno, autoridad, PDA del juego y mint.
fn setup_item(game_id: &str) -> (Env, Keypair, Pubkey, Pubkey) {
    let (mut env, authority, game) = setup(game_id);
    let mint = new_item(&mut env, &authority, &game, 1);
    (env, authority, game, mint)
}

#[test]
fn grant_creates_holder_account_and_mints() {
    let (mut env, authority, game, mint) = setup_item("demo");
    let player = holder();
    let before = env.svm.get_balance(&authority.pubkey()).unwrap();
    // `send` comprueba que la única firma es la de la autoridad: el tenedor no firma.
    env.send(
        grant_ix(&authority.pubkey(), &game, &mint, &player, 3),
        &authority,
    )
    .unwrap();

    let token = env.token(&player, &mint);
    assert_eq!(token.owner, player);
    assert_eq!(token.mint, mint);
    assert_eq!(token.amount, 3);
    assert_eq!(env.supply(&mint), 3);
    // La renta de la cuenta nueva la paga la autoridad, que es también la pagadora.
    let account = env.svm.get_account(&ata(&player, &mint)).unwrap();
    assert!(before - env.svm.get_balance(&authority.pubkey()).unwrap() >= account.lamports);
    println!(
        "cuenta de token asociada: {} bytes, {} lamports",
        account.data.len(),
        account.lamports
    );
}

#[test]
fn grant_to_existing_account_adds_units() {
    let (mut env, authority, game, mint) = setup_item("demo");
    let player = holder();
    for amount in [2, 5] {
        env.send(
            grant_ix(&authority.pubkey(), &game, &mint, &player, amount),
            &authority,
        )
        .unwrap();
    }
    assert_eq!(env.balance(&player, &mint), 7);
    assert_eq!(env.supply(&mint), 7);
}

#[test]
fn grant_rejects_other_signer() {
    let (mut env, _, game, mint) = setup_item("demo");
    let stranger = env.funded();
    assert_fails_with(
        env.send(
            grant_ix(&stranger.pubkey(), &game, &mint, &holder(), 1),
            &stranger,
        ),
        &anchor(ErrorCode::ConstraintHasOne),
    );
}

#[test]
fn grant_rejects_zero_amount() {
    let (mut env, authority, game, mint) = setup_item("demo");
    assert_fails_with(
        env.send(
            grant_ix(&authority.pubkey(), &game, &mint, &holder(), 0),
            &authority,
        ),
        &custom(ChainAssetsError::InvalidAmount),
    );
}

#[test]
fn grant_rejects_item_of_other_game() {
    // Un tipo creado por el juego A no se puede emitir con el `Game` B, ni siquiera por la
    // autoridad legítima de B.
    let (mut env, _, _, mint_a) = setup_item("game-a");
    let authority_b = env.funded();
    env.send(
        initialize_game_ix(&authority_b.pubkey(), "game-b"),
        &authority_b,
    )
    .unwrap();
    assert_fails_with(
        env.send(
            grant_ix(
                &authority_b.pubkey(),
                &game_pda("game-b"),
                &mint_a,
                &holder(),
                1,
            ),
            &authority_b,
        ),
        &anchor(ErrorCode::ConstraintMintMintAuthority),
    );
    assert_eq!(env.supply(&mint_a), 0);
}

#[test]
fn grant_rejects_account_of_another_holder() {
    // La cuenta de token existe pero es de otro tenedor: no se puede emitir en ella.
    let (mut env, authority, game, mint) = setup_item("demo");
    let (alice, bob) = (holder(), holder());
    env.send(
        grant_ix(&authority.pubkey(), &game, &mint, &alice, 1),
        &authority,
    )
    .unwrap();
    let mut ix = grant_ix(&authority.pubkey(), &game, &mint, &bob, 1);
    ix.accounts[4].pubkey = ata(&alice, &mint);
    assert_fails_with(
        env.send(ix, &authority),
        &anchor(ErrorCode::ConstraintTokenOwner),
    );
}

// --- transfer ----------------------------------------------------------------------------

/// Juego con un tipo y `amount` unidades en manos de un tenedor.
fn setup_holding(game_id: &str, amount: u64) -> (Env, Keypair, Pubkey, Pubkey, Pubkey) {
    let (mut env, authority, game, mint) = setup_item(game_id);
    let player = holder();
    env.send(
        grant_ix(&authority.pubkey(), &game, &mint, &player, amount),
        &authority,
    )
    .unwrap();
    (env, authority, game, mint, player)
}

#[test]
fn transfer_moves_units_without_sender_signature() {
    let (mut env, authority, game, mint, alice) = setup_holding("demo", 5);
    let bob = holder();
    // La cuenta del receptor no existe: la crea `transfer`. Sólo firma la autoridad.
    env.send(
        transfer_ix(&authority.pubkey(), &game, &mint, &alice, &bob, 2),
        &authority,
    )
    .unwrap();
    assert_eq!(env.balance(&alice, &mint), 3);
    assert_eq!(env.balance(&bob, &mint), 2);
    assert_eq!(env.token(&bob, &mint).owner, bob);
    assert_eq!(env.supply(&mint), 5);

    // Con la cuenta ya creada, y moviendo el saldo entero.
    env.send(
        transfer_ix(&authority.pubkey(), &game, &mint, &alice, &bob, 3),
        &authority,
    )
    .unwrap();
    assert_eq!(env.balance(&alice, &mint), 0);
    assert_eq!(env.balance(&bob, &mint), 5);
}

#[test]
fn transfer_rejects_other_signer() {
    let (mut env, _, game, mint, alice) = setup_holding("demo", 5);
    let stranger = env.funded();
    assert_fails_with(
        env.send(
            transfer_ix(&stranger.pubkey(), &game, &mint, &alice, &holder(), 1),
            &stranger,
        ),
        &anchor(ErrorCode::ConstraintHasOne),
    );
}

#[test]
fn transfer_rejects_zero_amount() {
    let (mut env, authority, game, mint, alice) = setup_holding("demo", 5);
    assert_fails_with(
        env.send(
            transfer_ix(&authority.pubkey(), &game, &mint, &alice, &holder(), 0),
            &authority,
        ),
        &custom(ChainAssetsError::InvalidAmount),
    );
}

#[test]
fn transfer_rejects_same_holder() {
    // Con la misma cuenta asociada en origen y destino, Anchor lo rechaza antes del handler:
    // es la misma cuenta mutable dos veces.
    let (mut env, authority, game, mint, alice) = setup_holding("demo", 5);
    assert_fails_with(
        env.send(
            transfer_ix(&authority.pubkey(), &game, &mint, &alice, &alice, 1),
            &authority,
        ),
        &anchor(ErrorCode::ConstraintDuplicateMutableAccount),
    );
    assert_eq!(env.balance(&alice, &mint), 5);
}

#[test]
fn transfer_rejects_same_holder_from_other_account() {
    // El origen es otra cuenta de token del mismo tenedor, no la asociada: lo para `SameHolder`.
    // Se copia la cuenta asociada a otra dirección, porque crearla con su propia clave pediría
    // una segunda firma, y `send` no lo admite.
    let (mut env, authority, game, mint, alice) = setup_holding("demo", 5);
    let other = Keypair::new().pubkey();
    let copy = env.svm.get_account(&ata(&alice, &mint)).unwrap();
    env.svm.set_account(other, copy).unwrap();
    let mut ix = transfer_ix(&authority.pubkey(), &game, &mint, &alice, &alice, 1);
    ix.accounts[3].pubkey = other;
    assert_fails_with(
        env.send(ix, &authority),
        &custom(ChainAssetsError::SameHolder),
    );
}

#[test]
fn transfer_rejects_insufficient_balance() {
    // El programa no lleva saldos: lo rechaza Token-2022, y no se mueve nada.
    let (mut env, authority, game, mint, alice) = setup_holding("demo", 2);
    let bob = holder();
    assert_fails_with(
        env.send(
            transfer_ix(&authority.pubkey(), &game, &mint, &alice, &bob, 3),
            &authority,
        ),
        &format!("Custom({TOKEN_INSUFFICIENT_FUNDS})"),
    );
    assert_eq!(env.balance(&alice, &mint), 2);
    assert!(env.svm.get_account(&ata(&bob, &mint)).is_none());
}

#[test]
fn transfer_rejects_item_of_other_game() {
    // Unidades de un tipo del juego A: el `Game` B no puede moverlas, ni con su autoridad.
    let (mut env, _, _, mint_a, alice) = setup_holding("game-a", 5);
    let authority_b = env.funded();
    env.send(
        initialize_game_ix(&authority_b.pubkey(), "game-b"),
        &authority_b,
    )
    .unwrap();
    assert_fails_with(
        env.send(
            transfer_ix(
                &authority_b.pubkey(),
                &game_pda("game-b"),
                &mint_a,
                &alice,
                &holder(),
                1,
            ),
            &authority_b,
        ),
        &anchor(ErrorCode::ConstraintMintMintAuthority),
    );
    assert_eq!(env.balance(&alice, &mint_a), 5);
}

// --- create_item + grant en una transacción (P7) -----------------------------------------

/// Envía `create_item` y `grant` de una unidad en una sola transacción, como hará el backend
/// cuando quepan (propuesta, revisión del 8 de noviembre).
fn create_and_grant(
    env: &mut Env,
    authority: &Keypair,
    game: &Pubkey,
    args: CreateItemArgs,
) -> Sent {
    let mint = item_pda(game, &args.item_seed);
    let player = holder();
    let sent = env
        .send_all(
            &[
                create_item_ix(&authority.pubkey(), game, args),
                grant_ix(&authority.pubkey(), game, &mint, &player, 1),
            ],
            authority,
        )
        .unwrap();
    assert_eq!(env.balance(&player, &mint), 1);
    sent
}

/// `n` pares de 32/64 y el resto de campos al mínimo: sin `uri`, `name` y `symbol` de 1.
fn minimal_with_max_pairs(seed: u8, n: usize) -> CreateItemArgs {
    CreateItemArgs {
        item_seed: [seed; 32],
        name: "n".into(),
        symbol: "s".into(),
        uri: String::new(),
        collection: "col_7Hs2aaaaaaaaaaaa".into(),
        qualities: (0..n)
            .map(|i| Quality {
                key: format!("{i}").repeat(32),
                value: "v".repeat(64),
            })
            .collect(),
    }
}

/// P7, medido sin red: `create_item` y `grant` juntos. Caso típico, cuántos pares máximos
/// caben y el máximo del contrato.
#[test]
fn create_item_and_grant_size_and_compute() {
    let (mut env, authority, game) = setup("demo");

    let typical = create_and_grant(&mut env, &authority, &game, sword(1));
    println!(
        "create_item + grant típico: {} bytes, {} CU",
        typical.size, typical.compute_units
    );
    assert!(typical.size <= PACKET_DATA_SIZE);

    let mut fits = 0;
    for n in 0..=8 {
        let sent = create_and_grant(
            &mut env,
            &authority,
            &game,
            minimal_with_max_pairs(10 + n as u8, n),
        );
        let ok = sent.size <= PACKET_DATA_SIZE;
        println!(
            "create_item + grant, {n} pares de 32/64 y resto mínimo: {} bytes, {} CU{}",
            sent.size,
            sent.compute_units,
            if ok { "" } else { " (no cabe)" }
        );
        if ok {
            fits = n;
        }
    }
    println!("juntos caben como máximo {fits} pares de 32/64 con el resto de campos mínimos");

    // LiteSVM no aplica el límite de paquete: se ejecuta igualmente para medir el cómputo.
    let max = create_and_grant(&mut env, &authority, &game, max_item(2));
    println!(
        "create_item + grant máximo del contrato: {} bytes (límite {PACKET_DATA_SIZE}), {} CU",
        max.size, max.compute_units
    );
    assert!(max.size > PACKET_DATA_SIZE);
}
