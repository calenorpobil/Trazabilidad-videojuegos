# Plan de implementación — *Nidada*

Versión 0.1 — 6 de octubre de 2026.

Desarrolla `docs/implementacion-android.md` en fases ejecutables. **Las horas de este plan no
cuentan en el presupuesto del PFM**: el desarrollo del juego queda fuera del cómputo (sección 11 del
documento de implementación).

---

## 0. Restricción que ordena todo el plan

Casi todo lo que hace especial a *Nidada* —especies certificadas, galletas, cría entre jugadores—
pasa por `godot-chain`, y `godot-chain` todavía no existe: el backend va por el bloque 2. El juego
no puede esperar a la librería ni adelantarla, así que se divide en dos mitades:

| Mitad | Depende de la librería | Cuándo |
|---|---|---|
| **Estado de juego convencional**: mascotas, necesidades, crecimiento, corral | No | Ya (fase J1) |
| **Activos certificados**: especies, coleccionables, regalos, cría | Sí | Cuando existan los bloques 2–7 |

La fase J1 respeta los invariantes de `CLAUDE.md` sin tocarlos: todo el código nuevo vive en `rust/`
y en `examples/godot-demo/`, nunca en `addon/`, y no habla con ninguna cadena.

---

## 1. Fases

| Fase | Contenido | Depende de | Estado |
|---|---|---|---|
| **J1** | Bucle de cuidado jugable en escritorio: `nidada-rules`, `nidada-server`, `nidada-ext`, corral en Godot | Nada | **Esta sesión** |
| J2 | Android: compilar `nidada-ext` para `arm64-v8a` y `x86_64`, exportar APK, ejecutar en un teléfono | J1 | Pendiente. Resuelve los puntos 6–11 de la sección 14 del documento de implementación |
| J3 | Corte vertical del PFM: colección «Coleccionables», Galleta de cortejo, regalo de A a B con `applied` / `settled` | J1, bloques 2–7 del PFM | Bloqueada por la librería |
| J4 | Especies en cadena: mascotas iniciales por `grant`, reconciliación (diseño 3.1) | J3, `POST /grants` | Bloqueada |
| J5 | Código de amigo y visitas | J1 | **Hecha** (sección 8) |
| J6 | Cría: máquina de estados del diseño 6.4, con pago y nacimiento | J4, J5 | Bloqueada |

---

## 2. Fase J1 — alcance exacto

### 2.1 Entra

- **`nidada-rules`**: catálogo de las 10 especies, tabla de cruce, necesidades, crecimiento, etapas,
  condiciones de cría, herencia con semilla, transiciones de la máquina de estados de la cría. Con
  tests de las tablas del diseño. Las reglas de cría se escriben ya aunque no se usen hasta J6:
  son funciones puras, baratas, y fijan el diseño en código comprobable.
- **`nidada-server`**: cuentas anónimas con token de sesión, dos mascotas iniciales de especies
  comunes distintas, alimentar, jugar, dormir, poner nombre. SQLite.
- **`nidada-ext`**: `PetView` y `SpeciesCatalog` para que el cliente dibuje sin preguntar al
  servidor cada segundo.
- **Proyecto Godot**: una escena de corral con las mascotas, sus tres barras animadas, etapa, y
  botones de cuidado. Sin arte: formas y colores.

### 2.2 No entra

- Nada de `godot-chain`, ni real ni simulado. Las mascotas iniciales viven sólo en el servidor de
  juego; en J4 pasarán a respaldarse con un `grant`, que no se pide al dar de alta al jugador sino en su primera acción real: un alta anónima no debe costar comisión ni renta.
- Galletas, coleccionables, regalos, cría jugable, código de amigo.
- Android (J2). El `.gdextension` deja las rutas de Android escritas, pero no se compilan.

### 2.3 Simplificaciones respecto al diseño, explícitas

