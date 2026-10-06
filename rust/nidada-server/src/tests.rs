//! Tests de integración de la API: el `Router` entero contra SQLite en memoria, sin red.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::friends::LOOKUP_LIMIT;
use crate::{AppState, api, db};

fn app() -> Router {
    let conn = db::open(":memory:", 1).unwrap();
    api::router(Arc::new(AppState {
        db: Mutex::new(conn),
        time_scale: 1.0,
    }))
}

async fn call(
    app: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let req = match body {
        Some(b) => req
            .header("Content-Type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.body(Body::empty()),
    }
    .unwrap();
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
    let path = std::env::temp_dir().join(format!("nidada-migration-{}.db", api::random_seed()));
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
    assert_eq!(version, 2);
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
