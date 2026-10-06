//! Persistencia en SQLite: un fichero, sin servidor.
//!
//! De cada mascota se guarda sólo la instantánea de `nidada-rules`; el estado actual se
//! deriva al leer.

use nidada_rules::{Pattern, Snapshot, Species, Traits};
use rusqlite::{Connection, OptionalExtension, params};

/// Comida con la que empieza cada jugador. Sin reposición en J1 (plan, 2.3).
pub const STARTING_FOOD: i64 = 10;

const SCHEMA: &str = "
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

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
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
        "SELECT player_id FROM players WHERE session_token = ?1",
        [token],
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
        "INSERT INTO players (player_id, session_token, food, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![player_id, token, STARTING_FOOD, now],
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
