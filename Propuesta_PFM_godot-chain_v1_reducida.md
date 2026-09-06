# Propuesta PFM — `godot-chain`

**Activos de Solana en Godot 4 sin que el jugador vea la cadena.**
Versión reducida, dimensionada para **un mes / ~40 horas reales** de desarrollo asistido con Claude Code.

Fecha de redacción: 25 de agosto de 2026.

---

## 0. Cómo usar este documento

Este documento es a la vez **propuesta de PFM** y **brief de implementación**: se le puede entregar
tal cual a Claude Code como especificación de partida.

Todas las decisiones técnicas están tomadas y justificadas. Quien implemente **no las reabre**. Si
aparece una contradicción o un hueco, va a la sección 14 como pregunta, no se resuelve sobre la
marcha.

### 0.1 Requisitos básicos que se asume que hay que cumplir

Marcados como supuestos porque no constan por escrito. **Confírmalos con el tutor antes de escribir
la primera línea** (ver sección 14).

| # | Supuesto | Cómo lo cumple este proyecto |
|---|---|---|
| R1 | Uso real y no trivial de Solana | Transacciones reales en devnet con Token-2022 y la extensión de metadatos |
| R2 | Producto demostrable de extremo a extremo | Hito de la sección 7, ejecutable en vivo desde Godot |
| R3 | Decisiones de arquitectura justificadas | Secciones 3, 4 y 12 |
| R4 | Calidad de ingeniería: tests, CI, documentación | Secciones 9 y 8, bloques 7 y 10 |
| R5 | Alcance realista para el tiempo disponible | Sección 8, con presupuesto horario y línea de corte |

### 0.2 Cómo escribir el código y la documentación

- **Español** en documentación y comentarios. **Inglés** en todos los identificadores de código.
- Ante la duda entre genérico y simple, **simple**. No hay excepciones en esta versión: no se
  construye nada pensando en un segundo cliente que no existe.
- Cero *hooks* especulativos. Lo que no está en la sección 7 no se escribe.

---

## 1. Qué es el producto

Un **addon de Godot 4** que permite a un desarrollador de videojuegos crear objetos de juego que
existen como activos reales en Solana, y transferirlos entre jugadores, sin escribir código on-chain
y sin que el jugador final sepa que hay una blockchain debajo.

**Premisas que no se negocian:**

1. El jugador no percibe la blockchain. Nada de *seed phrases*, gas ni wallets.
2. El addon no gestiona identidad. Recibe el identificador del jugador desde fuera.
3. No se despliega ningún programa propio. Sólo programas ya desplegados y auditados.
4. Ningún concepto de Solana cruza a GDScript. Si se filtra, es un fallo de diseño, y la CI lo
   detecta automáticamente (sección 9).
5. Las claves privadas nunca están en el binario del juego.

---

## 2. Qué se recorta respecto de la propuesta original, y por qué

Esta versión nace de una propuesta más ambiciosa. La tabla es parte de la defensa del proyecto: los
recortes son decisiones de ingeniería con motivo, no omisiones.

| Elemento original | Aquí | Motivo del recorte |
|---|---|---|
| `godot-client` como GDExtension con `gdext` (Rust) | Addon **100% GDScript** | Elimina Rust en cliente, FFI, `gdext` fijado a versión exacta, MSRV, y toda la compilación cruzada. Es el recorte que más horas libera con menos pérdida conceptual |
| CI con 5 targets de escritorio | CI sin matriz de compilación | Sin código nativo no hay nada que compilar por plataforma. Un addon GDScript funciona en escritorio, móvil y web sin trabajo adicional |
| `core` en Rust sans-io | Backend único en TypeScript | El núcleo era Rust *porque* tenía que empotrarse en una GDExtension. Al desaparecer la GDExtension, desaparece el motivo |
| `core` + `dev-backend` + `mock-backend` + `node-adapter` | **Un** backend + modo mock dentro del addon | Tres implementaciones del mismo contrato exigen tests de conformidad. Con una implementación, el problema no existe |
| `node-adapter` distribuible con `SeenStore` conectable | Idempotencia implementada en el backend sobre SQLite | El interfaz conectable existía para que el estudio enchufara su base de datos. Sin clientes reales, es abstracción sin usuario |
| «Ninguna base de datos propia» | **SQLite**, un fichero | La ausencia de base de datos era una restricción comercial (multi-tenant, operar poco). Aquí una tabla resuelve idempotencia, estado de operaciones e identificadores opacos en una tarde |
| Claves en HSM/KMS | Semilla maestra en fichero fuera del repo | El HSM es coste y proveedor. La derivación es idéntica; sólo cambia dónde vive la semilla. Queda escrito como limitación (12.2) |
| Firmantes múltiples, deduplicación, `SigningContext` | **Un único firmante en toda la v1** | Ver 4.2. Es la simplificación más rentable del proyecto |
| Trait `Signer` async con MPC/hardware futuro | No existe | Nacía con su forma final porque tendría usuarios externos. No los tiene |
| Backend comercial cerrado | No existe | Fuera del alcance de un PFM |
| Señal `expired` | Se pliega en `failed` con `retryable: true` | Un estado menos que probar. La caducidad del blockhash es un fallo reintentable, y el jugador no distingue una cosa de la otra |
| Pregunta abierta sobre Android/iOS en CI | **Disuelta** | Sin binarios nativos no hay toolchain móvil que validar |

