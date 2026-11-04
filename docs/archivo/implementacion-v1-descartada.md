# Librería de activos on-chain para Godot — Documento de implementación (v1)

> Este documento es el brief de partida para Claude Code. Describe **qué** hay que
> construir y **con qué restricciones**. Antes de escribir código, lee la sección
> "Decisiones bloqueantes" y resuélvela con el responsable del proyecto.

---

## 1. Resumen del proyecto

Librería que permite a un desarrollador de videojuegos en **Godot 4** crear y
transferir activos digitales en **Solana**, sin que tenga que escribir Solidity/Rust
on-chain, sin desplegar programas propios, y sin que el jugador final sepa que hay
una blockchain debajo.

**Premisas de diseño que no se negocian:**

1. El jugador no percibe la blockchain. Nada de seed phrases, gas ni wallets visibles.
2. La librería **no gestiona identidad**. Recibe capacidad de firma desde fuera.
3. **No se despliega ningún programa propio en v1.** Solo se usan programas ya
   desplegados y auditados (Metaplex Token Metadata, SPL Token / Token-2022).
4. El núcleo Rust es **sans-io**: no abre sockets, no usa `tokio`, no hace HTTP.
5. El valor del producto está en ocultar fricción, no en inventar protocolo.

---

## 2. Decisiones bloqueantes (resolver ANTES de codificar)

### 2.1 Contradicción: "PDA de estado" sin programa propio

El brief pide **SPL Token + Token Metadata con URI en Arweave/IPFS, más un PDA de
estado para los atributos certificables que cambian**, y simultáneamente **ningún
programa Anchor propio en v1**.

Esto no es realizable tal cual: **un PDA pertenece siempre a un programa concreto**
(se deriva de un `program_id`). Sin programa propio no existe ninguna instrucción
capaz de escribir estado arbitrario en un PDA bajo tu control.

Opciones reales para v1, en orden de recomendación:

| Opción | Atributos mutables on-chain | Programa propio | Coste |
|---|---|---|---|
| **A. Token-2022 + extensión `TokenMetadata` (`additional_metadata`)** | Sí, pares clave-valor actualizables por la update authority | No | Renta de cuenta, se amplía al añadir campos |
| **B. Solo Token Metadata con URI mutable** | No (los atributos viven off-chain, se actualiza el URI) | No | Mínimo |
| **C. PDA de estado propio** | Sí, esquema libre | **Sí (rompe la premisa 3)** | Programa + auditoría |

**Recomendación: opción A para v1**, tratando `additional_metadata` como el
sustituto directo del "PDA de estado" descrito en el brief, y dejando la opción C
explícitamente para v2. La opción A es la única que cumple *a la vez* "fungible",
"atributos certificables on-chain" y "sin programa propio".

> **Acción para Claude Code:** no elijas por tu cuenta. Pregunta y espera respuesta.
> Si se confirma la opción A, todo el resto del documento aplica sin cambios; el
> término "PDA de estado" debe leerse como "campos `additional_metadata` de Token-2022".

### 2.2 Aclaración menor: "programa actualizable"

El brief dice "el programa será actualizable, ya que es un servicio". Dado que en v1
no hay programa on-chain propio, esto se interpreta como: **el backend y la librería
son actualizables**, y la puerta a un programa propio actualizable queda abierta para
v2. No implementar nada on-chain por este punto.

---

## 3. Arquitectura

### 3.1 Recorrido de una transacción (autoritativo)

```
Fase 1 — Godot inicia
    El juego llama a la API de la librería (p. ej. mint_item()).
    El cliente GDExtension envía una petición HTTP al backend
    usando el nodo HTTPRequest de Godot. Devuelve un handle
    RefCounted inmediatamente.

Fase 2 — Backend recibe
    Valida la petición, resuelve la colección y la authority,
    y crea un registro de operación con un id.

Fase 3 — Backend construye y firma
    Usa el crate núcleo (sans-io) para construir la transacción.
    Firma con el Signer correspondiente (fee payer + authority).
    Envía la transacción al RPC de Solana.
    Responde a Godot con el id de operación y la firma de la tx.

Fase 4 — Godot pregunta
    El handle hace polling al backend por el estado de la operación,
    de nuevo vía HTTPRequest. Sin hilos, sin tokio, sin callbacks FFI.

Fase 5 — Backend observa la cadena
    El backend consulta el estado de confirmación de la transacción
    y expone: applied / settled / failed / expired.

Fase 6 — Godot resuelve
    El handle emite la señal correspondiente y queda resuelto.
```

**Consecuencia clave:** el núcleo Rust se ejecuta **en el backend**, no en el cliente.
El GDExtension del lado Godot es un cliente HTTP tipado con handles awaitables. Las
claves privadas nunca salen del backend, y por tanto **nunca están en el APK/binario
del juego**.

### 3.2 Estructura de crates