| Diseño | J1 | Motivo |
|---|---|---|
| «Adulta» exige bienestar **medio de las últimas 24 h** ≥ 60 % (3.4) | Bienestar **actual** ≥ 60 % | La media exige historial de interacciones. Se añade en J6, que es donde se usa |
| Las crías bajan necesidades al doble de ritmo (3.4) | El multiplicador se fija con la etapa del último instante guardado | Evita integrar a trozos a través del cambio de etapa. El error se corrige en cada interacción |
| Necesidades: cuánto repone cada acción no está fijado | Comida +35 hambre; jugar +25 ánimo, cada 30 min; dormir deja energía a 100 y bloquea 2 h | Valores provisionales, en `nidada-rules`, un solo sitio |
| Comida como objeto consumible con contador | 10 unidades de «Pienso» al crear la cuenta, sin reposición | La recompensa diaria llega con la galleta diaria, en J3 |

---

## 3. Modelo de necesidades — la única fórmula

Ésta es la razón de que `nidada-rules` exista (documento de implementación, sección 1). Servidor y
cliente llaman a la misma función.

Cada mascota guarda una **instantánea**: `hunger`, `mood`, `energy`, `growth_hours` y el instante
`at` en que se tomaron, más `sleep_until`. El estado en cualquier instante `t` se deriva:

```
h = (t - at) en horas de juego  (segundos reales × TIME_SCALE / 3600)
k = 2 si la etapa en la instantánea es «cría», 1 en otro caso
hunger(t) = max(0, hunger - 4·k·h)
mood(t)   = max(0, mood   - 3·k·h)
energy(t) = energy si duerme; si no, max(0, energy - 2·k·h)
bienestar = media de las tres
growth(t) = growth_hours + horas desde `at` en que el bienestar fue ≥ 30
```

El bienestar no crece nunca entre dos instantáneas, así que «horas con bienestar ≥ 30» es el tramo
inicial hasta que cruza 30. Se encuentra por bisección sobre una función monótona: exacto, sin
historial.

Cada interacción del jugador **materializa** el estado en `t`, aplica el efecto y guarda una
instantánea nueva. El cliente nunca guarda instantáneas: sólo evalúa la del servidor.

**Reloj:** el servidor es la referencia. Cada respuesta incluye `server_time`; el cliente calcula el
desfase con su reloj al recibirla y lo aplica al evaluar. Un móvil con la hora mal no ve barras
falsas.

---

## 4. API de `nidada-server` en J1

Interna del juego, no es el contrato de `godot-chain`. JSON, `Authorization: Bearer <session_token>`
salvo en el alta.

| Método | Ruta | Devuelve |
|---|---|---|
| `POST` | `/v1/players` | `{ player_id, session_token }` — crea cuenta y dos mascotas. `RATE_LIMITED` (429) pasadas 10 altas por hora desde una IP |
| `GET` | `/v1/corral` | `{ server_time, time_scale, food, pets: [ … ] }` |
| `POST` | `/v1/pets/{pet_id}/feed` | El corral actualizado |
| `POST` | `/v1/pets/{pet_id}/play` | Ídem |
| `POST` | `/v1/pets/{pet_id}/sleep` | Ídem |
| `PUT` | `/v1/pets/{pet_id}/name` | Ídem. Cuerpo `{ name }`, 1..16 caracteres |

Errores: `{ error: { code, message } }` con `code` en `UNAUTHORIZED`, `NOT_FOUND`, `NOT_ALLOWED`
(con el motivo de `nidada-rules`), `INVALID`. Los mensajes van en español y sin tecnicismos: se
pueden enseñar al jugador tal cual.

---

## 5. Verificación de J1

- `cargo test` del workspace en verde, con las tablas del diseño como vectores.
- `cargo clippy -D warnings` limpio.
- El servidor arranca, y con `curl` se crea un jugador, se alimenta una mascota y el hambre sube.
- Godot 4.7.1 carga `nidada-ext` en modo *headless* sin errores.
- La escena del corral se abre en el editor, conecta al servidor y las barras bajan en tiempo real.

---

## 6. Cómo arrancarlo

```bash
cd rust
./build-ext.sh                                # compila nidada-ext y la copia al proyecto Godot
TIME_SCALE=120 cargo run -p nidada-server     # escucha en 127.0.0.1:8080
```

Luego abrir `examples/godot-demo/project.godot` con Godot 4.7.x y ejecutar. En Windows hay dos
trampas (toolchain MSVC y la «í» de la ruta): ver `rust/README.md`.

