//! Servidor de juego de *Nidada*. Fase J1 de `docs/plan-juego.md`: cuentas anónimas y
//! bucle de cuidado. Es la autoridad sobre el estado de las mascotas; el cliente sólo
//! dibuja.
//!
//! Todavía no habla con `godot-chain`: las mascotas iniciales viven sólo aquí. En J4
//! pasarán a respaldarse con un `grant` y se añadirá la reconciliación del diseño 3.1.

mod api;
mod db;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub time_scale: f64,
}

/// Configuración por variables de entorno. Ninguna credencial en el repositorio.
struct Config {
    addr: SocketAddr,
    db_path: String,
    time_scale: f64,
}

impl Config {
    fn from_env() -> Result<Config, String> {
        let addr = std::env::var("NIDADA_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
        let addr = addr
            .parse()
            .map_err(|_| format!("NIDADA_ADDR no es una dirección válida: {addr}"))?;
        let db_path = std::env::var("NIDADA_DB").unwrap_or_else(|_| "nidada.db".into());
        let time_scale = match std::env::var("TIME_SCALE") {
            Ok(v) => v
                .parse::<f64>()
                .map_err(|_| format!("TIME_SCALE no es un número: {v}"))?,
            Err(_) => 1.0,
        };
        if time_scale.is_nan() || time_scale <= 0.0 {
            return Err("TIME_SCALE tiene que ser positivo".into());
        }
        Ok(Config {
            addr,
            db_path,
            time_scale,
        })
    }
}

#[tokio::main]
async fn main() {
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Configuración inválida: {e}");
            std::process::exit(2);
        }
    };
    let conn = match db::open(&config.db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("No se pudo abrir la base de datos {}: {e}", config.db_path);
            std::process::exit(1);
        }
    };
    let state = Arc::new(AppState {
        db: Mutex::new(conn),
        time_scale: config.time_scale,
    });

    let listener = match tokio::net::TcpListener::bind(config.addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("No se pudo escuchar en {}: {e}", config.addr);
            std::process::exit(1);
        }
    };
    println!(
        "nidada-server escuchando en http://{} (TIME_SCALE = {}, base de datos {})",
        config.addr, config.time_scale, config.db_path
    );
    axum::serve(listener, api::router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("el servidor HTTP terminó con error");
}
