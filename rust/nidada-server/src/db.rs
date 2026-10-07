//! Persistencia en SQLite: un fichero, sin servidor.
//!
//! De cada mascota se guarda sólo la instantánea de `nidada-rules`; el estado actual se
//! deriva al leer.
//!
//! El esquema evoluciona con migraciones numeradas en `PRAGMA user_version`. Una base de
//! datos de una fase anterior se pone al día al abrirla; nunca se borra.

use nidada_rules::{Pattern, Snapshot, Species, SplitMix64, Traits, friend_code};
use rusqlite::{Connection, ErrorCode, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

/// Comida con la que empieza cada jugador. Sin reposición en J1 (plan, 2.3).
pub const STARTING_FOOD: i64 = 10;

/// Migración 1: el esquema de J1. `IF NOT EXISTS` porque las bases de J1 ya lo tienen
/// aunque su `user_version` sea 0.
const V1_CARE: &str = "
CREATE TABLE IF NOT EXISTS players (
    player_id     TEXT PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    food          INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pets (
    pet_id        TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES players(player_id),
    species       TEXT NOT NULL,
    name          TEXT,
    color         INTEGER NOT NULL,
    pattern       TEXT NOT NULL,
    born_at       INTEGER NOT NULL,
    hunger        REAL NOT NULL,
    mood          REAL NOT NULL,
    energy        REAL NOT NULL,
    growth_hours  REAL NOT NULL,
    at            INTEGER NOT NULL,
    sleep_until   INTEGER NOT NULL,
    play_ready_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pets_owner ON pets(owner_id);
";

/// Migración 2: J5, amigos. La amistad va en un sentido: es la lista de códigos que ha
/// guardado cada jugador, con un alias que sólo ve él.
const V2_FRIENDS: &str = "
ALTER TABLE players ADD COLUMN friend_code TEXT;
CREATE UNIQUE INDEX players_friend_code ON players(friend_code);
CREATE TABLE friends (
    player_id TEXT NOT NULL REFERENCES players(player_id),
    friend_id TEXT NOT NULL REFERENCES players(player_id),
    alias     TEXT,
    added_at  INTEGER NOT NULL,
    PRIMARY KEY (player_id, friend_id)
);
CREATE TABLE friend_lookup_failures (
    player_id TEXT NOT NULL REFERENCES players(player_id),
    at        INTEGER NOT NULL
);
CREATE INDEX friend_lookup_failures_by_player ON friend_lookup_failures(player_id, at);
";

/// Migración 3: el token de sesión deja de guardarse en claro; la columna pasa a guardar
/// su SHA-256 (los tokens ya existentes se convierten en `hash_existing_tokens`). Más la
/// tabla de eventos por IP: sin ella, crear jugadores nuevos esquiva cualquier límite
/// por jugador.
const V3_HASHED_TOKENS_AND_IP_LIMITS: &str = "
ALTER TABLE players RENAME COLUMN session_token TO token_hash;
CREATE TABLE ip_events (
    ip   TEXT NOT NULL,
    kind TEXT NOT NULL,
    at   INTEGER NOT NULL
);
CREATE INDEX ip_events_by_ip ON ip_events(ip, kind, at);
";

type PostStep = fn(&Transaction) -> rusqlite::Result<()>;

/// Cada migración, con un paso en Rust opcional para lo que SQL no puede hacer.
const MIGRATIONS: &[(&str, Option<PostStep>)] = &[
    (V1_CARE, None),
    (V2_FRIENDS, None),
    (V3_HASHED_TOKENS_AND_IP_LIMITS, Some(hash_existing_tokens)),
];

/// `seed` alimenta los códigos de amigo que haya que generar al migrar.
pub fn open(path: &str, seed: u64) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    migrate(&mut conn)?;
    backfill_friend_codes(&conn, &mut SplitMix64::new(seed))?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, (sql, post)) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        if let Some(post) = post {
            post(&tx)?;
        }
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

/// Hasta la migración 3 la columna guardaba el token en claro: se sustituye por su hash.
fn hash_existing_tokens(tx: &Transaction) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare("SELECT player_id, token_hash FROM players")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (player_id, token) in rows {
        tx.execute(
            "UPDATE players SET token_hash = ?2 WHERE player_id = ?1",
            params![player_id, hash_token(&token)],
        )?;
    }
    Ok(())
}

/// El servidor sólo guarda el SHA-256 del token. Basta un hash rápido: el token son 256
/// bits aleatorios, no una contraseña que haya que proteger de un diccionario.
fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Los jugadores creados antes de J5 no tienen código: se les da uno.
fn backfill_friend_codes(conn: &Connection, rng: &mut SplitMix64) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT player_id FROM players WHERE friend_code IS NULL")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for id in ids {
        assign_friend_code(conn, &id, rng)?;
    }
    Ok(())
}

/// Intentos para encontrar un código libre antes de rendirse.
const FRIEND_CODE_ATTEMPTS: usize = 16;