---

## 7. Estado de J1 — 6 de octubre de 2026

Hecho y comprobado:

- `nidada-rules`: 34 tests en verde (tablas de cruce, especies, necesidades, crecimiento, cría,
  máquina de estados, herencia, nombres). `clippy -D warnings` y `fmt` limpios.
- `nidada-server`: probado con `curl`: alta, corral, comer, jugar con espera, dormir bloqueando
  acciones, nombre válido e inválido, sesión inválida (401) y mascota ajena (404).
- `nidada-ext` carga en Godot 4.7.1 *headless* (API 4.7, comprobado en el arranque de gdext).
- La escena del corral, *headless* contra el servidor: crea jugador, reutiliza la sesión, y los
  botones comer, jugar, bautizar y dormir funcionan de extremo a extremo.

Desviaciones respecto a lo previsto:

- Godot instalado es **4.7.1**, no 4.7.2. Funciona: la API compilada es 4.7.
- `nidada-rules` usa SplitMix64 propio en vez de `rand_chacha`: cero dependencias y salida idéntica
  en cualquier plataforma, que es lo que importa (test con vectores de referencia).
- Con `TIME_SCALE = 120`, una cría pasa de hambre llena a vacía en unos 6 minutos reales. Es la
  consecuencia directa de las tasas del diseño (3.5) y del doble ritmo de las crías; para la demo
  puede convenir una escala menor.

- Revisión visual en ventana: las barras eran invisibles a 0 con el tema por defecto. Ahora tienen
  fondo, color por necesidad y valor numérico; los botones miden 48 px de alto.
- `examples/godot-demo/tests/test_ext.gd`: carga la GDExtension y comprueba sus cálculos contra los
  mismos valores que los tests de `nidada-rules`. Sale con código 1 si falla (comprobado).
- CI: trabajos `nidada-rust` (formato, clippy, tests, guardias de dependencias y de vocabulario) y
  `nidada-godot` (compila para Linux, descarga Godot 4.7.1 y ejecuta `test_ext.gd`). Las guardias se
  han probado en local; los trabajos todavía no han corrido en GitHub.

J1 queda cerrada. Siguiente fase sin bloqueo: **J5** (código de amigo y visitas). J2 necesita el NDK
de Android, unos 2,5 GB, y el disco tiene poco margen.

---

## 8. Fase J5 — amigos y visitas

### 8.1 Decisiones (del responsable, 6 de octubre de 2026)

| Pregunta | Decisión | Consecuencia |
|---|---|---|
| ¿Amistad mutua o en un sentido? | **En un sentido** | Añadir a alguien es guardar su código. Sin solicitudes, sin aceptar, sin estado pendiente |
| ¿Cómo se ve a un amigo? | **Alias que pone quien lo añade**, sólo visible para él | Opcional, mismas reglas que el nombre de una mascota (1..16 caracteres) |
| ¿Se protege el código? | **Límite de intentos fallidos**: 20 por jugador y hora | Con el cupo agotado, ni un código correcto confirma que existe |

Consecuencia de las tres juntas: **visitar exige tener el código en tu lista**. Si se pudiera visitar
con cualquier código, la ruta de visita serviría para probar códigos saltándose el límite.

### 8.2 Código de amigo

`nidada-rules::friend_code`: 6 símbolos de un alfabeto de 31 sin `0/O` ni `1/I/L` (unos 887 millones
de códigos). `normalize` acepta minúsculas, espacios y guiones. El cliente lo usa a través de
`FriendCode.normalize` (nidada-ext) para avisar de un código mal escrito sin preguntar al servidor.
Un código mal escrito no consulta la base de datos y por eso no gasta intentos.

### 8.3 API añadida

