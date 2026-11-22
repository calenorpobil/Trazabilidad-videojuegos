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
modificarlo (sección 8).

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
export CHAIN_STUDIO_NAME="Mi estudio"
export CHAIN_DEMO_GAME_ID=\$CHAIN_GAME_ID
export CHAIN_DEMO_STUDIO=\$CHAIN_STUDIO_NAME
EOF
    chmod 600 "$D/env.sh"
    echo "Creado $D. Edita CHAIN_GAME_ID y CHAIN_STUDIO_NAME en env.sh y guarda una copia de la semilla fuera de este ordenador."
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
`CHAIN_READ_RATE_LIMIT` (120 lecturas por minuto y por IP), `CHAIN_EXPLORER_TX_URL` y `CHAIN_EXPLORER_ADDRESS_URL`,
`CHAIN_STUDIO_NAME` (el nombre del estudio, sólo para mostrarlo) y las de OpenBao (sección 5). Del servidor de juego:
`GAME_SERVER_BACKEND_URL`, `GAME_SERVER_PLAYER` (por defecto `player-a`), `GAME_SERVER_HOST` y `GAME_SERVER_PORT`.
De la demo: `CHAIN_DEMO_WRITE_URL`, `CHAIN_DEMO_READ_URL`, y `CHAIN_DEMO_GAME_ID` y `CHAIN_DEMO_STUDIO`, que la demo
muestra arriba y en el título de la ventana para saber a qué juego está conectada. Sólo se muestran: no viajan en
ninguna petición.

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

`godot` es la ruta al ejecutable de Godot, salvo que lo tengas en el `PATH` o con un alias. En Windows, por ejemplo,
`/c/ruta/Godot_v4.7.2-stable_win64.exe --path examples/chain-demo`, desde la raíz del repositorio. Con
`alias godot='/c/Users/Carlos/Desktop/Godot_v4.7.1-stable_win64.exe'` en `~/.bashrc`, los comandos de esta guía funcionan tal cual.

Hay que lanzarla **desde esa terminal**: Godot sólo ve `CHAIN_DEMO_READ_TOKEN` si hereda su entorno. Abierta desde
un acceso directo, arranca en modo MOCK. La segunda línea de la ventana dice en qué modo está.

### El recorrido del hito

1. **En la consola** (`http://127.0.0.1:8787/admin`, ver más abajo), crea una colección y, dentro, un tipo con sus
   cualidades y una entrega inicial a `player-a`, por ejemplo 3 unidades. Espera a que su operación llegue a
   `settled`. La demo no puede crear objetos: el servidor de juego lo rechaza con `403`.

   **Para probar sin la consola**, con el backend arrancado, `npm run seed-demo` en `examples/game-server/` crea la
   colección «Armería de la demo» y tres tipos para `player-a`: 3 espadas, 2 escudos y 5 pociones. Espera a que
   lleguen a `settled`. Es repetible: ejecutarlo otra vez no duplica nada. `SEED_TAG=otra npm run seed-demo` crea
   otro juego de datos. En el vídeo, la creación se enseña desde la consola.
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
`127.0.0.1`, `localhost` o `[::1]` con su puerto.

**Juego → Despliegue** dice qué despliegue es: el juego, el estudio, la cuenta `Game`, la autoridad (y si firma la
semilla u OpenBao, con su versión) y el programa, con enlaces al explorador. El juego y el estudio también salen bajo
el nombre de la consola y en la pestaña del navegador.

### Parar

`Ctrl+C` en las terminales 1 y 2. Si una terminal se cerró sin parar su proceso, el puerto sigue ocupado. Para
encontrarlo:

```bash
netstat -ano | grep -E ":878[78] .*LISTEN"   # Windows; en Linux y macOS: lsof -i :8787 -i :8788
```

Y para cerrarlo: `taskkill //PID <pid> //F` en Git Bash, o `kill <pid>`.

## 5. Un segundo estudio, con la autoridad en OpenBao

Cada estudio despliega lo suyo: su juego, su semilla, sus credenciales y sus bases SQLite. Todos comparten el
programa `chain-assets`. Para probar dos estudios en la misma máquina, el segundo va en **otra carpeta y otros
puertos**, y aquí además con la autoridad en OpenBao: su clave firma dentro de OpenBao y nunca llega al backend.

**Cómo firma con OpenBao.** Lo que sale de OpenBao son claves públicas y firmas, nunca la clave privada:

1. **Elegir quién firma:** al arrancar, el backend pide a OpenBao las **claves públicas** de cada versión, que no
   son secretas, y elige la que coincide con la autoridad guardada en la cuenta `Game`.
2. **Pedir la firma:** en cada escritura, el backend envía a OpenBao los bytes de la transacción y OpenBao firma
   **por dentro**, con la clave privada, y devuelve sólo la **firma**, que el backend añade a la transacción y
   envía a Solana.
3. **Rotar:** el operador pide a OpenBao que cree una **versión nueva** de la clave, también por dentro, y
   `rotate-authority` usa la versión anterior para firmar en la cadena que la autoridad pasa a ser la dirección
   de la nueva (5.5).