Lo que **no** se recorta, porque es la tesis del proyecto: Token-2022 en lugar de Metaplex,
atributos sólo por tipo, escrituras a través de servidor autoritativo, vocabulario sin cadena en la
API pública, y la distinción `applied` / `settled`.

---

## 3. Arquitectura: tres piezas y un ejemplo

```
Dispositivo del jugador
    Proyecto Godot 4  +  addon godot-chain (GDScript)
        │ escrituras                          │ lecturas
        ▼                                     │
    game-server de ejemplo (Node, ~150 líneas)│
        │  clave de escritura                 │
        ▼                                     ▼
    chain-backend  (TypeScript + SQLite)
        │  claves derivadas de una semilla maestra por juego
        ▼
    Solana devnet  —  Token-2022
```

**Escrituras** (crear un objeto, entregarlo, transferirlo) van del juego al servidor de juego, y de
ahí al backend. Nunca directas.

**Lecturas** (qué tiene un jugador) van directas del juego al backend con un token de sólo lectura.

**Motivo de la topología —y hay que saber defenderlo en la presentación:** la credencial que
autoriza operaciones no puede viajar dentro del binario del juego, porque se extrae del APK con
herramientas triviales. Y quien decide que un jugador se ha ganado un objeto tiene que ser un
servidor autoritativo, no el cliente, que el jugador controla. Un juego que mintea desde el cliente
es un juego donde cualquiera se mintea lo que quiera.

**Consecuencia:** el `game-server` de ejemplo no es decorado. Sin él, el proyecto demuestra una
arquitectura insegura.

---

## 4. Decisiones cerradas

### 4.1 Cadena y activo

| Decisión | Valor |
|---|---|
| Red | **Solana devnet.** Sólo. Mainnet fuera de alcance |
| Programa de tokens | **Token-2022** (SPL Token Extensions) |
| Metadatos | Extensiones `MetadataPointer` + `TokenMetadata` del propio mint. **No se usa Metaplex** |
| Tipo de activo | **Sólo fungibles.** 0 decimales, supply ≥ 1 |
| Atributos on-chain | **Sólo por tipo**, en `additional_metadata` del mint |
| Atributos por jugador | No existen en v1. Ni en el backend ni en ningún sitio |
| `PermanentDelegate` | **Activado** al crear cada mint, apuntando a la autoridad del juego |
| `NonTransferable` | **No.** Ver 12.4 |
| Programa propio | Ninguno |
| Operaciones en lote | **No.** Ocho objetos son ocho transacciones |

**Por qué Token-2022 y no Metaplex.** Metaplex Token Metadata está marcado por su propio autor como
programa heredado y no recomendado para proyectos nuevos. Además, Metaplex prohíbe la extensión
`metadata` de Token-2022 cuando se usa su programa: son mutuamente excluyentes, hay que elegir.
Token-2022 guarda nombre, símbolo, URI y pares clave-valor en el propio mint, sin cuenta ni programa
externo, lo que significa una transacción menos, una cuenta menos que pagar y ninguna dependencia de
un tercero. Su inconveniente conocido —soporte desigual en carteras y exploradores— no aplica aquí,
porque el jugador nunca ve una cartera.

**Por qué sólo atributos por tipo.** Fungible significa intercambiable. Si la copia de un jugador
tuviera atributos distintos a la de otro, no serían el mismo token. En Solana los metadatos viven en
el mint, que es *el tipo*, no *el ejemplar*; las extensiones a nivel de cuenta de token controlan
comportamiento y no almacenan datos arbitrarios. Atributos divergentes por jugador exigirían un
programa propio o activos no fungibles, y ambas cosas están descartadas.

