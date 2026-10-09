# Prompt: redactar el documento de implementación

## Tu tarea

Escribe el **documento de implementación v1** de la librería descrita abajo. Es un
brief que se le pasará a Claude Code para que construya el proyecto.

No escribas código. No escribas el README. Escribe el documento.

**Regla crítica:** todas las decisiones de diseño están tomadas y aparecen en este
prompt. Tu trabajo es organizarlas, desarrollarlas y hacerlas accionables — **no
reabrirlas, no proponer alternativas, no añadir "opcionalmente se podría".** Si
detectas una contradicción o un hueco real, **no lo resuelvas tú: márcalo como
pregunta explícita al responsable del proyecto** en una sección propia al final.

---

## 1. Qué es el producto

Una librería que permite a un desarrollador de videojuegos en **Godot 4** crear y
transferir activos digitales en **Solana**, sin escribir código on-chain, sin
desplegar programas propios y sin que el jugador final sepa que hay una blockchain
debajo.

**Premisas que no se negocian:**

1. El jugador no percibe la blockchain. Nada de seed phrases, gas ni wallets.
2. La librería no gestiona identidad. Recibe la identidad del jugador desde fuera.
3. No se despliega ningún programa propio. Solo programas ya desplegados y auditados.
4. El núcleo Rust es **sans-io**: no abre sockets, no usa `tokio`, no hace HTTP.
5. Ningún concepto de Solana cruza a GDScript. Si se filtra, es un fallo de diseño.

---

## 2. Arquitectura: cuatro capas

```
Dispositivo del jugador
    Juego (GDScript)  +  godot-client (GDExtension)
        │ escrituras                        │ lecturas
        ▼                                   │
Servidor del estudio                        │
    Lógica de juego  +  adaptador Node      │
        │                                   │
        ▼                                   ▼
Tu backend  (cerrado)
    core (Rust, sans-io)  +  claves en HSM
        │
        ▼
Solana
```

**Escrituras** (mintear, transferir, actualizar metadatos del tipo) van del juego al
servidor del estudio, y de ahí a tu backend. Nunca directas.

**Lecturas** (qué tiene un jugador) van directas del juego a tu backend con una
credencial de sólo lectura. No pueden causar daño y así el estudio construye menos.

**Motivo de la topología:** la credencial que autoriza operaciones no puede viajar
dentro del binario del juego, porque se extrae del APK. Y quien decide que un
jugador se ha ganado un objeto tiene que ser un servidor autoritativo, no el cliente.

**Consecuencia clave:** el núcleo Rust se ejecuta en el backend. Las claves privadas
nunca están en el binario del juego.

---

## 3. Decisiones cerradas

Reprodúcelas en el documento. No las cuestiones.

### 3.1 Cadena y activo

| Decisión | Valor |
|---|---|
| Blockchain | Solana. Única. No multi-chain, no hooks para ello |
| Programa de tokens | **Token-2022** (SPL Token Extensions) |
| Metadatos | Extensión `TokenMetadata` de Token-2022. **No se usa Metaplex** |
| Tipo de activo | **Sólo fungibles.** 0 decimales, supply ≥ 1 |
| Atributos on-chain | **Sólo por tipo**, en `additional_metadata` del mint |
| Atributos por jugador | Base de datos del estudio. **No certificados** |
| Programa propio | Ninguno |

**Por qué Token-2022 y no Metaplex:** Metaplex Token Metadata está marcado por su
propio autor como programa heredado y no recomendado para proyectos nuevos. Además,
Metaplex **prohíbe** la extensión `metadata` de Token-2022 cuando se usa su programa,
así que son mutuamente excluyentes. Token-2022 guarda nombre, símbolo, URI y pares
clave-valor en el propio mint, sin cuenta ni programa externo. Su único inconveniente
conocido —soporte desigual en carteras y exploradores— no aplica aquí, porque el
jugador nunca ve una cartera.

**Por qué sólo atributos por tipo:** fungible significa intercambiable. Si la copia de
un jugador tuviera atributos distintos a la de otro, no serían el mismo token. En
Solana los metadatos viven en el mint, que es el tipo, no el ejemplar; las extensiones
a nivel de cuenta de token controlan comportamiento y no almacenan datos arbitrarios.
Atributos divergentes por jugador exigirían un programa propio o activos no fungibles,
y ambas cosas están descartadas.