### 5.1 OpenBao persistente, una sola vez

En WSL (o en Linux), con Docker. Almacenamiento `raft` en un volumen; OpenBao 2.7 ya no tiene `file`. La
configuración, en un fichero de la carpeta del estudio, por ejemplo `~/.godot-chain-estudio-b/bao-config.json`:

```json
{"storage":{"raft":{"path":"/openbao/file","node_id":"estudio-b-1"}},
 "listener":[{"tcp":{"address":"0.0.0.0:8200","tls_disable":true}}],
 "api_addr":"http://127.0.0.1:8200","cluster_addr":"http://127.0.0.1:8201","disable_mlock":true,"ui":false}
```

```bash
# En WSL. Publica el puerto sólo en 127.0.0.1, por eso basta sin TLS
docker volume create godot-chain-bao-data
docker run --name godot-chain-bao -p 127.0.0.1:8200:8200 -v godot-chain-bao-data:/openbao/file \
  -v /mnt/c/Users/<usuario>/.godot-chain-estudio-b/bao-config.json:/openbao/config/bao.json:ro \
  openbao/openbao:2.7.2 server
```

Después, desde Git Bash:

1. **Inicializar** con `POST /v1/sys/init`, por ejemplo con 3 claves de desellado y umbral 2, y guardar la
   respuesta (claves y token raíz) en la carpeta del estudio, **nunca en el repositorio**:
   `curl -X POST http://127.0.0.1:8200/v1/sys/init -d '{"secret_shares":3,"secret_threshold":2}' > bao-init.json`.
2. **Desellar** con dos claves (5.3).
3. Con el token raíz: montar Transit (`POST /v1/sys/mounts/transit`), crear la clave ed25519
   (`POST /v1/transit/keys/<nombre>` con `{"type":"ed25519"}`), las políticas `chain-backend` y `chain-operator` del
   README («Autoridad en OpenBao») y un token con `chain-backend` para el backend (`POST /v1/auth/token/create`).
   El backend nunca usa el token raíz.

**Si se pierden las claves de desellado o el volumen, se pierde la clave de la autoridad, y con ella el juego.**
Guarda una copia de `bao-init.json` fuera de este ordenador, como la semilla. No reinicialices OpenBao nunca.

### 5.2 El despliegue del estudio

Su propio `env.sh`, generado como en la 3.2 pero en otra carpeta (`D="$HOME/.godot-chain-estudio-b"`), con otro
`CHAIN_GAME_ID` y además:

```bash
export CHAIN_PORT=8887
export CHAIN_STUDIO_NAME="Estudio B"
export CHAIN_AUTHORITY_SIGNER=transit
export CHAIN_BAO_ADDR=http://127.0.0.1:8200
export CHAIN_BAO_TOKEN=<el token con la política chain-backend>
export CHAIN_BAO_TRANSIT_KEY=<nombre de la clave>
export GAME_SERVER_BACKEND_URL=http://127.0.0.1:8887
export GAME_SERVER_PORT=8888
export CHAIN_DEMO_WRITE_URL=http://127.0.0.1:8888
export CHAIN_DEMO_READ_URL=http://127.0.0.1:8887
```

`init-game` (3.3 y 3.4) crea el juego con la clave de OpenBao y dice qué dirección hay que financiar. La semilla
sigue haciendo falta: de ella salen las direcciones de los jugadores.

### 5.3 Cada vez que se arranca

OpenBao vuelve **sellado** tras cada arranque, y mientras lo está el backend no puede firmar: las escrituras dan
`500` sin guardar nada, y se pueden reintentar con la misma clave al desellarlo.

```bash
# 1. En WSL, en una terminal que siga abierta: WSL se apaga si no le queda ningún proceso
docker start -a godot-chain-bao

# 2. En Git Bash, desellar con dos de las claves de bao-init.json
for i in 0 1; do
  command node -e "process.stdout.write(JSON.stringify({key: require(process.argv[1]).keys[+process.argv[2]]}))" \
    "$HOME/.godot-chain-estudio-b/bao-init.json" $i | curl -s -X POST http://127.0.0.1:8200/v1/sys/unseal -d @-
done

# 3. Backend, servidor de juego y demo, como en la sección 4, cargando este env.sh
. ~/.godot-chain-estudio-b/env.sh
```

El backend escribe al arrancar quién firma: `firma la autoridad: OpenBao Transit, clave … version 1`.

### 5.4 Su consola y su demo

- **Consola:** `http://127.0.0.1:8887/admin`, con el `CHAIN_ADMIN_KEY` de su `env.sh`
  (`grep CHAIN_ADMIN_KEY ~/.godot-chain-estudio-b/env.sh`). Las dos consolas pueden estar abiertas a la vez:
  la cookie de sesión lleva el `game_id`.
- **Demo:** `. ~/.godot-chain-estudio-b/env.sh` y `godot --path examples/chain-demo`. Arriba dice a qué juego y
  estudio está conectada. Si lanzas desde el editor, ábrelo desde esa terminal.

