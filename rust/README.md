# Workspace de Rust de *Nidada*

| Crate | Qué es |
|---|---|
| `nidada-rules` | Reglas del juego. Puras: sin Godot, sin red, sin reloj ni aleatoriedad propios |
| `nidada-ext` | GDExtension que expone las reglas a GDScript para dibujar |
| `nidada-server` | Servidor de juego. Autoridad sobre el estado de las mascotas |

Diseño en [`docs/implementacion-android.md`](../docs/implementacion-android.md); fases en
[`docs/plan-juego.md`](../docs/plan-juego.md).

## Comandos

```bash
cargo test                                   # reglas, con las tablas del diseño como vectores
cargo clippy --all-targets -- -D warnings
./build-ext.sh                               # compila nidada-ext y la copia a examples/godot-demo/bin
TIME_SCALE=120 cargo run -p nidada-server    # http://127.0.0.1:8080, base de datos nidada.db
```

Variables del servidor: `NIDADA_ADDR` (por defecto `127.0.0.1:8080`), `NIDADA_DB` (por defecto
`nidada.db`) y `TIME_SCALE` (por defecto `1`; `120` convierte 72 h de juego en 36 min).

## Windows: tres trampas comprobadas

0. **Git Bash o PowerShell, no WSL.** En WSL se compila para Linux y el Godot de Windows necesita la
   `.dll`; además, una ruta `C:/...` en `CARGO_TARGET_DIR` es relativa para Linux. `build-ext.sh` se
   niega a correr en WSL.

1. **Usa la toolchain MSVC, no la GNU.** Con `x86_64-pc-windows-gnu` faltan `gcc` (para el SQLite
   que compila `rusqlite`) y las utilidades que necesita `windows-sys`. `rust-toolchain.toml` fija la
   versión pero no el anfitrión, así que en una máquina con GNU por defecto:

   ```bash
   rustup toolchain install 1.94.0-x86_64-pc-windows-msvc
   export RUSTUP_TOOLCHAIN=1.94.0-x86_64-pc-windows-msvc   # o: rustup set default-host x86_64-pc-windows-msvc
   ```

   Hace falta Visual Studio 2022 con las herramientas de C++.

2. **La ruta del repositorio tiene una «í»** («Librería»). El enlazador de MinGW no encuentra sus
   propios ficheros en rutas con caracteres no ASCII. Con MSVC no está comprobado, así que por
   ahora compila fuera:

   ```bash
   export CARGO_TARGET_DIR=C:/Users/<tú>/.cargo-target/nidada
   ```

   `build-ext.sh` respeta esa variable.

Con el editor de Godot abierto, la `.dll` está bloqueada y `build-ext.sh` no puede copiarla.
