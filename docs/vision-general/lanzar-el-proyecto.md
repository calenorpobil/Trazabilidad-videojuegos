# Lanzar el proyecto

Cómo levantar el hito de `godot-chain` en una máquina de desarrollo: el backend, el servidor de juego de ejemplo,
la demo de Godot y la consola de administración, contra devnet. También cómo probarlo sin red y cómo ejecutar
las suites de tests.

Los comandos son de una shell POSIX: Bash en Linux o macOS, **Git Bash** en Windows. Se ejecutan desde la raíz
del repositorio salvo que se diga otra cosa.

---

## 1. Qué se levanta

| Pieza | Directorio | Dirección | Credencial que usa |
|---|---|---|---|
| Backend y consola `/admin` | `backend/` | `http://127.0.0.1:8787` | Semilla maestra, `write_key`, `read_token`, clave de administración |
| Servidor de juego | `examples/game-server/` | `http://127.0.0.1:8788` | `write_key` |
| Demo | `examples/chain-demo/` | Ventana de Godot | `read_token` |
| Programa `chain-assets` | `programs/chain-assets/` | Ya desplegado en devnet: `4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz` | — |

El catálogo (colecciones y tipos, con la entrega inicial a un jugador) lo crea el estudio desde la consola. La
demo sólo lee inventarios y pide transferencias: éstas van al servidor de juego y de ahí al backend, y las
lecturas van directas al backend. La demo no sabe que hay una cadena debajo: las transacciones se ven en la consola.

Para lanzar el hito **no hace falta compilar el programa**: está desplegado. Anchor sólo hace falta para
modificarlo (sección 7).

## 2. Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 22 o superior (desarrollado con 24) | Backend y servidor de juego |
| Godot | 4.7.2 | La demo y la suite del addon |
| CLI de Solana | Cualquiera reciente, configurada en devnet | Sólo para financiar la autoridad del juego |

La CLI de Solana necesita una cartera con algo de SOL de devnet: `solana airdrop 2` o el faucet web de devnet.

## 3. Configuración, una sola vez

### 3.1 Dependencias

```bash
(cd backend && npm ci)
(cd examples/game-server && npm ci)
```

### 3.2 Semilla y credenciales

El backend necesita una **semilla maestra** y **tres credenciales**, distintas entre sí y de 32 caracteres o más.
Van **fuera del repositorio**. Este bloque las genera con el generador criptográfico de Node, 32 bytes aleatorios
cada una, y escribe un fichero de variables que se carga en cada terminal:

```bash
D="$HOME/.godot-chain"
if [ -e "$D/chain-demo.seed" ] || [ -e "$D/env.sh" ]; then
  echo "Ya hay un despliegue en $D y no se sobrescribe: perder la semilla es perder el juego." >&2
else
  r() { command node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
  SEED=$(r); WK=$(r); RT=$(r); AK=$(r)
  if [ ${#SEED} -ne 64 ] || [ ${#WK} -ne 64 ] || [ ${#RT} -ne 64 ] || [ ${#AK} -ne 64 ]; then
    echo "No se han generado las claves. Comprueba que node funciona en esta terminal: node --version" >&2
  else
    mkdir -p "$D" && chmod 700 "$D"
    printf '%s\n' "$SEED" > "$D/chain-demo.seed" && chmod 600 "$D/chain-demo.seed"
    cat > "$D/env.sh" <<EOF
# Despliegue local de la demo de godot-chain. Fuera del repositorio: no lo publiques.
export CHAIN_GAME_ID=elige-un-id-propio
export CHAIN_MASTER_SEED_FILE=$D/chain-demo.seed
export CHAIN_DATABASE_PATH=$D/chain.db
export CHAIN_WRITE_KEY=$WK
export CHAIN_READ_TOKEN=$RT
export CHAIN_ADMIN_KEY=$AK
export GAME_SERVER_WRITE_KEY=\$CHAIN_WRITE_KEY
export GAME_SERVER_DATABASE_PATH=$D/game-server.db
export CHAIN_DEMO_READ_TOKEN=\$CHAIN_READ_TOKEN
EOF
    chmod 600 "$D/env.sh"
    echo "Creado $D. Edita CHAIN_GAME_ID en env.sh y guarda una copia de la semilla fuera de este ordenador."
  fi
fi
```

**Se ejecuta una sola vez, al montar un despliegue nuevo.** Si ya tienes uno, sáltate esta sección y la 3.3 y la
3.4: empieza en la sección 4. `command node` evita el alias que Git Bash pone a `node` (`winpty node.exe`), que
dentro de `$(…)` no devuelve nada. Si la carpeta ya tiene un despliegue, el bloque no la toca; si `node` no responde en
esa terminal, avisa y no escribe nada. **La semilla no se puede reponer:** si se pierde, se pierden la autoridad
del juego y todo lo que controla. Guarda una copia fuera de este ordenador, por ejemplo en un gestor de
contraseñas.