**Nota crítica sobre extensiones.** La mayoría de extensiones de Token-2022 se activan al crear el
mint y **no se pueden añadir después**. Lo que no se decida ahora no se puede retrofitear sobre
tokens ya creados. Por eso `PermanentDelegate` entra desde el primer mint aunque parezca prescindible.

### 4.2 Firmante único: la simplificación central

**Decisión: toda transacción de la v1 tiene exactamente un firmante**, la autoridad del juego, que
es también la cuenta pagadora.

Cómo se sostiene, operación por operación:

| Operación | Instrucción | Quién firma |
|---|---|---|
| Crear un tipo de objeto | `CreateAccount` + `InitializeMetadataPointer` + `InitializeMint` + `InitializeTokenMetadata` | Autoridad (como pagadora y como *mint authority*) |
| Crear la cuenta de token de un jugador | `CreateAssociatedTokenAccount` | Autoridad (como pagadora; el propietario no firma) |
| Entregar unidades a un jugador | `MintTo` | Autoridad (como *mint authority*) |
| Transferir entre jugadores | `TransferChecked` | Autoridad (como **permanent delegate**) |

El jugador emisor de una transferencia **no firma nunca**, porque el permanent delegate puede mover
tokens de cualquier cuenta de ese mint.

**Por qué importa tanto.** Elimina de un plumazo: transacciones multi-firma, la deduplicación de
firmantes coincidentes que Solana rechaza, la separación `fee_payer` / `authority`, y la abstracción
`Signer` con implementaciones intercambiables. Son cuatro fuentes de bugs y un día largo de trabajo.

**Por qué es honesto.** En una v1 custodial el backend ya posee todas las claves de los jugadores. El
permanent delegate no añade ningún poder que el backend no tuviera; sólo lo hace explícito on-chain.
La limitación real —que el estudio puede mover los objetos de cualquier jugador— queda escrita en
12.3, no escondida.

**Invariante verificable, y hay que testearlo:** ninguna transacción construida por el backend
contiene más de una firma requerida.

### 4.3 Identidad y claves

| Decisión | Valor |
|---|---|
| Identidad del jugador | La aporta el juego. El backend no la crea ni la verifica |
| Identificador | Opaco, con ámbito `(game_id, external_id)` |
| Inmutabilidad | Requisito del integrador. Si cambia, el jugador pierde sus objetos |
| Claves de jugador | Derivadas de una semilla maestra **por juego** |
| Custodia de la semilla | Fichero fuera del repositorio, permisos `0600`, o variable de entorno |
| Salida a wallet propia (`claim`) | **No existe** |

**Esquema de derivación** (concreto, no lo reinventes):

```
master_seed        := 32 bytes aleatorios, uno por juego, nunca en el repositorio
authority_seed     := HKDF-SHA512(ikm = master_seed, salt = game_id, info = "authority")
player_seed(ext)   := HKDF-SHA512(ikm = master_seed, salt = game_id, info = "player:" || ext)
keypair(x)         := ed25519_from_seed(primeros 32 bytes de x)
holder_id(ext)     := "hld_" || base58(pubkey(keypair(player_seed(ext))))[0..16]
```

`salt = game_id` da separación de dominio entre juegos: dos juegos con la misma semilla maestra —que
no debe ocurrir— seguirían produciendo claves distintas.

**Las claves privadas de jugador se derivan pero nunca se usan para firmar en v1** (ver 4.2). Se
derivan porque hacen falta para calcular la dirección, y porque son el mismo camino que usaría un
futuro `claim`. Deben existir **vectores de test fijos**: misma semilla y mismo `external_id`
producen siempre la misma dirección, con valores escritos a mano en el test. Es el primer test que
se escribe en el bloque 2, antes de la implementación.

**Procedimiento de rotación ante compromiso** (escrito, no implementado; va al README):

1. Generar una semilla maestra nueva y una autoridad nueva.
2. Para cada mint existente, transferir el `mint authority` a la nueva autoridad con `SetAuthority`.
3. Para cada tenedor, mover su saldo a la dirección derivada de la nueva semilla usando el permanent
   delegate antiguo, mientras siga siendo válido.
4. Republicar el mapa `holder_id` → dirección.
5. Destruir la semilla comprometida.

El paso 3 depende de si el permanent delegate puede reasignarse tras la creación del mint: **es uno
de los puntos a verificar antes de escribir código** (sección 13).

