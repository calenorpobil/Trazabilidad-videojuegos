# Propuesta PFM — `godot-chain`

**Activos de Solana en Godot 4 sin que el jugador vea la cadena.**
Versión reducida, dimensionada en **unas 44 horas reales** de desarrollo asistido con Claude Code
(40 en la redacción original; ver las revisiones de abajo).

Fecha de redacción: 25 de agosto de 2026. **Revisada el 8 de octubre de 2026** (cliente en Rust, sección 2),
**el 4 de noviembre de 2026** (programa Anchor propio y demo sencilla) **y el 5 de noviembre de 2026**
(Android fuera del PFM, entrega el 30 de noviembre, dashboard web y cliente en GDScript).

---

## 0. Cómo usar este documento

Este documento es a la vez **propuesta de PFM** y **brief de implementación**: se le puede entregar
tal cual a Claude Code como especificación de partida.

Todas las decisiones técnicas están tomadas y justificadas. Quien implemente **no las reabre**. Si
aparece una contradicción o un hueco, va a la sección 14 como pregunta, no se resuelve sobre la
marcha.

### Revisión del 8 de octubre de 2026

El responsable del proyecto decidió el 6 de octubre **volver a escribir el cliente en Rust como
GDExtension** (`godot-chain`), revirtiendo el recorte más grande de la sección 2. El desarrollo
detallado de esa decisión —toolchain de Android, estructura, CI, presupuesto— está en
`docs/juego/arquitectura-cliente-rust.md`, que no la reabre. Esta revisión traslada a la propuesta lo que
cambia: secciones 2, 3, 4.6, 6, 8, 9, 10, 11, 12, 13, 14 y 15. **No cambia:** el backend (TypeScript),
el contrato HTTP (congelado), el hito de la sección 7, y los invariantes 1, 2, 3, 5, 6, 7 y 8 de
`CLAUDE.md`. Lo que queda abierto es la **Q7** (sección 14): las horas extra.

### Revisión del 4 de noviembre de 2026

El responsable del proyecto decidió dos cosas a la vista de las instrucciones de entrega del máster
(0.1):

1. **Se escribe un programa Anchor propio**, `chain-assets` (4.7). Revierte la premisa 3 y el
   invariante 8 anterior. Los activos siguen siendo Token-2022 reales: el programa tiene los poderes
   sobre ellos mediante PDA, no reimplementa tokens ni contiene lógica de juego.
2. **El hito se demuestra con una demo sencilla**, no con *Nidada* (sección 7). *Nidada* sigue en el
   repositorio como proyecto aparte y deja de condicionar la librería.

Cambian las secciones 0.1, 1, 3, 4.1, 4.2, 4.3, 4.6, 7, 8, 9, 10, 11, 12, 13 y 14, y se añade la 4.7.
**No cambian:** el contrato HTTP (congelado), el backend en TypeScript, el cliente en Rust, el
vocabulario sin cadena de `addon/`, y los invariantes 1 a 7 de `CLAUDE.md`. Quedan abiertas la **Q1**,
para confirmarla con el tutor, y la **Q7**. El hito ya no necesita reglas compartidas: Rust en el cliente
se sostiene por ser decisión del responsable (sección 2, motivo 2).

### Revisión del 5 de noviembre de 2026

El responsable del proyecto decidió **sacar Android del PFM**: el cliente y la demo se compilan y se prueban
en escritorio. Desaparecen la fase A0, el trabajo `android-build` y sus riesgos, y el presupuesto baja a
**unas 48 h**. Android sigue siendo el objetivo de *Nidada* como proyecto aparte. Cambian las secciones 2, 3,
4.6, 6, 8, 9, 10, 11, 12, 13, 14 y 15.

También se revisan las preguntas de la sección 14 contra la documentación del máster: Q1, Q2, Q3, Q5, Q6 y
Q7 quedan resueltas. Lo que dicen de ellas las revisiones anteriores de esta sección es historia.

El responsable fija además que **la entrega es el 30 de noviembre de 2026**, que el tema propio se admite, y
que **habrá un dashboard web**: la consola de administración de la sección 3 entra en el hito en una versión
reducida. El plan de la sección 8 se ordena por esa fecha.

Por último, el responsable decide **volver al addon en GDScript puro**, revirtiendo la GDExtension en Rust del
6 de octubre, y fija su dedicación en **2 h diarias, 6 días a la semana**. Son unas 40 h hasta el 29 de
noviembre, así que se aplica la línea de corte desde el principio (8.1) y el presupuesto queda en **unas
44 h**. Rust sigue sólo en *Nidada*, y su documento pasa a `docs/juego/`. Las menciones a Rust en las
revisiones anteriores son historia.

### 0.1 Requisitos de entrega del máster

Hasta el 4 de noviembre eran supuestos. Ahora salen de las instrucciones generales de entrega del TFM,
que el repositorio no incluye porque son material del curso. **Son las que definen qué se valora y qué se
exige.** Lo que no resuelven está en la sección 14.

| Criterio | Peso | Qué pide | Cómo lo cumple este proyecto |
|---|---|---|---|
| Código fuente | 30 % | MVP funcional, código limpio, 5 tests o más, README completo | Hito de la sección 7, secciones 8 y 9 |
| Programa Solana (Anchor) | 25 % | 5 instrucciones o más, PDAs, validaciones, seguridad, comentarios, desplegado en devnet con Program ID visible | `chain-assets` (4.7) |
| Vídeo | 15 % | 5 minutos como máximo, 720p, voz, demostración práctica con transacción en un explorador, enlace público | Guion: el hito de la sección 7 |
| Documentación | 10 % | Diagramas de arquitectura y de flujo de datos (Mermaid preferido, `docs/diagramas.md`), comentarios, 5 capturas o más en `screenshots/` | Último bloque de la sección 8. Las capturas salen del dashboard web (sección 3) |
| Innovación | 15 % | Diferenciarse del esqueleto base y documentar qué se añade | Activos Token-2022 reales, jugador sin wallet, firmante único, idempotencia, `applied`/`settled`, cliente Godot |
| IA y MCP | 5 % | Documentar el uso de IA; MCP es opcional | Sección del README sobre el uso de Claude Code |

También se exige: repositorio público, `LICENSE`, y un README con problema que resuelve, tecnologías,
instalación, Program ID, casos de uso, capturas, diagramas, enlace al vídeo, innovaciones, uso de IA y
autor. Retraso: −10 % a 1 día, −20 % a 2-3 días; más de 3 días no se acepta.

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

**Objetivo final y modelo de servicio (11-oct-2026).** El proyecto es un **servicio de trazabilidad
para estudios de videojuegos**, y se ofrece **autoalojado**: cada estudio despliega su propio
backend, custodia su propia semilla y opera su propia instancia. No hay un servicio central que
sirva a varios estudios. Es lo que cabe en el presupuesto, y es una decisión, no una omisión
(ver 11). Lo que se entrega a un estudio es:

