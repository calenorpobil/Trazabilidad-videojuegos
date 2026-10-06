//! Amigos y visitas (fase J5 de `docs/plan-juego.md`, diseño 5).
//!
//! La amistad va en un sentido: añadir a alguien es guardar su código en tu lista, con
//! un alias que sólo ves tú. No hay solicitudes ni aceptación.
//!
//! El código de amigo es la única forma de llegar a otro jugador, así que se protege
//! contra quien pruebe códigos al azar: los intentos fallidos están limitados, y visitar
//! exige tener el código en la lista. Si se pudiera visitar con cualquier código, la
//! ruta de visita serviría para saltarse el límite.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use nidada_rules::{friend_code, validate_name};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{ApiError, ApiResult, Shared, authenticate, lock, now, pet_json};
use crate::db::{self, Friend};

/// Códigos equivocados que se permiten por jugador dentro de la ventana.
pub const LOOKUP_LIMIT: i64 = 20;
pub const LOOKUP_WINDOW_SECS: i64 = 3600;

pub fn routes() -> Router<Shared> {
    Router::new()
        .route("/v1/friends", post(add).get(list))
        .route("/v1/friends/{code}", axum::routing::delete(remove))
        .route("/v1/friends/{code}/alias", put(set_alias))
        .route("/v1/visit/{code}", get(visit))
}

fn not_a_friend() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "NOT_FOUND",
        "Ese código no está en tu lista de amigos.",
    )
}

/// Alias opcional: ausente o vacío es «sin alias».
fn parse_alias(raw: Option<&str>) -> Result<Option<String>, ApiError> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => validate_name(text)
            .map(Some)
            .ok_or_else(|| ApiError::invalid("El alias tiene que tener entre 1 y 16 letras.")),
    }
}

/// Lista completa de amigos, con los nombres de sus mascotas para reconocerlos.
fn list_response(conn: &rusqlite::Connection, player_id: &str) -> ApiResult {
    let mut friends = Vec::new();
    for Friend {
        player_id: friend_id,
        code,
        alias,
    } in db::friends_of(conn, player_id)?
    {
        let pets: Vec<Value> = db::pets_of(conn, &friend_id)?
            .iter()
            .map(|p| json!({ "species": p.species.key(), "name": p.name }))
            .collect();
        friends.push(json!({ "code": code, "alias": alias, "pets": pets }));
    }
    Ok(Json(json!({ "friends": friends })).into_response())
}

#[derive(Deserialize)]
struct AddBody {
    code: String,
    alias: Option<String>,
}

async fn add(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<AddBody>,
) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    let now = now();

    // El límite se mira antes que nada: con el cupo agotado, ni siquiera un código
    // correcto confirma que existe.
    if db::lookup_failures_since(&conn, &player_id, now - LOOKUP_WINDOW_SECS)? >= LOOKUP_LIMIT {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Demasiados códigos equivocados. Espera un rato antes de probar otro.",
        ));
    }
    // Un código mal escrito no consulta la base de datos, así que no cuenta como intento.
    let code = friend_code::normalize(&body.code).ok_or_else(|| {
        ApiError::invalid("Un código de amigo tiene 6 letras y números, sin 0, O, 1, I ni L.")
    })?;
    let alias = parse_alias(body.alias.as_deref())?;

    let Some(friend_id) = db::player_by_friend_code(&conn, &code)? else {
        db::record_lookup_failure(&conn, &player_id, now, LOOKUP_WINDOW_SECS)?;
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "No hay nadie con ese código.",
        ));
    };
    if friend_id == player_id {
        return Err(ApiError::not_allowed("Ese es tu propio código."));
    }
    db::add_friend(&conn, &player_id, &friend_id, alias.as_deref(), now)?;
    list_response(&conn, &player_id)
}

async fn list(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    list_response(&conn, &player_id)
}

/// Busca el código sólo en la lista del jugador. Fuera de ella, no existe.
fn friend_in_list(
    conn: &rusqlite::Connection,
    player_id: &str,
    raw_code: &str,
) -> Result<Friend, ApiError> {
    let code = friend_code::normalize(raw_code).ok_or_else(not_a_friend)?;
    db::friend_by_code(conn, player_id, &code)?.ok_or_else(not_a_friend)
}

async fn remove(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    let friend = friend_in_list(&conn, &player_id, &code)?;
    db::remove_friend(&conn, &player_id, &friend.player_id)?;
    list_response(&conn, &player_id)
}

#[derive(Deserialize)]
struct AliasBody {
    alias: Option<String>,
}

async fn set_alias(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Json(body): Json<AliasBody>,
) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    let friend = friend_in_list(&conn, &player_id, &code)?;
    let alias = parse_alias(body.alias.as_deref())?;
    db::set_alias(&conn, &player_id, &friend.player_id, alias.as_deref())?;
    list_response(&conn, &player_id)
}

/// El corral de un amigo, sólo para mirar. Mismo formato de mascotas que el propio, para
/// que el cliente reutilice la tarjeta; sin la comida, que no es asunto del visitante.
async fn visit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult {
    let conn = lock(&state);
    let player_id = authenticate(&conn, &headers)?;
    let friend = friend_in_list(&conn, &player_id, &code)?;
    let pets: Vec<Value> = db::pets_of(&conn, &friend.player_id)?
        .iter()
        .map(pet_json)
        .collect();
    let body = json!({
        "server_time": now(),
        "time_scale": state.time_scale,
        "code": friend.code,
        "alias": friend.alias,
        "pets": pets,
    });
    Ok(Json(body).into_response())
}