### 4.4 Persistencia y seguridad

| Decisión | Valor |
|---|---|
| Almacenamiento | **SQLite**, un fichero, sin servidor |
| Autenticación de escrituras | `Authorization: Bearer <write_key>` — la tiene el servidor de juego |
| Autenticación de lecturas | `Authorization: Bearer <read_token>` — viaja en el binario del juego |
| Autorización de operaciones | Del servidor de juego, con sus propios datos |
| Idempotencia | Cabecera `Idempotency-Key` **obligatoria** en toda escritura |
| Escritura de estado en el juego | **Sólo en `settled`.** `applied` es puramente cosmético |

**Tablas:**

```sql
collections (collection_id PK, game_id, name, created_at)
items        (item_id PK, collection_id, mint, name, symbol, uri, created_at)
operations   (operation_id PK, kind, state, signature, error_code, error_message,
              created_at, updated_at)
idempotency  (key PK, operation_id, created_at)
```

**Idempotencia — el orden importa: marcar primero, llamar después.** Ante una escritura, el backend
inserta la clave en `idempotency` dentro de una transacción SQLite. Si el `INSERT` choca con la clave
primaria, devuelve el resultado anterior sin tocar Solana. Si no choca, procede. Invertir el orden
—llamar y luego marcar— deja una ventana en la que un reintento mintea dos veces.

**Segunda capa, gratis:** Solana rechaza una firma ya procesada, lo que cubre los reintentos dentro
de la ventana de validez del blockhash (~1 minuto) aunque la primera capa falle. Es red de seguridad,
no protección primaria.

**El `read_token` está en el binario del juego y por tanto es público.** Consecuencias asumidas: es
de sólo lectura, va limitado por tasa, y cualquiera que lo extraiga puede consultar el inventario de
cualquier jugador de ese juego. Ver 12.5.

### 4.5 Modelo de datos y vocabulario público

| Concepto | Qué es | Dónde vive |
|---|---|---|
| `Collection` | Agrupación lógica del catálogo de un juego. **No tiene existencia on-chain** | SQLite, y como par `collection` en `additional_metadata` de cada item |
| `Item` | Un **tipo** de objeto. Un mint de Token-2022 | On-chain, indexado en SQLite |
| `Quality` | Atributo del tipo (`rarity`, `damage`) | `additional_metadata` del mint |
| `Holder` | Un jugador, identificado de forma opaca | Derivado, no almacenado |

Esto resuelve una ambigüedad de la propuesta original, que nunca decía qué era una `Collection`
on-chain. Aquí la respuesta es explícita: **nada**. Crear una colección no produce una transacción y
por eso su endpoint no devuelve `operation_id`.

| Decisión de API | Valor |
|---|---|
| Idioma | **Inglés.** `Collection`, `Item`, `Quality`, señales en inglés |
| `transfer` | Cantidad **obligatoria**: `transfer(item_id, amount, recipient)` |
| Transferencia parcial | No existe. O entra entera o no entra |
| Saldo insuficiente | Comprobación optimista en el backend + rechazo de la cadena como red de seguridad |
| Identificadores | Opacos con prefijo: `col_`, `itm_`, `opr_`, `hld_`. **Nunca direcciones base58 en crudo** |

### 4.6 Repositorio, licencias y dependencias

Monorepo, licencia **MIT OR Apache-2.0**, cuatro directorios:

| Directorio | Contenido |
|---|---|
| `addon/` | `addons/godot_chain/`, GDScript puro. **Cero dependencias** |
| `backend/` | TypeScript, Node ≥ 22, el servicio y su suite de tests |
| `examples/game-server/` | Servidor de juego mínimo. Ejemplo, no producto |
| `examples/godot-demo/` | Proyecto Godot que ejecuta el hito |

**Stack del backend, fijado a versión exacta en `package.json`:**

- `@solana/kit` — es el SDK vigente; `@solana/web3.js` v1 está marcado como heredado y las
  aplicaciones nuevas se construyen sobre Kit.
- `@solana-program/token-2022` y `@solana-program/token` — clientes generados de los programas.
- `fastify` para HTTP, `better-sqlite3` para persistencia, `zod` para validar entrada,
  `vitest` para tests.

**Prohibido en `addon/`:** cualquier dependencia, cualquier binario, y las cadenas `solana`,
`pubkey`, `lamport`, `blockhash`, `base58`, `mint` y `spl` en el código. La CI lo comprueba con un
`grep` (sección 9). Es el sucesor espiritual del `cargo tree` de la propuesta original: un invariante
de diseño convertido en test automático.