**Nota operativa que debe aparecer en el documento:** la mayoría de extensiones de
Token-2022 se activan al crear el mint y **no se pueden añadir después**. Lo que no se
decida ahora no se puede retrofitear sobre tokens ya creados. Evalúa y documenta si
conviene activar desde el principio `permanent delegate` (permite al backend corregir
errores y hacer soporte sobre cuentas de jugador) y `non-transferable` (para objetos
ligados a la cuenta).

### 3.2 Identidad y claves

| Decisión | Valor |
|---|---|
| Identidad del jugador | La aporta el estudio. Tú no la creas ni la verificas |
| Identificador | Opaco, con ámbito `(game_id, external_id)` |
| Inmutabilidad | **Requisito contractual del estudio.** Si cambia, el jugador pierde sus objetos |
| Claves de jugador | Derivadas de una llave maestra **por juego** |
| Custodia de la llave maestra | HSM o KMS. Nunca sale |
| Salida a wallet propia (`claim`) | **No existe en v1** |

El documento debe incluir: esquema de derivación concreto, separación de dominio por
juego, y **procedimiento escrito de rotación ante compromiso** — esto último antes de
tener el primer cliente, porque después es inviable.

### 3.3 Persistencia y seguridad

| Decisión | Valor |
|---|---|
| Base de datos propia | **Ninguna.** Sólo fichero de configuración por juego |
| Autenticación | Credencial por estudio, en el fichero de configuración |
| Autorización de operaciones | Del servidor del estudio, con sus propios datos |
| Protección contra repetición | Clave de idempotencia exigida por el `node-adapter` + rechazo de firmas duplicadas de Solana |
| Escritura de estado | **Sólo en `settled`.** `applied` es puramente cosmético |

**Sobre la repetición:** hay dos capas y ninguna sustituye a la otra.

**Capa 1 — el `node-adapter`.** Toda operación de escritura exige una clave de
idempotencia que aporta el servidor del estudio. Antes de reenviar nada, el adaptador
comprueba y marca esa clave; si ya existía, devuelve el resultado anterior sin llamar a
tu backend. El orden importa: **marcar primero, llamar después.**

El adaptador **define la interfaz de almacenamiento pero no la implementa**:

```ts
interface SeenStore {
  markIfNew(key: string, ttlSeconds: number): Promise<boolean>;
  getResult(key: string): Promise<OperationResult | null>;
  saveResult(key: string, result: OperationResult): Promise<void>;
}
```

El estudio la enchufa a la base de datos que ya tiene. Un `Set` en memoria muere al
reiniciar y falla con varias instancias del servidor, así que el adaptador incluye uno
sólo como implementación de desarrollo, y **se niega a arrancar con él salvo que se
active un flag explícito**. Sin esa negativa, alguien lo dejará puesto en producción.

**Capa 2 — Solana.** Rechaza una firma ya procesada, lo que cubre los reintentos dentro
de la ventana de validez del blockhash (~1 minuto) aunque la capa 1 falle. Es red de
seguridad, no protección primaria.

Tu backend no guarda nada por jugador y no participa en la deduplicación. El documento
debe dejar escrito que la garantía depende de que el estudio conecte un `SeenStore`
real, y que ésa es una condición del contrato de integración.

### 3.4 Economía

| Decisión | Valor |
|---|---|
| Quién paga los fees y la renta | **El estudio** |
| Cuenta pagadora | Dirección derivada de la llave maestra del juego; el estudio la financia |
| Endpoint RPC producción | Proveedor comercial, contratado y pagado por el estudio |
| Endpoint RPC desarrollo | Devnet público por defecto; validador local como alternativa configurable |
| Operaciones en lote | **No.** Ocho objetos son ocho transacciones |

El estudio nunca te entrega una clave suya: se le da una dirección y envía SOL a ella.
Hace falta una categoría de error `SIN_FONDOS` y un umbral de aviso (log y métrica; sin
base de datos no hay alertas por cliente).

