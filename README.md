# godot-chain

Activos de Solana en Godot 4 sin que el jugador vea la cadena.

> **Antes de usar esto en un juego comercial.** Steam prohíbe en su proceso de
> onboarding los juegos construidos sobre tecnología blockchain que emitan o permitan
> el intercambio de criptomonedas o NFTs. Google Play y App Store lo permiten con
> restricciones. Verifica el texto vigente de las tres políticas antes de publicar: son
> la razón más común por la que un juego con activos on-chain no llega a la tienda.
>
> *Pendiente de contrastar con el texto literal actual de las tres políticas
> (`docs/seguimiento/verificaciones.md`, P4) antes de la entrega.*

---

## Qué es

Un **addon de Godot 4**, en GDScript puro y sin dependencias, que permite a un
desarrollador crear objetos de juego que existen como activos reales en Solana y
transferirlos entre jugadores, sin escribir código on-chain y sin que el jugador final
sepa que hay una blockchain debajo.

Proyecto de fin de máster. **Sólo devnet.** No apto para producción tal cual: ver
limitaciones.

## Problema que resuelve

Un estudio que quiere que los objetos de su juego existan como activos reales en una
blockchain choca hoy con tres obstáculos:

1. **El jugador tiene que entender la cadena.** Wallet, frase semilla, comisiones y firmas
   de cada transacción. Es fricción que la mayoría de jugadores no acepta, y un juego no
   debería pedírsela.
2. **El desarrollador tiene que escribir código on-chain.** Un estudio de Godot sabe
   GDScript, no Rust ni Anchor, y no debería tener que aprenderlos para dar un objeto a un
   jugador.
3. **Las claves acaban en el sitio equivocado.** Si el juego firma, la clave viaja dentro del
   binario, y cualquiera puede extraerla. Y si el cliente decide qué se gana un jugador,
   cualquiera puede darse lo que quiera.

`godot-chain` resuelve los tres. El juego llama a una API en GDScript que no menciona la
cadena. Las escrituras las autoriza un servidor del estudio y las firma un backend que
custodia las claves. Los objetos son tokens Token-2022 reales en Solana, y su historial
queda verificable en un explorador.

## Casos de uso

- **El estudio define su catálogo.** Desde la consola `/admin` crea colecciones y tipos de
  objeto (nombre, símbolo, URI y hasta 8 cualidades, como `rareza: épica`) y entrega las
  unidades iniciales a un jugador.
- **El juego enseña el inventario.** `Chain.inventory()` devuelve los objetos de un jugador
  a partir del identificador que el juego ya usa para él, sin direcciones ni claves.
- **Un jugador da objetos a otro.** El juego pide la transferencia con `Chain.transfer()`.
  El servidor de juego decide si se permite y quién la envía, y el juego ve su estado:
  `pending`, `applied` (aceptada) y `settled` (definitiva en la cadena). El juego sólo
  guarda estado cuando llega a `settled`.
- **Reintentos sin duplicados.** Si la red falla y el juego repite una petición, la misma
  operación no se ejecuta dos veces: cada escritura lleva una clave de idempotencia.
- **El estudio audita.** La consola lista cada operación con su estado y un enlace a su
  transacción en el explorador de Solana.
- **Desarrollo sin red.** En modo MOCK el addon responde en memoria con la misma forma que
  el backend, y el juego se puede programar y probar sin backend ni cadena.

## Arquitectura

```
Dispositivo del jugador                                    Navegador del estudio
    Proyecto Godot 4  +  addon godot-chain (GDScript)          consola /admin
        | transferencias                      | lecturas           |
        v                                     |                    | clave de administración
    game-server de ejemplo                    |                    |
        | clave de escritura                  |                    |
        v                                     v                    v
    chain-backend  (TypeScript + SQLite)  ------------------------------
        | claves derivadas de una semilla maestra por juego
        v
    Solana devnet  -  chain-assets (Anchor)  -CPI->  Token-2022
```

Las **escrituras** van del juego al servidor de juego y de ahí al backend, nunca
directas: la credencial que autoriza operaciones no puede viajar dentro del binario del
juego, y quien decide que un jugador se ha ganado un objeto tiene que ser un servidor
autoritativo, no el cliente. Las **lecturas** van directas del juego al backend con un
token de sólo lectura.