Antes de seguir, edita `CHAIN_GAME_ID` en `env.sh`: `[a-z0-9-]`, de 1 a 32 caracteres. **Tiene que ser único en
devnet**: el juego es una cuenta que sale sólo de ese identificador, y el primero que lo crea es su dueño. Si el
paso 3.4 dice que el juego existe con otra autoridad, elige otro.

| Variable | Qué es | Quién la usa |
|---|---|---|
| `CHAIN_MASTER_SEED_FILE` | Fichero con la semilla maestra: 64 caracteres hexadecimales. De ella salen la clave de la autoridad del juego y la de cada jugador | Sólo el backend |
| `CHAIN_WRITE_KEY` | Credencial de escritura del contrato HTTP | Backend y servidor de juego (`GAME_SERVER_WRITE_KEY`) |
| `CHAIN_READ_TOKEN` | Credencial de lectura. Va en el juego y se da por pública | Backend y demo (`CHAIN_DEMO_READ_TOKEN`) |
| `CHAIN_ADMIN_KEY` | Entrada a la consola `/admin` | Backend |
| `CHAIN_DATABASE_PATH`, `GAME_SERVER_DATABASE_PATH` | Ficheros SQLite | Backend y servidor de juego |

**La semilla no se cambia una vez creado el juego.** Otra semilla da otra autoridad, y el juego quedaría en manos
de la anterior. Las tres credenciales sí se pueden regenerar cuando se quiera: basta con reiniciar los procesos.

Opcionales del backend: `CHAIN_RPC_URL` (por defecto, el nodo público de devnet), `CHAIN_HOST`, `CHAIN_PORT`,
`CHAIN_READ_RATE_LIMIT` (120 lecturas por minuto y por IP) y `CHAIN_EXPLORER_TX_URL`. Del servidor de juego:
`GAME_SERVER_BACKEND_URL`, `GAME_SERVER_PLAYER` (por defecto `player-a`), `GAME_SERVER_HOST` y `GAME_SERVER_PORT`.
De la demo: `CHAIN_DEMO_WRITE_URL` y `CHAIN_DEMO_READ_URL`.

### 3.3 Financiar la autoridad del juego

La autoridad firma y paga todas las operaciones del juego. Su dirección sale de la semilla; `init-game` la
imprime:

```bash
. ~/.godot-chain/env.sh
(cd backend && npm run init-game)
```

La primera vez termina diciendo que no hay fondos y da el comando para financiarla:

```bash
solana transfer <dirección de la autoridad> 0.2 --allow-unfunded-recipient
```

Con 0,2 SOL hay para muchas ejecuciones del hito: cada tipo nuevo cuesta unas milésimas de SOL en renta.

### 3.4 Crear el juego en la cadena

```bash
. ~/.godot-chain/env.sh
(cd backend && npm run init-game)
```

Con fondos, envía `initialize_game` e imprime su firma. Es repetible: si el juego ya existe con esta autoridad, no
hace nada. Sirve también, más adelante, para ver el saldo de la autoridad.

### 3.5 Importar la demo en Godot

```bash
godot --headless --path examples/chain-demo --import
```

En Windows, `godot` es la ruta al ejecutable, por ejemplo `/c/ruta/Godot_v4.7.2-stable_win64.exe`. La importación
registra las clases del addon. En Windows puede terminar con un código de error aunque haya funcionado.

## 4. Lanzar el hito

Tres terminales. **Cada una carga antes las variables:**

```bash
. ~/.godot-chain/env.sh
```

**Terminal 1, backend.** Listo cuando escribe `Server listening at http://127.0.0.1:8787`.

```bash
cd backend && npm start
```

**Terminal 2, servidor de juego.** Listo cuando escribe `Server listening at http://127.0.0.1:8788`.

```bash
cd examples/game-server && npm start
```

**Terminal 3, demo.**

```bash
godot --path examples/chain-demo        # el juego
godot -e --path examples/chain-demo     # o el editor, y Play desde él
```

Hay que lanzarla **desde esa terminal**: Godot sólo ve `CHAIN_DEMO_READ_TOKEN` si hereda su entorno. Abierta desde
un acceso directo, arranca en modo MOCK. La segunda línea de la ventana dice en qué modo está.

### El recorrido del hito

1. **En la consola** (`http://127.0.0.1:8787/admin`, ver más abajo), crea una colección y, dentro, un tipo con sus
   cualidades y una entrega inicial a `player-a`, por ejemplo 3 unidades. Espera a que su operación llegue a
   `settled`. La demo no puede crear objetos: el servidor de juego lo rechaza con `403`.
2. **En la demo**, pulsa «Releer inventarios». A muestra el tipo nuevo, con su identificador `itm_…`.
3. **Pulsa «Dar 1 a B»** en esa línea. La transferencia aparece en la lista de operaciones y pasa por
   `pending → applied → settled`; al final se releen los dos inventarios. Se puede repetir mientras A tenga
   unidades; sin ellas, la operación falla con `INSUFFICIENT_BALANCE`.