**Godot:** fija la versión que instales (4.6.x o 4.7.x en el momento de escribir esto) y decláralo en
el README. La sensibilidad a la versión es baja precisamente por no haber código nativo.

---

## 5. Contrato HTTP

**Escríbelo primero. Es el artefacto del que cuelga todo lo demás.** Va en `docs/http-contract.md`,
versionado, y se congela antes de implementar nada.

Vocabulario **sin cadena**. Si un endpoint necesita decir «blockhash», la costura está rota.

| Método | Ruta | Tipo | Devuelve |
|---|---|---|---|
| `POST` | `/v1/collections` | escritura | `{ collection_id }` — no toca la cadena |
| `POST` | `/v1/items` | escritura | `{ operation_id, item_id }` — crea el tipo y emite la cantidad inicial |
| `POST` | `/v1/items/{item_id}/grants` | escritura | `{ operation_id }` — entrega unidades a un tenedor |
| `POST` | `/v1/items/{item_id}/transfer` | escritura | `{ operation_id }` |
| `PATCH` | `/v1/items/{item_id}/qualities` | escritura | `{ operation_id }` — **bajo la línea de corte** |
| `GET` | `/v1/operations/{operation_id}` | lectura | `{ state, error }` |
| `GET` | `/v1/holders/{holder_id}/items` | lectura | `[ { item_id, name, qualities, amount } ]` |

Las escrituras exigen `write_key` + `Idempotency-Key`. Las lecturas, `read_token`.

**Máquina de estados de una operación:**

```
pending ──▶ applied ──▶ settled
   │           │
   └──────────┴──────▶ failed
```

`pending`: firma enviada. `applied`: confirmada, **no final**. `settled`: finalizada, irreversible.
`applied → failed` es una transición **posible**: una transacción confirmada pero no finalizada puede
desaparecer. Por eso existen los dos estados y por eso el juego sólo escribe en `settled`.

El backend mantiene un bucle que consulta el estado de las firmas pendientes y promueve
`applied → settled` cuando alcanzan finalización. No expongas nunca `processed` / `confirmed` /
`finalized` fuera del backend.

---

## 6. API del lado Godot

Tres formas expuestas, ni una más.

1. **`ChainConfig`** — `Resource`. `write_url`, `read_url`, `read_token`, `game_id`, timeouts,
   política de sondeo, `mode` (`LIVE` | `MOCK`).
2. **`Chain`** — singleton autoload registrado por el plugin. Punto de entrada.
3. **`ChainHandle`** — `RefCounted` devuelto por cada operación.

```gdscript
var handle := Chain.transfer("itm_a1b2", 1, "hld_c3d4")
handle.settled.connect(_on_settled)
if not handle.is_finished():
    await handle.finished
```

### Señales

| Señal | Significado | Uso |
|---|---|---|
| `applied` | Confirmada, no final | **Anima aquí.** No garantiza nada |
| `settled` | Final e irreversible | **Compromete aquí.** Persiste estado |
| `failed` | Falló, con `ChainError` | Revierte la animación optimista |
| `finished` | Tras cualquiera de las tres | Para el patrón de espera seguro |

### Problemas de implementación que hay que resolver, no descubrir

1. **`HTTPRequest` es un `Node`; el handle es `RefCounted`.** El handle no hace nada: es un buzón
   pasivo. El singleton posee el pool de `HTTPRequest`, mantiene referencia fuerte a los handles
   pendientes y sondea en `_process`. El handle **no** referencia al singleton. Sin ciclos.
2. **`await` sobre una señal ya emitida cuelga para siempre.** Documenta el patrón seguro
   (`if not handle.is_finished(): await handle.finished`) y garantiza estructuralmente que un handle
   recién creado no puede resolverse dentro del mismo bloque síncrono.
3. **Sin hilos.** Sondeo con backoff exponencial en `_process`; la respuesta llega por la señal
   `request_completed` en el hilo principal. Cero primitivas de concurrencia.
4. **Registro del autoload.** Lo declara el `plugin.gd` mediante `add_autoload_singleton` al
   activarse el addon. Justificación: es el mecanismo estándar y evita insertar nodos bajo la raíz a
   mano, que rompe si el juego cambia la escena principal.

### Errores