El juego no crea objetos. El **catálogo** (las colecciones y los tipos, con la entrega
inicial a un jugador) lo crea el estudio desde la consola `/admin`, y el servidor de juego
rechaza la creación con un `403`. Cada pieza tiene su credencial y con ella su papel; el
programa no define roles propios (ver `docs/vision-general/guia.md`).

## Tecnologías

| Pieza | Tecnologías |
|---|---|
| Programa `chain-assets` | Rust, Anchor 1.2.2 (`anchor-lang` y `anchor-spl`), Token-2022 con las extensiones `MetadataPointer`, `TokenMetadata` y `PermanentDelegate`. Tests con LiteSVM 0.18.2 |
| Backend | TypeScript 6.0.3 sobre Node >= 22, Fastify 5.12.8, SQLite con better-sqlite3 13.0.3, `@solana/kit` 8.6.0 y un cliente del programa generado con Codama 1.11.0 a partir del IDL. Tests con Vitest 5.1.0 |
| Consola `/admin` | HTML, CSS y JavaScript sin compilación, servidos por el backend |
| Addon | GDScript puro para Godot 4.7.2, sin dependencias ni binarios. La red pasa por `HTTPRequest` |
| Servidor de juego de ejemplo | TypeScript, Fastify y better-sqlite3 |
| Red | Solana devnet |
| CI | GitHub Actions: tipos y tests del backend y del servidor de juego (y estilo y licencias en el backend), auditoría de dependencias, tests del programa, suite del addon con Godot sin pantalla, y guardias que impiden vocabulario de cadena, hilos y binarios en el addon |

## Estructura del repositorio

| Directorio | Contenido |
|---|---|
| `addon/addons/godot_chain/` | El addon. GDScript puro, cero dependencias, modos LIVE y MOCK. `addon/tests/` es su suite |
| `programs/chain-assets/` | El programa Anchor, que controla los activos Token-2022 mediante PDA. Desplegado en devnet |
| `backend/` | El servicio: TypeScript, Node >= 22, SQLite. Sirve el contrato HTTP y la consola `/admin` |
| `frontend/` | La consola de administración (dashboard web). La sirve el backend, sin compilación |
| `examples/chain-demo/` | Proyecto Godot de la demo sencilla que ejecuta el hito |
| `examples/game-server/` | Servidor de juego mínimo del hito: autoriza, registra y reenvía las transferencias |
| `rust/` | Workspace de Cargo de *Nidada*: reglas, GDExtension y servidor |
| `examples/godot-demo/` | Proyecto Godot de *Nidada*, un juego de mascotas aparte del hito |
| `docs/especificacion/propuesta-pfm.md` | **La especificación.** Única fuente de verdad |
| `docs/especificacion/http-contract.md` | **Contrato HTTP, congelado.** El artefacto del que cuelga todo |
| `docs/vision-general/guia.md` | Explicación legible del proyecto: actores, roles y quién manda sobre los activos |
| `docs/vision-general/lanzar-el-proyecto.md` | Cómo levantar el hito paso a paso, en devnet o sin red |
| `docs/seguimiento/verificaciones.md` | Hechos comprobados, con fecha, y lo que falta por comprobar |
| `docs/seguimiento/preguntas-tutor.md` | Lo que bloquea el proyecto y no decide quien implementa |
| `docs/juego/` | Diseño y plan de *Nidada* |

## Estado

**Librería:** el hito de la sección 7 de la propuesta está hecho y probado de extremo a
extremo en devnet: el estudio crea el catálogo en la consola, la demo de Godot lee los
inventarios y pide transferencias, y cada operación pasa por `pending → applied → settled`
(`docs/seguimiento/verificaciones.md`, V20 y V21). La CI cubre la sección 9 de la propuesta.
Faltan los entregables del máster: diagramas, capturas y vídeo.

***Nidada*:** fases J1 (cuidado) y J5 (amigos y visitas) hechas, en escritorio. Es un
proyecto aparte, fuera del hito, y no usa `godot-chain`. Plan en `docs/juego/plan.md`.

## Programa `chain-assets`

Programa Anchor mínimo y sin lógica de juego. No guarda saldos ni reimplementa tokens: los
activos son mints Token-2022 y el programa sólo los controla por CPI.

