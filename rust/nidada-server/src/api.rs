//! API HTTP del servidor de juego (`docs/plan-juego.md`, sección 4).
//!
//! Es interna del juego, no el contrato de `godot-chain`. Los mensajes de error van en
//! español y sin tecnicismos: el cliente los enseña tal cual.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use nidada_rules::{Action, Snapshot, Species, SplitMix64, Traits, needs, validate_name};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::db::{self, Pet};

type Shared = Arc<AppState>;

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/v1/players", post(create_player))
        .route("/v1/corral", get(corral))
        .route("/v1/pets/{pet_id}/feed", post(feed))
        .route("/v1/pets/{pet_id}/play", post(play))
        .route("/v1/pets/{pet_id}/sleep", post(sleep))
        .route("/v1/pets/{pet_id}/name", put(rename))
        .with_state(state)
}

pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> ApiError {
        ApiError {
            status,
            code,
            message: message.into(),
        }
    }

    fn unauthorized() -> ApiError {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Tu sesión no es válida. Vuelve a entrar.",
        )
    }

    fn not_found() -> ApiError {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Esa mascota no está en tu corral.",
        )
    }

    fn not_allowed(message: impl Into<String>) -> ApiError {
        ApiError::new(StatusCode::CONFLICT, "NOT_ALLOWED", message)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> ApiError {
        eprintln!("error de base de datos: {e}");
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            "Algo ha fallado. Inténtalo de nuevo.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "code": self.code, "message": self.message } });
        (self.status, Json(body)).into_response()
    }
}

type ApiResult = Result<Response, ApiError>;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("el sistema operativo no da aleatoriedad");
    buf
}

fn random_hex<const N: usize>() -> String {
    random_bytes::<N>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

fn authenticate(conn: &rusqlite::Connection, headers: &HeaderMap) -> Result<String, ApiError> {
    let token = bearer(headers).ok_or_else(ApiError::unauthorized)?;
    db::player_by_token(conn, token)?.ok_or_else(ApiError::unauthorized)
}

fn pet_json(pet: &Pet) -> Value {
    let s = &pet.snapshot;
    json!({
        "pet_id": pet.pet_id,
        "species": pet.species.key(),
        "name": pet.name,
        "color": pet.traits.color,
        "pattern": pet.traits.pattern.key(),
        "born_at": pet.born_at,
        "snapshot": {
            "hunger": s.hunger,
            "mood": s.mood,
            "energy": s.energy,
            "growth_hours": s.growth_hours,
            "at": s.at,
            "sleep_until": s.sleep_until,
            "play_ready_at": s.play_ready_at,
        },
    })
}

/// El corral completo. Lo devuelven todas las acciones, para que el cliente no tenga
/// que pedirlo aparte.
fn corral_response(state: &AppState, conn: &rusqlite::Connection, player_id: &str) -> ApiResult {
    let pets: Vec<Value> = db::pets_of(conn, player_id)?.iter().map(pet_json).collect();
    let body = json!({
        "server_time": now(),
        "time_scale": state.time_scale,
        "food": db::food(conn, player_id)?,
        "pets": pets,
    });
    Ok(Json(body).into_response())
}

async fn create_player(State(state): State<Shared>) -> ApiResult {
    let player_id = format!("plr_{}", random_hex::<8>());
    let token = random_hex::<32>();
    let now = now();
    let mut rng = SplitMix64::new(u64::from_le_bytes(random_bytes::<8>()));

    let mut conn = state
        .db
        .lock()
        .expect("mutex de la base de datos envenenado");
    let tx = conn.transaction()?;
    db::insert_player(&tx, &player_id, &token, now)?;
    for species in Species::starters(&mut rng) {
        let pet = Pet {
            pet_id: format!("pet_{}", random_hex::<8>()),
            owner_id: player_id.clone(),
            species,
            name: None,
            traits: Traits::random(&mut rng),
            born_at: now,
            snapshot: Snapshot::newborn(now),
        };
        db::insert_pet(&tx, &pet)?;
    }
    tx.commit()?;

    let body = json!({ "player_id": player_id, "session_token": token });
    Ok((StatusCode::CREATED, Json(body)).into_response())
}

async fn corral(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let conn = state
        .db
        .lock()
        .expect("mutex de la base de datos envenenado");
    let player_id = authenticate(&conn, &headers)?;
    corral_response(&state, &conn, &player_id)
}

/// Carga la mascota sólo si es del jugador. Si no lo es, responde igual que si no
/// existiera: no se revela qué mascotas tienen otros.
fn owned_pet(conn: &rusqlite::Connection, player_id: &str, pet_id: &str) -> Result<Pet, ApiError> {
    match db::pet(conn, pet_id)? {
        Some(pet) if pet.owner_id == player_id => Ok(pet),
        _ => Err(ApiError::not_found()),
    }
}

fn act(state: &AppState, headers: &HeaderMap, pet_id: &str, action: Action) -> ApiResult {
    let mut conn = state
        .db
        .lock()
        .expect("mutex de la base de datos envenenado");
    let player_id = authenticate(&conn, headers)?;
    let tx = conn.transaction()?;
    let pet = owned_pet(&tx, &player_id, pet_id)?;

    let food = db::food(&tx, &player_id)?;
    if action == Action::Feed && food <= 0 {
        return Err(ApiError::not_allowed("No te queda comida."));
    }
    let snapshot = needs::apply(pet.species, &pet.snapshot, action, now(), state.time_scale)
        .map_err(|r| ApiError::not_allowed(r.message()))?;
    db::save_snapshot(&tx, &pet.pet_id, &snapshot)?;
    if action == Action::Feed {
        db::set_food(&tx, &player_id, food - 1)?;
    }
    tx.commit()?;
    corral_response(state, &conn, &player_id)
}

async fn feed(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(pet_id): Path<String>,
) -> ApiResult {
    act(&state, &headers, &pet_id, Action::Feed)
}

async fn play(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(pet_id): Path<String>,
) -> ApiResult {
    act(&state, &headers, &pet_id, Action::Play)
}

async fn sleep(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(pet_id): Path<String>,
) -> ApiResult {
    act(&state, &headers, &pet_id, Action::Sleep)
}

#[derive(Deserialize)]
struct RenameBody {
    name: String,
}

async fn rename(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(pet_id): Path<String>,
    Json(body): Json<RenameBody>,
) -> ApiResult {
    let conn = state
        .db
        .lock()
        .expect("mutex de la base de datos envenenado");
    let player_id = authenticate(&conn, &headers)?;
    let pet = owned_pet(&conn, &player_id, &pet_id)?;
    let name = validate_name(&body.name).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID",
            "El nombre tiene que tener entre 1 y 16 letras.",
        )
    })?;
    db::set_name(&conn, &pet.pet_id, &name)?;
    corral_response(&state, &conn, &player_id)
}