| Pieza | Qué es | Quién la opera |
|---|---|---|
| `godot-chain` (addon) | El addon en GDScript que el estudio añade a su juego | El estudio, dentro de su juego |
| `chain-backend` | El servicio, con su consola de administración | El estudio, desplegado por su cuenta |
| `chain-assets` | El programa on-chain que tiene los poderes sobre los activos (4.7) | Se despliega una vez; cada juego es una PDA suya, controlada por la autoridad del estudio |
| Servidor de juego | La lógica y las decisiones de **su** juego; llama al backend con el `write_key` | El estudio (lo escribe él) |

La demo del hito (`examples/chain-demo/` y `examples/game-server/`) hace de estudio de ejemplo: integra
las piezas para demostrar que funciona de extremo a extremo. No forma parte de lo que se entrega a un
estudio. *Nidada*, el juego de mascotas, sigue como proyecto aparte, fuera del hito.

**Premisas que no se negocian:**

1. El jugador no percibe la blockchain. Nada de *seed phrases*, gas ni wallets.
2. El addon no gestiona identidad. Recibe el identificador del jugador desde fuera.
3. Un único programa propio, mínimo y sin lógica de juego (4.7). Los activos son Token-2022, un
   programa ya desplegado: no se reimplementan tokens. El desarrollador del juego sigue sin escribir
   código on-chain.
4. Ningún concepto de Solana cruza a GDScript. Si se filtra, es un fallo de diseño, y la CI lo
   detecta automáticamente (sección 9).
5. Las claves privadas nunca están en el binario del juego.

---

## 2. Qué se recorta respecto de la propuesta original, y por qué

Esta versión nace de una propuesta más ambiciosa. La tabla es parte de la defensa del proyecto: los
recortes son decisiones de ingeniería con motivo, no omisiones.

| Elemento original | Aquí | Motivo del recorte |
|---|---|---|
| `godot-client` como GDExtension con `gdext` (Rust) | **Addon 100 % GDScript** | Ahorra FFI, `gdext` fijado, MSRV y compilación nativa. Se probó a revertir este recorte el 6 de octubre, por las reglas compartidas de *Nidada* y por Android. Decisión del 5 de noviembre: con ambos fuera del PFM, no queda motivo técnico para pagar ese coste |
| CI con 5 targets de escritorio | CI en Linux, sin matriz | El addon no tiene código nativo que compilar (sección 9) |
| `core` en Rust sans-io | Backend único en TypeScript | Sin cambios. El núcleo era Rust *porque* tenía que empotrarse en una GDExtension que firmara transacciones en el dispositivo, y eso sigue sin ocurrir: la firma está en el backend |
| `core` + `dev-backend` + `mock-backend` + `node-adapter` | **Un** backend + modo mock dentro del addon | Tres implementaciones del mismo contrato exigen tests de conformidad. Con una implementación, el problema no existe |
| `node-adapter` distribuible con `SeenStore` conectable | Idempotencia implementada en el backend sobre SQLite | El interfaz conectable existía para que el estudio enchufara su base de datos. Sin clientes reales, es abstracción sin usuario |
| «Ninguna base de datos propia» | **SQLite**, un fichero | La ausencia de base de datos era una restricción comercial (multi-tenant, operar poco). Aquí una tabla resuelve idempotencia, estado de operaciones e identificadores opacos en una tarde |
| Claves en HSM/KMS | Semilla maestra en fichero fuera del repo | El HSM es coste y proveedor. La derivación es idéntica; sólo cambia dónde vive la semilla. Queda escrito como limitación (12.2) |
| Firmantes múltiples, deduplicación, `SigningContext` | **Un único firmante en toda la v1** | Ver 4.2. Es la simplificación más rentable del proyecto |
| Trait `Signer` async con MPC/hardware futuro | No existe | Nacía con su forma final porque tendría usuarios externos. No los tiene |
| Backend comercial cerrado | No existe | Fuera del alcance de un PFM |
| Señal `expired` | Se pliega en `failed` con `retryable: true` | Un estado menos que probar. La caducidad del blockhash es un fallo reintentable, y el jugador no distingue una cosa de la otra |
| Pregunta abierta sobre Android/iOS en CI | **Fuera de alcance los dos** | Decisión del 5 de noviembre de 2026: el hito se demuestra en escritorio. Ni se compilan ni se prometen |

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
    game-server de ejemplo (examples/game-server)
        │  clave de escritura                 │
        ▼                                     ▼
    chain-backend  (TypeScript + SQLite)
        │  claves derivadas de una semilla maestra por juego
        ▼
    Solana devnet  —  chain-assets (Anchor)  ──CPI──▶  Token-2022