**Program ID (devnet):** `4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz`
([explorador](https://explorer.solana.com/address/4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz?cluster=devnet))

### Cuentas y PDA

| Cuenta | Semillas | Qué es |
|---|---|---|
| `Game` | `["game", game_id]` | Un juego. Guarda `authority` (la única clave que firma y paga), `game_id` y `bump`. Tiene todos los poderes sobre los activos del juego |
| Mint de un tipo | `["item", game, item_seed]` | Un tipo de objeto: mint Token-2022 de 0 decimales con `MetadataPointer`, `PermanentDelegate` y `TokenMetadata`. `item_seed` la calcula el backend a partir del `item_id` |
| Cuenta de token del tenedor | Cuenta asociada (mint + tenedor) | El saldo de un jugador. El tenedor es una clave derivada por el backend que nunca firma |

La PDA `Game` es, en cada mint, autoridad de acuñación, autoridad del puntero y de la
actualización de metadatos, y delegado permanente. Ningún mint tiene autoridad de congelación.

### Instrucciones

Todas tienen una sola firma requerida: la autoridad del juego, que también paga. Las PDA
firman por CPI.

| Instrucción | Qué hace | Evento |
|---|---|---|
| `initialize_game(game_id)` | Crea `Game` y fija como autoridad a quien firma. `game_id` cumple `[a-z0-9-]{1,32}` | `GameInitialized` |
| `rotate_authority(new_authority)` | Cambia la autoridad. Los mints no cambian, porque sus poderes los tiene `Game` | `AuthorityRotated` |
| `create_item(args)` | Crea el mint de un tipo con sus metadatos: nombre, símbolo, URI, colección y hasta 8 cualidades | `ItemCreated` |
| `grant(amount)` | Acuña unidades a un tenedor y crea su cuenta de token si hace falta | `ItemGranted` |
| `transfer(amount)` | Mueve unidades entre dos tenedores con `Game` como delegado permanente. El emisor no firma | `ItemTransferred` |

Cada instrucción tiene sus tests negativos: 30 tests con LiteSVM en
`programs/chain-assets/tests/`. Los errores propios están en `programs/chain-assets/src/error.rs`.

## Innovaciones

Lo que este proyecto añade frente a un programa Anchor con wallet en el navegador:

- **Activos reales, no cuentas propias.** Los objetos son mints Token-2022 con sus metadatos
  en el propio mint, sin Metaplex. El programa no guarda saldos ni reimplementa tokens: sólo
  tiene los poderes sobre ellos y los ejerce por CPI.
- **Jugador sin wallet.** El jugador no firma, no paga comisiones y no ve la cadena. Su
  identidad es la que ya le da el juego, y el backend deriva de ella su dirección.
- **Firmante único.** Toda transacción tiene una sola firma requerida: la autoridad del
  juego, que también paga. Los mints son PDA y firman por CPI, y la PDA del juego mueve los
  objetos como delegado permanente. Un test lo verifica.
- **Autoridad rotable sin tocar los activos.** Los poderes los tiene la PDA del juego, no la
  clave. Cambiar la clave es una sola instrucción, `rotate_authority`.
- **Idempotencia de extremo a extremo.** La clave de idempotencia se registra en SQLite
  antes de tocar Solana, así que un reintento nunca acuña ni transfiere dos veces.
- **Estados `applied` y `settled`.** El juego distingue una operación aceptada de una
  definitiva en la cadena, y sólo guarda estado con la segunda.
- **Un addon de Godot sin vocabulario de cadena.** La API pública no habla de claves,
  cuentas ni comisiones, y la CI lo comprueba con `grep` en cada cambio.
- **Contrato HTTP congelado.** El addon, el servidor de juego y el backend dependen de un
  contrato escrito (`docs/especificacion/http-contract.md`), no unos de otros.

## Requisitos

- Node >= 22 (desarrollado con 24.12.0)
- Godot 4.7.2
- CLI de Solana, configurada en devnet, para financiar la autoridad del juego
- Sólo para modificar el programa: Anchor 1.2.2 y Solana 4.1.2, en Linux o WSL. Anchor no
  funciona nativo en Windows. Lanzar el hito no lo necesita: el programa ya está desplegado
- Sólo para *Nidada*: Rust 1.94.0, fijado en `rust/rust-toolchain.toml`. En Windows, ver
  `rust/README.md`

## Instalación y ejecución

Los pasos completos, con las credenciales, la creación del juego y el recorrido del hito,
están en `docs/vision-general/lanzar-el-proyecto.md`. Sin red, la demo arranca en modo MOCK:
basta con abrir `examples/chain-demo` en Godot y ejecutarla.

## Desarrollo

```bash
# Backend: tipos, estilo y tests
cd backend
npm ci
npm run typecheck
npm run lint
npm test

# Servidor de juego
cd examples/game-server
npm ci && npm run typecheck && npm test

# Addon, en modo MOCK, desde la raíz
godot --headless --path addon --import             # sólo la primera vez
godot --headless --path addon --script res://tests/run.gd

# Programa, en Linux o WSL, desde la raíz
anchor build                                       # .so e IDL
cargo test -p chain-assets                         # LiteSVM, sin red

# Sólo Nidada
cd rust
cargo test
cargo clippy --all-targets -- -D warnings
./build-ext.sh        # compila nidada-ext y la copia al proyecto Godot
```

## Limitaciones aceptadas conscientemente

Son decisiones, no defectos:

1. **La cadena certifica catálogo y propiedad, no estado individual.** Los activos son
   fungibles: las unidades son indistinguibles y nada sobrevive a la transferencia
   salvo la cantidad.
2. **La semilla maestra vive en un fichero, no en un HSM.** Quien lea ese fichero
   controla todos los activos del juego.
3. **El jugador no posee de verdad.** Las claves las custodia el backend, el delegado
   permanente permite mover sus objetos sin su consentimiento, y no hay vía de salida a
   una wallet propia.
4. **`NonTransferable` no está activado y no puede añadirse después.** Todo objeto
   creado en v1 es transferible para siempre.
5. **El `read_token` es público de facto.** Va en el binario del juego; cualquiera
   puede extraerlo y consultar el inventario de cualquier jugador de ese juego.
6. **El modo mock puede divergir del backend real.** No hay tests de conformidad que lo
   impidan.
7. **Una sola instancia del backend.** SQLite en fichero; escalar horizontalmente
   rompería la idempotencia.
8. **El identificador de jugador debe ser inmutable.** Si cambia, sus objetos quedan
   bajo una clave derivada que nadie reclama.
9. **`chain-assets` no está auditado.** Tiene poder sobre todos los activos de cada juego:
   apto para devnet, no para mainnet sin una auditoría.
10. **Quien tenga la autoridad de actualización del programa controla todos los juegos.**
    En devnet se conserva para poder corregir errores; un despliegue real tendría que
    congelarla o que cada estudio desplegara su propio programa.

## Procedimiento de rotación ante compromiso de la semilla

Escrito, no implementado:

1. Generar una semilla maestra nueva y una autoridad nueva.
2. Ejecutar `rotate_authority` con la autoridad antigua. Los activos no cambian, porque sus
   poderes los tiene la PDA del juego.
3. Para cada tenedor, mover su saldo a la dirección derivada de la nueva semilla con
   `transfer`.
4. Republicar el mapa `holder_id` -> dirección.
5. Destruir la semilla comprometida.

Es una carrera: quien tenga la semilla comprometida también puede ejecutar
`rotate_authority`, y si lo hace primero, el estudio pierde el juego.

## Trabajo futuro

- **Entrar a la consola con una wallet.** El jugador no tiene wallet, porque esa es la premisa del
  proyecto. El estudio sí podría entrar en `/admin` con una (*Sign-In With Solana*), validada contra
  una lista de claves autorizadas en el backend, como alternativa a `CHAIN_ADMIN_KEY`. Pero sólo
  cambiaría cómo se autentica el administrador, no quién firma en la cadena: todas las operaciones las
  sigue firmando la autoridad del juego desde el backend. Para que una wallet tuviera poder propio
  sobre los activos, `chain-assets` necesitaría un rol de administrador separado de la autoridad, con
  su propia instrucción. Si esa wallet firmara junto a la autoridad, se rompería la regla de un único
  firmante. Y si sustituyera a la autoridad, el servidor de juego ya no podría hacer transferencias.

## Licencia

MIT OR Apache-2.0. Ver `LICENSE-MIT` y `LICENSE-APACHE`.