`ChainError` con **categoría accionable**, nunca un código de cadena:
`NETWORK`, `REJECTED`, `NOT_FOUND`, `RATE_LIMITED`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_FUNDS`,
`CONFIG`, `EXPIRED`, `INTERNAL`. Cada una con `retryable: bool`.

`EXPIRED` (blockhash caducado) es un `failed` con `retryable = true`, no un estado propio.

### Modo mock

`ChainConfig` con `mode = MOCK` resuelve contra una máquina de estados **en GDScript**, en memoria,
con reloj controlable y sin red. Debe incluir `Chain.mock_force(handle, state, error)` para poder
probar la rama de reversión: es la que rompe inventarios en producción y la que nadie prueba.

Esto sustituye al `mock-backend` de la propuesta original. Coste: el mock puede divergir del backend
real, y no hay tests de conformidad que lo impidan. Queda anotado en 12.6.

---

## 7. Hito mínimo demostrable

> En devnet, desde un proyecto Godot 4 y **pasando por un servidor de juego de ejemplo**: crear una
> colección, crear un objeto con cualidades de tipo, entregarlo al jugador A, transferir una unidad
> del jugador A al jugador B, y ver el inventario de ambos actualizado en pantalla.

Nada más entra en el proyecto hasta que esto funcione de extremo a extremo. Es también el guion del
vídeo de demostración.

---

## 8. Plan de trabajo: 40 horas

Orden estricto. Cada bloque termina con la CI en verde y un commit. No se empieza el siguiente con el
anterior a medias.

| # | Bloque | h | Acumulado |
|---|---|---|---|
| 1 | Contrato HTTP escrito y congelado. Esqueleto del monorepo. `CLAUDE.md`. CI vacía en verde | 3 | 3 |
| 2 | Backend: configuración, derivación de claves **con vectores de test**, SQLite, idempotencia, máquina de estados de operaciones | 5 | 8 |
| 3 | Backend: crear item — mint Token-2022 con `MetadataPointer`, `TokenMetadata` y `PermanentDelegate` | 6 | 14 |
| 4 | Backend: ATA, `MintTo`, `TransferChecked` vía delegate, e inventario con parseo de metadatos | 5 | 19 |
| 5 | Backend: seguimiento de confirmación `applied → settled`, categorías de error, `INSUFFICIENT_FUNDS` | 2 | 21 |
| 6 | Addon: `ChainConfig`, `Chain`, `ChainHandle`, pool de `HTTPRequest`, backoff, errores | 7 | 28 |
| 7 | Addon: modo mock, `mock_force`, suite de tests sin red | 3 | 31 |
| 8 | `game-server` de ejemplo: autorización y reenvío con clave de escritura | 2 | 33 |
| 9 | Proyecto Godot de demo: dos jugadores, inventario, botón de transferir | 3 | 36 |
| 10 | README con aviso de Steam, documentación de integración, vídeo de demo | 3 | 39 |

**Buffer: 1 hora.** Es decir: prácticamente ninguno. Por eso existe la línea de corte.

### 8.1 Línea de corte

Si a mitad del bloque 6 el acumulado se ha ido más de un 20%, se recorta **en este orden**, y se
documenta cada recorte en el README:

1. `PATCH /qualities` — ya está fuera; no lo metas «porque es rápido».
2. `POST /grants` — el hito no lo necesita; `POST /items` ya emite la cantidad inicial.
3. `mock_force` y la parte del modo mock que prueba reversiones; conserva el mock básico.
4. La demo Godot se reduce a una escena única con botones y `Label`, sin arte ni pulido.

**Nunca se recorta el bloque 10.** Un proyecto funcionando sin documentar puntúa peor que uno con
menos alcance bien documentado.

### 8.2 Reparto por semanas

| Semana | Bloques | h |
|---|---|---|
| 1 | 1, 2 | 8 |
| 2 | 3, 4 | 11 |
| 3 | 5, 6 | 9 |
| 4 | 7, 8, 9, 10 | 11 |

La semana 2 es la de mayor riesgo: es donde vive Token-2022. Si algo se va a torcer, se tuerce ahí,
y por eso el plan B de la sección 10 se decide como muy tarde al final del bloque 3.

---

## 9. CI

GitHub Actions, un solo runner Linux. **Sin matriz de compilación**, porque no hay nada que compilar
por plataforma: ése es precisamente el beneficio de no usar GDExtension.

Comprobaciones obligatorias desde el primer commit:

- `tsc --noEmit` y `eslint` sobre `backend/`.
- `vitest run` — incluye los vectores fijos de derivación de claves.
- **Test del invariante de firmante único:** ninguna transacción construida requiere más de una firma.
- **Guardia de vocabulario:** `grep -riE '(solana|pubkey|lamport|blockhash|base58|spl|mint)' addon/`
  debe devolver vacío. Si falla, la costura está rota.
- **Godot headless** ejecutando la suite del addon en modo mock, sin red.
- `npm audit --audit-level=high` y revisión de licencias de dependencias.

Los tests que tocan devnet **no** entran en la CI: dependen de una red externa y de un faucet con
límite. Van en un script manual, `npm run test:devnet`, y su ejecución se documenta con capturas o
firmas de transacción en la memoria.

---

## 10. Riesgos y planes B, con disparador explícito

Un plan B sin disparador es una excusa. Cada uno tiene condición de activación y fecha límite.

| Riesgo | Disparador | Plan B |
|---|---|---|
| El API de `@solana/kit` con Token-2022 cuesta más de lo previsto | 2 h dentro del bloque 3 sin un mint con metadatos en devnet | Cambiar a `@solana/web3.js@1` + `@solana/spl-token` + `@solana/spl-token-metadata`, que tienen más material publicado. **Decidir antes de acabar el bloque 3, nunca después** |
| El faucet de devnet se agota | Dos peticiones de airdrop rechazadas seguidas | Validador local (`solana-test-validator`) con `--clone` del programa Token-2022 para desarrollo; devnet sólo para la demo final |
| El sondeo en `_process` resulta inestable | Bloque 6 supera 9 h | Reducir a sondeo con `Timer` a intervalo fijo, sin backoff, y documentar la pérdida |
| El vídeo o la memoria se comen el desarrollo | Fin de la semana 3 sin hito completo | Aplicar la línea de corte 8.1 entera de una vez, no gradualmente |

---

## 11. Fuera de alcance

No implementar, no diseñar, no dejar hooks especulativos:

- Mainnet
- Staking, marketplace, multi-chain, Unity
- NFTs comprimidos y activos no fungibles de cualquier tipo
- Metaplex, en cualquiera de sus programas
- Programa Anchor propio y cualquier lógica de juego on-chain
- Gestión de identidad o login
- Salida de activos a wallets del jugador (`claim`)
- Operaciones en lote
- Atributos por jugador
- Multi-tenant: un despliegue del backend sirve a **un** juego
- Alta disponibilidad, réplicas, métricas, panel de administración
- GDExtension y cualquier código nativo

---

## 12. Limitaciones aceptadas conscientemente

Son decisiones, no defectos. Deben aparecer en el README y en la memoria con este mismo tono, para
que nadie —empezando por el tribunal— las descubra por sorpresa.

1. **La cadena certifica catálogo y propiedad, no estado individual.** Al ser los activos fungibles,
   las unidades son indistinguibles on-chain y nada sobrevive a la transferencia salvo la cantidad.
2. **La semilla maestra vive en un fichero, no en un HSM.** Quien lea ese fichero controla todos los
   activos del juego. La derivación es la misma que usaría un HSM; sólo cambia la custodia.
3. **El jugador no posee de verdad.** Las claves las custodia el backend, el permanent delegate
   permite mover sus objetos sin su consentimiento, y no hay vía de salida a una wallet propia.
4. **`NonTransferable` no está activado y no puede añadirse después.** Todo objeto creado en v1 es
   transferible para siempre. Un futuro objeto ligado a la cuenta exigiría mints nuevos.
5. **El `read_token` es público de facto.** Va en el binario del juego; cualquiera puede extraerlo y
   consultar el inventario de cualquier jugador de ese juego. Es el precio de que las lecturas no
   pasen por el servidor de juego.
6. **El modo mock puede divergir del backend real.** No hay tests de conformidad que lo impidan,
   porque eso exigía dos implementaciones del contrato mantenidas en paralelo.
7. **Una sola instancia del backend.** SQLite en fichero; escalar horizontalmente rompería la
   idempotencia.
8. **El identificador de jugador debe ser inmutable.** Si cambia, sus objetos quedan bajo una clave
   derivada que nadie reclama y no hay forma de recuperarlos salvo con el permanent delegate.

---

## 13. Verificar antes de escribir código

No decidas estos puntos: compruébalos, y anota en la memoria lo que encuentres **con la fecha**.

**Ya verificado el 25 de agosto de 2026:**

1. Godot va por la 4.7.1-stable (julio de 2026); la 4.6.3 es de mayo de 2026. Fija en el README la
   que instales.
2. `@solana/web3.js` está marcado como SDK heredado; la recomendación oficial para proyectos nuevos
   es `@solana/kit` con los clientes generados por programa.
3. Restricción de orden en Token-2022 que hay que respetar sí o sí: `InitializeMetadataPointer` debe
   ir **antes** de `InitializeMint`, y `CreateAccount`, la inicialización del puntero y la del mint
   deben viajar **en la misma transacción**.
4. `TokenMetadata` es una extensión TLV de longitud variable: si los metadatos crecen después,
   `UpdateField` redimensiona la cuenta pero **no** transfiere lamports. Hay que enviarlos antes o la
   instrucción falla por falta de exención de renta.

**Pendiente de verificar, contra devnet y contra documentación vigente:**

5. Cifras reales de renta de un mint de Token-2022 con `MetadataPointer` + `TokenMetadata` +
   `PermanentDelegate`, y de una cuenta de token asociada. **No uses cifras de memoria.**
6. Si el `PermanentDelegate` puede reasignarse tras la creación del mint. De ello depende el paso 3
   del procedimiento de rotación (4.3).
7. Versiones exactas de `@solana/kit` y `@solana-program/token-2022`, y si el API de cliente por
   plugins ha cambiado respecto a los ejemplos que encuentres.
8. Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas
   actuales de Google Play y App Store.

---

## 14. Preguntas para el tutor, que no debes responder tú

**Estas van resueltas antes del primer commit.** La primera puede invalidar el proyecto entero.

1. **¿El PFM exige escribir un programa on-chain propio (Anchor)?** Esta propuesta usa
   exclusivamente programas ya desplegados. Si el criterio de evaluación exige código on-chain, hay
   que rediseñar el proyecto, no ajustarlo.
2. **¿Se exige que el backend esté en Rust?** Si la respuesta es sí, hay que añadir entre 8 y 12
   horas al presupuesto y aplicar la línea de corte 8.1 desde el principio.
3. **¿Basta con devnet o hay que demostrar algo en mainnet?**
4. **¿La memoria escrita y la presentación cuentan dentro de las 40 horas o van aparte?** El plan de
   la sección 8 asume que van aparte, salvo el bloque 10.
5. **¿Hay que desplegar el backend en un servidor público o basta con ejecutarlo en local durante la
   defensa?**
6. **¿El proyecto debe ser original respecto a la propuesta de la que deriva, o se admite
   explícitamente como versión reducida de ella?**

---

## 15. Cómo trabajar con Claude Code en este proyecto

Con 40 horas, la disciplina de sesión importa tanto como el código.

- **`CLAUDE.md` en la raíz desde el primer commit**, con los invariantes en imperativo: firmante
  único, marcar antes de llamar, cero vocabulario de cadena en `addon/`, nada fuera de la sección 7.
  Es lo que evita que el alcance se expanda solo.
- **Una sesión por bloque de la sección 8.** Empezar la sesión pegando el bloque correspondiente.
  Terminarla con CI en verde y commit. No arrastrar trabajo entre bloques.
- **Antes de tocar Token-2022, obliga a leer la documentación oficial vigente.** El orden de
  inicialización de extensiones y el cálculo de espacio con TLV son exactamente el tipo de detalle
  que un modelo reconstruye de memoria y se inventa a medias. Que lo lea, no que lo recuerde.
- **Tests antes que implementación en dos sitios concretos:** los vectores de derivación de claves
  (bloque 2) y el invariante de firmante único (bloque 3). En el resto, tests después.
- **La sección 11 es un contrato.** Si Claude Code propone «ya que estamos, añadimos un endpoint
  para…», la respuesta es no. Ese impulso es lo que convierte 40 horas en 90.
- **Commits pequeños y frecuentes.** Cuando una sesión se tuerce, revertir sale más barato que
  depurar lo que otro escribió mientras no mirabas.

---

## 16. Aviso obligatorio en el README

Arriba del todo, antes de cualquier instrucción de instalación:

> **Antes de usar esto en un juego comercial.** Steam prohíbe en su proceso de onboarding los juegos
> construidos sobre tecnología blockchain que emitan o permitan el intercambio de criptomonedas o
> NFTs. Google Play y App Store lo permiten con restricciones. Verifica el texto vigente de las tres
> políticas antes de publicar: son la razón más común por la que un juego con activos on-chain no
> llega a la tienda.

Verifica el texto literal actual (punto 13.8) antes de redactarlo definitivamente.