```

**Escrituras** (crear un objeto, entregarlo, transferirlo) van del juego al servidor de juego, y de
ahí al backend. Nunca directas.

**Lecturas** (qué tiene un jugador) van directas del juego al backend con un token de sólo lectura.

**Motivo de la topología —y hay que saber defenderlo en la presentación:** la credencial que
autoriza operaciones no puede viajar dentro del binario del juego, porque se extrae del ejecutable con
herramientas triviales. Y quien decide que un jugador se ha ganado un objeto tiene que ser un
servidor autoritativo, no el cliente, que el jugador controla. Un juego que mintea desde el cliente
es un juego donde cualquiera se mintea lo que quiera.

**Consecuencia:** el `game-server` de ejemplo no es decorado. Sin él, el proyecto demuestra una
arquitectura insegura.

**Consola de administración (11-oct-2026).** Es parte del **producto**: la sirve el propio
`chain-backend`, de modo que cada estudio la recibe al desplegarlo y no tiene que construir la suya.
Vive bajo `/admin` y el navegador **sólo habla con el backend**:

```
Navegador (consola) ──cookie de sesión──▶ chain-backend (rutas /admin, mismas funciones internas que la API)
```

- **Sin intermediario.** La consola llama a las funciones del backend por dentro, no por HTTP, así que
  ninguna credencial de la API (`write_key`, `read_token`) pasa por el navegador.
- **Acceso.** Una credencial de administrador propia, distinta de las dos anteriores, que se configura
  al arrancar (variable de entorno, nunca en el repositorio) y se cambia en `/admin` por una cookie de
  sesión `HttpOnly` y `SameSite=Strict`. Sin cookie válida, las rutas de `/admin` responden `401`.
  Por defecto escucha sólo en `127.0.0.1`; exponerla es una decisión explícita de quien despliega.
- **No es parte del contrato HTTP.** Las rutas `/admin` son internas del backend y no las usa el addon
  ni el servidor de juego.
- **Qué hace en el hito (5-nov-2026):** es el dashboard web de la entrega. Crear colecciones y tipos,
  consultar operaciones e inventarios y listar el catálogo, con enlace de cada operación a su transacción
  en un explorador. Entregar y transferir se hacen desde la demo. Sale de la maqueta `docs/especificacion/mockup-admin/index.html`,
  que hoy simula el servidor. Su código vive en `frontend/`, como HTML y JavaScript sin paso de compilación,
  y lo sirve el backend.
- **Fuera del hito:** importar un catálogo y editar un tipo (8.1). El servidor de juego sigue siendo quien
  decide qué gana cada jugador; la consola es para el equipo del estudio.

**Catálogo declarativo (11-oct-2026).** Un estudio no programa nada para dar de alta sus objetos: los
describe en un fichero de datos, `catalog.json`, que versiona junto a su juego, y el backend lo aplica.
Se **describe** aquí y no se construye en el hito: es una función de la consola y del backend, bajo la
línea de corte (8.1).

```json
{
  "collections": [{ "id": "species", "name": "Especies" }],
  "items": [{
    "id": "brasa", "collection": "species", "name": "Brasa", "symbol": "BRASA",
    "qualities": { "kind": "pet", "element": "fire", "rarity": "common", "growth_hours": "72" },
    "initial_grant": { "holder": "game-reserve", "amount": 1 }
  }]
}
```

- **Se aplica desde la consola** («Importar catálogo») **o con un comando** del backend
  (`catalog apply catalog.json`). No hay una tercera vía.
- **Primero un plan, sin tocar nada.** Cada entrada sale como *nuevo*, *ya existe*, *cambia*, *en curso*,
  *diverge*, *fallido* o *error* (el fichero no cumple los límites del contrato 4.3). Sólo al confirmar
  se aplica.
- **Repetible.** El `id` de cada entrada fija su `call_id` (`catalog_<id>`), y con él la clave de
  idempotencia (4.4). Aplicarlo dos veces no crea nada dos veces, y un corte a medias se reanuda.
- **Cambios: se editan en el sitio.** Si una entrada ya creada cambia en el fichero, el plan la marca
  *cambia* y, al confirmar, el backend **edita el mismo tipo** (`PATCH /v1/items/{id}`, contrato
  4.6): mismo `item_id`, mismas unidades en manos de los jugadores, una transacción por tipo y ninguna
  migración. Se pueden cambiar `name`, `uri` y `qualities`. La clave de cada edición incluye la
  `revision` del tipo (`catalog_<id>:r<revision+1>`): una misma edición reintentada no se repite, y una
  edición nueva, aunque deshaga la anterior o repita una que falló, no devuelve el resultado viejo.
  Sólo se admite una edición a la vez por tipo (contrato 4.6).
- **Divergencia (lo que no se puede editar).** Cambiar el `symbol`, la colección o el `initial_grant` de
  una entrada ya creada no se aplica: el plan la marca *diverge*. El `symbol` es la clave de emparejamiento
  del servidor de juego, y las existencias iniciales ya se emitieron. Una entrada *fallida* tampoco se
  reintenta sola.
- **Cambio de significado: tipo nuevo.** La edición en el sitio cambia **todas** las unidades ya
  repartidas. Si un cambio no debe alcanzar a lo entregado (rebalanceos que respeten lo ya obtenido,
  el tipo como certificado histórico), se añade una entrada nueva con otro `id` y otro `symbol`
  (`brasa-2`, `BRASA2`). Pasar los saldos al tipo nuevo es una tarea aparte, sin herramienta en v1: una
  transferencia por jugador y tipo.
- **Quién lo escribe.** Un estudio con el catálogo ya definido en código (como *Nidada* en
  `nidada-rules`) no lo teclea a mano: lo genera desde su código, y un test comprueba que coinciden.
  Es lo único que programa el estudio, y sólo si le interesa evitar la duplicación.

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
| `PermanentDelegate` | **Activado** al crear cada mint, apuntando a la PDA del juego (4.7) |
| `NonTransferable` | **No.** Ver 12.4 |
| Programa propio | **`chain-assets`**, mínimo y sin lógica de juego (4.7) |
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
comportamiento y no almacenan datos arbitrarios. Atributos divergentes por jugador exigirían guardar
estado por ejemplar en el programa o usar activos no fungibles, y ambas cosas están descartadas.

**Nota crítica sobre extensiones.** La mayoría de extensiones de Token-2022 se activan al crear el
mint y **no se pueden añadir después**. Lo que no se decida ahora no se puede retrofitear sobre
tokens ya creados. Por eso `PermanentDelegate` entra desde el primer mint aunque parezca prescindible.

### 4.2 Firmante único: la simplificación central

**Decisión: toda transacción de la v1 tiene exactamente un firmante**, la autoridad del juego, que
es también la cuenta pagadora.

Cómo se sostiene, operación por operación:

| Operación | Instrucción de `chain-assets` | Por dentro, por CPI | Firma de la transacción |
|---|---|---|---|
| Crear un tipo de objeto | `create_item` | `CreateAccount` + `InitializeMetadataPointer` + `InitializePermanentDelegate` + `InitializeMint` + `InitializeTokenMetadata` | Autoridad, como pagadora. El mint y la PDA del juego firman con sus semillas |
| Crear la cuenta de token de un jugador | Dentro de `grant` y `transfer` | `CreateAssociatedTokenAccount` | Autoridad, como pagadora; el propietario no firma |
| Entregar unidades a un jugador | `grant` | `MintTo` | Autoridad. La PDA del juego actúa como *mint authority* |
| Transferir entre jugadores | `transfer` | `TransferChecked` | Autoridad. La PDA del juego actúa como **permanent delegate** |
| Cambiar la autoridad del juego | `rotate_authority` | Ninguno | Autoridad actual |
| Editar un tipo (fuera del hito) | `update_item`, sólo si se decide editar tipos (4.7) | Transferencia de lamports si crece + `UpdateField` y `RemoveKey` (13, puntos 5 a 8) | Autoridad, como pagadora. La PDA del juego actúa como autoridad de actualización |

La firma de una PDA por CPI (`invoke_signed`) no es una firma de la transacción: el invariante se
refiere a las firmas requeridas de la transacción, y ésas siguen siendo una.

**Corrección del 4 de noviembre de 2026.** La versión anterior de esta tabla era incorrecta: daba por
hecho que al crear un tipo sólo firmaba la autoridad, pero `CreateAccount` exige también la firma de la
**cuenta nueva**, y un mint con clave propia habría sido un segundo firmante. Que el mint sea una PDA
del programa es lo que hace cierto el firmante único.

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
2. Ejecutar `rotate_authority` con la autoridad antigua: una sola transacción. Los mints no cambian,
   porque sus poderes los tiene la PDA del juego, no la autoridad.
3. Para cada tenedor, mover su saldo a la dirección derivada de la nueva semilla con `transfer`.
4. Republicar el mapa `holder_id` → dirección.
5. Destruir la semilla comprometida.

Es una carrera: quien tenga la semilla comprometida también puede ejecutar `rotate_authority`. Si lo
hace primero, el estudio pierde el juego (12.2).

### 4.4 Persistencia y seguridad

| Decisión | Valor |
|---|---|
| Almacenamiento | **SQLite**, un fichero, sin servidor |
| Autenticación de escrituras | `Authorization: Bearer <write_key>` — la tiene el servidor de juego |
| Autenticación de lecturas | `Authorization: Bearer <read_token>` — viaja en el binario del juego |
| Autorización de operaciones | Del servidor de juego, con sus propios datos |
| Idempotencia | Cabecera `Idempotency-Key` **obligatoria** en toda escritura. La **decide el plugin** (ver abajo) |
| Escritura de estado en el juego | **Sólo en `settled`.** `applied` es puramente cosmético |

**Tablas:**

```sql
collections (collection_id PK, game_id, name, created_at)
items        (item_id PK, collection_id, mint, name, symbol, uri, qualities, operation_id,
              revision, edit_operation_id, created_at)