```
workspace/
├── crates/
│   ├── core/              # ABIERTO. sans-io. Sin tokio, sin reqwest.
│   │   ├── Construcción de instrucciones (SPL Token, Token Metadata, Token-2022)
│   │   ├── Serialización de transacciones a bytes/base64
│   │   ├── Trait Signer (async)
│   │   ├── SigningContext (fee payer + authority)
│   │   └── Tipos de dominio propios (Coleccion, Objeto, Cualidad)
│   │
│   ├── godot-client/      # ABIERTO. GDExtension (gdext) para Godot 4.
│   │   ├── Singleton de configuración
│   │   ├── Handles RefCounted awaitables con señales
│   │   └── HTTP delegado a HTTPRequest de Godot
│   │
│   ├── dev-backend/       # ABIERTO. Backend mínimo para desarrollo local.
│   │   └── Levanta la API contra devnet, con airdrop
│   │
│   └── mock-backend/      # ABIERTO. En memoria, determinista, para tests.
│
└── backend/               # CERRADO. Producto comercial. Repo separado.
```

**Licencias:** `core`, `godot-client`, `dev-backend` y `mock-backend` son abiertos.
El `backend` de producción es cerrado y vive en otro repositorio.

### 3.3 Dependencias

- Usar los crates `solana-*` **granulares** (`solana-pubkey`, `solana-keypair`, `solana-signer`, `solana-signature`, `solana-instruction`, `solana-message`, `solana-transaction`, `solana-hash`, más `spl-token-interface` / `spl-token-2022-interface` / `spl-token-metadata-interface`, etc.), nunca el metacrate completo. Objetivo: minimizar
  el árbol de dependencias y evitar que `tokio` entre por la puerta de atrás.
- Siempre los crates -interface, nunca los de programa, porque estos últimos declaran un target cdylib y arrastran más dependencias
- `gdext` (godot-rust) para el binding de Godot 4.
- **Prohibido en `core`:** `tokio`, `reqwest`, cualquier cliente HTTP, cualquier
  runtime async. Si aparece en `cargo tree`, es un bug.

---

## 4. Modelo de dominio

### 4.1 Conceptos

- **Colección**: agrupación de objetos que pertenece a un juego. Tiene una
  *authority* resoluble (ver 5.2).
- **Objeto**: activo fungible (supply ≥ 1, 0 decimales). Muchos jugadores pueden
  poseer copias del mismo objeto.
- **Cualidad**: par clave-valor. Dos categorías:
  - *Descriptivas* → viven en el JSON off-chain (Arweave/IPFS) referenciado por URI.
  - *Certificables* → viven on-chain y son mutables por la authority
    (pendiente de 2.1: `additional_metadata` de Token-2022).
  - *Fungible, cualidades por tipo* → Iguales para todos los poseedores. 
### 4.2 Estándar

- **SPL Token / Token-2022**, no comprimido, fungible.
- **Metaplex Token Metadata** para nombre, símbolo y URI.
- Metadata off-chain siguiendo el esquema JSON de Metaplex: los únicos campos
  obligatorios de un atributo son `trait_type` y `value`.

---

## 5. Contratos de código

### 5.1 Trait `Signer`

Async desde el primer commit. No negociable: cambiarlo después rompe a todos los
usuarios cuando llegue el primer firmante MPC o hardware.

```rust
#[async_trait]
pub trait Signer: Send + Sync {
    fn pubkey(&self) -> Pubkey;
    async fn sign_message(&self, msg: &[u8]) -> Result<Signature, SignerError>;
}
```

- Devuelve **firma**, nunca la transacción completa.
- `Send + Sync` obligatorio.
- El `core` no sabe ni le importa cómo se firma.

### 5.2 `SigningContext`

Dos roles separados desde el día uno, aunque hoy apunten al mismo keypair:

```rust
pub struct SigningContext {
    pub fee_payer: Arc<dyn Signer>,
    pub authority: Arc<dyn Signer>,
}
```

- La `authority` debe ser **resoluble por colección** (una colección puede tener su
  propia authority distinta del fee payer global).
- **Deduplicar firmantes antes de construir la transacción cuando coincidan.**
  Solana rechaza cuentas firmantes repetidas. Esto debe tener test dedicado.

### 5.3 Implementaciones de referencia

| Implementación | Feature flag | Uso |
|---|---|---|
| `LocalKeypairSigner` | `dev-signer` (**apagada por defecto**) | Desarrollo local contra devnet |
| `MockSigner` | siempre disponible en tests | Determinista, para tests del juego |

`dev-backend` debe levantar la API contra devnet **con airdrop incluido**, de forma
que un desarrollador pueda hacer el "hola mundo" sin configurar nada externo.

`mock-backend` debe permitir que los tests del juego pasen **sin que devnet esté en
pie**. Esto es un requisito, no un extra.

---

## 6. API del lado Godot

### 6.1 Formas expuestas

1. **Configuración** — recurso configurable (endpoint del backend, red, timeouts).
2. **Singleton de motor** — punto de entrada global para las operaciones.
3. **Handle `RefCounted` awaitable** — devuelto por cada operación.

### 6.2 Señales del handle