Cada tipo de A tiene su propio botón. Dos tipos pueden llamarse igual y ser activos distintos: no se suman ni se
mueven juntos, y por eso cada línea muestra su identificador. Un jugador que nunca ha recibido nada aparece «sin
objetos». En devnet `applied` y `settled` llegan casi a la vez.

La demo no guarda nada al cerrarse; al abrirla relee los inventarios. El backend y el servidor de juego conservan
lo suyo en SQLite.

### La consola de administración

Abre `http://127.0.0.1:8787/admin` y entra con la clave de administración:

```bash
. ~/.godot-chain/env.sh && echo "$CHAIN_ADMIN_KEY"
```

Ahí se crean las colecciones y los tipos, y están el catálogo, los inventarios y la lista de operaciones. Cada operación enlaza a su
transacción en el explorador de devnet, y una transferencia muestra quién da a quién. La consola sólo responde en
`127.0.0.1`.

### Parar

`Ctrl+C` en las terminales 1 y 2. Si una terminal se cerró sin parar su proceso, el puerto sigue ocupado. Para
encontrarlo:

```bash
netstat -ano | grep -E ":878[78] .*LISTEN"   # Windows; en Linux y macOS: lsof -i :8787 -i :8788
```

Y para cerrarlo: `taskkill //PID <pid> //F` en Git Bash, o `kill <pid>`.

## 5. Sin red: modo MOCK

Sin `CHAIN_DEMO_READ_TOKEN` en el entorno, la demo responde en memoria, sin backend ni servidor de juego, y se crea
un tipo de prueba con 3 unidades para A:

```bash
godot --path examples/chain-demo
```

Sólo cubre el camino feliz, y puede divergir del backend real. Sirve para ver la escena, no para validar la cadena.

## 6. Problemas frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| La demo dice «Modo MOCK» | Godot no heredó el entorno | Lánzala desde una terminal con `env.sh` cargado |
| `INSUFFICIENT_FUNDS` en una operación o en `init-game` | La autoridad no tiene SOL suficiente | Financiarla (3.3) |
| `init-game` dice que el juego existe con otra autoridad | Otro despliegue ya usa ese `CHAIN_GAME_ID` | Elegir otro `CHAIN_GAME_ID` |
| `INTERNAL: el backend no responde` | El servidor de juego no llega al backend | Arrancar el backend (terminal 1) |
| `NETWORK` al pulsar un botón | No hay servidor de juego | Arrancarlo (terminal 2) |
| A sale «sin objetos» | Todavía no se ha creado ningún tipo con entrega a `player-a`, o su creación no ha llegado a `settled` | Crearlo en la consola (sección 4) y releer |
| `RATE_LIMITED` | Demasiadas lecturas por minuto, o límite del nodo público de devnet | Esperar unos segundos; el addon reintenta solo |
| `REJECTED` con credencial inválida | Las credenciales del backend y del servidor de juego no coinciden | Cargar el mismo `env.sh` en todas las terminales y reiniciar |
| `EADDRINUSE` al arrancar | Queda un proceso anterior escuchando | Pararlo (sección 4, «Parar») |
| Errores de clases al abrir la demo | El proyecto no se ha importado | Importarlo (3.5) |
| El backend termina con `configuracion invalida` | Falta una variable o no cumple su formato | El mensaje dice cuál; revisar `env.sh` |

## 7. Tests

Ninguno necesita red salvo los de devnet, que van a mano y fuera de la CI.

```bash
# Backend: tipos, estilo y tests (incluye el firmante único y los vectores de derivación)
cd backend && npm run typecheck && npm run lint && npm test

# Servidor de juego, contra un backend falso
cd examples/game-server && npm run typecheck && npm test

# Addon, en modo MOCK, con Godot sin pantalla
godot --headless --path addon --import                        # sólo la primera vez
godot --headless --path addon --script res://tests/run.gd

# Programa: Anchor y Solana, en Linux o WSL (no funciona nativo en Windows)
anchor build
cargo test -p chain-assets

# Devnet, a mano: crea su propio juego con una cartera con fondos
cd backend && CHAIN_DEVNET_KEYPAIR=<fichero de clave con fondos> npm run test:devnet
```

La CI de GitHub ejecuta todo lo anterior salvo la prueba de devnet, más la guardia de vocabulario. Se lanza desde
la pestaña Actions o con un push a la rama principal.

## 8. Lo que no hay que hacer

- **No publicar `env.sh` ni el fichero de la semilla.** Quien tenga la semilla controla todos los activos del juego.
- **No poner el `write_key` en el juego.** Las escrituras pasan siempre por el servidor de juego.
- **No borrar `chain.db`** con un juego en uso: guarda el catálogo, los jugadores y el estado de las operaciones.
  La cadena conserva la propiedad, pero sin la base el backend no sabe qué tipo es cada activo.
