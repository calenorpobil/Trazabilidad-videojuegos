# Manual del estudio

Qué recibe un estudio de videojuegos que adopta `godot-chain`, qué tiene que poner de su parte y cómo se
usa y se opera, desde las decisiones previas hasta el día a día.

Está escrito para el equipo del estudio: el responsable técnico, quien programa en Godot, quien programa
el servidor de juego y quien gestiona el catálogo. Los comandos concretos no se repiten aquí: están en
[`lanzar-el-proyecto.md`](lanzar-el-proyecto.md), al que este manual remite por secciones.

> **Estado de v1.** Funciona en **devnet**, la red de pruebas de Solana, y se ha probado de extremo a
> extremo con todas las piezas en una misma máquina. No está preparado para jugadores reales ni para
> mainnet: la sección 10 dice qué falta.

## Índice

1. [Qué recibe el estudio](#1-qué-recibe-el-estudio)
2. [Quién hace qué en el estudio](#2-quién-hace-qué-en-el-estudio)
3. [Decisiones previas que no tienen vuelta atrás](#3-decisiones-previas-que-no-tienen-vuelta-atrás)
4. [Puesta en marcha](#4-puesta-en-marcha)
5. [Integrar el addon en el juego](#5-integrar-el-addon-en-el-juego)
6. [Escribir el servidor de juego](#6-escribir-el-servidor-de-juego)
7. [Gestionar el catálogo en la consola](#7-gestionar-el-catálogo-en-la-consola)
8. [Operación diaria](#8-operación-diaria)
9. [Incidentes](#9-incidentes)
10. [Antes de abrirlo a jugadores reales](#10-antes-de-abrirlo-a-jugadores-reales)
11. [Lista de comprobación](#11-lista-de-comprobación)

---

## 1. Qué recibe el estudio

`godot-chain` es un servicio **autoalojado**: cada estudio despliega y opera su propia instancia, una por
juego. No hay un servicio central ni nadie que lo opere por el estudio (propuesta, sección 1 y limitación 11).

| Pieza | Qué es | Quién la opera |
|---|---|---|
| **Addon `godot_chain`** | Carpeta de GDScript que se copia al proyecto de Godot. Da al juego el objeto `Chain` para leer inventarios y pedir transferencias | Programadores del juego |
| **Backend `chain-backend`** | Servicio en Node.js con SQLite. Custodia las claves, firma y envía las transacciones, sigue su estado y sirve la consola | El estudio, en su máquina |
| **Consola `/admin`** | Web de administración que sirve el propio backend: catálogo, operaciones, inventarios y datos del despliegue | Quien gestiona el catálogo |
| **Programa `chain-assets`** | El programa en la cadena que tiene los poderes sobre los objetos. **Ya está desplegado en devnet**; cada juego es una cuenta dentro de él | Nadie del estudio: no se compila ni se despliega |
| **Servidor de juego de ejemplo** | `examples/game-server/`. Punto de partida para el servidor del estudio, **no un producto**: no autentica a nadie | De referencia |

**Lo que pone el estudio:**

- **Su servidor de juego**, con su sistema de cuentas. Es quien decide qué puede hacer cada jugador (sección 6).
- **Una máquina** para el backend, con Node.js 22 o superior, y, si se elige, OpenBao (sección 3).
- **SOL** para la cuenta que paga las operaciones del juego, la *autoridad* (sección 8).
- **La custodia** de la semilla maestra y, con OpenBao, de sus claves de desellado.
- **Copias de seguridad** de las bases de datos.

```
Jugador ─► Juego de Godot + addon ──lecturas (read_token)──────────────────┐
                │                                                           ▼
                └─escrituras─► Servidor de juego del estudio ─(write_key)─► Backend ─► Solana
                                                                            ▲
                               Equipo del estudio ─► Consola /admin ────────┘
```

El jugador no tiene wallet, no firma y no paga nada. Su identidad es la que ya le da el juego.

## 2. Quién hace qué en el estudio

| Papel | Qué hace | Qué credencial maneja |
|---|---|---|
| **Responsable técnico u operaciones** | Despliega el backend, guarda la semilla, financia la autoridad, hace las copias de seguridad y rota claves | La semilla maestra, `CHAIN_WRITE_KEY`, `CHAIN_READ_TOKEN`, `CHAIN_ADMIN_KEY` y, con OpenBao, sus claves y tokens |
| **Programador de Godot** | Integra el addon: configuración, inventarios, transferencias y estados | Sólo el `read_token`, que va en el binario y se da por público |
| **Programador del servidor de juego** | Autentica al jugador, decide qué se le permite y reenvía las transferencias | El `write_key` |
| **Gestor del catálogo** | Crea colecciones y tipos de objeto en la consola y consulta operaciones e inventarios | `CHAIN_ADMIN_KEY` |

Cada credencial abre una sola puerta, y el backend no arranca si dos coinciden. Qué pasa si se filtra cada
una está en la sección 9.

## 3. Decisiones previas que no tienen vuelta atrás

Hay que tomarlas antes de crear el juego. Ninguna se puede cambiar después sin perder lo creado.

| Decisión | Por qué no se puede cambiar | Recomendación |
|---|---|---|
| **El identificador del juego** (`CHAIN_GAME_ID`): `[a-z0-9-]`, de 1 a 32 caracteres | La cuenta del juego en la cadena sale sólo de él, y el primero que lo usa es su dueño | Uno propio y distintivo. Si `init-game` dice que ya existe con otra autoridad, elegir otro |
| **El identificador de cada jugador** (`external_id`): de 1 a 64 caracteres | De él sale la dirección del jugador. Si cambia, sus objetos se quedan en una dirección que nadie reclama | El identificador interno e inmutable de la cuenta del jugador. Nunca el nombre visible ni el correo |
| **La semilla maestra** | De ella salen las direcciones de todos los jugadores y, si no se usa OpenBao, la autoridad. **No se puede reponer** | Generarla una vez (lanzamiento, 3.2) y guardar una copia fuera de la máquina antes de seguir |
| **Dónde firma la autoridad** | Con la semilla, quien lea el fichero controla todo el juego. Con OpenBao, la clave de la autoridad no sale nunca de OpenBao | OpenBao para cualquier cosa que no sea una prueba (lanzamiento, sección 5). Se puede pasar de la semilla a OpenBao después; la herramienta de rotación sólo va en ese sentido |
| **Qué es un objeto** | Los objetos son **fungibles**: las unidades de un tipo son idénticas, y las cualidades describen el tipo, no cada ejemplar. **Todo objeto es transferible**, para siempre | Si algo tiene que diferenciarse (durabilidad, nivel), un tipo por variante o guardar ese estado en el servidor de juego |

**Dos comprobaciones fuera de la técnica:**

- **Las tiendas.** Steam prohíbe en su onboarding los juegos con tecnología blockchain que emitan o permitan
  intercambiar criptomonedas o NFT. Hay que leer el texto vigente de Steam, Google Play y App Store antes de
  decidir nada (README, aviso inicial).
- **El presupuesto en SOL.** Casi todo el coste es un depósito por jugador y tipo distinto que tiene: unos
  0,00152 SOL la primera vez que un jugador recibe un tipo, y no se recupera. 20.000 jugadores con 10 tipos
  distintos de media son unos 304 SOL. El resto es despreciable (README, «Coste en la cadena»).

## 4. Puesta en marcha

Se hace una vez por juego. Cada paso remite a [`lanzar-el-proyecto.md`](lanzar-el-proyecto.md).

1. **Instalar las dependencias** del backend (lanzamiento, 3.1).
2. **Generar la semilla y las tres credenciales** en una carpeta fuera del repositorio, con su `env.sh`
   (3.2). Fijar en ese fichero `CHAIN_GAME_ID` y `CHAIN_STUDIO_NAME`. **Copiar la semilla fuera de la
   máquina**, por ejemplo a un gestor de contraseñas.
3. **Con OpenBao:** levantarlo con almacenamiento persistente, inicializarlo, crear la clave y las dos
   políticas, y añadir sus variables a `env.sh` (5.1 y 5.2). Copiar fuera de la máquina la respuesta de la
   inicialización, con las claves de desellado.
4. **Financiar la autoridad y crear el juego** con `npm run init-game`. La primera vez dice qué dirección
   financiar y con qué orden; con fondos, crea el juego (3.3 y 3.4).
5. **Arrancar el backend** con `npm start` (sección 4).
6. **Entrar en la consola** y comprobar en **Juego → Despliegue** que el juego, el estudio y la autoridad son
   los esperados (sección 4, «La consola de administración»).
7. **Crear el catálogo** (sección 7 de este manual).
8. **Arrancar el servidor de juego del estudio**, con el `write_key` (sección 6).

## 5. Integrar el addon en el juego

### 5.1 Instalar

1. Copiar la carpeta `addon/addons/godot_chain/` a `addons/godot_chain/` del proyecto. Es GDScript puro, sin
   binarios ni dependencias; funciona en Godot 4.7.2.
2. En **Proyecto → Configuración del proyecto → Plugins**, activar `godot_chain`. Eso registra el autoload
   `Chain`, accesible desde cualquier escena.

Al actualizar el addon, se sustituye la carpeta entera.

### 5.2 Configurar

`Chain.configure()` se llama una vez, antes de la primera operación. `ChainConfig` es un `Resource`: se puede
crear por código, como aquí, o como recurso `.tres` en el editor.

```gdscript
func _ready() -> void:
	var config := ChainConfig.new()
	config.write_url = "https://juego.mi-estudio.example"   # el servidor de juego del estudio
	config.read_url = "https://objetos.mi-estudio.example"  # el backend, sólo para lecturas
	config.read_token = "..."                                # público: va dentro del binario
	config.game_id = "mi-juego"                              # sólo informativo, no viaja
	Chain.configure(config)
```

| Campo | Qué es | Por defecto |
|---|---|---|
| `write_url` | Servidor de juego, que recibe las transferencias | — |
| `read_url` | Backend, que responde a las lecturas | — |
| `read_token` | Credencial de sólo lectura | — |
| `game_id` | Para mostrarlo; no viaja en ninguna petición | `""` |
| `request_timeout` | Segundos de espera de cada petición | 10 |
| `operation_timeout` | Segundos que se sigue una operación antes de darla por fallida con `NETWORK`; 0 es sin límite | 120 |
| `poll_interval` | Segundos entre consultas del estado de una operación | 1 |
| `mode` | `LIVE` o `MOCK` (5.7) | `LIVE` |
| `mock_sender` | Sólo en MOCK: el jugador que hace las transferencias | `""` |

**En el binario sólo va el `read_token`.** El `write_key` no va nunca en el juego: quien lo extrajera podría
mover los objetos de cualquier jugador.

### 5.3 Leer el inventario de un jugador

```gdscript
func show_inventory(player_id: String) -> void:
	var handle := Chain.inventory(player_id)
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		for item in handle.result["items"]:
			print("%s x%d" % [item["name"], item["amount"]])
	elif handle.error.code == ChainError.NOT_FOUND:
		print("Sin objetos")  # nunca ha recibido nada
	else:
		push_warning(str(handle.error))
```

- `player_id` es el identificador que el juego da al jugador (sección 3). También admite un `hld_…`.
- Cada objeto trae `item_id`, `collection_id`, `name`, `symbol`, `uri`, `qualities` y `amount`.
- **Sólo refleja lo definitivo.** Una transferencia en curso puede no verse todavía.
- **Dos tipos pueden llamarse igual** y ser objetos distintos. Lo que los distingue es el `item_id`.

### 5.4 Transferir

```gdscript
func give(item_id: String, recipient_id: String, call_id: String) -> void:
	var handle := Chain.transfer(item_id, 1, recipient_id, call_id)
	handle.applied.connect(_play_give_animation)
	handle.failed.connect(_undo_give_animation)
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		_save_game_state()  # sólo aquí se guarda estado
```

- **No hay argumento para el emisor.** Quién da lo decide el servidor de juego, que sabe qué jugador hace la
  petición (sección 6).
- **Entra la cantidad entera o nada.** No hay transferencias parciales.
- **Se conectan las señales justo después de la llamada.** El handle nunca se resuelve antes, pero esperar
  con `await` una señal ya emitida cuelga para siempre: de ahí el `is_finished()`.

### 5.5 Los estados de una operación

```
pending ──► applied ──► settled
   │           │
   └───────────┴──► failed
```

| Estado | Señal | Qué hace el juego |
|---|---|---|
| `pending` | — | Como mucho, indicar que hay algo en curso |
| `applied` | `applied` | Animar. **No guardar nada**: todavía puede fallar |
| `settled` | `settled` | Definitivo e irreversible. **Aquí, y sólo aquí, se guarda estado** |
| `failed` | `failed(error)` | Deshacer lo que se animó |

En devnet `applied` y `settled` llegan casi a la vez, pero el juego tiene que tratarlos por separado.

### 5.6 El `call_id`: una acción, un identificador

Cada escritura lleva un `call_id`, de 1 a 64 caracteres, que el juego elige. Con él, el addon calcula la
clave que impide que una acción se ejecute dos veces.

- **Una acción nueva, un `call_id` nuevo.** Si se reutiliza el de una acción anterior, la nueva **no se
  ejecuta** y devuelve el resultado de la anterior, sin aviso.
- **Una misma acción reintentada, el mismo `call_id`.** Si se genera uno nuevo en cada reintento, la acción se
  ejecuta dos veces.
- **Los cortes de red los reintenta el addon solo**, con la misma clave. El juego no tiene que hacer nada.
- **Si una acción tiene que sobrevivir a un cierre del juego**, el juego guarda su `call_id` antes de
  llamar y lo reutiliza al reabrir.

Una forma sencilla es construirlo con lo que identifica la acción en el juego: `"regalo-<id del regalo>"`.

### 5.7 Errores

`handle.error` es un `ChainError` con `code`, `message` y `retryable`.

| `code` | Qué significa | Qué hace el juego |
|---|---|---|
| `NETWORK` | No hubo respuesta a tiempo | Reintentar con el **mismo** `call_id` |
| `RATE_LIMITED` | Demasiadas peticiones | Esperar y reintentar; el addon ya respeta `Retry-After` |
| `INSUFFICIENT_BALANCE` | El jugador no tiene unidades suficientes | Avisar al jugador. No se reintenta |
| `INSUFFICIENT_FUNDS` | La autoridad del juego no tiene SOL | Es del estudio: avisar a operaciones (sección 8). Se puede reintentar después |
| `EXPIRED` | La transacción caducó antes de confirmarse | Reintentar con un `call_id` **nuevo** |
| `REJECTED` | Petición inválida o no permitida | Corregir; no se reintenta |
| `NOT_FOUND` | El tipo o el jugador no existen. En un inventario, el jugador no tiene objetos | Tratarlo como «sin objetos» |
| `INTERNAL` | Fallo del backend o del servidor de juego | Reintentar más tarde |
| `CONFIG` | Falta la configuración o es incoherente | Corregir el código |

**Regla:** tras un `failed`, un reintento lleva un `call_id` nuevo. Tras un `NETWORK`, el mismo.

### 5.8 Desarrollar sin red: modo MOCK

Con `config.mode = ChainConfig.Mode.MOCK`, el addon responde en memoria, sin backend ni servidor de juego, con
la misma forma de respuesta. Sirve para programar la interfaz sin desplegar nada.

- En MOCK el juego puede crearse colecciones y tipos de prueba con `Chain.create_collection()` y
  `Chain.create_item()`. **En LIVE no**: el servidor de juego lo rechaza, porque el catálogo lo crea el
  estudio en la consola.
- El emisor de las transferencias es `config.mock_sender`.
- **Sólo cubre el camino feliz.** No produce fallos y puede divergir del backend real. No sustituye a una
  prueba en devnet.

### 5.9 Resumen de la API

| Llamada | Devuelve en `result` |
|---|---|
| `Chain.configure(config)` | — |
| `Chain.inventory(player)` | `holder_id` e `items` |
| `Chain.transfer(item_id, amount, recipient, call_id)` | `from_holder_id` y `to_holder_id` |
| `Chain.create_collection(name, call_id)` | `collection_id`. Sólo en MOCK |
| `Chain.create_item(collection_id, name, symbol, uri, qualities, holder, amount, call_id)` | `item_id` y `holder_id`. Sólo en MOCK |

Todas devuelven un `ChainHandle`: `state`, `operation_id`, `result`, `error`, `is_finished()` y las señales
`applied`, `settled`, `failed(error)` y `finished`.

## 6. Escribir el servidor de juego

El servidor de juego es la pieza que escribe el estudio. Existe porque **quien decide que un jugador puede
mover un objeto no puede ser el cliente**: el jugador controla el cliente. Y porque el `write_key` no puede ir
en el binario.

### 6.1 Qué tiene que hacer

| # | Responsabilidad | En el ejemplo |
|---|---|---|
| 1 | **Saber qué jugador hace la petición**, con el sistema de cuentas del estudio | **No lo hace**: el emisor es siempre `GAME_SERVER_PLAYER` (ver 6.4) |
| 2 | **Decidir si la acción está permitida**, con las reglas del juego | No hay reglas |
| 3 | **Poner el emisor** de la transferencia y rechazar un `from` que mande el juego | Sí |
| 4 | **Rechazar la creación de colecciones y tipos** con `403` | Sí |
| 5 | **Registrar la acción por su `Idempotency-Key` antes de llamar** al backend. Si llega repetida, reenviar la registrada, no la nueva | Sí, en SQLite |
| 6 | **Reenviar al backend** con `Authorization: Bearer <write_key>` y la `Idempotency-Key` intacta, y devolver la respuesta tal cual, con su `Retry-After` | Sí |

### 6.2 Qué recibe del juego

```
POST {write_url}/v1/items/{item_id}/transfer
Content-Type: application/json
Idempotency-Key: <SHA-256 de "transfer:<call_id>">

{ "to": { "external_id": "player-b" }, "amount": 1 }
```

Y lo que envía al backend, añadiendo el emisor:

```
POST {backend}/v1/items/{item_id}/transfer
Authorization: Bearer <write_key>
Idempotency-Key: <la misma>

{ "from": { "external_id": "<el jugador autenticado>" }, "to": { "external_id": "player-b" }, "amount": 1 }
```

El contrato completo está en [`http-contract.md`](../especificacion/http-contract.md), secciones 3 (idempotencia),
4.5 (transferencia) y 6 (errores).

### 6.3 Dar objetos a los jugadores: la reserva

En v1 las unidades sólo se emiten al crear el tipo, con su entrega inicial, y después sólo se mueven. Emitir
más tarde (`POST /v1/items/{item_id}/grants`) está en el contrato, pero no implementado.

**Cómo se hace con v1:** se crea cada tipo con su entrega inicial a un jugador reservado, por ejemplo
`game-reserve`, con las existencias de todo el juego. Cuando el servidor de juego decide que un jugador se ha
ganado algo, **transfiere desde la reserva**, llamando él mismo al backend, sin pasar por el addon:

```
POST {backend}/v1/items/{item_id}/transfer
Authorization: Bearer <write_key>
Idempotency-Key: recompensa:<id de la partida>:<id del jugador>

{ "from": { "external_id": "game-reserve" }, "to": { "external_id": "<jugador>" }, "amount": 1 }
```

- La clave sale del hecho que da derecho al objeto. Así, si el servidor reintenta, el jugador no cobra dos
  veces.
- Las existencias quedan limitadas a la entrega inicial. Si se acaban, hay que crear un tipo nuevo.
- Cuesta lo mismo que una emisión. Para ahorrar depósitos, se puede apuntar lo ganado y transferirlo cuando
  el jugador entre (README, «Coste en la cadena»).

### 6.4 El hueco de v1: el addon no identifica al jugador

**El addon no manda al servidor de juego nada que identifique al jugador.** `ChainConfig` no tiene campo para
un token de sesión ni para cabeceras propias. Por eso el ejemplo usa un emisor fijo y escucha sólo en
`127.0.0.1`: no podría saber quién le escribe.

Un estudio tiene dos salidas:

- **Usar su propio canal para las escrituras.** Si el juego ya tiene un servidor con conexión autenticada,
  el cliente pide la acción por ese canal y el servidor llama al backend como en 6.3. El addon se queda para
  las lecturas y el modo MOCK. A cambio, el seguimiento de estados (5.5) lo hace el servidor, que consulta
  `GET /v1/operations/{operation_id}` y se lo comunica al cliente.
- **Ampliar el addon** con un campo para la credencial de sesión que se envíe en cada escritura. Es un cambio
  pequeño, pero está fuera de v1.

### 6.5 Partir del ejemplo

`examples/game-server/` (TypeScript, Fastify y SQLite) cumple los puntos 3 a 6. Para usarlo como base, hay que
sustituir el emisor fijo por el jugador autenticado, añadir las reglas del juego, ponerlo detrás de TLS y
añadir las recompensas de 6.3.

## 7. Gestionar el catálogo en la consola

### 7.1 Entrar

`http://127.0.0.1:8787/admin`, con `CHAIN_ADMIN_KEY`. La consola sólo responde si se llega a ella por
`127.0.0.1`, `localhost` o `[::1]`. Desde otra máquina, lo razonable es un túnel SSH al puerto del backend; no
se ha probado de otra forma.

### 7.2 Crear una colección

Una colección agrupa tipos, por ejemplo «Armería». Basta con un nombre, de 1 a 64 caracteres. No toca la cadena
ni cuesta nada.

### 7.3 Crear un tipo de objeto

| Campo | Límite | Notas |
|---|---|---|
| Colección | Una existente | No se cambia después |
| Nombre | 1 a 32 caracteres | Lo que ve el jugador |
| Símbolo | 1 a 10 caracteres | **No se podrá cambiar nunca** |
| URI | 0 a 200 caracteres | Opcional: una imagen o una ficha del objeto |
| Cualidades | Hasta 8 pares; clave de 1 a 32, valor de 1 a 64 | Describen el tipo, no cada ejemplar. La clave `collection` está reservada |
| Tenedor de la entrega inicial | El identificador del jugador que recibe las unidades | Para el patrón de 6.3, `game-reserve` |
| Cantidad | Entero de 1 a 2⁵³ − 1 | **Son todas las unidades que existirán** de este tipo en v1 |

- **Si los campos son muy largos, puede no caber.** Un tipo con casi todo al máximo no cabe en una
  transacción y se rechaza con «el tipo no cabe en una transacción: acorta sus campos». No se crea nada ni se
  gasta SOL.
- **Hay que esperar a `settled`.** El tipo existe para el juego cuando su operación llega a `settled`. Una
  creación que falla sigue en el listado como `failed`; se repite con otro identificador de llamada.
- **El identificador de llamada** del formulario cumple la función del `call_id` (5.6): con el mismo
  identificador, un reenvío no crea el tipo dos veces.
- **En v1 un tipo no se edita.** Un error en el nombre, la URI o las cualidades exige crear otro. Las
  unidades del tipo antiguo siguen existiendo.

Crear un tipo típico cuesta unos 0,00465 SOL con su entrega inicial.

### 7.4 Consultar

- **Catálogo:** colecciones y tipos, con el estado de la operación que creó cada uno.
- **Operaciones:** cada una con su estado, quién da a quién y un enlace a su transacción en el explorador de
  Solana. Es el registro auditable.
- **Inventario:** lo que tiene un jugador, por su identificador.
- **Juego → Despliegue:** el juego, el estudio, la autoridad (y si firma la semilla u OpenBao, con su versión)
  y el programa.

La consola no transfiere: las transferencias van por el servidor de juego.

## 8. Operación diaria

### 8.1 Arrancar y parar

**Orden de arranque:** OpenBao, si se usa, desellado (lanzamiento, 5.3); luego el backend; luego el servidor de
juego. Para parar, en orden inverso, con `Ctrl+C`.

Si el backend se para, las operaciones en curso no se quedan colgadas: al arrancar, el seguimiento las lleva a
`settled` o, si su transacción no llegó a entrar, a `failed` con `EXPIRED`, y el juego la repite con un
`call_id` nuevo. Si
OpenBao está sellado, las escrituras fallan con `INTERNAL` sin guardar nada, y se pueden reintentar al
desellarlo.

### 8.2 El saldo de la autoridad

La autoridad paga todo. Cuando se queda sin SOL, las escrituras responden `INSUFFICIENT_FUNDS` y el juego no
puede mover objetos.

- **Consultarlo:** `npm run init-game` en `backend/`, con el `env.sh` cargado. Si el juego ya existe, sólo
  informa.
- **Recargarlo:** `solana transfer <dirección de la autoridad> <SOL> --allow-unfunded-recipient`.
- **Cuánto hace falta:** sobre todo depende de los jugadores y tipos nuevos (sección 3).

### 8.3 Copias de seguridad

| Qué | Dónde | Cuándo | Si se pierde |
|---|---|---|---|
| **Semilla maestra** | El fichero de `CHAIN_MASTER_SEED_FILE` | Una vez, fuera de la máquina | **Se pierde el juego.** No se puede reponer |
| **Claves de desellado de OpenBao** | `bao-init.json` de la carpeta del estudio | Una vez, fuera de la máquina | **Se pierde la autoridad, y con ella el juego** |
| **Volumen de OpenBao** | El volumen de Docker (`godot-chain-bao-data`) | Tras crear o rotar la clave | Igual que lo anterior |
| **Base del backend** | `CHAIN_DATABASE_PATH` (`chain.db`) | A diario | La cadena conserva la propiedad, pero el backend ya no sabe qué tipo es cada objeto ni el estado de las operaciones |
| **Base del servidor de juego** | `GAME_SERVER_DATABASE_PATH` | A diario | Se pierde el registro de acciones; un reintento antiguo se trataría como nuevo |
| **`env.sh`** | La carpeta del despliegue | Al cambiar algo | Las credenciales se regeneran; la semilla no (ver arriba) |

Las bases usan SQLite en modo WAL: el fichero `.db` solo no es una copia coherente con el proceso en marcha.
Se copian con el proceso parado, junto a sus ficheros `-wal` y `-shm`, o con la orden `.backup` de `sqlite3`.

### 8.4 Cambiar credenciales

| Credencial | Cómo se cambia | Ojo |
|---|---|---|
| `write_key` | Nueva en `env.sh`, en el backend y el servidor de juego a la vez, y reiniciar los dos | Entre medias, las escrituras fallan |
| `CHAIN_ADMIN_KEY` | Nueva en `env.sh` y reiniciar el backend | — |
| `read_token` | Nuevo en `env.sh` y reiniciar el backend | **Va en el binario.** Las copias del juego ya distribuidas dejan de leer hasta que se actualicen |

Ninguna toca la cadena. La semilla no se cambia nunca (sección 3).

### 8.5 Rotar la autoridad

Cambiar la clave que firma sin tocar los objetos. Con OpenBao, es el procedimiento paso a paso de la sección
5.5 del lanzamiento: parar el backend, rotar la clave en OpenBao, financiar la nueva autoridad,
`npm run rotate-authority` y arrancar. Conviene hacerlo de forma periódica y, sobre todo, si se sospecha que
el token del backend se ha filtrado.

### 8.6 Ajustes que pueden hacer falta

- **`CHAIN_RPC_URL`.** Por defecto el backend usa el nodo público de devnet, que limita la tasa. Con más
  tráfico, un proveedor propio.
- **`CHAIN_READ_RATE_LIMIT`.** 120 lecturas por minuto y por IP. Jugadores detrás de la misma IP comparten el
  límite.

## 9. Incidentes

| Incidente | Consecuencia | Qué hacer |
|---|---|---|
| Se filtra el `read_token` | Cualquiera lee inventarios. Se da por hecho: es público | Nada; el límite por IP frena el abuso |
| Se filtra el `write_key` | Cualquiera puede transferir desde cualquier jugador y crear tipos | Cambiarlo (8.4). La cadena no se toca |
| Se filtra `CHAIN_ADMIN_KEY` | Cualquiera con acceso a la consola crea tipos y emite unidades | Cambiarla (8.4) |
| Se filtra el token del backend en OpenBao | Quien lo tenga pide firmas mientras valga | Revocarlo en OpenBao, emitir otro y rotar la autoridad (8.5) |
| Se filtra la semilla, con la autoridad en la semilla | **Quien la tenga controla todo el juego** | El procedimiento del README («Rotación ante compromiso de la semilla»). Es una carrera: quien tenga la semilla también puede rotar |
| Se filtra la semilla, con la autoridad en OpenBao | Puede mover los objetos de cualquier jugador, pero no crear ni emitir | Mover los saldos a una semilla nueva (mismo procedimiento, sin rotar) |
| OpenBao sellado o parado | Las escrituras fallan con `INTERNAL` | Arrancarlo y desellarlo; el juego reintenta con la misma clave |
| La autoridad sin fondos | `INSUFFICIENT_FUNDS` en todas las escrituras | Recargarla (8.2) |
| Se corrompe `chain.db` | El backend no sabe qué tipo es cada objeto | Restaurar la última copia (8.3) |

Los síntomas más frecuentes al arrancar, con su arreglo, están en la sección 7 del lanzamiento.

## 10. Antes de abrirlo a jugadores reales

v1 demuestra el modelo en devnet. Para un juego publicado, faltan cosas que el estudio tendría que resolver o
encargar:

- **Mainnet.** El programa `chain-assets` no está auditado, y quien tiene su autoridad de actualización
  controla todos los juegos que lo usan. Un estudio en mainnet desplegaría el suyo, auditado, con esa autoridad
  congelada o en una multifirma (limitaciones 9 y 10 del README).
- **Exponer el backend.** Se ha probado sólo en `127.0.0.1`. Un solo puerto sirve la API y la consola. Para que
  los jugadores lean desde fuera haría falta un proxy con TLS que publique sólo las lecturas
  (`GET /v1/holders…`, `GET /v1/operations/…`) y deje fuera `/admin` y las escrituras. **Y hay que cambiar el
  backend:** detrás de un proxy ve la IP del proxy, y el límite de 120 lecturas por minuto se aplicaría a
  todos los jugadores juntos.
- **Identificar al jugador** en el servidor de juego (6.4).
- **Una sola instancia.** SQLite en un fichero, sin réplicas ni alta disponibilidad. Escalar a varias instancias
  rompería la idempotencia.
- **Lo que v1 no hace:** emitir después de crear un tipo (se usa la reserva, 6.3), editar tipos, importar un
  catálogo, operaciones en lote y cerrar cuentas para recuperar depósitos.
- **El jugador no posee de verdad.** El backend custodia sus claves, el juego puede mover sus objetos sin su
  consentimiento y no hay salida a una wallet propia. Hay que poder explicarlo a los jugadores.
- **Plataformas.** Probado en escritorio. Android e iOS no se han compilado ni probado.
- **Tiendas.** Las políticas de la sección 3.

## 11. Lista de comprobación

**Antes de crear el juego**

- [ ] Identificador del juego elegido y comprobado como libre
- [ ] Identificador de jugador definido: interno e inmutable
- [ ] Decidido dónde firma la autoridad: semilla u OpenBao
- [ ] Revisadas las políticas de las tiendas en las que se publicará
- [ ] Estimado el SOL necesario

**Al desplegar**

- [ ] Semilla generada y copiada fuera de la máquina
- [ ] Con OpenBao: claves de desellado copiadas fuera de la máquina
- [ ] Credenciales distintas, en `env.sh`, fuera del repositorio
- [ ] Autoridad financiada y juego creado con `init-game`
- [ ] **Juego → Despliegue** muestra el juego, el estudio y la autoridad esperados
- [ ] Copias diarias de `chain.db` y de la base del servidor de juego programadas

**En el juego**

- [ ] Addon copiado y plugin activado
- [ ] En el binario sólo el `read_token`, nunca el `write_key`
- [ ] Estado guardado sólo en `settled`
- [ ] Un `call_id` por acción, y el mismo en sus reintentos
- [ ] Probado en MOCK y después contra devnet

**En el servidor de juego**

- [ ] Autentica al jugador y pone él al emisor
- [ ] Rechaza la creación de colecciones y tipos
- [ ] Registra cada acción antes de llamar al backend
- [ ] Las recompensas salen de la reserva, con una clave ligada al hecho que las da
