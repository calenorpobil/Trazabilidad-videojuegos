//! API HTTP del servidor de juego (`docs/plan-juego.md`, sección 4).
//!
//! Es interna del juego, no el contrato de `godot-chain`. Los mensajes de error van en
//! español y sin tecnicismos: el cliente los enseña tal cual.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{ConnectInfo, FromRequest, FromRequestParts, Path, Request, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use nidada_rules::{Action, Snapshot, Species, SplitMix64, Traits, needs, validate_name};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::AppState;
use crate::db::{self, Pet};
use crate::friends;

pub type Shared = Arc<AppState>;

/// Jugadores nuevos permitidos por IP dentro de la ventana. Crear un jugador es gratis
/// y anónimo; sin este tope, también vaciaría cualquier límite por jugador.
pub const SIGNUP_LIMIT: i64 = 10;
pub const SIGNUP_WINDOW_SECS: i64 = 3600;

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/v1/players", post(create_player))
        .route("/v1/corral", get(corral))
        .route("/v1/pets/{pet_id}/feed", post(feed))
        .route("/v1/pets/{pet_id}/play", post(play))
        .route("/v1/pets/{pet_id}/sleep", post(sleep))
        .route("/v1/pets/{pet_id}/name", put(rename))
        .merge(friends::routes())
        .with_state(state)
}

pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> ApiError {
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

    pub fn invalid(message: impl Into<String>) -> ApiError {
        ApiError::new(StatusCode::BAD_REQUEST, "INVALID", message)
    }

    pub fn rate_limited(message: impl Into<String>) -> ApiError {
        ApiError::new(StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", message)
    }

    pub fn not_allowed(message: impl Into<String>) -> ApiError {
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

impl From<getrandom::Error> for ApiError {
    fn from(e: getrandom::Error) -> ApiError {
        eprintln!("sin aleatoriedad del sistema: {e}");
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

pub type ApiResult = Result<Response, ApiError>;

/// La conexión es una sola y sin hilos propios: cada petición la toma entera.
///
/// Si una petición anterior entró en pánico con el cerrojo tomado, éste queda marcado
/// como envenenado. La conexión sigue siendo válida (una transacción a medias se deshace
/// sola al soltarla), así que se recupera en vez de dejar el servidor inservible.
pub fn lock(state: &AppState) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
    state.db.lock().unwrap_or_else(|poisoned| {
        eprintln!("una petición anterior entró en pánico; se recupera la base de datos");
        state.db.clear_poison();
        poisoned.into_inner()
    })
}

/// Como `axum::Json`, pero un cuerpo mal formado responde con el formato de error de la
/// API en vez del texto plano de axum.
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(value)) => Ok(ApiJson(value)),
            Err(rejection) => Err(ApiError::new(
                rejection.status(),
                "INVALID",
                "La petición no tiene el formato esperado.",
            )),
        }
    }
}

/// Dirección del cliente que abrió la conexión. Detrás de un proxy inverso sería la del
/// proxy: si el servidor se despliega así, aquí es donde leer la cabecera del proxy.
pub struct ClientIp(pub String);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Infallible> {
        // Sin dirección, todos comparten un solo cupo: falla hacia el lado estricto.
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip().to_string())
            .unwrap_or_else(|| "desconocida".into());
        Ok(ClientIp(ip))
    }
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn random_bytes<const N: usize>() -> Result<[u8; N], getrandom::Error> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf)?;
    Ok(buf)
}

/// Semilla para las tiradas del servidor: especies iniciales, rasgos, códigos de amigo.
pub fn random_seed() -> Result<u64, getrandom::Error> {
    Ok(u64::from_le_bytes(random_bytes::<8>()?))
}

fn random_hex<const N: usize>() -> Result<String, getrandom::Error> {
    Ok(random_bytes::<N>()?
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

pub fn authenticate(conn: &rusqlite::Connection, headers: &HeaderMap) -> Result<String, ApiError> {
    let token = bearer(headers).ok_or_else(ApiError::unauthorized)?;
    db::player_by_token(conn, token)?.ok_or_else(ApiError::unauthorized)
}

pub fn pet_json(pet: &Pet) -> Value {
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
        "friend_code": db::friend_code_of(conn, player_id)?,
        "pets": pets,
    });
    Ok(Json(body).into_response())
}

async fn create_player(State(state): State<Shared>, ClientIp(ip): ClientIp) -> ApiResult {
    let player_id = format!("plr_{}", random_hex::<8>()?);
    let token = random_hex::<32>()?;
    let now = now();
    let mut rng = SplitMix64::new(random_seed()?);

    let mut conn = lock(&state);
    // Todo intento cuenta, salga bien o no. En J4 cada alta pedirá un `grant` que cuesta
    // comisión y renta: ese `grant` tiene que esperar a la primera acción real del
    // jugador, no hacerse aquí.
    if db::ip_events_since(&conn, &ip, db::IpEvent::Signup, now - SIGNUP_WINDOW_SECS)?
        >= SIGNUP_LIMIT
    {
        return Err(ApiError::rate_limited(
            "Demasiadas cuentas nuevas desde este dispositivo. Inténtalo más tarde.",
        ));
    }
    db::record_ip_event(&conn, &ip, db::IpEvent::Signup, now, SIGNUP_WINDOW_SECS)?;
    let tx = conn.transaction()?;
    db::insert_player(&tx, &player_id, &token, now)?;
    db::assign_friend_code(&tx, &player_id, &mut rng)?;
    for species in Species::starters(&mut rng) {
        let pet = Pet {
            pet_id: format!("pet_{}", random_hex::<8>()?),
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
    let conn = lock(&state);
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
    let mut conn = lock(state);
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
    ApiJson(body): ApiJson<RenameBody>,
) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    let pet = owned_pet(&conn, &player_id, &pet_id)?;
    let name = validate_name(&body.name)
        .ok_or_else(|| ApiError::invalid("El nombre tiene que tener entre 1 y 16 letras."))?;
    db::set_name(&conn, &pet.pet_id, &name)?;
    corral_response(&state, &conn, &player_id)
}