/// Da un código libre al jugador. Con 887 millones de códigos una colisión es rara;
/// si ocurre, se tira otra vez, con un máximo. Falla si el jugador no existe.
pub fn assign_friend_code(
    conn: &Connection,
    player_id: &str,
    rng: &mut SplitMix64,
) -> rusqlite::Result<String> {
    let mut collision = None;
    for _ in 0..FRIEND_CODE_ATTEMPTS {
        let code = friend_code::generate(rng);
        match conn.execute(
            "UPDATE players SET friend_code = ?2 WHERE player_id = ?1",
            params![player_id, code],
        ) {
            Ok(1) => return Ok(code),
            Ok(n) => return Err(rusqlite::Error::StatementChangedRows(n)),
            Err(rusqlite::Error::SqliteFailure(f, msg))
                if f.code == ErrorCode::ConstraintViolation =>
            {
                collision = Some(rusqlite::Error::SqliteFailure(f, msg));
            }
            Err(e) => return Err(e),
        }
    }
    Err(collision.unwrap_or(rusqlite::Error::StatementChangedRows(0)))
}

#[derive(Debug, Clone)]
pub struct Pet {
    pub pet_id: String,
    pub owner_id: String,
    pub species: Species,
    pub name: Option<String>,
    pub traits: Traits,
    pub born_at: i64,
    pub snapshot: Snapshot,
}

pub fn player_by_token(conn: &Connection, token: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT player_id FROM players WHERE token_hash = ?1",
        [hash_token(token)],
        |r| r.get(0),
    )
    .optional()
}

pub fn food(conn: &Connection, player_id: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT food FROM players WHERE player_id = ?1",
        [player_id],
        |r| r.get(0),
    )
}

pub fn set_food(conn: &Connection, player_id: &str, food: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE players SET food = ?2 WHERE player_id = ?1",
        params![player_id, food],
    )?;
    Ok(())
}

pub fn insert_player(
    conn: &Connection,
    player_id: &str,
    token: &str,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO players (player_id, token_hash, food, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![player_id, hash_token(token), STARTING_FOOD, now],
    )?;
    Ok(())
}

pub fn insert_pet(conn: &Connection, pet: &Pet) -> rusqlite::Result<()> {
    let s = &pet.snapshot;
    conn.execute(
        "INSERT INTO pets (pet_id, owner_id, species, name, color, pattern, born_at,
                           hunger, mood, energy, growth_hours, at, sleep_until, play_ready_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            pet.pet_id,
            pet.owner_id,
            pet.species.key(),
            pet.name,
            pet.traits.color,
            pet.traits.pattern.key(),
            pet.born_at,
            s.hunger,
            s.mood,
            s.energy,
            s.growth_hours,
            s.at,
            s.sleep_until,
            s.play_ready_at,
        ],
    )?;
    Ok(())
}

pub fn save_snapshot(conn: &Connection, pet_id: &str, s: &Snapshot) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pets SET hunger = ?2, mood = ?3, energy = ?4, growth_hours = ?5, at = ?6,
                         sleep_until = ?7, play_ready_at = ?8
         WHERE pet_id = ?1",
        params![
            pet_id,
            s.hunger,
            s.mood,
            s.energy,
            s.growth_hours,
            s.at,
            s.sleep_until,
            s.play_ready_at
        ],
    )?;
    Ok(())
}

pub fn set_name(conn: &Connection, pet_id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pets SET name = ?2 WHERE pet_id = ?1",
        params![pet_id, name],
    )?;
    Ok(())
}

const PET_COLUMNS: &str = "pet_id, owner_id, species, name, color, pattern, born_at,
                           hunger, mood, energy, growth_hours, at, sleep_until, play_ready_at";

fn row_to_pet(r: &rusqlite::Row) -> rusqlite::Result<Pet> {
    let species: String = r.get(2)?;
    let pattern: String = r.get(5)?;
    // Una clave desconocida en la base de datos es corrupción, no un error del jugador.
    let bad = |col: usize, v: String| {
        rusqlite::Error::FromSqlConversionFailure(
            col,
            rusqlite::types::Type::Text,
            format!("valor desconocido: {v}").into(),
        )
    };
    Ok(Pet {
        pet_id: r.get(0)?,
        owner_id: r.get(1)?,
        species: Species::from_key(&species).ok_or_else(|| bad(2, species.clone()))?,
        name: r.get(3)?,
        traits: Traits {
            color: r.get(4)?,
            pattern: Pattern::from_key(&pattern).ok_or_else(|| bad(5, pattern.clone()))?,
        },
        born_at: r.get(6)?,
        snapshot: Snapshot {
            hunger: r.get(7)?,
            mood: r.get(8)?,
            energy: r.get(9)?,
            growth_hours: r.get(10)?,
            at: r.get(11)?,
            sleep_until: r.get(12)?,
            play_ready_at: r.get(13)?,
        },
    })
}

pub fn pets_of(conn: &Connection, owner_id: &str) -> rusqlite::Result<Vec<Pet>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PET_COLUMNS} FROM pets WHERE owner_id = ?1 ORDER BY born_at, pet_id"
    ))?;
    stmt.query_map([owner_id], row_to_pet)?.collect()
}