| Método | Ruta | Devuelve |
|---|---|---|
| `GET` | `/v1/corral` | Como en J1, más `friend_code` |
| `POST` | `/v1/friends` | `{ code, alias? }` → la lista. `INVALID` si el formato es malo, `NOT_FOUND` si no existe (gasta intento), `NOT_ALLOWED` si es el tuyo, `RATE_LIMITED` (429) con el cupo agotado, por jugador (20/h) o por IP (60/h) |
| `GET` | `/v1/friends` | `{ friends: [ { code, alias, pets: [ { species, name } ] } ] }` |
| `PUT` | `/v1/friends/{code}/alias` | `{ alias }`; vacío o `null` lo borra |
| `DELETE` | `/v1/friends/{code}` | La lista |
| `GET` | `/v1/visit/{code}` | `{ server_time, time_scale, code, alias, pets }`: mismo formato de mascota que el corral, **sin la comida** |

Fuera de la lista, un código no existe: borrar, cambiar alias o visitar devuelven `NOT_FOUND`.

### 8.4 Base de datos

Migraciones numeradas con `PRAGMA user_version`. La 1 es el esquema de J1 (con `IF NOT EXISTS`,
porque las bases de J1 lo tienen con `user_version` 0); la 2 añade `players.friend_code` con índice
único, `friends` y `friend_lookup_failures`. Al abrir, los jugadores sin código reciben uno.

### 8.5 Verificación

- `nidada-rules`: 38 tests (4 nuevos de código de amigo).
- `nidada-server`: 9 tests de integración nuevos, con el `Router` entero y SQLite en memoria: códigos
  distintos y válidos, añadir con formato descuidado, amistad en un sentido, añadir dos veces, no
  añadirse a uno mismo, alias (cambiar, borrar, validar), visitar sólo con el código en la lista,
  no poder tocar las mascotas de una visita, límite de intentos (los mal escritos no cuentan, es por
  jugador), y migración de una base de J1 conservando sus datos.
- `test_ext.gd`: `FriendCode.normalize` con la misma regla.
- En Godot, contra el servidor arrancado sobre la base de datos de J1 de las pruebas: el jugador
  antiguo recibió código y conservó su comida; código mal escrito, código propio, añadir con alias,
  visitar en solo lectura y volver. Revisado en capturas.

Fuera de J5, sin cambios: chat, avisos de visita, búsqueda de jugadores, regenerar el código.

## 9. Decisiones previas a J3 y J4 — 7 de octubre de 2026

Fijadas antes de escribir J3 (galleta y regalos) y J4 (especies en cadena). Ninguna se
implementa todavía: aquí quedan decididas para que J3 y J4 no las reinventen.

### 9.1 El cliente necesita su `holder_id`

Las lecturas van directas del cliente al backend (`GET /v1/holders/{holder_id}/items`), pero
el contrato (§4.1 y §9.1 de `docs/http-contract.md`) sólo devuelve el `holder_id` en las
respuestas de escritura.

- `players.holder_id`, nullable. El servidor de juego lo guarda en cuanto recibe la primera
  respuesta de escritura del backend.
- `GET /v1/corral` lo devuelve con el resto, y el cliente lo usa para leer el inventario.
- Con `holder_id` nulo el inventario es **vacío**, no un error: aún no ha habido escrituras.
- `external_id` = `player_id` (`plr_…`). Es inmutable, como exige la limitación 12.8.

### 9.2 «Marcar primero, llamar después» en el servidor de juego

Hoy ninguna acción es idempotente. Dar de comer da igual, pero un regalo repetido por la red
o por un reintento se haría dos veces.

- Tabla `operations` con el estado y el `call_id` (p. ej. `gift_<id>`). La fila se inserta
  **antes** de llamar al backend (diseño 6.4). Desde el 9-oct-2026 la clave de idempotencia
  no la escribe el juego: la construye `Chain` a partir del `call_id` (propuesta 4.4).
- El `call_id` lo fija el servidor al registrar la acción, de modo que un reinicio no lo
  pierde. Un reintento de la misma acción reutiliza el mismo; una acción nueva, aunque sea
  idéntica a otra anterior, lleva uno nuevo. `Chain` no puede detectar un error aquí
  (propuesta 12.10).
- Lo que el servidor lance por su cuenta sin pasar por el plugin aporta su propia clave. El alta del
  catálogo no es de ese tipo: la hace el backend al aplicar el `catalog.json` (10.2), con las claves
  `catalog_<id>`.