Advierte del límite de airdrops y peticiones del devnet público, que se agota en una
sesión de trabajo larga.

### 3.5 API pública

| Decisión | Valor |
|---|---|
| Idioma | **Inglés.** `Collection`, `Item`, `Quality`, señales en inglés |
| `transfer` | Cantidad **obligatoria**: `transfer(item_id, amount, recipient)` |
| Transferencia parcial | No existe. O entra entera o no entra |
| Saldo insuficiente | Comprobación optimista + rechazo de la cadena como red de seguridad |
| Identificadores | Opacos con prefijo propio. **Nunca direcciones base58 en crudo** |

### 3.6 Licencias y repositorio

| Crate | Licencia | Contenido |
|---|---|---|
| `core` | MIT OR Apache-2.0 | sans-io. Instrucciones, serialización, `Signer`, `SigningContext`, tipos de dominio |
| `godot-client` | MIT OR Apache-2.0 | GDExtension con gdext. **Cero dependencias de Solana** |
| `node-adapter` | MIT OR Apache-2.0 | Librería Node que el estudio incrusta en su servidor. Exige la clave de idempotencia y define `SeenStore` |
| `dev-backend` | MIT OR Apache-2.0 | Backend mínimo contra devnet, con airdrop |
| `mock-backend` | MIT OR Apache-2.0 | En memoria, determinista, sin red |
| `backend` | Cerrado, repo separado | Producto comercial |

`gdext` está bajo **MPL-2.0**: copyleft por fichero. Enlazarlo no obliga a nada, pero
si acabáis parcheando gdext, esos parches concretos se publican. Verifícalo con quien
lleve lo legal y menciónalo en el documento.

Fija `gdext` a una **versión exacta**, no un rango: introduce cambios rompientes con
frecuencia. Declara MSRV con `rust-version` y **verifícalo en CI** con esa toolchain.

### 3.7 Dependencias

- Crates `solana-*` **granulares**, nunca el metacrate. Objetivo: árbol pequeño y que
  `tokio` no entre por la puerta de atrás.
- **Prohibido en `core`:** `tokio`, `reqwest`, cualquier cliente HTTP, cualquier runtime
  async. Si aparece en `cargo tree`, es un bug.
- **Prohibido en `godot-client`:** cualquier dependencia de Solana.

---

## 4. API del lado Godot

Tres formas expuestas, ni una más:

1. **`ChainConfig`** — Resource. Endpoint del estudio (escrituras), endpoint tuyo
   (lecturas), credencial de lectura, timeouts, política de sondeo, modo.
2. **`Chain`** — singleton autoload. Punto de entrada de las operaciones.
3. **`ChainHandle`** — `RefCounted` devuelto por cada operación.

### Señales

| Señal | Significado | Uso |
|---|---|---|
| `applied` | Confirmada, no final | **Anima aquí.** No garantiza nada |
| `settled` | Final e irreversible | **Compromete aquí.** Persistir estado |
| `failed` | Falló en cadena | Revertir la animación optimista |
| `expired` | El blockhash caducó | Reintentar o avisar |
| `finished` | Tras cualquiera de las cuatro | Para el patrón de espera seguro |

`applied` → `failed` es una transición **posible**: una transacción confirmada pero no
finalizada puede desaparecer. Por eso las dos señales existen y por eso sólo se escribe
en `settled`.

No expongas `processed` / `confirmed` / `finalized`.

### Problemas de implementación que el documento debe resolver

1. **`HTTPRequest` es un `Node`, el handle es `RefCounted`.** El handle no hace nada:
   es un buzón pasivo. El singleton posee el pool de `HTTPRequest`, mantiene referencia
   fuerte a los handles pendientes y sondea en `_process`. El handle no referencia al
   singleton. Sin ciclos.
2. **`await` sobre una señal ya emitida cuelga.** Documenta el patrón seguro
   (`if not handle.is_finished(): await handle.finished`) y la garantía estructural de
   que un handle recién creado no puede resolverse en el mismo bloque síncrono.
3. **Sin hilos.** Sondeo con backoff en `_process`; respuesta por la señal
   `request_completed` en el hilo principal. Cero primitivas de concurrencia.