operations   (operation_id PK, kind, state, signature, error_code, error_message,
              created_at, updated_at)
idempotency  (key PK, operation_id, created_at)
```

`items.qualities` es texto JSON, sin la clave reservada `collection`. Se guarda al crear el tipo y de
ahí se sirve: el backend **no lee la cadena en cada consulta**. La cadena sigue siendo la fuente de
verdad de la propiedad. Las `qualities` son editables (contrato 4.6, fuera del hito), así que **la edición
actualiza también esta copia** al llegar a `settled`; si no, el listado y el inventario mostrarían datos viejos.
`items.operation_id` apunta a la operación que creó el tipo y da su `state` en el listado (11-oct-2026).

**Idempotencia — el orden importa: marcar primero, llamar después.** Ante una escritura, el backend
inserta la clave en `idempotency` dentro de una transacción SQLite. Si el `INSERT` choca con la clave
primaria, devuelve el resultado anterior sin tocar Solana. Si no choca, procede. Invertir el orden
—llamar y luego marcar— deja una ventana en la que un reintento mintea dos veces.

**Quién decide la clave (decisión del 9-oct-2026).** La construye el plugin, a partir de un
**identificador de llamada** (`call_id`) que aporta el juego. El juego no escribe nunca una
`Idempotency-Key`: sólo dice *qué acción lógica es esta*, y `Chain` la convierte en clave.

- Toda operación de escritura de `Chain` recibe `call_id` como **último argumento, obligatorio**.
  Es una cadena de 1 a 64 caracteres que identifica la acción de negocio («el regalo 42», «la
  compra 7»).
- `Chain` calcula la clave como SHA-256 en hexadecimal de `(operación, call_id)` y la envía en la
  cabecera. Incluir la operación evita que `grant` y `transfer` con el mismo `call_id` choquen. Los
  demás argumentos no entran: reutilizar un `call_id` con otros datos devuelve el resultado
  original (contrato 9.5), que es la respuesta menos dañina.
- El servidor de juego reenvía la clave sin tocarla. El backend sólo la guarda y compara.
- Reglas para el juego: un `call_id` por acción lógica; el **mismo** en todos sus reintentos,
  incluido tras reabrir la aplicación; **nuevo** para una acción nueva, aunque sus datos sean
  idénticos a los de una anterior; y **nuevo** para reintentar tras un `failed`, porque el backend
  exige una clave nueva (contrato 8).
- El `call_id` debe poder recuperarse tras un reinicio, así que lo fija el servidor de juego en el
  momento en que registra la acción (en su tabla `operations`, antes de llamar), no el cliente al
  vuelo.
- Un llamador que no pasa por el plugin (p. ej. el servidor de juego dando de alta tipos) aporta su
  propia clave; el backend no distingue el origen.

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

Monorepo, licencia **MIT OR Apache-2.0**, estos directorios:

| Directorio | Contenido |
|---|---|
| `addon/` | `addons/godot_chain/`: el addon, en GDScript puro y sin dependencias |
| `programs/chain-assets/` | El programa Anchor (4.7), con `Anchor.toml` en la raíz |
| `rust/` | Workspace de Cargo de *Nidada*: `nidada-rules`, `nidada-ext` y `nidada-server`. Fuera del hito |
| `backend/` | TypeScript, Node ≥ 22, el servicio y su suite de tests |
| `frontend/` | El dashboard web: la consola de administración que sirve el backend (sección 3) |
| `examples/chain-demo/` | Proyecto Godot de la demo sencilla, que ejecuta el hito |
| `examples/game-server/` | Servidor de juego mínimo del hito: TypeScript, `fastify` y `better-sqlite3`, las mismas dependencias que el backend |
| `examples/godot-demo/` | Proyecto Godot de *Nidada*, fuera del hito |

El servidor de juego del hito vuelve a ser `examples/game-server/`: reutiliza la pila del backend y sólo
autoriza, guarda el `call_id` antes de llamar (4.4) y reenvía con el `write_key`. `rust/nidada-server`
sigue siendo el servidor de *Nidada*.

**Stack del backend, fijado a versión exacta en `package.json`:**

- `@solana/kit` — es el SDK vigente; `@solana/web3.js` v1 está marcado como heredado y las
  aplicaciones nuevas se construyen sobre Kit.
- `@solana-program/token-2022` y `@solana-program/token` — clientes generados de los programas, para
  leer inventarios. Las escrituras pasan por `chain-assets`, con un cliente generado de su IDL para
  seguir sobre Kit (herramienta y versión por verificar, sección 13).
- `fastify` para HTTP, `better-sqlite3` para persistencia, `zod` para validar entrada,
  `vitest` para tests.

**Prohibido en `addon/`:** las cadenas `solana`, `pubkey`, `lamport`, `blockhash`, `base58`, `mint` y
`spl`, cualquier dependencia y cualquier binario. El HTTP pasa por `HTTPRequest` de Godot y todo ocurre en
el hilo principal. La CI lo comprueba con `grep` y `find` (sección 9): un invariante de diseño convertido
en test automático.

**Godot:** 4.7.2, la última estable, declarada en el README. Al ser GDScript puro, la sensibilidad a la
versión es baja.

### 4.7 Programa on-chain: `chain-assets` (4-nov-2026)

**Decisión: un programa Anchor mínimo, que tiene los poderes sobre los activos y nada más.** Los activos
siguen siendo Token-2022: el programa no lleva saldos ni reimplementa tokens, sólo los controla por CPI.
No contiene lógica de juego: quién gana qué lo decide el servidor de juego. Anchor `=1.2.2`, la última
estable a 4 de noviembre de 2026.

| Cuenta | Semillas | Qué es |
|---|---|---|
| `Game` | `["game", game_id]` | Guarda `authority`, `game_id` y `bump`. Es *mint authority*, autoridad de actualización y *permanent delegate* de todos los activos del juego |
| Mint del tipo | `["item", game, item_seed]` | Mint Token-2022 con sus extensiones. Es una PDA, así que se crea sin clave propia. `item_seed` lo calcula el backend a partir del `item_id` |

| Instrucción | Qué hace | Validaciones principales |
|---|---|---|
| `initialize_game` | Crea `Game` y fija su autoridad | `game_id` de longitud acotada; no se puede repetir, porque la PDA ya existe |
| `create_item` | Crea el mint con `MetadataPointer`, `PermanentDelegate` y `TokenMetadata` | Firma la autoridad de `Game`; límites de `name`, `symbol`, `uri` y `qualities` iguales al contrato 4.3 |
| `grant` | Crea la cuenta del jugador si hace falta y emite unidades | Firma la autoridad de `Game`; `amount > 0` |
| `transfer` | Mueve unidades entre jugadores mediante el delegado | Firma la autoridad de `Game`; `amount > 0`; emisor y receptor distintos; el saldo lo rechaza Token-2022 |
| `rotate_authority` | Cambia la autoridad de `Game` | Firma la autoridad actual; la nueva es distinta |

**Sólo estas cinco**, salvo `update_item`, que se añade únicamente si se decide editar tipos (8.1),
porque editar un tipo necesita que la PDA actúe como autoridad de actualización. Cada instrucción emite
un evento con `emit!` y lleva comentarios de documentación. Cada una tiene al menos un test negativo:
otro firmante, cantidad cero, tipo de otro juego.

**Por qué compensa, además de pedirlo la entrega (0.1):**

1. **Hace cierto el firmante único.** Un mint PDA no necesita firmar la transacción (4.2).
2. **Simplifica la rotación.** Cambiar una autoridad es una instrucción, no un recorrido por todos los
   mints, y deja de depender de si el delegado permanente se puede reasignar (4.3).
3. **Separa juegos con la misma pieza.** Un solo despliegue del programa sirve a cualquier estudio, cada
   uno con su `Game`, sin que el servicio deje de ser autoalojado.

**Qué no cambia.** El contrato HTTP sigue igual: `POST /v1/items` devuelve `{ operation_id, item_id }` y
emite la cantidad inicial, enviando `create_item` y `grant` en la misma transacción si caben (13). Las
colecciones siguen sin existir on-chain y el jugador sigue sin firmar nada. El addon no sabe que el
programa existe.

---

## 5. Contrato HTTP

**Escríbelo primero. Es el artefacto del que cuelga todo lo demás.** Va en `docs/especificacion/http-contract.md`,
versionado, y se congela antes de implementar nada.

Vocabulario **sin cadena**. Si un endpoint necesita decir «blockhash», la costura está rota.

| Método | Ruta | Tipo | Devuelve |
|---|---|---|---|
| `POST` | `/v1/collections` | escritura | `{ collection_id }` — no toca la cadena |
| `POST` | `/v1/items` | escritura | `{ operation_id, item_id }` — crea el tipo y emite la cantidad inicial |
| `POST` | `/v1/items/{item_id}/grants` | escritura | `{ operation_id }` — entrega unidades a un tenedor. **Recortado, sin implementar** (8.1) |
| `POST` | `/v1/items/{item_id}/transfer` | escritura | `{ operation_id }` |
| `PATCH` | `/v1/items/{item_id}` | escritura | `{ operation_id }` — edita `name`, `uri` y `qualities` del tipo **en el sitio**. **Bajo la línea de corte** |
| `GET` | `/v1/operations/{operation_id}` | lectura | `{ state, error }` |
| `GET` | `/v1/holders/{holder_id}/items` | lectura | `[ { item_id, name, qualities, amount } ]` |
| `GET` | `/v1/collections` | lectura | `{ collections: [...] }` — para la web de administración |
| `GET` | `/v1/items` | lectura | `{ items: [...] }`, filtrable por `collection_id` — para la web de administración |

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

Tres formas expuestas, ni una más, en GDScript dentro de `addon/addons/godot_chain/` (`ChainConfig` sobre
`Resource`, `Chain` sobre `Node`, `ChainHandle` sobre `RefCounted`).

1. **`ChainConfig`** — `Resource`. `write_url`, `read_url`, `read_token`, `game_id`, timeouts,
   intervalo de sondeo, `mode` (`LIVE` | `MOCK`).
2. **`Chain`** — singleton autoload registrado por el plugin. Punto de entrada.
3. **`ChainHandle`** — `RefCounted` devuelto por cada operación.

```gdscript
var handle := Chain.transfer("itm_a1b2", 1, "hld_c3d4", "gift_42")
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
3. **Sin hilos.** Sondeo a intervalo fijo con un `Timer`, sin backoff (8.1); la respuesta llega por la
   señal `request_completed` en el hilo principal. Cero primitivas de concurrencia.
