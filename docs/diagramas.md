# Diagramas

Arquitectura y flujo de datos de `godot-chain`, en Mermaid. Describen lo que hay en el código, no lo
previsto: lo recortado (propuesta, 8.1) no aparece. La especificación es
`docs/especificacion/propuesta-pfm.md`, y el contrato, `docs/especificacion/http-contract.md`.

1. [Arquitectura: piezas y credenciales](#1-arquitectura-piezas-y-credenciales)
2. [Flujo de datos: una transferencia](#2-flujo-de-datos-una-transferencia)
3. [Flujo de datos: el estudio crea un tipo](#3-flujo-de-datos-el-estudio-crea-un-tipo)
4. [Flujo de datos: leer un inventario](#4-flujo-de-datos-leer-un-inventario)
5. [Estados de una operación](#5-estados-de-una-operación)
6. [Cuentas en la cadena](#6-cuentas-en-la-cadena)
7. [Quién firma como autoridad](#7-quién-firma-como-autoridad)

---

## 1. Arquitectura: piezas y credenciales

Cada flecha lleva la credencial con la que se llama. El juego sólo tiene el `read_token`, que va en
su binario y es público de facto (limitación 5). La `write_key` está en el servidor de juego, y la
clave de administración, en el navegador del estudio. La autoridad del juego no sale del backend, o de
OpenBao si se usa.

```mermaid
flowchart TB
    subgraph jugador["Dispositivo del jugador"]
        godot["Juego Godot 4<br/>+ addon godot-chain<br/>(GDScript puro)"]
    end

    subgraph estudio["Infraestructura del estudio"]
        gs["Servidor de juego<br/>examples/game-server<br/>Fastify + SQLite (actions)"]
        nav["Navegador del estudio<br/>consola /admin"]
        subgraph be["chain-backend · TypeScript + SQLite"]
            api["API HTTP /v1<br/>(contrato congelado)"]
            admin["Rutas /admin<br/>(frontend/ sin compilación)"]
            core["Idempotencia · máquina de estados<br/>constructores de transacciones<br/>derivación de claves"]
            tracker["Bucle de seguimiento<br/>(tracker.ts, cada 2 s)"]
            db[("SQLite<br/>collections · items · holders<br/>operations · idempotency")]
        end
        bao["OpenBao Transit<br/>(opcional)"]
    end

    subgraph solana["Solana devnet"]
        prog["chain-assets<br/>(Anchor)"]
        t22["Token-2022"]
    end

    godot -- "Pide transferir objetos<br/>escrituras: Idempotency-Key, sin credencial" --> gs
    gs -- "Autoriza, decide quién da y reenvía<br/>Bearer write_key + from" --> api
    godot -- "Lee inventarios y pregunta<br/>por sus operaciones<br/>lecturas y sondeo: Bearer read_token" --> api
    nav -- "El estudio crea el catálogo y audita<br/>cookie de sesión (CHAIN_ADMIN_KEY)" --> admin
    api -- "Las dos entradas usan<br/>las mismas funciones" --> core
    admin --> core
    core -- "Apunta claves, operaciones,<br/>tipos y jugadores" --> db
    tracker -- "Actualiza el estado<br/>de cada operación" --> db
    core -. "Pide cada firma de la autoridad<br/>sin que la clave salga de OpenBao" .-> bao
    core -- "Ensaya y envía las transacciones<br/>simula y envía (RPC)" --> prog
    tracker -- "Vigila lo enviado hasta que es definitivo<br/>estados de firmas, altura finalizada" --> prog
    prog -- "Crea, emite y mueve los objetos<br/>CPI con la PDA Game" --> t22
```

**Por qué las escrituras no van directas.** Una credencial dentro del binario del juego se extrae con
herramientas triviales, y quien decide que un jugador se ha ganado algo debe ser un servidor, no el
cliente que el jugador controla. Por eso el servidor de juego no es decorado: sin él, la arquitectura
sería insegura (propuesta, 3).

**Por qué la consola no usa la API.** Llama a las funciones del backend por dentro: ni la `write_key`
ni el `read_token` pasan por el navegador.

---

## 2. Flujo de datos: una transferencia

Es el camino del hito (propuesta, 7): el jugador A da una unidad a B desde la demo. Se ven los dos
invariantes de idempotencia: **marcar primero, llamar después**, en el servidor de juego y en el
backend, y **simular antes de reclamar la clave**, para no guardar una clave cuya operación no puede
ejecutarse.

```mermaid
sequenceDiagram
    autonumber
    participant G as Juego (addon)
    participant S as Servidor de juego
    participant B as chain-backend
    participant DB as SQLite del backend
    participant C as Solana devnet

    Note over G,C: Fase 1 · El juego pide la transferencia al servidor de juego
    G->>S: Pide dar unidades de un tipo a otro jugador<br/>POST /v1/items/{itm_}/transfer { amount, to }<br/>Idempotency-Key = SHA-256("transfer:call_id")
    Note over S: Rechaza un "from" del juego.<br/>El emisor lo pone el servidor.
    S->>S: Apunta la petición antes de llamar a nadie<br/>INSERT en actions (por la clave)
    S->>B: Reenvía el encargo con su credencial<br/>mismo cuerpo + from, Bearer write_key,<br/>la misma Idempotency-Key

    Note over G,C: Fase 2 · El backend prepara, ensaya y envía
    B->>DB: Comprueba si esa clave ya se tramitó<br/>¿clave ya aceptada?
    alt Reintento de una clave aceptada
        DB-->>B: Recupera la respuesta de entonces<br/>respuesta guardada
        B-->>S: Devuelve lo mismo, sin repetir nada<br/>202 con el mismo operation_id
    else Clave nueva
        B->>B: Identifica a emisor y receptor<br/>resuelve tenedores (hld_) y deriva sus direcciones
        B->>C: Mira si el emisor tiene unidades<br/>lee saldo del emisor (comprobación optimista)
        B->>B: Prepara la transferencia y la firma<br/>construye transfer y la firma la autoridad
        B->>C: Ensaya la transacción<br/>simula la transacción
        alt El ensayo falla
            B-->>S: Responde con un error y NO guarda la clave<br/>409 INSUFFICIENT_BALANCE o 503 INSUFFICIENT_FUNDS
        else El ensayo pasa
            B->>DB: Guarda clave, operación y firma ANTES de enviar<br/>claim: clave + operación pending<br/>+ firma y last_valid_block_height
            B->>C: Envía la transacción<br/>envía (skipPreflight)
            B-->>S: Acepta la petición, todavía en curso<br/>202 { operation_id: opr_ }
        end
    end
    S->>S: Apunta la respuesta junto a la petición<br/>guarda la respuesta en actions
    S-->>G: Se la pasa al juego tal cual<br/>la misma respuesta
    Note over G: ChainHandle.state = pending

    Note over G,C: Fase 3 · El juego espera a que sea definitiva
    loop Cada poll_interval, hasta settled, failed o operation_timeout
        G->>B: Pregunta cómo va su operación<br/>GET /v1/operations/{opr_}, Bearer read_token
        B-->>G: Devuelve su estado<br/>{ state }
    end

    par Bucle de seguimiento del backend, cada 2 s
        B->>C: Pregunta qué ha pasado con lo enviado<br/>altura finalizada y estados de las firmas abiertas
        C-->>B: La red la ha aceptado<br/>confirmed
        B->>DB: Marca la operación como aceptada<br/>pending → applied
        C-->>B: Ya es irreversible<br/>finalized
        B->>DB: Marca la operación como definitiva<br/>applied → settled
    end
    Note over G: señal applied: sólo cosmético<br/>señal settled: aquí se guarda estado
```

---

## 3. Flujo de datos: el estudio crea un tipo

El catálogo lo crea el estudio en `/admin`; el servidor de juego responde `403` si el juego lo
intenta. Un tipo se crea con su entrega inicial a un jugador. Si sus campos no caben con el `grant` en
una sola transacción (V10, V13), el backend la **parte** en dos pasos: el segundo sale de
`operations.payload` cuando el primero está finalizado (P11).

```mermaid
sequenceDiagram
    autonumber
    participant N as Consola /admin
    participant B as chain-backend
    participant DB as SQLite del backend
    participant C as Solana devnet

    Note over N,C: Fase 1 · Crear la colección (sólo en SQLite)
    N->>B: Pide crear la colección «Arsenal»<br/>POST /admin/api/collections { name }<br/>cookie de sesión + Idempotency-Key
    B->>DB: Comprueba si esa clave ya se tramitó<br/>(si es así, devuelve la misma respuesta)
    B->>DB: Genera un col_ nuevo y guarda la colección<br/>(una colección no existe en la cadena)
    B-->>N: Devuelve el id de la colección<br/>201 { collection_id }

    Note over N,C: Fase 2 · Crear el tipo y entregar sus unidades iniciales
    N->>B: Pide crear el tipo dentro de la colección<br/>POST /admin/api/items { collection_id, name, symbol, uri,<br/>qualities, initial_grant: { holder, amount } } + Idempotency-Key
    B->>DB: Comprueba si esa clave ya se tramitó
    B->>DB: Comprueba que la colección existe (si no, 404)<br/>y registra al jugador que recibe la entrega
    B->>B: Calcula las direcciones del tipo<br/>item_id (itm_), item_seed y el mint (PDA)
    B->>B: Mide si todo cabe en una transacción<br/>(planItemCreation)
    alt Cabe
        B->>B: Prepara crear y entregar juntos<br/>create_item + grant, y lo firma la autoridad
    else No cabe: tipo partido
        B->>B: Prepara sólo la creación (create_item)<br/>y deja la entrega (grant) apuntada en payload
    end
    B->>C: Ensaya la transacción<br/>simula
    alt El ensayo falla
        B-->>N: Responde con un error claro (por ejemplo, 503 si<br/>la autoridad no tiene saldo para pagar) y NO guarda la clave
    else El ensayo pasa
        B->>DB: Guarda la clave, la operación en pending<br/>y la firma del paso 1<br/>claim: pending, step 1, firma
        B->>C: Envía la transacción
        B-->>N: Acepta la petición, todavía en curso<br/>202 { item_id, operation_id }
    end

    Note over N,C: Fase 3 · Seguimiento hasta que es definitiva
    loop Cada 2 s, mientras la operación siga abierta
        B->>C: Pregunta cómo va la transacción<br/>estado de la firma
        alt Tipo partido y la creación ya es definitiva
            B->>B: Prepara la entrega apuntada en payload<br/>(grant) y la firma la autoridad
            B->>C: La ensaya<br/>simula
            B->>DB: Guarda la firma del paso 2 ANTES de enviarla<br/>step 2 y su firma
            B->>C: Envía la entrega<br/>envía el paso 2
        end
        B->>DB: Actualiza el estado<br/>applied, settled o failed (EXPIRED)
    end

    Note over N,C: Fase 4 · El estudio lo comprueba
    N->>B: Pide la lista de operaciones<br/>GET /admin/api/operations
    B-->>N: Estado y firma de cada una,<br/>con enlace a su transacción en el explorador
```

---

## 4. Flujo de datos: leer un inventario

El juego conoce a su jugador por su propio identificador (`player-a`), no por una dirección. El addon
lo traduce a `holder_id` y lee. Los saldos se leen de la cadena, con compromiso `finalized`, no de
SQLite: SQLite sólo da el `item_id`, el nombre y las cualidades de los tipos, y sólo de los que están en
`settled`.

```mermaid
sequenceDiagram
    autonumber
    participant G as Juego (addon)
    participant B as chain-backend
    participant DB as SQLite del backend
    participant C as Solana devnet

    Note over G,C: Fase 1 · Traducir el jugador del juego a su tenedor
    G->>B: Pregunta qué tenedor corresponde a «player-a»<br/>GET /v1/holders?external_id=player-a<br/>Bearer read_token
    B->>DB: Lo busca entre los jugadores registrados<br/>holder_id del jugador
    alt Ninguna escritura lo ha nombrado
        B-->>G: Responde que no lo conoce<br/>404 NOT_FOUND
    else Registrado
        B-->>G: Devuelve su identificador opaco<br/>{ holder_id: hld_ }

        Note over G,C: Fase 2 · Leer lo que tiene
        G->>B: Pide su inventario<br/>GET /v1/holders/{hld_}/items
        B->>C: Lee sus saldos definitivos, sólo de tipos del juego<br/>cuentas Token-2022 del tenedor (finalized)<br/>y mints cuya autoridad es la PDA Game
        B->>DB: Añade nombre y cualidades de cada tipo<br/>nombre y cualidades de los tipos en settled
        B-->>G: Devuelve la lista de objetos<br/>{ items: [{ item_id, name, qualities, amount }] }
    end
    Note over G: Chain.inventory("player-a")<br/>hace los dos pasos en un solo ChainHandle
```

Las lecturas tienen límite de tasa por IP: 120 por minuto (P14).

---

## 5. Estados de una operación

Lo que ve el juego en `ChainHandle.state`, y lo que guarda `operations.state`. **El juego sólo escribe
estado en `settled`**; `applied` sirve para animar y no garantiza nada.

```mermaid
stateDiagram-v2
    [*] --> pending: 202, firma registrada
    pending --> applied: firma confirmed<br/>(o finalized, de paso)
    applied --> settled: firma finalized
    pending --> failed: error finalizado,<br/>o EXPIRED por altura
    applied --> failed: la transacción desaparece<br/>(EXPIRED)
    settled --> [*]
    failed --> [*]

    note right of pending
        Tipo partido: sigue en pending
        hasta que finaliza el paso 2
    end note
    note right of failed
        Reintentar es decisión del servidor
        de juego, con una clave nueva
    end note
```

La caducidad se decide por la altura **finalizada**: si ya pasa del `last_valid_block_height` de la
firma y la firma no aparece, la transacción ya no puede entrar (P13). El backend no reenvía
transacciones: sólo guarda su firma.

---

## 6. Cuentas en la cadena

`chain-assets` no guarda saldos. Tiene los poderes sobre los mints Token-2022 a través de la PDA
`Game`, y los ejerce por CPI. Program ID en devnet: `4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz`.

```mermaid
flowchart LR
    auth(["Autoridad del juego<br/>única firmante y pagadora"])
    subgraph prog["chain-assets"]
        game["PDA Game<br/>semillas: game, game_id<br/>authority · game_id · bump"]
    end
    subgraph t22["Token-2022"]
        mint["Mint de un tipo (PDA)<br/>semillas: item, game, item_seed<br/>0 decimales<br/>MetadataPointer · TokenMetadata<br/>PermanentDelegate"]
        ataA["Cuenta asociada<br/>mint + tenedor A"]
        ataB["Cuenta asociada<br/>mint + tenedor B"]
    end
    holderA(["Tenedor A<br/>clave derivada, nunca firma"])
    holderB(["Tenedor B<br/>clave derivada, nunca firma"])

    auth -- "Es quien manda en el juego<br/>authority" --> game
    game -- "Tiene todos los poderes sobre el tipo<br/>autoridad de acuñación<br/>de metadatos y del puntero<br/>delegado permanente" --> mint
    mint -- "Guarda el saldo de A<br/>de ese tipo" --> ataA
    mint -- "Guarda el saldo de B<br/>de ese tipo" --> ataB
    holderA -. "Es su dueño, pero no firma<br/>dueño" .- ataA
    holderB -. "Es su dueño, pero no firma<br/>dueño" .- ataB
    game -- "Mueve las unidades sin firma de A<br/>transfer como<br/>delegado permanente" --> ataA
    ataA -- "Pasan de A a B<br/>unidades" --> ataB
```

| Instrucción | Firma | Qué hace |
|---|---|---|
| `initialize_game` | autoridad | Crea `Game` y fija la autoridad |
| `rotate_authority` | autoridad actual | Cambia la autoridad; los mints no cambian |
| `create_item` | autoridad | Crea el mint con sus extensiones y metadatos |
| `grant` | autoridad | Acuña a un tenedor y crea su cuenta si hace falta |
| `transfer` | autoridad | Mueve unidades entre tenedores; el emisor no firma |

Ningún mint tiene autoridad de congelación. Rotar la autoridad no toca los activos, porque los poderes
son de `Game`, no de la clave.

---

## 7. Quién firma como autoridad

Dos firmantes posibles, con `CHAIN_AUTHORITY_SIGNER`. En los dos casos la transacción lleva **una sola
firma** (invariante 1), y lo comprueba un test con cada uno.

```mermaid
flowchart TB
    seed[("Semilla maestra<br/>fichero, fuera del repositorio")]
    derive["Derivación con vectores fijos"]
    players["Claves de los jugadores<br/>(dueñas de sus cuentas)"]
    choice{"CHAIN_AUTHORITY_SIGNER"}
    seedAuth["Autoridad derivada<br/>de la semilla"]
    transit["OpenBao Transit<br/>clave ed25519, versión que<br/>coincide con Game.authority"]
    verify["El backend verifica la firma<br/>antes de usarla"]
    tx["Transacción con una sola firma"]

    seed -- "Es el origen de todas<br/>las claves derivadas" --> derive
    derive -- "Da una clave a cada jugador<br/>siempre la misma" --> players
    choice -- "Firma con la semilla<br/>seed (por defecto)" --> seedAuth
    derive -- "Da también la autoridad<br/>si se elige seed" --> seedAuth
    choice -- "Firma dentro de OpenBao<br/>transit" --> transit
    seedAuth -- "Firma en el propio backend" --> tx
    transit -- "Devuelve la firma, nunca la clave<br/>bytes del mensaje →<br/>firma ed25519 sin prehash" --> verify
    verify -- "Sólo si la firma es correcta" --> tx
```

Con Transit, la clave privada de la autoridad no sale nunca de OpenBao. La semilla sigue dando las
claves de los jugadores: quien la lea puede mover sus objetos, pero no crear tipos, emitir ni quedarse
con el juego (limitación 2). La rotación es `npm run rotate-authority` (V23).