4. **Registro del autoload.** Decide entre autoload declarado por el addon o
   autoinserción diferida bajo la raíz, y justifica.

### Errores

`ChainError` con categoría accionable, no código de cadena. Categorías mínimas:
`NETWORK`, `REJECTED`, `NOT_FOUND`, `RATE_LIMITED`, `INSUFFICIENT_BALANCE`,
`INSUFFICIENT_FUNDS`, `CONFIG`, `INTERNAL`. Cada una con `retryable: bool`.

### Modo mock

`ChainConfig.mock()` resuelve contra una máquina de estados en memoria con reloj
controlable. Debe incluir `mock_force(handle, estado, error)` para poder probar la rama
de reversión, que es la que rompe inventarios en producción y la que nadie prueba.

---

## 5. Contratos de código

### `Signer`

Async desde el primer commit. Cambiarlo después rompe a todos los usuarios cuando
llegue el primer firmante MPC o hardware.

```rust
#[async_trait]
pub trait Signer: Send + Sync {
    fn pubkey(&self) -> Pubkey;
    async fn sign_message(&self, msg: &[u8]) -> Result<Signature, SignerError>;
}
```

Devuelve firma, nunca la transacción completa.

### `SigningContext`

Roles separados desde el día uno aunque hoy coincidan: `fee_payer` y `authority`, con
la authority resoluble por colección. **Deduplicar firmantes coincidentes antes de
construir la transacción** — Solana rechaza firmantes repetidos. Test dedicado.

### Implementaciones de referencia

- `LocalKeypairSigner`, tras feature flag `dev-signer` **apagada por defecto**.
- `MockSigner`, siempre disponible en tests. Determinista.

---

## 6. Contrato HTTP

**Escríbelo primero en el documento. Es el artefacto del que cuelga todo lo demás.**

Lo implementan tres partes (tu backend, `dev-backend`, `mock-backend`) y lo consumen
dos (`godot-client`, `node-adapter`). Versionado, con tests de conformidad que las tres
implementaciones deben pasar. Sin esos tests, `mock-backend` divergirá y el requisito de
"los tests del juego pasan sin red" dejará de ser cierto.

Vocabulario **sin cadena**. Si un endpoint necesita decir "blockhash", la costura está
rota. Esbozo:

```
POST  /v1/collections                   → { collection_id }
POST  /v1/items                         → { operation_id, item_id }
POST  /v1/items/{item_id}/transfer      → { operation_id }
PATCH /v1/items/{item_id}/qualities     → { operation_id }
GET   /v1/operations/{operation_id}     → { state: pending|applied|settled|failed|expired }
GET   /v1/holders/{holder_id}/items     → [ { item_id, name, qualities, amount } ]
```

Marca claramente qué endpoints son de escritura (van por el servidor del estudio) y
cuáles de lectura (directos, credencial de sólo lectura).

---

## 7. Hito mínimo demostrable

> En devnet, desde Godot y **pasando por un servidor de juego de ejemplo**: crear una
> colección, mintear un objeto con cualidades de tipo, y transferirlo entre dos cuentas.

Nada más entra en v1 hasta que esto funcione de extremo a extremo con `dev-backend`, el
`node-adapter` y un servidor de ejemplo mínimo.

---

## 8. Orden de trabajo

1. Contrato HTTP escrito y versionado.
2. Esqueleto del workspace + CI en verde y vacío.
3. `core`: `Signer`, `SigningContext`, deduplicación, tipos de dominio, `MockSigner`.
4. `core`: crear colección, mintear, transferir, actualizar cualidades de tipo.
5. `dev-backend` contra devnet, con airdrop.
6. `node-adapter` + servidor de juego de ejemplo.
7. `godot-client`: config, singleton, handle, cinco señales, HTTP vía `HTTPRequest`.
8. Proyecto Godot de ejemplo que ejecute el hito.
9. `mock-backend` y suite sin red.
10. README.

---

## 9. CI

