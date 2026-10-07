//! Tests de integración de la API: el `Router` entero contra SQLite en memoria, sin red.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::api::SIGNUP_LIMIT;
use crate::friends::{LOOKUP_LIMIT, LOOKUP_LIMIT_PER_IP};
use crate::{AppState, api, db};

/// IP desde la que llaman los tests salvo que digan otra.
const HOME: &str = "10.0.0.1";

fn app() -> Router {
    app_with_state().0
}

fn app_with_state() -> (Router, Arc<AppState>) {
    let conn = db::open(":memory:", 1).unwrap();
    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        time_scale: 1.0,
    });
    (api::router(state.clone()), state)
}

async fn call(
    app: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    call_from(app, HOME, method, uri, token, body).await
}

async fn call_from(
    app: &Router,
    ip: &str,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let mut req = match body {
        Some(b) => req
            .header("Content-Type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
    let addr = SocketAddr::new(ip.parse().unwrap(), 50000);
    req.extensions_mut().insert(ConnectInfo(addr));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Crea un jugador y devuelve su token y su código de amigo.
async fn player(app: &Router) -> (String, String) {
    let (status, body) = call(app, Method::POST, "/v1/players", None, None).await;
    assert_eq!(status, StatusCode::CREATED);
    let token = body["session_token"].as_str().unwrap().to_owned();
    let (_, corral) = call(app, Method::GET, "/v1/corral", Some(&token), None).await;
    (token, corral["friend_code"].as_str().unwrap().to_owned())
}

async fn add_friend(
    app: &Router,
    token: &str,
    code: &str,
    alias: Option<&str>,
) -> (StatusCode, Value) {
    call(
        app,
        Method::POST,
        "/v1/friends",
        Some(token),
        Some(json!({ "code": code, "alias": alias })),
    )
    .await
}

#[tokio::test]
async fn every_player_gets_a_distinct_valid_code() {
    let app = app();
    let (_, a) = player(&app).await;
    let (_, b) = player(&app).await;
    assert_eq!(nidada_rules::friend_code::normalize(&a), Some(a.clone()));
    assert_ne!(a, b);
}

#[tokio::test]
async fn add_friend_list_and_visit() {
    let app = app();
    let (a, _) = player(&app).await;
    let (b, b_code) = player(&app).await;

    // Minúsculas y espacios valen: el código se normaliza.
    let messy = format!(" {} ", b_code.to_lowercase());
    let (status, list) = add_friend(&app, &a, &messy, Some("Lucía")).await;
    assert_eq!(status, StatusCode::OK);
    let friends = list["friends"].as_array().unwrap();
    assert_eq!(friends.len(), 1);
    assert_eq!(friends[0]["code"], b_code.as_str());
    assert_eq!(friends[0]["alias"], "Lucía");
    assert_eq!(friends[0]["pets"].as_array().unwrap().len(), 2);

    let (status, visit) = call(
        &app,
        Method::GET,
        &format!("/v1/visit/{b_code}"),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(visit["alias"], "Lucía");
    assert_eq!(visit["pets"].as_array().unwrap().len(), 2);
    assert!(visit["pets"][0]["snapshot"]["hunger"].is_number());
    assert!(
        visit.get("food").is_none(),
        "la comida del otro no se enseña"
    );

    // En un sentido: B no tiene a A en su lista.
    let (_, b_list) = call(&app, Method::GET, "/v1/friends", Some(&b), None).await;
    assert_eq!(b_list["friends"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn adding_twice_keeps_one_entry_and_the_alias() {
    let app = app();
    let (a, _) = player(&app).await;
    let (_, b_code) = player(&app).await;
    add_friend(&app, &a, &b_code, Some("Lucía")).await;
    let (status, list) = add_friend(&app, &a, &b_code, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["friends"].as_array().unwrap().len(), 1);
    assert_eq!(list["friends"][0]["alias"], "Lucía");
}

#[tokio::test]
async fn cannot_add_yourself() {
    let app = app();
    let (a, a_code) = player(&app).await;
    let (status, body) = add_friend(&app, &a, &a_code, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "NOT_ALLOWED");
}

#[tokio::test]
async fn alias_can_be_changed_cleared_and_is_validated() {
    let app = app();
    let (a, _) = player(&app).await;
    let (_, b_code) = player(&app).await;
    add_friend(&app, &a, &b_code, None).await;
    let uri = format!("/v1/friends/{b_code}/alias");

    let (_, list) = call(
        &app,
        Method::PUT,
        &uri,
        Some(&a),
        Some(json!({ "alias": "Prima" })),
    )
    .await;
    assert_eq!(list["friends"][0]["alias"], "Prima");
    let (_, list) = call(
        &app,
        Method::PUT,
        &uri,
        Some(&a),
        Some(json!({ "alias": "" })),
    )
    .await;
    assert!(list["friends"][0]["alias"].is_null());

    let (status, _) = call(
        &app,
        Method::PUT,
        &uri,
        Some(&a),
        Some(json!({ "alias": "x".repeat(17) })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = add_friend(&app, &a, &b_code, Some(&"x".repeat(17))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn visiting_requires_the_code_in_your_list() {
    let app = app();
    let (a, _) = player(&app).await;
    let (_, b_code) = player(&app).await;
    let uri = format!("/v1/visit/{b_code}");

    let (status, _) = call(&app, Method::GET, &uri, Some(&a), None).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "sin añadirlo antes no se visita"
    );

    add_friend(&app, &a, &b_code, None).await;
    let (status, _) = call(&app, Method::GET, &uri, Some(&a), None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, list) = call(
        &app,
        Method::DELETE,
        &format!("/v1/friends/{b_code}"),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["friends"].as_array().unwrap().len(), 0);
    let (status, _) = call(&app, Method::GET, &uri, Some(&a), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_visit_does_not_let_you_touch_their_pets() {
    let app = app();
    let (a, _) = player(&app).await;
    let (_, b_code) = player(&app).await;
    add_friend(&app, &a, &b_code, None).await;
    let (_, visit) = call(
        &app,
        Method::GET,
        &format!("/v1/visit/{b_code}"),
        Some(&a),
        None,
    )
    .await;
    let their_pet = visit["pets"][0]["pet_id"].as_str().unwrap();

    for action in ["feed", "play", "sleep"] {
        let (status, _) = call(
            &app,
            Method::POST,
            &format!("/v1/pets/{their_pet}/{action}"),
            Some(&a),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{action}");
    }
    let (status, _) = call(
        &app,
        Method::PUT,
        &format!("/v1/pets/{their_pet}/name"),
        Some(&a),
        Some(json!({ "name": "Mía" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn wrong_codes_are_rate_limited() {
    let app = app();
    let (a, _) = player(&app).await;
    let (_, b_code) = player(&app).await;

    // Mal escrito: no consulta nada y no gasta intentos.
    for _ in 0..30 {
        let (status, _) = add_friend(&app, &a, "K7M2Q0", None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    // Bien escrito pero inexistente: gasta un intento cada vez.
    let unknown = if b_code == "222222" {
        "333333"
    } else {
        "222222"
    };
    for _ in 0..LOOKUP_LIMIT {
        let (status, _) = add_friend(&app, &a, unknown, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    // Agotado el cupo, ni el código bueno pasa: no se confirma que existe.
    let (status, body) = add_friend(&app, &a, &b_code, None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"]["code"], "RATE_LIMITED");

    // El límite es por jugador.
    let (c, _) = player(&app).await;
    let (status, _) = add_friend(&app, &c, &b_code, None).await;
    assert_eq!(status, StatusCode::OK);
}

/// Una base de datos de J1 (sin `user_version`, sin códigos) se pone al día al abrirla.
#[test]
fn j1_database_is_migrated_in_place() {
    let path = std::env::temp_dir().join(format!(
        "nidada-migration-{}.db",
        api::random_seed().unwrap()
    ));
    let path_str = path.to_str().unwrap();
    {
        let conn = rusqlite::Connection::open(path_str).unwrap();
        conn.execute_batch(
            "CREATE TABLE players (player_id TEXT PRIMARY KEY, session_token TEXT NOT NULL UNIQUE,
                                   food INTEGER NOT NULL, created_at INTEGER NOT NULL);
             INSERT INTO players VALUES ('plr_old', 'tok', 7, 0);",
        )
        .unwrap();
    }
    let conn = db::open(path_str, 5).unwrap();
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 3);
    assert_eq!(
        db::player_by_token(&conn, "tok").unwrap().as_deref(),
        Some("plr_old"),
        "el token de J1 sigue valiendo tras guardarse como hash"
    );
    let stored: String = conn
        .query_row("SELECT token_hash FROM players", [], |r| r.get(0))
        .unwrap();
    assert_ne!(stored, "tok", "ya no queda en claro");
    let code = db::friend_code_of(&conn, "plr_old").unwrap();
    assert_eq!(
        nidada_rules::friend_code::normalize(&code),
        Some(code.clone())
    );
    assert_eq!(
        db::food(&conn, "plr_old").unwrap(),
        7,
        "los datos de J1 se conservan"
    );
    drop(conn);

    // Abrirla otra vez no repite migraciones ni cambia el código.
    let conn = db::open(path_str, 6).unwrap();
    assert_eq!(db::friend_code_of(&conn, "plr_old").unwrap(), code);
    drop(conn);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{path_str}{suffix}"));
    }
}

#[tokio::test]
async fn session_tokens_are_not_stored_in_plain_text() {
    let (app, state) = app_with_state();
    let (token, _) = player(&app).await;
    let stored: String = api::lock(&state)
        .query_row("SELECT token_hash FROM players", [], |r| r.get(0))
        .unwrap();
    assert_ne!(stored, token);
    assert_eq!(stored.len(), 64);
    let (status, _) = call(&app, Method::GET, "/v1/corral", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    // El hash no es una credencial: presentarlo tal cual no abre la sesión.
    let (status, _) = call(&app, Method::GET, "/v1/corral", Some(&stored), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn signups_are_limited_per_ip() {
    let app = app();
    for _ in 0..SIGNUP_LIMIT {
        let (status, _) = call(&app, Method::POST, "/v1/players", None, None).await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, body) = call(&app, Method::POST, "/v1/players", None, None).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"]["code"], "RATE_LIMITED");

    // Otra IP no se ve afectada.
    let (status, _) = call_from(&app, "10.0.0.2", Method::POST, "/v1/players", None, None).await;
    assert_eq!(status, StatusCode::CREATED);
}

/// El motivo del límite por IP: con un jugador nuevo cada 20 intentos, el límite por
/// jugador no frena a quien pruebe códigos a lo bruto.
#[tokio::test]
async fn wrong_codes_are_limited_per_ip_even_across_new_players() {
    let app = app();
    let (_, victim_code) = player(&app).await;
    let unknown = if victim_code == "222222" {
        "333333"
    } else {
        "222222"
    };
    let mut attempts = 0;
    // Jugadores distintos, misma IP, sin que ninguno llegue a su propio límite.
    let per_player = LOOKUP_LIMIT - 1;
    'outer: loop {
        let (status, body) =
            call_from(&app, "10.0.0.9", Method::POST, "/v1/players", None, None).await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            // Las altas por IP también frenan: el atacante se queda sin jugadores.
            break;
        }
        let token = body["session_token"].as_str().unwrap().to_owned();
        for _ in 0..per_player {
            let (status, _) = call_from(
                &app,
                "10.0.0.9",
                Method::POST,
                "/v1/friends",
                Some(&token),
                Some(json!({ "code": unknown })),
            )
            .await;
            if status == StatusCode::TOO_MANY_REQUESTS {
                break 'outer;
            }
            attempts += 1;
        }
    }
    assert!(
        attempts <= LOOKUP_LIMIT_PER_IP,
        "se probaron {attempts} códigos desde una sola IP"
    );
}

#[tokio::test]
async fn malformed_json_gets_the_api_error_format() {
    let app = app();
    let (token, _) = player(&app).await;
    let req = Request::builder()
        .method(Method::POST)
        .uri("/v1/friends")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from("{esto no es json"))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_client_error());
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).expect("el cuerpo del error es JSON");
    assert_eq!(body["error"]["code"], "INVALID");
    assert!(body["error"]["message"].is_string());
}

/// Un pánico con la conexión tomada no deja el servidor inservible.
#[tokio::test]
async fn server_survives_a_panic_while_holding_the_connection() {
    let (app, state) = app_with_state();
    let (token, _) = player(&app).await;

    let poisoner = state.clone();
    let result = std::thread::spawn(move || {
        let _conn = poisoner.db.lock().unwrap();
        panic!("fallo simulado en una petición");
    })
    .join();
    assert!(result.is_err());
    assert!(state.db.is_poisoned());

    let (status, _) = call(&app, Method::GET, "/v1/corral", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!state.db.is_poisoned());
}

#[test]
fn assigning_a_code_to_a_missing_player_is_an_error() {
    let conn = db::open(":memory:", 1).unwrap();
    let mut rng = nidada_rules::SplitMix64::new(3);
    assert!(db::assign_friend_code(&conn, "plr_no_existe", &mut rng).is_err());
}