Los dos estudios están aislados: el mismo `player-a` tiene otro `holder_id` en cada uno, y las credenciales de
uno no sirven en el otro.

### 5.5 Rotar la autoridad

Cambiar la clave que firma por una versión nueva, sin tocar los objetos de los jugadores. Se parte de que la
autoridad es la versión 1, en OpenBao y en la cadena. Los comandos de `npm` van en `backend/`, con el `env.sh`
del estudio cargado.

| # | Paso | Cómo | OpenBao | Cadena (`Game`) | Backend |
|---|---|---|---|---|---|
| 1 | **Parar el backend** | `Ctrl+C` en su terminal | v1 | v1 | Parado |
| 2 | **Rotar la clave en OpenBao**, con el **token del operador** (el del backend no puede rotar) | `curl -H "X-Vault-Token: <token del operador>" -X POST http://127.0.0.1:8200/v1/transit/keys/<nombre de la clave>/rotate` | v1 y **v2** | v1 | Parado |
| 3 | **Ver la dirección nueva** | `npm run rotate-authority`. Si la nueva no tiene fondos, se niega y da su dirección y la orden para financiarla | v1 y v2 | v1 | Parado |
| 4 | **Financiar la autoridad nueva**, que pagará desde ahora | `solana transfer <dirección de la v2> 0.1 --allow-unfunded-recipient` | v1 y v2 | v1 | Parado |
| 5 | **Rotar en la cadena** | `npm run rotate-authority`. Firma la **v1** (`rotate_authority`, una sola firma), espera la confirmación y comprueba que `Game` ya dice v2 | v1 y v2 | **v2** | Parado |
| 6 | **Arrancar el backend** | `npm start`. El log dice `firma la autoridad: OpenBao Transit, clave … version 2` | v1 y v2 | v2 | Firma con la **v2** |
| 7 | **Comprobar** | En la consola, **Juego → Despliegue** muestra la autoridad nueva y «versión 2»; una transferencia desde la demo llega a `settled` | v1 y v2 | v2 | v2 |

- **Por qué hay que parar el backend:** elige su versión al arrancar. Si sigue en marcha tras el paso 5, firma
  con la v1, y el programa rechaza esas firmas. El servidor de juego puede seguir encendido: mientras tanto, sus
  peticiones fallan con `INTERNAL` y se pueden reintentar.
- **Dos tokens, dos papeles:** rotar en OpenBao (paso 2) exige el token del operador. `rotate-authority` (pasos 3
  y 5) usa el del backend, porque sólo lee la clave y firma. El token que vive en el backend no puede rotar la
  clave por su cuenta.
- **Si algo falla entre el paso 2 y el 5,** no pasa nada: la cadena sigue en la v1 y el backend, al arrancar,
  elige la v1. Se retoma desde el paso 3.
- **La v1 no se borra.** Sigue en OpenBao con el SOL que le quede. No la recortes (`trim`) mientras tenga fondos:
  es la única que puede moverlos, y para eso no hay herramienta en v1.
- **El juego no nota nada:** ni la demo ni el addon cambian, ni los objetos de los jugadores. Los poderes los
  tiene la cuenta `Game`; sólo cambia a quién obedece.

Para pasar a OpenBao un juego que firmaba con la semilla, el camino es el mismo desde el paso 3: se crea la clave
en OpenBao, se añaden a su `env.sh` las variables de OpenBao de la 5.2 y `rotate-authority` firma con la semilla
hacia la versión 1.

## 6. Sin red: modo MOCK

Sin `CHAIN_DEMO_READ_TOKEN` en el entorno, la demo responde en memoria, sin backend ni servidor de juego, y se crea
un tipo de prueba con 3 unidades para A:

```bash
godot --path examples/chain-demo
```

Sólo cubre el camino feliz, y puede divergir del backend real. Sirve para ver la escena, no para validar la cadena.

## 7. Problemas frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| La demo dice «Modo MOCK» | Godot no heredó el entorno | Lánzala desde una terminal con `env.sh` cargado |
| La demo dice «Juego: sin indicar» | Godot se lanzó con un entorno sin `CHAIN_DEMO_GAME_ID`: una terminal o un editor abiertos antes de añadirla a `env.sh` | Cargar otra vez `env.sh` y lanzar la demo, o reabrir el editor, desde esa terminal |
| `INTERNAL` en todas las escrituras con OpenBao | OpenBao está sellado o parado (el log del backend dice «OpenBao responde 503» o «no responde») | Arrancarlo y desellarlo (5.3) y reintentar con la misma clave |
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

## 8. Tests

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

## 9. Lo que no hay que hacer

- **No publicar `env.sh` ni el fichero de la semilla.** Quien tenga la semilla controla todos los activos del juego.
- **No poner el `write_key` en el juego.** Las escrituras pasan siempre por el servidor de juego.
- **No borrar `chain.db`** con un juego en uso: guarda el catálogo, los jugadores y el estado de las operaciones.
  La cadena conserva la propiedad, pero sin la base el backend no sabe qué tipo es cada activo.