4. **Registro del autoload.** Lo declara el `plugin.gd` mediante `add_autoload_singleton` al
   activarse el addon, apuntando a `chain.gd`. Es el mecanismo estándar y evita insertar nodos bajo la
   raíz a mano, que rompe si el juego cambia la escena principal.
5. **No se persisten handles.** Si se cierra la aplicación, los handles se pierden pero la operación sigue
   en el backend; al reabrir, el juego relee el inventario.
6. **La clave de idempotencia la construye `Chain`** a partir del `call_id` que pasa el juego (ver
   4.4). Es determinista: el handle la usa en sus reintentos de red y, tras reabrir la aplicación,
   el mismo `call_id` produce la misma clave. `call_id` es obligatorio en toda escritura.

### Errores

`ChainError` con **categoría accionable**, nunca un código de cadena:
`NETWORK`, `REJECTED`, `NOT_FOUND`, `RATE_LIMITED`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_FUNDS`,
`CONFIG`, `EXPIRED`, `INTERNAL`. Cada una con `retryable: bool`.

`EXPIRED` (blockhash caducado) es un `failed` con `retryable = true`, no un estado propio.

### Modo mock

`ChainConfig` con `mode = MOCK` resuelve contra una máquina de estados en GDScript, dentro del addon, en
memoria y sin red. Sólo cubre el camino feliz: `mock_force`, que permitía probar la rama de reversión, queda
recortado (8.1).

Esto sustituye al `mock-backend` de la propuesta original. Coste: el mock puede divergir del backend
real, y no hay tests de conformidad que lo impidan. Queda anotado en 12.6.

---

## 7. Hito mínimo demostrable

> En devnet, desde un proyecto Godot 4 y **pasando por un servidor de juego de ejemplo**: crear una
> colección, crear un objeto con cualidades de tipo, entregarlo al jugador A, transferir una unidad
> del jugador A al jugador B, y ver el inventario de ambos actualizado en pantalla. Lo mismo se puede
> consultar desde el **dashboard web**, con enlace de cada operación a su transacción en un explorador. La
> entrega al jugador A es la cantidad inicial de `POST /v1/items` (8.1).

**Se demuestra con una demo sencilla** (`examples/chain-demo/`): una sola escena de Godot, con un botón
por operación, los inventarios de A y B, y el estado `applied`/`settled` de cada operación. Sin arte, sin
reglas de juego y sin *Nidada*: su único fin es probar con facilidad las funciones de la cadena. Las
transacciones se enseñan en un explorador desde el dashboard, con las firmas que registra el backend, nunca
desde `addon/`.

Nada más entra en el proyecto hasta que esto funcione de extremo a extremo. Es también el guion del
vídeo de demostración.

---

## 8. Plan de trabajo: unas 44 horas

Orden estricto. Cada bloque termina con la CI en verde y un commit. No se empieza el siguiente con el
anterior a medias.

**Qué es una hora aquí:** tiempo del responsable trabajando con Claude Code, incluidos revisar, probar y
entender lo generado. Son estimaciones, no mediciones. Se contrastan con las horas reales al acabar OC1.

**El tiempo de desarrollo de la demo y de *Nidada* no cuenta en las horas del PFM.** El presupuesto
cubre la librería: programa, backend, `godot-chain`, su CI y su documentación.

| # | Bloque | h | Acumulado |
|---|---|---|---|
| 1 | Contrato HTTP escrito y congelado. Esqueleto del monorepo. `CLAUDE.md`. CI vacía en verde | 3 | 3 |
| 2 | Backend: configuración, derivación de claves **con vectores de test**, SQLite, idempotencia, máquina de estados de operaciones | 5 | 8 |
| OC1 | Programa: entorno de Anchor, `initialize_game`, `rotate_authority` y `create_item` con mint PDA, `MetadataPointer`, `TokenMetadata` y `PermanentDelegate`. Tests, también negativos. Despliegue en devnet | 8 | 16 |
| OC2 | Programa: `grant` y `transfer`, con sus tests | 4 | 20 |
| 3 | Backend: cliente del programa y crear item, con el **test del invariante de firmante único** | 3 | 23 |
| 4 | Backend: transferir e inventario con parseo de metadatos | 2 | 25 |
| 5 | Backend: seguimiento de confirmación `applied → settled`, categorías de error, `INSUFFICIENT_FUNDS` | 2 | 27 |
| W1 | Dashboard web: rutas `/admin`, sesión, listados de catálogo, y `frontend/` a partir de la maqueta | 4 | 31 |
| A1 | `godot-chain` en GDScript: `ChainConfig`, `Chain`, `ChainHandle`, pool de `HTTPRequest`, sondeo fijo, errores | 5 | 36 |
| A2 | Modo mock básico y suite *headless* en GDScript | 2 | 38 |
| A5 | CI de la sección 9 | 1 | 39 |
| — | Entregables de 0.1: README completo con aviso de Steam, diagramas Mermaid, capturas, documentación de integración y vídeo (antiguo bloque 10) | 5 | 44 |

**Sin buffer.** Con 44 h no queda colchón: por eso existe la línea de corte.

**Fuera del cómputo — la demo**, estimada sólo para planificar el calendario. Sigue siendo necesaria:
sin ella no hay hito que enseñar.

| Fase | Contenido | Sustituye a | h estimadas |
|---|---|---|---|
| A3 + A4 | `examples/game-server/` mínimo y `examples/chain-demo/`: la escena del hito, en escritorio | Corte vertical y escena de *Nidada* (10 h) | 3 |

**Respecto a la documentación del máster.** No fija un límite: orienta entre 30 y 55 h según el TFM. Esa cifra
incluye la memoria, 4-6 h, que este plan no presupuesta (**Q4**, sección 14).

### 8.1 Línea de corte

**Aplicada desde el principio** (5-nov-2026), porque el calendario no da para más. Cada recorte se documenta en
el README:

1. `PATCH /v1/items/{id}` (edición en el sitio), `update_item` e importar un catálogo: fuera.
2. `POST /grants`: fuera. `POST /items` ya emite la cantidad inicial. La instrucción `grant` se conserva,
   porque `POST /items` la usa. El contrato no cambia: el endpoint queda sin implementar.
3. `mock_force` y la parte del modo mock que prueba reversiones: fuera. Se conserva el mock básico.
4. Backoff del sondeo: fuera. Intervalo fijo con `Timer`.
5. Entregar y transferir desde el dashboard: fuera. Se hacen desde la demo.

**Si aun así no llega**, el siguiente recorte son las pantallas del dashboard que no salgan en el vídeo ni en las
capturas.

**El programa no se recorta por debajo de cinco instrucciones**, porque es lo que pide la entrega (0.1). **El
dashboard no se recorta por debajo de lo que necesitan las 5 capturas.**

**Nunca se recorta el último bloque (README, documentación, vídeo).** Un proyecto funcionando sin documentar puntúa peor que uno con
menos alcance bien documentado.

### 8.2 Calendario hasta la entrega, el 30 de noviembre de 2026

Dedicación del responsable: **2 h diarias, 6 días a la semana**, con el domingo de descanso. Son 20 días y
**40 h** del 6 al 28 de noviembre. Quedan 41 h de librería (el bloque 1 está hecho) y 3 h de demo: **44 h**.
**Las 4 h que faltan se cubren con algún día de mayor esfuerzo**, que el responsable planificará cuando queden
pocos días.

| Fechas | Bloques | h |
|---|---|---|
| 6–7 de noviembre | 2 (4 de 5 h) | 4 |
| 9–14 de noviembre | 2 (resto), OC1, OC2 (3 de 4 h) | 12 |
| 16–21 de noviembre | OC2 (resto), 3, 4, 5, W1 | 12 |
| 23–28 de noviembre | A1, A2, A3 + A4, A5, entregables (1 de 5 h) | 12 |
| Días de mayor esfuerzo, por fijar | Entregables (4 h): README, capturas, diagramas y vídeo | 4 |
| 30 de noviembre | Entrega | — |

La semana del 9 de noviembre es la de mayor riesgo: es donde viven Anchor y Token-2022. Si algo se va a torcer,
se tuerce ahí, y por eso el plan B de la sección 10 se decide como muy tarde al final de OC1.

**Revisiones obligatorias.** El 14 de noviembre: si OC1 no está hecho, se decide el plan B y se contrastan
las horas reales con estas. El 21 de noviembre: si los bloques hasta W1 no están hechos, se recortan las
pantallas del dashboard y se reparte de nuevo lo que quede. Un día de retraso cuesta un 10 % de la nota.

---

## 9. CI

GitHub Actions, un solo runner Linux, sin matriz de compilación.

| Trabajo | Qué hace |
|---|---|
| `backend` | `tsc --noEmit`, `eslint`, `vitest run` (incluye los vectores fijos de derivación de claves y el **test del invariante de firmante único**: ninguna transacción construida requiere más de una firma), `npm audit --audit-level=high` y revisión de licencias |
| `program` | `anchor build` y los tests de `chain-assets`, sin devnet |
| `vocab-guard` | **Guardia de vocabulario:** `grep -riE '(solana|pubkey|lamport|blockhash|base58|spl|mint)'` sobre `addon/` y `examples/chain-demo/` debe devolver vacío. Si falla, la costura está rota. También comprueba que `addon/` no tenga dependencias ni binarios |
| `godot-headless` | Ejecuta la suite del addon en modo mock, sin red, con Godot *headless* |
| `nidada-*` | Los trabajos de *Nidada* (Rust y Godot), que siguen como están. Fuera del hito |

**No entran en la CI** los tests que tocan devnet. Éstos dependen de una red externa y de un faucet con límite: van en un script manual,
`npm run test:devnet`, y su ejecución se documenta con capturas o firmas de transacción en la
memoria.

---

## 10. Riesgos y planes B, con disparador explícito

Un plan B sin disparador es una excusa. Cada uno tiene condición de activación y fecha límite.

| Riesgo | Disparador | Plan B |
|---|---|---|
| Crear por CPI un mint PDA con metadatos cuesta más de lo previsto o no cabe en una transacción | 3 h dentro de OC1 sin un mint PDA con metadatos en devnet | Que el mint tenga clave propia y `create_item` exija su firma como excepción **documentada** al invariante 1, o reducir los límites de `qualities` sin tocar el contrato salvo decisión explícita. **Decidir antes de acabar OC1, nunca después** |
| El entorno de Anchor no funciona en la máquina de desarrollo (Windows, disco casi lleno) | 1 h dentro de OC1 sin `anchor build` | Compilar en WSL con espacio liberado, o en la CI con el trabajo `program` |
| El cliente generado del IDL sobre `@solana/kit` cuesta más de lo previsto | 2 h dentro del bloque 3 sin llamar al programa desde el backend | Cambiar a `@solana/web3.js@1` + `@coral-xyz/anchor`, que tienen más material publicado. **Decidir antes de acabar el bloque 3, nunca después** |
| El faucet de devnet se agota | Dos peticiones de airdrop rechazadas seguidas | Validador local (`solana-test-validator`) con `--clone` del programa Token-2022 para desarrollo; devnet sólo para la demo final |
| El vídeo o la memoria se comen el desarrollo | 26 de noviembre sin hito completo | Recortar las pantallas del dashboard (8.1) y grabar el vídeo con lo que funcione. El vídeo no se retrasa |

---

## 11. Fuera de alcance

No implementar, no diseñar, no dejar hooks especulativos:

- Mainnet
- Staking, marketplace, multi-chain, Unity
- NFTs comprimidos y activos no fungibles de cualquier tipo
- Metaplex, en cualquiera de sus programas
- Lógica de juego on-chain, saldos propios en el programa, y cualquier instrucción de `chain-assets` que no
  esté en 4.7
- Gestión de identidad o login
- Salida de activos a wallets del jugador (`claim`)
- Operaciones en lote
- Atributos por jugador
- Multi-tenant: un despliegue del backend sirve a **un** juego. El servicio es **autoalojado**: cada
  estudio despliega el suyo (ver 1). Un servicio alojado que sirva a varios estudios exigiría
  credenciales por estudio, aislamiento de datos, custodia de varias semillas y facturación
- Alta disponibilidad, réplicas, métricas
- En el dashboard: importar un catálogo y editar tipos (8.1)
- Android e iOS: la arquitectura no lo impide, pero no se compilan, no se prueban y no se prometen
- Publicación en tiendas de aplicaciones
- Código nativo en el addon. *Nidada* tiene el suyo, aparte

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
9. **Recortes por calendario (8.1).** El cliente sondea a intervalo fijo, sin backoff; el mock no prueba
   la rama de reversión; y el dashboard no entrega, ni transfiere, ni edita. El hito se ha probado sólo en
   escritorio.
10. **El `call_id` es responsabilidad del juego.** `Chain` no puede saber si dos llamadas iguales son
    la misma acción reintentada o dos acciones distintas. Si el juego reutiliza un `call_id` para una
    acción nueva, ésta no se ejecuta y devuelve el resultado de la anterior, sin aviso, porque las
    claves no caducan. Si genera uno nuevo en cada reintento de la misma acción, ésta se ejecuta dos
    veces. `Chain` no lo detecta; lo evita el servidor de juego guardando el `call_id` antes de
    llamar.
11. **El servicio es autoalojado: el estudio opera y custodia.** Cada estudio despliega su backend,
    guarda su semilla maestra (limitación 2), financia la autoridad de su juego y hace sus copias
    de seguridad de SQLite. Quien pierda el fichero de la semilla o la base de datos pierde el acceso
    a sus activos. El proyecto documenta cómo, pero no lo opera ni lo respalda.
12. **Editar un tipo cambia todas sus unidades a la vez.** Las unidades no guardan datos propios, así que
    una edición en el sitio (contrato 4.6) alcanza a todo lo ya repartido y no deja rastro de los
    valores anteriores en el tipo. Quien necesite conservar lo antiguo debe crear un tipo nuevo. Y como
    el `symbol` no se edita, un error en el símbolo exige también un tipo nuevo.
13. **`chain-assets` no está auditado.** Tiene poder sobre todos los activos de cada juego. Es apto para
    devnet, que es el alcance de este proyecto; no para mainnet sin una auditoría.
14. **Quien tenga la autoridad de actualización del programa controla todos los juegos.** Puede cambiar
    el código y, con él, mover cualquier activo. En devnet se conserva para poder corregir errores; un
    despliegue real tendría que congelarla o que cada estudio desplegara su propio programa.

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

**Ya verificado el 11 de octubre de 2026, para la edición de un tipo en el sitio** (documentación oficial de
Solana sobre la extensión de metadatos y el código de la interfaz `token-metadata`):

5. **Qué instrucciones hay.** `UpdateField` **añade o actualiza** un campo base (`name`, `symbol`, `uri`) o
   una clave propia. `RemoveKey` **elimina una clave propia**, nunca un campo base. Ambas las firma la
   **autoridad de actualización** de los metadatos, no la de acuñación: hay que fijarla en
   `InitializeTokenMetadata` y apuntarla a la autoridad del juego. Si se dejara sin autoridad, el tipo
   sería inmutable para siempre. Con una sola firma (la autoridad, que además paga) se respeta el
   invariante 1.
6. **Edición de `qualities` como conjunto completo.** Se traduce en un `UpdateField` por cada clave nueva o
   cambiada y un `RemoveKey` por cada clave que falta. Sólo se envían las que cambian. `RemoveKey` lleva
   una marca `idempotent`: con `true`, no falla si la clave ya no existe; con `false`, falla. Conviene
   `true` para que reaplicar una edición no rompa. La clave reservada `collection` nunca se toca.
7. **Tamaño y renta.** Ambas instrucciones redimensionan los metadatos y **ninguna transfiere lamports**:
   si crecen, hay que enviarlos **antes** y en la misma transacción. Se calculan sobre el tamaño final
   tras todas las instrucciones. Si encogen, los lamports sobrantes se quedan en el mint; no hay
   reembolso. La documentación no da una fórmula cerrada de tamaño: se calcula con las utilidades del SDK
   de metadatos, que es justo el detalle que no se reconstruye de memoria (CLAUDE.md, sección 4).
8. **Límite de tamaño de la transacción (cálculo propio, no de la documentación).** Una transacción de
   Solana admite unos 1.232 bytes. Ocho pares con clave de 32 y valor de 64 caracteres, todos cambiados
   a la vez, sumarían alrededor de 960 bytes sólo de datos de instrucción, más firma, claves de cuenta y
   *blockhash*, y rozarían o superarían ese límite. Con valores normales y editando sólo lo que cambia,
   sobra margen. El backend debe **rechazar** una edición que no quepa, no partirla en varias
   transacciones, para que una edición siga siendo una operación atómica. **Por comprobar con una
   transacción real** antes de fijar el límite.

**Ya verificado el 6-8 de octubre de 2026, para *Nidada*** (no afecta al PFM desde el 5 de noviembre)**:**

- El crate `godot` más reciente es la 0.5.5 (9 de agosto de 2026), MSRV Rust 1.94. Su característica de
  API **`api-4-7` existe y compila** (comprobado el 7 de octubre).
- Regla de compatibilidad de GDExtension: carga en cualquier Godot cuya versión sea ≥ la de la API
  compilada. Una GDExtension compilada con `api-4-7` carga en Godot 4.7.1 de escritorio (comprobado).
- Lo que fija Godot 4.7.1 para Android (leído de su `config.gradle`): NDK `29.0.14206865`, Java 17,
  `minSdk` 24 y `targetSdk` 36. Con la plantilla precompilada (`android_debug.apk`) el NDK sólo hace
  falta para enlazar la parte de Rust.
- **16 KB de páginas** (requisito de Google Play desde Android 15): con NDK r29 es el comportamiento por
  defecto, y la `libnidada_ext.so` compilada para `aarch64-linux-android` tiene los segmentos `LOAD`
  alineados a `0x4000` (comprobado leyendo las cabeceras del ELF).
- **No verificado:** que una GDExtension carga y funciona **en un teléfono real**. El APK generado hasta
  ahora no se ha instalado en ningún dispositivo.

**Ya verificado el 4 de noviembre de 2026:**

- Godot: la última estable es la 4.7.2-stable, publicada el 18 de agosto. `nidada-ext` compilada con
  `api-4-7` carga en ella en Windows. Sustituye al punto 1.
- `SystemInstruction::CreateAccount` declara como `SIGNER` tanto la cuenta pagadora como **la cuenta
  nueva** (documentación de `solana-system-interface`). Es el motivo de la corrección de 4.2.
- `anchor-lang`: la última estable es la 1.2.2. Hay una 2.0.0-rc.2, que no se usa (crates.io).
- Anchor admite extensiones de Token-2022 con restricciones `extensions::metadata_pointer::…` y
  `extensions::permanent_delegate::…`, y `token_metadata_initialize` por CPI. Los ejemplos oficiales de
  `solana-developers/program-examples` pagan aparte la renta de los metadatos con una transferencia.
  Advertencia de la documentación de Anchor: no todas las instrucciones de extensión están implementadas, y
  algunas pueden exigir CPI a mano. Esos ejemplos usan un mint con clave propia, **no una PDA**.

**Pendiente de verificar, contra devnet y contra documentación vigente:**

5. Cifras reales de renta de un mint de Token-2022 con `MetadataPointer` + `TokenMetadata` +
   `PermanentDelegate`, y de una cuenta de token asociada. **No uses cifras de memoria.**
6. Si el `PermanentDelegate` puede reasignarse tras la creación del mint. Ya no condiciona la rotación
   (4.3), porque el delegado es una PDA que no cambia. Sólo es curiosidad; no bloquea nada.
7. Versiones exactas de `@solana/kit` y `@solana-program/token-2022`, y si el API de cliente por
   plugins ha cambiado respecto a los ejemplos que encuentres.
8. Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas
   actuales de Google Play y App Store.
9. **Que un mint PDA con estas extensiones se puede crear por CPI**, con una sola firma en la
   transacción. Es lo que sostiene 4.2 y 4.7: primera prueba de OC1, contra devnet.
10. **Que `create_item` más `grant` caben en una transacción** con el máximo del contrato (8 pares de 32 y
    64 caracteres), en tamaño y en unidades de cómputo. Ver el punto 8 de arriba. Si no caben, el
    backend rechaza o limita; no parte la operación sin una decisión explícita.
11. Qué versión de la toolchain de Solana pide Anchor 1.2.2, y cuánto ocupa: el disco de desarrollo
    está casi lleno.
12. Qué herramienta genera hoy un cliente sobre `@solana/kit` a partir de un IDL de Anchor 1.x, y qué
    arnés de tests del programa conviene usar sin devnet.

---

## 14. Preguntas para el tutor, que no debes responder tú

La lista viva, con lo que ya han resuelto las instrucciones de entrega, está en
`docs/seguimiento/preguntas-tutor.md`. Siguen abiertas:

- **Q4:** si hay memoria escrita o defensa, además del vídeo.
- **Q11:** si los avances intermedios son obligatorios. La entrega final es el 30 de noviembre.

---

## 15. Cómo trabajar con Claude Code en este proyecto

Con tan pocas horas, la disciplina de sesión importa tanto como el código.

- **`CLAUDE.md` en la raíz desde el primer commit**, con los invariantes en imperativo: firmante
  único, marcar antes de llamar, cero vocabulario de cadena en `addon/`, nada fuera de la sección 7.
  Es lo que evita que el alcance se expanda solo.
- **Una sesión por bloque de la sección 8** (los bloques 1 a 5, OC1 y OC2, y las fases A1, A2 y A5). Empezar la sesión pegando el bloque correspondiente.
  Terminarla con CI en verde y commit. No arrastrar trabajo entre bloques.
- **Antes de tocar Token-2022, obliga a leer la documentación oficial vigente.** El orden de
  inicialización de extensiones y el cálculo de espacio con TLV son exactamente el tipo de detalle
  que un modelo reconstruye de memoria y se inventa a medias. Que lo lea, no que lo recuerde.
- **Tests antes que implementación en dos sitios concretos:** los vectores de derivación de claves
  (bloque 2) y el invariante de firmante único (bloque 3). En el resto, tests después.
- **La sección 11 es un contrato.** Si Claude Code propone «ya que estamos, añadimos un endpoint
  para…», la respuesta es no. Ese impulso es lo que convierte 44 horas en 100.
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