| Señal | Significado | Uso recomendado |
|---|---|---|
| `applied` | La transacción ha sido confirmada (rápido) | **Anima aquí.** Feedback inmediato al jugador |
| `settled` | La transacción es final e irreversible | **Compromete aquí.** Persistir el cambio de estado |
| `failed` | La transacción falló en cadena | Revertir la animación optimista |
| `expired` | El blockhash caducó sin confirmación | Reintentar o avisar |

La distinción `applied` / `settled` es la traducción de los niveles de confirmación
de Solana a algo que un desarrollador de juegos pueda usar sin saber qué es un
commitment level. **No expongas `processed`/`confirmed`/`finalized` en la API pública.**

### 6.3 Ejemplo de uso objetivo (GDScript)

```gdscript
var handle = Chain.mint_item(coleccion_id, {
    "nombre": "Espada de Fuego",
    "cualidades": { "daño": "45", "elemento": "fuego" }
}, destinatario)

handle.applied.connect(_on_applied)   # animar
handle.settled.connect(_on_settled)   # comprometer
handle.failed.connect(_on_failed)

# o bien:
await handle.settled
```

La API pública usa **tipos propios**, nunca tipos de Metaplex ni de `solana-sdk`.
Esto es lo que permite cambiar el motor de abajo (opción A → opción C) sin romper
a nadie.

---

## 7. Hito mínimo demostrable (definición de "terminado" para v1)

> En devnet, desde Godot: crear una colección, mintear un objeto con cualidades,
> y transferirlo entre dos cuentas.

Nada más entra en v1 hasta que esto funcione de extremo a extremo con `dev-backend`.

---

## 8. Fuera de alcance en v1

No implementar, no diseñar, no dejar hooks especulativos para:

- Staking
- Transacciones gasless / patrocinio de fees
- Unity
- Multi-chain (solo Solana)
- Marketplace
- NFTs comprimidos (cNFTs / Bubblegum)
- Lógica de juego on-chain (cría, combinación, reglas de transferencia)
- Gestión de identidad / login (la librería recibe capacidad de firma, no la crea)

---

## 9. CI

**Validar los cinco targets de escritorio desde el primer commit.** No dejarlo para
después: un fallo de compilación cruzada descubierto tarde puede obligar a cambiar
dependencias del núcleo.

- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`

Comprobaciones adicionales obligatorias en CI:

- `cargo tree` de `core` no contiene `tokio` ni ningún cliente HTTP.
- Test de deduplicación de firmantes coincidentes.
- Suite del `mock-backend` corriendo sin acceso a red.

---

## 10. Aviso de compatibilidad con Steam (obligatorio en el README)

Steam prohíbe explícitamente los juegos que usen esta tecnología. El README debe
incluir un aviso destacado, en la parte superior, antes de cualquier instrucción de
instalación.

Norma de Steam (regla de onboarding nº 13), texto literal:

> "Applications built on blockchain technology that issue or allow exchange of
> cryptocurrencies or NFTs."

Redacción del aviso:

```
⚠️ INCOMPATIBLE CON STEAM

Steam prohíbe la publicación de juegos construidos sobre tecnología blockchain
que emitan o permitan el intercambio de criptomonedas o NFTs (regla de onboarding
nº 13). Un juego que use esta librería NO puede publicarse en Steam.

Google Play y la App Store sí lo permiten, con restricciones significativas.
Verifica la política vigente de cada plataforma antes de comprometerte.
```

> **Acción para Claude Code:** verifica el texto literal actual en la documentación
> de onboarding de Steam antes de escribirlo en el README. La redacción puede haber
> cambiado desde la última comprobación.

---

## 11. Orden de trabajo sugerido

1. Resolver la decisión bloqueante 2.1. **No avanzar sin respuesta.**
2. Esqueleto del workspace + CI con los cinco targets, en verde y vacío.
3. `core`: trait `Signer`, `SigningContext`, deduplicación de firmantes, tipos de
   dominio. Con tests unitarios y `MockSigner`.
4. `core`: construcción y serialización de las tres operaciones del hito
   (crear colección, mintear, transferir).
5. `dev-backend`: API HTTP mínima contra devnet, con airdrop.
6. `godot-client`: configuración, singleton, handle `RefCounted` con las cuatro
   señales, HTTP vía `HTTPRequest`.
7. Proyecto Godot de ejemplo que ejecute el hito de la sección 7.
8. `mock-backend` y suite de tests sin red.
9. README con el aviso de Steam y el "hola mundo".

---

## 12. Notas de criterio para quien implemente

- Ante la duda entre "hacerlo genérico ahora" y "hacerlo simple ahora", **simple**.
  La única excepción es el trait `Signer` y la separación fee payer/authority, que
  sí deben nacer con su forma final.
- Cualquier detalle técnico de Solana que se filtre a la API pública de Godot es un
  fallo de diseño: commitment levels, `Pubkey` crudos, blockhashes, cuentas.
- Si una decisión no está en este documento y afecta a la API pública, **pregunta**
  en vez de asumir.