- El `call_id` es único por operación lógica y **no se reutiliza nunca**: el contrato (§9.5)
  devuelve el resultado original si se repite una clave con otro cuerpo, así que reutilizarla
  devolvería un resultado que no corresponde.

### 9.3 La conexión de SQLite no se retiene durante una llamada al backend

Hoy `lock()` se mantiene toda la petición, y no importa porque son cortas (el compilador
además impide mantener el cerrojo a través de un `.await`). En J3 habrá llamadas al backend
dentro de una petición: retener la conexión durante esa espera bloquearía a todos los
jugadores. Patrón obligatorio:

1. tomar la conexión y guardar la operación;
2. soltarla;
3. llamar al backend;
4. volver a tomarla y actualizar la operación.

J3 añadirá un test que falle si un manejador mantiene el cerrojo durante la llamada.

## 10. Alta de especies en cadena — 9 de octubre de 2026

Decidido antes de escribir J4. Nada de esto se implementa todavía. Describe cómo una especie
que ya existe en el juego (hoy sólo en `nidada-rules`) pasa a tener su `Item` en `godot-chain`.

### 10.1 Qué lo dispara

Un **alta de contenido** hecha por el equipo, nunca una acción del jugador. Coherente con el
diseño 3.2: las especies se crean de antemano y ninguna durante la partida.

Para *Nidada*, el disparo es **aplicar un `catalog.json`** (formato en la propuesta, 3). El fichero
**se genera desde `nidada-rules`**, así que las `qualities` salen de ahí y no se teclean (10.4), y un
test comprueba que fichero y catálogo coinciden. Se aplica desde la consola («Importar catálogo») o
con el comando del backend. Es el «script de carga» que prevé el diseño 3.2, pero lo único que
programa *Nidada* es la generación del fichero: el alta, el plan previo y la idempotencia son del
producto.

La **consola de administración** no es parte de *Nidada*: la trae el `chain-backend` (propuesta 3),
porque el servicio es autoalojado y cada estudio la recibe al desplegarlo. Maqueta en
`docs/mockup-admin/index.html`. Además de importar el catálogo, sirve para ver el resultado (listado
de tipos, estado de cada operación, inventarios) y para operaciones sueltas.

Qué queda del lado del juego:
- El servidor de juego **no** sirve ninguna página de administración ni guarda credenciales de
  administrador.
- El servidor de juego llama al backend con el `write_key` (entregas, transferencias) y el
  `read_token` (lecturas), como cualquier llamador del contrato. El alta del catálogo ya no es cosa
  suya: la hace el backend al aplicar el fichero.

**Queda abierto** (de la consola, no del juego; ver propuesta 3): caducidad de la sesión de
administración, si hay más de un administrador y si los listados llevan límite de tasa.

### 10.2 Flujo

1. **Catálogo.** Las especies viven en `nidada-rules`. Un paso de generación escribe de ahí el
   `catalog.json` (nombre, símbolo, elemento, rareza, `growth_hours`) y un test comprueba que
   coinciden.
2. **Plan.** Se aplica el fichero desde la consola o con el comando del backend. Primero sale el plan,
   sin tocar nada: *nuevo*, *ya existe*, *diverge*, *fallido* o *error*.
3. **Alta.** Al confirmar, el backend crea la colección «Especies» y un tipo por especie con su
   `initial_grant` (10.6). La clave de idempotencia sale del `id` de cada entrada (`catalog_brasa`):
   marcar primero, llamar después es cosa del backend (invariante 2), no del servidor de juego.
4. **Descubrir los tipos.** El servidor de juego lee `GET /v1/items` (contrato 5.4) y rellena
   `species_items` emparejando por `symbol` (10.3). No necesita que nadie le pase los `item_id`.
5. **Esperar a `settled`.** Una especie cuyo tipo no está en `settled` no se ofrece a nadie
   (invariante 5 de `CLAUDE.md`). El listado ya trae el `state`.
6. **Activar.** En `settled` la especie queda disponible para `grant` (mascotas iniciales) y
   `transfer`.