Los cinco targets de escritorio desde el primer commit:
`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
`x86_64-apple-darwin`, `aarch64-apple-darwin`.

Comprobaciones obligatorias:

- `cargo tree` de `core` sin `tokio` ni cliente HTTP.
- `cargo tree` de `godot-client` sin ninguna dependencia de Solana.
- Test de deduplicación de firmantes coincidentes.
- Suite de `mock-backend` con la red deshabilitada.
- `cargo deny` para licencias y avisos de seguridad.
- MSRV verificado con la toolchain declarada.

---

## 10. Fuera de alcance

No implementar, no diseñar, no dejar hooks especulativos:

- Staking, marketplace, multi-chain, Unity
- NFTs comprimidos y activos no fungibles de cualquier tipo
- Metaplex, en cualquiera de sus programas
- Programa Anchor propio
- Lógica de juego on-chain
- Gestión de identidad o login
- Salida de activos a wallets del jugador (`claim`)
- Operaciones en lote
- Almacenamiento de atributos por jugador
- Base de datos propia

---

## 11. Limitaciones aceptadas conscientemente

El documento debe recogerlas en una sección propia, con este tono. Son decisiones, no
defectos, pero deben estar escritas para que nadie las descubra por sorpresa.

- **La cadena certifica propiedad y catálogo, no estado individual.** Lo que diverge
  por jugador vive en la base de datos del estudio y es mutable sin transacción.
- **El estado individual no sobrevive a la transferencia.** Al ser fungibles, las
  unidades son indistinguibles on-chain.
- **El jugador no posee de verdad en v1.** Las claves las custodia el backend y no hay
  vía de salida a una wallet propia.
- **La protección contra repetición depende del estudio.** El `node-adapter` la impone,
  pero el almacén lo aporta el estudio; con el almacén de desarrollo, la garantía se
  reduce a la ventana del blockhash.
- **El identificador de jugador debe ser inmutable.** Es responsabilidad contractual del
  estudio; si cambia, los objetos quedan bajo una clave que nadie reclama.

---

## 12. Verificar antes de escribir

No decidas estos puntos: compruébalos y refleja lo que encuentres, con la fecha.

1. **Texto literal vigente** de la regla de onboarding de Steam sobre blockchain, más la
   política actual de Google Play y App Store.
2. **Versión actual de `gdext`**, versión mínima de Godot 4.x que exige, y MSRV.
3. **Cifras de renta** de un mint de Token-2022 con la extensión de metadata y de una
   cuenta de token, contra devnet. No uses cifras de memoria.
4. **Qué extensiones de Token-2022** siguen sin poder añadirse tras la creación del mint.

---

## 13. Aviso de Steam

Obligatorio en el README, arriba del todo, antes de cualquier instrucción de
instalación. Steam prohíbe los juegos construidos sobre tecnología blockchain que
emitan o permitan el intercambio de criptomonedas o NFTs. Google Play y App Store lo
permiten con restricciones. Verifica el texto vigente (punto 12.1) antes de redactarlo.

---

## 14. Preguntas que debes plantear, no resolver

Al final del documento, sección propia. Al menos ésta sigue abierta:

- **¿Entran Android e iOS en los targets de CI de v1?** Si están en el plan, deben
  entrar desde el primer commit por el mismo motivo que los cinco de escritorio: el
  toolchain móvil es el que más problemas de compilación cruzada da, y descubrirlo tarde
  puede obligar a cambiar dependencias del núcleo. Si no entran, hay que evitar cualquier
  promesa sobre móvil en la documentación.

Añade cualquier otra que encuentres. No las respondas.

---

## 15. Cómo escribir el documento

- **Español.** Identificadores de código en inglés.
- Estructura con secciones numeradas, como un brief de ingeniería.
- Tablas para decisiones y comparaciones; prosa para justificaciones.
- **Incluye el porqué de las decisiones no obvias**, para que quien implemente no las
  reabra por su cuenta. Especialmente: por qué Token-2022 y no Metaplex, por qué sólo
  atributos por tipo, y por qué las escrituras pasan por el servidor del estudio.
- Criterio para quien implemente: ante la duda entre genérico y simple, **simple**. Las
  únicas excepciones son el trait `Signer` y la separación fee payer / authority, que
  nacen con su forma final.
- Si una decisión no está en este prompt y afecta a la API pública, **pregunta**.