pub fn pet(conn: &Connection, pet_id: &str) -> rusqlite::Result<Option<Pet>> {
    conn.query_row(
        &format!("SELECT {PET_COLUMNS} FROM pets WHERE pet_id = ?1"),
        [pet_id],
        row_to_pet,
    )
    .optional()
}

pub fn friend_code_of(conn: &Connection, player_id: &str) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT friend_code FROM players WHERE player_id = ?1",
        [player_id],
        |r| r.get(0),
    )
}

pub fn player_by_friend_code(conn: &Connection, code: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT player_id FROM players WHERE friend_code = ?1",
        [code],
        |r| r.get(0),
    )
    .optional()
}

/// Añade a la lista. Si ya estaba, sólo cambia el alias, y sólo si viene uno.
pub fn add_friend(
    conn: &Connection,
    player_id: &str,
    friend_id: &str,
    alias: Option<&str>,
    now: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO friends (player_id, friend_id, alias, added_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (player_id, friend_id) DO UPDATE SET alias = COALESCE(excluded.alias, alias)",
        params![player_id, friend_id, alias, now],
    )?;
    Ok(())
}

pub fn set_alias(
    conn: &Connection,
    player_id: &str,
    friend_id: &str,
    alias: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE friends SET alias = ?3 WHERE player_id = ?1 AND friend_id = ?2",
        params![player_id, friend_id, alias],
    )?;
    Ok(())
}

pub fn remove_friend(conn: &Connection, player_id: &str, friend_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM friends WHERE player_id = ?1 AND friend_id = ?2",
        params![player_id, friend_id],
    )?;
    Ok(())
}

/// Un amigo tal como lo ve quien lo ha guardado.
pub struct Friend {
    pub player_id: String,
    pub code: String,
    pub alias: Option<String>,
}

fn row_to_friend(r: &rusqlite::Row) -> rusqlite::Result<Friend> {
    Ok(Friend {
        player_id: r.get(0)?,
        code: r.get(1)?,
        alias: r.get(2)?,
    })
}

/// El amigo con ese código, sólo si está en la lista de `player_id`.
pub fn friend_by_code(
    conn: &Connection,
    player_id: &str,
    code: &str,
) -> rusqlite::Result<Option<Friend>> {
    conn.query_row(
        "SELECT p.player_id, p.friend_code, f.alias
         FROM friends f JOIN players p ON p.player_id = f.friend_id
         WHERE f.player_id = ?1 AND p.friend_code = ?2",
        params![player_id, code],
        row_to_friend,
    )
    .optional()
}

/// En el orden en que se añadieron.
pub fn friends_of(conn: &Connection, player_id: &str) -> rusqlite::Result<Vec<Friend>> {
    let mut stmt = conn.prepare(
        "SELECT p.player_id, p.friend_code, f.alias
         FROM friends f JOIN players p ON p.player_id = f.friend_id
         WHERE f.player_id = ?1 ORDER BY f.added_at, p.friend_code",
    )?;
    stmt.query_map([player_id], row_to_friend)?.collect()
}

/// Apunta un código equivocado y olvida los que ya no cuentan para el límite.
pub fn record_lookup_failure(
    conn: &Connection,
    player_id: &str,
    now: i64,
    window_secs: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM friend_lookup_failures WHERE player_id = ?1 AND at <= ?2",
        params![player_id, now - window_secs],
    )?;
    conn.execute(
        "INSERT INTO friend_lookup_failures (player_id, at) VALUES (?1, ?2)",
        params![player_id, now],
    )?;
    Ok(())
}

pub fn lookup_failures_since(
    conn: &Connection,
    player_id: &str,
    since: i64,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM friend_lookup_failures WHERE player_id = ?1 AND at > ?2",
        params![player_id, since],
        |r| r.get(0),
    )
}

/// Eventos que se limitan por dirección IP.
#[derive(Clone, Copy)]
pub enum IpEvent {
    /// Un jugador nuevo.
    Signup,
    /// Un código de amigo bien escrito pero inexistente.
    LookupFailure,
}

impl IpEvent {
    fn key(self) -> &'static str {
        match self {
            IpEvent::Signup => "signup",
            IpEvent::LookupFailure => "lookup_failure",
        }
    }
}

/// Apunta el evento y olvida los de esa IP que ya no cuentan para la ventana.
pub fn record_ip_event(
    conn: &Connection,
    ip: &str,
    kind: IpEvent,
    now: i64,
    window_secs: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM ip_events WHERE ip = ?1 AND kind = ?2 AND at <= ?3",
        params![ip, kind.key(), now - window_secs],
    )?;
    conn.execute(
        "INSERT INTO ip_events (ip, kind, at) VALUES (?1, ?2, ?3)",
        params![ip, kind.key(), now],
    )?;
    Ok(())
}

pub fn ip_events_since(
    conn: &Connection,
    ip: &str,
    kind: IpEvent,
    since: i64,
) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM ip_events WHERE ip = ?1 AND kind = ?2 AND at > ?3",
        params![ip, kind.key(), since],
        |r| r.get(0),
    )
}
