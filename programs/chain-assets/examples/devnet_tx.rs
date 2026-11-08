//! Construye y firma una transacción de `chain-assets` para enviarla a devnet a mano, con
//! `scripts/devnet-smoke.sh`. No envía nada: imprime la transacción en base64 por la salida
//! estándar y las direcciones derivadas por la de errores. Sirve para P1, P6 y P7
//! (`docs/seguimiento/verificaciones.md`) sin meter un cliente RPC en el programa.
//!
//! Uso:
//!   devnet_tx <keypair.json> <blockhash> init <game_id>
//!   devnet_tx <keypair.json> <blockhash> create <game_id> <seed_byte> typical|max
//!   devnet_tx <keypair.json> <blockhash> grant <game_id> <seed_byte> <holder> <amount>
//!   devnet_tx <keypair.json> <blockhash> transfer <game_id> <seed_byte> <from> <to> <amount>
//!   devnet_tx <keypair.json> <blockhash> create-grant <game_id> <seed_byte> <holder> <amount>
//!
//! `create-grant` envía el tipo típico y su primera emisión en una sola transacción (P7).

use std::str::FromStr;

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, system_program, InstructionData,
    ToAccountMetas,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address_with_program_id},
    token_2022::spl_token_2022,
};
use chain_assets::{
    instructions::{CreateItemArgs, Quality},
    state::{GAME_SEED, ITEM_SEED},
};
use solana_keypair::Keypair;
use solana_message::{Hash, Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let keypair = read_keypair(&args[1]);
    let blockhash = Hash::from_str(&args[2]).expect("blockhash");
    let authority = keypair.pubkey();
    let game_id = &args[4];
    let game =
        Pubkey::find_program_address(&[GAME_SEED, game_id.as_bytes()], &chain_assets::id()).0;
    eprintln!("game={game}");

    let mint_of = |arg: &str| {
        let seed = [arg.parse::<u8>().expect("seed_byte"); 32];
        let mint =
            Pubkey::find_program_address(&[ITEM_SEED, game.as_ref(), &seed], &chain_assets::id()).0;
        eprintln!("mint={mint}");
        (seed, mint)
    };
    let key = |arg: &str| Pubkey::from_str(arg).expect("clave");
    let amount = |arg: &str| arg.parse::<u64>().expect("amount");

    let ixs = match args[3].as_str() {
        "init" => vec![Instruction::new_with_bytes(
            chain_assets::id(),
            &chain_assets::instruction::InitializeGame {
                game_id: game_id.clone(),
            }
            .data(),
            chain_assets::accounts::InitializeGame {
                authority,
                game,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )],
        "create" => {
            let (seed, mint) = mint_of(&args[5]);
            let item = if args[6] == "max" {
                max_item(seed)
            } else {
                typical_item(seed)
            };
            vec![create_ix(authority, game, mint, item)]
        }
        "grant" => {
            let (_, mint) = mint_of(&args[5]);
            vec![grant_ix(
                authority,
                game,
                mint,
                key(&args[6]),
                amount(&args[7]),
            )]
        }
        "transfer" => {
            let (_, mint) = mint_of(&args[5]);
            let (from, to) = (key(&args[6]), key(&args[7]));
            eprintln!("to_token={}", ata(&to, &mint));
            vec![Instruction::new_with_bytes(
                chain_assets::id(),
                &chain_assets::instruction::Transfer {
                    amount: amount(&args[8]),
                }
                .data(),
                chain_assets::accounts::TransferItem {
                    authority,
                    game,
                    mint,
                    from_token: ata(&from, &mint),
                    to_holder: to,
                    to_token: ata(&to, &mint),
                    token_program: spl_token_2022::ID,
                    associated_token_program: associated_token::ID,
                    system_program: system_program::ID,
                }
                .to_account_metas(None),
            )]
        }
        "create-grant" => {
            let (seed, mint) = mint_of(&args[5]);
            vec![
                create_ix(authority, game, mint, typical_item(seed)),
                grant_ix(authority, game, mint, key(&args[6]), amount(&args[7])),
            ]
        }
        other => panic!("orden desconocida: {other}"),
    };

    let msg = VersionedMessage::Legacy(Message::new_with_blockhash(
        &ixs,
        Some(&authority),
        &blockhash,
    ));
    assert_eq!(
        msg.header().num_required_signatures,
        1,
        "invariante 1: una sola firma"
    );
    let tx = VersionedTransaction::try_new(msg, &[&keypair]).expect("firma");
    let bytes = [
        vec![1u8],
        tx.signatures[0].as_ref().to_vec(),
        tx.message.serialize(),
    ]
    .concat();
    eprintln!("size={}", bytes.len());
    println!("{}", base64(&bytes));
}

fn ata(holder: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(holder, mint, &spl_token_2022::ID)
}

fn create_ix(authority: Pubkey, game: Pubkey, mint: Pubkey, item: CreateItemArgs) -> Instruction {
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::CreateItem { args: item }.data(),
        chain_assets::accounts::CreateItem {
            authority,
            game,
            mint,
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Imprime la cuenta de token del tenedor para que el script mida su renta (P1).
fn grant_ix(
    authority: Pubkey,
    game: Pubkey,
    mint: Pubkey,
    holder: Pubkey,
    amount: u64,
) -> Instruction {
    let holder_token = ata(&holder, &mint);
    eprintln!("holder_token={holder_token}");
    Instruction::new_with_bytes(
        chain_assets::id(),
        &chain_assets::instruction::Grant { amount }.data(),
        chain_assets::accounts::Grant {
            authority,
            game,
            mint,
            holder,
            holder_token,
            token_program: spl_token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn typical_item(seed: [u8; 32]) -> CreateItemArgs {
    CreateItemArgs {
        item_seed: seed,
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

/// Ocho pares de 32 y 64 caracteres, sin `uri` y con `name` y `symbol` cortos: es lo más grande
/// del caso máximo de `qualities` que cabe en una transacción (ver P7).
fn max_item(seed: [u8; 32]) -> CreateItemArgs {
    CreateItemArgs {
        item_seed: seed,
        name: "n".into(),
        symbol: "s".into(),
        uri: String::new(),
        collection: "col_7Hs2aaaaaaaaaaaa".into(),
        qualities: (0..8)
            .map(|i| Quality {
                key: format!("{i}").repeat(32),
                value: "v".repeat(64),
            })
            .collect(),
    }
}

/// El fichero de clave de la CLI: un array JSON de 64 bytes.
fn read_keypair(path: &str) -> Keypair {
    let text = std::fs::read_to_string(path).expect("keypair");
    let bytes: Vec<u8> = text
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|b| b.trim().parse().expect("byte"))
        .collect();
    Keypair::try_from(bytes.as_slice()).expect("keypair de 64 bytes")
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |acc, (i, b)| acc | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