7. **Reconciliar.** Se aplica el invariante del diseño 3.1: individuos de la especie del
   jugador == `amount` de su inventario. Si no cuadra, manda la cadena.

### 10.3 La asociación especie ↔ `item_id`

En el servidor de juego. No hay una tabla de especies (el catálogo es código de `nidada-rules`, que
es puro y no toca la base de datos), así que se añade una:

```
species_items (species TEXT PRIMARY KEY, item_id TEXT NOT NULL, synced_at INTEGER)
```

Es una **copia local** de lo que dice el backend, no una fuente de verdad: se rellena y se refresca
leyendo `GET /v1/items` y emparejando por `symbol`. Una migración nueva, como las anteriores. Si la
tabla se pierde, se reconstruye igual.

Para emparejar, el símbolo de cada especie es su nombre en mayúsculas y sin acentos (`BRASA`,
`CIENAGA`; el más largo mide 7, y el límite es 10). **Abierto:** el contrato no obliga a que el
`symbol` sea único, así que el servidor de juego debe rechazar un emparejamiento ambiguo en lugar de
elegir uno.

### 10.4 Las `qualities` salen del catálogo

Se generan desde `nidada-rules`, no se escriben a mano: `kind=pet`, `element`, `rarity`,
`growth_hours`. Así el catálogo y la cadena no pueden divergir. Un error o un retoque se corrige
**editando el tipo en el sitio** (contrato 4.6): se cambia la entrada en `catalog.json` y se vuelve a
aplicar. El `symbol` no se edita, así que un error en él exige una especie nueva.

**Ojo con el balance.** Editar cambia *todos* los ejemplares ya repartidos. Un retoque de `growth_hours`
afecta a las mascotas que ya existen; si no debe ser así, se crea una especie nueva (otro `id` y otro
`symbol`) en lugar de editar.

### 10.5 Fallos y reintentos

- **Red cortada o aplicación interrumpida.** Volver a aplicar el fichero es seguro: cada entrada lleva
  siempre la misma clave y el backend devuelve la respuesta original.
- **Entrada en `failed`.** Reutilizar la clave devolvería el mismo fallo para siempre (contrato 3 y
  9.5), así que el plan la marca *fallido* y **no la reintenta sola**. Política: **revisión manual y
  `id` nuevo** (`brasa-2`). Antes se comprueba que el primer intento no dejó un mint huérfano. Un fallo
  no transitorio (saldo agotado de la autoridad) dejaría mints a medias si se reintentara en automático.
- **Entrada modificada tras crearse.** El plan la marca *cambia* y, al confirmar, edita el mismo
  tipo (propuesta 3). Si lo que cambió es el `symbol`, la colección o el `initial_grant`, la marca
  *diverge* y no la aplica.
- **Edición en curso o en `failed`.** Si la edición sigue en curso, el plan la marca *en curso* y no
  la reenvía. Si acabó en `failed`, el tipo sigue como estaba y la `revision` ya subió, así que al
  volver a aplicar el fichero el plan vuelve a decir *cambia* y la clave es nueva. Antes conviene
  revisar la causa (p. ej. el saldo de la autoridad).

### 10.6 `initial_grant`

Es obligatorio en `POST /v1/items` (contrato 4.3). Va a un **tenedor técnico**
`external_id = "game-reserve"`, que no es un jugador. Cantidad: 1.

- No es un tope de suministro: `POST /v1/items/{id}/grants` emite más cuando haga falta.
- No choca con la reconciliación, que es por jugador. Esa unidad no tiene individuo asociado.
- El tenedor lo crea el backend la primera vez que se nombra.

### 10.7 Queda fuera

- **Dónde guarda el backend las `qualities`.** Resuelto el 11-oct-2026 en la propuesta (4.4):
  las guarda en SQLite al crear el tipo y de ahí las sirve. El listado `GET /v1/items` de la
  consola de administración (contrato 5.4) las devuelve desde esa copia.
- **Botón de «corregir» una especie ya creada.** No hay operación de edición ni de borrado.
- **Alta de un tipo distinto de especie** (accesorios como el Cascabel de luna): el mismo flujo
  vale, pero sus `qualities` y su `initial_grant` se decidirán cuando se necesiten.
