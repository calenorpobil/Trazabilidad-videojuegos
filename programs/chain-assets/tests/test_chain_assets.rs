//! Tests de `chain-assets` con LiteSVM, sin red. Cargan el `.so` de `anchor build`.
//!
//! Cada instrucción tiene al menos un test negativo: otro firmante, valores fuera de límite y
//! tipo de otro juego (propuesta, 4.7). Toda transacción que construyen comprueba el invariante 1:
//! una sola firma requerida.

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, system_program,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        token_2022::spl_token_2022::{
            self,
            extension::{
                metadata_pointer::MetadataPointer, permanent_delegate::PermanentDelegate,
                BaseStateWithExtensions, StateWithExtensions,
            },
            state::Mint,
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
        let msg =
            Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &self.svm.latest_blockhash());
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

fn assert_fails_with(result: Result<Sent, String>, code: &str) {
    match result {
        Ok(_) => panic!("se esperaba un fallo con {code}"),
        Err(e) => assert!(e.contains(code), "se esperaba {code}, llegó: {e}"),
    }
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
/// `grant` es de OC2: falta medir los dos juntos.
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
