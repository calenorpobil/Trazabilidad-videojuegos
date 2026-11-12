# Verificaciones — hechos comprobados, con fecha

Sección 13 de la propuesta: **no se decide de memoria, se comprueba**. Cada entrada
lleva la fecha en la que se verificó y cómo. Lo que no está verificado está marcado
como pendiente y **bloquea el bloque en el que se necesita**.

---

## Verificado

### V1 — Versiones exactas de las dependencias del backend (6 de septiembre de 2026)

Consultadas contra el registro de npm ese día. Van fijadas sin `^` ni `~` en
`backend/package.json`.

| Paquete | Versión |
|---|---|
| `@solana/kit` | 8.2.0 |
| `@solana-program/token-2022` | 0.16.1 |
| `@solana-program/token` | 0.16.1 |
| `fastify` | 5.12.8 (subido el 5 de noviembre, por avisos de seguridad) |
| `better-sqlite3` | 13.0.3 |
| `zod` | 4.6.7 (subido el 5 de noviembre, por un aviso alto) |
| `vitest` | 5.1.0 (subido el 5 de noviembre, por avisos de seguridad) |
| `typescript` | 6.0.3 |
| `eslint` | 10.10.0 |
| `typescript-eslint` | 8.69.0 |

**TypeScript se fija en 6.0.3 y no en 7.0.2, que es la última publicada**, porque
`typescript-eslint@8.69.0` declara `typescript: ">=4.8.4 <6.1.0"` como par. Elegir la
última rompería el linter, que es una de las comprobaciones obligatorias de la CI
(sección 9). Cuando `typescript-eslint` soporte la 7, se sube en un commit propio.

Node local: v24.12.0 (el requisito es >= 22).

### V2 — Heredado de la propuesta, verificado el 25 de agosto de 2026

- Godot va por la 4.7.1-stable (julio de 2026); la 4.6.3 es de mayo de 2026.
- `@solana/web3.js` está marcado como SDK heredado; la recomendación oficial para
  proyectos nuevos es `@solana/kit` con clientes generados por programa.
- Orden obligatorio en Token-2022: la inicialización del puntero de metadatos va
  **antes** de la del propio activo, y la creación de la cuenta, el puntero y la
  inicialización viajan **en la misma transacción**.
- Los metadatos son una extensión TLV de longitud variable: al crecer, la instrucción
  de actualización redimensiona la cuenta pero **no** le transfiere fondos. Hay que
  enviarlos antes o falla por falta de exención de renta.

### V3 — Versión de Godot (4 de noviembre de 2026)

- La última estable es la **4.7.2-stable**, publicada el 18 de agosto de 2026 (API de
  *releases* de GitHub). Es la fijada en el README y en la CI. Corrige a V2: la 4.7.1 ya no
  es la vigente.
- En Windows, `nidada-ext` compilada con `api-4-7` carga en la 4.7.2 y `tests/test_ext.gd`
  pasa con código 0. No probado en Linux ni en Android.
- En Windows, `--headless --import` termina con fallo de segmentación tras cargar el editor,
  3 de 3 veces en la 4.7.1 y en la 4.7.2. En la 4.7.2 también falla sin `nidada-ext`, y
  `--script` funciona después. No depende de la versión ni de la extensión.
- En Linux, en la CI, `--import` termina con código 134 y `test_ext.gd` pasa después (5 de
  noviembre, ejecución 42093209225). La causa del error no está investigada: la CI lo
  deja como aviso y es el test quien decide.

### V4 — Base del programa Anchor (4 de noviembre de 2026)

- `SystemInstruction::CreateAccount` declara como `SIGNER` la cuenta pagadora **y la cuenta
  nueva** (documentación de `solana-system-interface`). Un mint con clave propia es un
  segundo firmante; por eso el mint de `chain-assets` es una PDA.
- `anchor-lang`: última estable 1.2.2; existe una 2.0.0-rc.2 que no se usa (crates.io).
- Anchor admite `extensions::metadata_pointer::…` y `extensions::permanent_delegate::…`,
  y `token_metadata_initialize` por CPI. Los ejemplos de
  `solana-developers/program-examples` pagan aparte la renta de los metadatos. Su mint **no
  es una PDA**, así que esto no demuestra la combinación que necesitamos (P6).
- La documentación de Anchor avisa de que no todas las instrucciones de extensión están
  implementadas y de que algunas pueden exigir CPI a mano.

### V5 — Toolchain del programa (P8, 8 de noviembre de 2026)

- Notas de la versión 1.2.2 de Anchor (anchor-lang.com, *release notes*): Solana recomendada
  **4.1.2**, platform-tools **v1.57**, SBPF v3. AVM instala la CLI de Solana y las
  platform-tools que tocan. La plantilla de tests por defecto es LiteSVM en Rust.
- Página de instalación de Anchor: en Windows **exige WSL**. No hay instalación nativa.
- Instalado en el Debian de WSL: Solana 4.1.2, `anchor-cli` 1.2.2 (con avm 1.1.2) y Rust
  stable **1.99.1**. Hace falta rustc >= 1.98.1: las crates de agave 4.4.1 que arrastra
  `litesvm` lo exigen, y la 1.96 falla al generar el IDL.
- Espacio: lo nuevo ocupa unos 2-3 GB dentro de WSL (Solana 4.1.2 unos 0,4 GB, platform-tools
  v1.57, `target/` de unos 2 GB). El disco virtual de WSL vive en C:, así que antes se
  borraron, dentro de WSL, dos ledgers de prueba, dos releases viejas de Solana y tres
  platform-tools antiguas: 13 GB de hueco interno, que se reutiliza sin hacer crecer el
  fichero. `target/` es un enlace a `~/build/chain-assets-target`, en ext4.
- Dependencias del programa, versiones exactas: `anchor-lang` y `anchor-spl` `=1.2.2`;
  en desarrollo `litesvm` `=0.18.2` (la 0.18.1 no compila contra agave 4.4.1: dos versiones de
  `solana-account`), y `solana-keypair`, `-message`, `-signer` y `-transaction` en las
  versiones del ejemplo oficial. Licencias de las 420 crates del `Cargo.lock`: todas
  permisivas (Apache-2.0, MIT, BSD, Zlib, 0BSD, CC0, Unicode-3.0); ninguna copyleft
  obligatoria.

### V6 — Cliente generado y arnés de tests (P9, 8 de noviembre de 2026)

- **Cliente:** Codama. `@codama/nodes-from-anchor` 1.5.6 convierte el IDL de Anchor
  (`target/idl/chain_assets.json`) y `@codama/renderers-js` 2.8.0 genera un cliente para
  `@solana/kit` (documentación de Solana, «Codama: clients»; registro de npm). Ambos MIT,
  publicados el 20 de octubre de 2026. Dependen de `@solana/codecs ^8.3.0` y de
  `@solana/codecs-strings ^8.0.0`: encajan con la línea 8 de kit. **Sin probar** con kit
  8.2.0: `nodes-from-anchor` pide `^8.3.0`, más que el 8.2.0 fijado en el backend. Se
  comprueba en el bloque 3 (P3).
- **Arnés:** LiteSVM en Rust (`litesvm` 0.18.2), que es lo que recomienda la documentación de
  Anchor («use `litesvm` wherever possible») y la plantilla por defecto de Anchor 1.2.2. Trae
  Token-2022 cargado. No hacen falta Mollusk ni bankrun (bankrun está en desuso).

### V7 — Token-2022 por CPI desde Anchor (8 de noviembre de 2026)

Leído en el ejemplo oficial `solana-foundation/program-examples`
(`tokens/token-2022/metadata/anchor` y `permanent-delegate/anchor`, Anchor 1.2.1) y en el
código de `anchor-spl` 1.2.2:

- La restricción `init` con `extensions::metadata_pointer::…` y
  `extensions::permanent_delegate::…` reserva sólo el espacio de las extensiones de tamaño
  fijo e inicializa las extensiones antes que el mint, en la misma instrucción. Con
  `seeds` y `bump`, el mint PDA firma su `CreateAccount` por CPI.
- `TokenMetadata` no entra en esa reserva. Se calcula con `TokenMetadata::tlv_size_of()`; el
  programa transfiere la diferencia de renta y después llama a `token_metadata_initialize`,
  que redimensiona la cuenta. `chain-assets` calcula el tamaño **final**, con todas las claves
  de `additional_metadata`, y paga una sola vez antes del `initialize` y de los `UpdateField`.

### V8 — Mint PDA con tres extensiones y una sola firma (P6, 8 de noviembre de 2026)

**Hecho, en LiteSVM y en devnet.** `create_item` crea por CPI un mint Token-2022 PDA con
`MetadataPointer` (que apunta al propio mint), `PermanentDelegate` y `TokenMetadata`, y la
transacción lleva **una sola firma**. Los tests comprueban `num_required_signatures == 1` en
cada transacción; en devnet, `getTransaction` devuelve una firma.

- Programa: `4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz`, desplegado en devnet en el slot
  520005780. Firma del despliegue:
  `5bx7kWKs6g7E7qE1a1rcmLAPCXwTvx5WfvrFrGeogPp2cFEVEYu9cxf51tgVT8FUMyd2vjz8UxgUXmCqM4bXgUFW`.
  Autoridad de actualización: `E4eHhXeqQvNvSoNhEVx7rk9Z88uo9CfjySigra2q7P1z`, el monedero de
  desarrollo de WSL. La clave del programa está en `target/deploy/` dentro de WSL, **fuera
  del repositorio**: sin ella no se puede redesplegar en el mismo id.
- Prueba de humo (`programs/chain-assets/scripts/devnet-smoke.sh`), juego `oc1-1794137367`:
  `initialize_game`
  `5Z1L8SZCfJFFBEg21UWCMNbGxZZYP3fxFjkFnkHShKtveferurxYbU7pxB4LWigqJkD9FqWtoVDx2x4oFb4Y7nBu`;
  `create_item` típico
  `gZPmwFcGbFxvmE2EFKDj2ynn1rngETXbertPKDmU5ZoorLdDAHTAHsenyta8q19ZEbYU8vDGHsYHQBPtxmRfXRr`;
  `create_item` con 8 pares máximos
  `3AY6BZjmKUMcaucVDo1T8yqKhkwcP91ruErq1DVPgCWAQGUh4w2CDHoZ5aR3Gcoy9LTmfexmtzeTDSZgn16gMbPE`.

### V9 — Renta medida en devnet (P1, en parte; 8 de noviembre de 2026)

| Cuenta | Bytes | Lamports | SOL |
|---|---|---|---|
| Programa (`ProgramData`) | 233.520 + cabecera | 1.187.160.440 | 1,187 |
| `Game` | 77 | 1.041.400 | 0,00104 |
| Mint típico (2 cualidades, `uri` de 32) | 481 | 3.134.360 | 0,00313 |
| Mint con 8 pares de 32/64, sin `uri` | 1.226 | 6.918.960 | 0,00692 |

Comisión por transacción: 5.000 lamports (una firma). La cuenta de tenencia asociada se mide en
OC2 (V12).

### V10 — Tamaño y cómputo de `create_item` (P7, en parte; 8 de noviembre de 2026)

| Caso | Bytes | Cómputo |
|---|---|---|
| Típico | 472 | 56.608 CU (LiteSVM), 63.062 CU (devnet) |
| 8 pares de 32/64, `uri` vacía, `name` y `symbol` de 1 | 1.217 | 148.332 CU (devnet) |
| **Máximo del contrato**: además `uri` de 200, `name` de 32, `symbol` de 10 | **1.457** | 143.340 CU (LiteSVM) |

- El cómputo cabe de sobra en el límite por defecto (200.000 CU por instrucción).
- **El máximo del contrato no cabe en una transacción (1.232 bytes) ni con `create_item`
  solo**: se pasa en 225 bytes. Con 8 pares máximos, sólo cabe si los demás campos son casi
  vacíos, y queda un margen de 15 bytes. Con `grant` en la misma transacción (OC2) cabe todavía
  menos. Es el caso que la propuesta prevé en la sección 13 (punto 10): el backend rechaza o
  limita, y no parte la operación sin una decisión explícita. **Decidido el 8 de noviembre**
  (propuesta, revisión del 8 de noviembre): se mantienen los límites; el backend mide la
  transacción, separa `create_item` y `grant` en dos si juntos no caben, y rechaza con
  `400` / `REJECTED` sólo si `create_item` no cabe ni solo.
- Fórmula aproximada, que cuadra con las dos medidas: 363 bytes fijos + `name` + `symbol` +
  `uri` + `collection` + Σ(clave + valor + 8) por cualidad. Quedan unos 850 bytes para los
  campos.
- `create_item` + `grant` juntos, medido en OC2: V13.

### V11 — Cuenta asociada y transferencia con delegado por CPI desde Anchor (8 de noviembre de 2026)

Leído antes de escribir `grant` y `transfer` (CLAUDE.md, sección 4):

- Ejemplos oficiales de `solana-foundation/program-examples`, rama `main`, en
  `raw.githubusercontent.com`: `tokens/token-2022/basics/anchor` (Anchor 1.2.1) crea la cuenta
  asociada con `init` + `associated_token::mint` / `::authority` y mueve con
  `token_interface::transfer_checked` pasando `mint.decimals`; activa la feature
  `init-if-needed` de `anchor-lang`. `tokens/token-2022/permanent-delegate/anchor` sólo crea el
  mint con `extensions::permanent_delegate::delegate`: **no hay ejemplo oficial que transfiera
  como delegado permanente**.
- Código de `anchor-spl` 1.2.2 (`src/associated_token.rs`, `src/token_2022.rs`):
  `associated_token::create` hace `invoke_signed` de `create_associated_token_account` con el
  pagador, la cuenta, el propietario, el mint y los programas. **El propietario no firma.**
  `transfer_checked` y `mint_to` pasan la autoridad sin multifirma; con `new_with_signer`, la
  PDA `Game` firma por CPI. Hace falta la feature `associated_token` de `anchor-spl`, que añade
  `spl-associated-token-account-interface` 2.0.0 (Apache-2.0).
- Código generado de `anchor-syn` 1.2.2 (`codegen/accounts/constraints.rs`): con
  `init_if_needed` y `associated_token::…`, si la cuenta pertenece al programa del sistema la
  crea; si ya existe, comprueba que su mint, su propietario, su programa de tokens y su
  dirección asociada son los esperados. Por eso `init_if_needed` es seguro aquí.
- Anchor 1.2.2 rechaza la misma cuenta mutable pasada dos veces
  (`ConstraintDuplicateMutableAccount`, 2040): una transferencia de un tenedor a sí mismo con
  su cuenta asociada falla antes del handler. `SameHolder` cubre un origen que no es la cuenta
  asociada (test `transfer_rejects_same_holder_from_other_account`).
- LiteSVM 0.18.2 trae cargado el programa de cuentas asociadas
  (`spl_associated_token_account-1.1.1.so`), además de Token-2022.
- Que la PDA `Game`, como delegado permanente, mueve el saldo de cualquier cuenta del mint sin
  la firma del propietario: **comprobado** en LiteSVM y en devnet (V12).
- Licencias tras añadir las features (`cargo metadata`): 419 crates, todas permisivas. Dos
  ofrecen LGPL-2.1 sólo como una de las opciones (`MIT OR Apache-2.0 OR LGPL-2.1-or-later`).

**Cómo se comprueba que el tipo es del juego:** `mint::authority = game`, no las semillas con
`item_seed`. Es el poder que se ejerce, da un error claro (`ConstraintMintMintAuthority`) y
ahorra 32 bytes por `grant`, que cuentan en V13. Un mint ajeno con esta PDA como autoridad se
puede crear fuera del programa, pero emitir de él sólo lo pide la autoridad del juego y no toca
los activos de nadie más. Explicado en `src/instructions/grant.rs`.

### V12 — `grant` y `transfer` en devnet; renta de la cuenta asociada (P1, 8 de noviembre de 2026)

Programa actualizado **en el mismo id** (`4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz`), slot
520017921. Firma del despliegue:
`31Rqw9T7YuuLmX2jJxyPRvTH7SbrobPw2kPRk17HNvmKpUMviMUJ78Y5FN8idhRaCWrQAW1fZp436LNNrgN7Qju8`.
`ProgramData` pasa de 233.520 a 281.528 bytes (1,431 SOL de renta; la CLI lo amplía sola). El
despliegue y la prueba costaron unos 0,26 SOL; quedan 3,38 SOL en el monedero de WSL.

Prueba de humo (`devnet-smoke.sh`), juego `oc2-1794140207`. Todas con **una firma** y 5.000
lamports de comisión:

| Paso | CU | Firma |
|---|---|---|
| `grant` 5, crea la cuenta de alice | 35.415 | `4pPWk61z3t9QBcUTrF7UsC1t8jWmjdFg1mChZQ77BxAhzmAHK8zXqYZxmdLaDzcQfFBsewhdLBe6iz8TdxfeAvZW` |
| `grant` 2, cuenta existente | 13.425 | `fRKknopbtzCCJ8D2bcFoJKW2YnDo54YKBbEWGZs9iejrga96Az8JSM3ZuU9wkdjTvWhh12adJGL4x1atsE8Ti8M` |
| `transfer` 3 de alice a bob, crea la cuenta de bob | 41.790 | `2qnB2j2E951N3PShvE91io4fjifPihtdhZ6s8TmU3uyWEdxbyyVLydFKTnLDFJmq74DcDFgSEHsDrZiuqDwDNV6n` |
| `transfer` 1, cuenta existente | 16.800 | `5EoeL2EjrVpbCsbcGRhmsYH8YxuzsFuTJSbubXJgtS74m2PBN7Zy9s2Doqw2dEysMuXRH2pWnDmwwWbFoHsuCHRZ` |
| `create_item` + `grant` típico, una transacción | 99.987 | `5N4ktdnUMnGAcLXM35pjxv74HRTRL1MQUpaV77kTwQoBv6buRYwtpeaMEJZ9L6PxKLUqUTtFauurjPzSY9DVVXaq` |

Saldos finales: alice 3, bob 4, carol 1. Ni alice ni bob firmaron nada.

**Renta de la cuenta de tenencia asociada** de estos mints: **170 bytes, 1.513.840 lamports
(0,00151 SOL)**, igual en LiteSVM y en devnet. Son 165 bytes de la cuenta base más la extensión
`ImmutableOwner`, que el programa de cuentas asociadas añade siempre; `PermanentDelegate` y los
metadatos no añaden extensión a la cuenta. La paga la autoridad la primera vez que un tenedor
recibe un tipo, sea por `grant` o por `transfer`.

Coste de referencia por tipo: crear el mint típico, 0,00313 SOL (V9); cada tenedor nuevo de ese
tipo, 0,00151 SOL; cada transacción, 0,000005 SOL.

### V13 — Tamaño y cómputo de `create_item` + `grant` en una transacción (P7, 8 de noviembre de 2026)

Medido en LiteSVM (`create_item_and_grant_size_and_compute`), con `grant` de una unidad a un
tenedor nuevo, es decir, creando su cuenta:

| Caso | Bytes | Cómputo |
|---|---|---|
| Típico | 595 | 99.000-104.000 CU (LiteSVM), 99.987 CU (devnet) |
| Sin cualidades, `uri` vacía, `name` y `symbol` de 1 | 507 | ~70.000 CU |
| 6 pares de 32/64 y resto mínimo | 1.132 | ~142.000 CU |
| 7 pares de 32/64 y resto mínimo | 1.236 | **no cabe** |
| Máximo del contrato | 1.580 | 181.741 CU |

- `grant` añade 122-123 bytes a `create_item`: tres cuentas nuevas (tenedor, su cuenta y el
  programa de cuentas asociadas) y 16 bytes de datos. Fórmula de la transacción conjunta, que
  cuadra con las medidas: **486 bytes fijos + `name` + `symbol` + `uri` + `collection` +
  Σ(clave + valor + 8)** por cualidad. Quedan unos 746 bytes para los campos, frente a los ~869
  de `create_item` solo (V10).
- El cómputo cabe siempre: el máximo del contrato gasta 181.741 CU entre las dos instrucciones,
  y el límite por defecto es de 200.000 por instrucción. No hace falta pedir más cómputo.
- Las CU varían en unos miles entre ejecuciones porque cada tenedor es una clave aleatoria y la
  búsqueda del *bump* de su cuenta asociada cambia.
- **Consecuencia para el bloque 3** (propuesta, revisión del 8 de noviembre): los casos normales
  van en una transacción. Se separan en dos cuando los campos pasan de unos 746 bytes sin llegar
  a unos 869: por ejemplo, 7 u 8 cualidades largas. Se rechazan con `400` / `REJECTED` cuando
  `create_item` no cabe ni solo. El backend lo decide **midiendo la transacción serializada**, no
  con esta fórmula, que sólo sirve para orientarse.

### V14 — Cliente generado sobre `@solana/kit` (P3 y P10, 8 de noviembre de 2026)

Leído en el registro de npm y en los paquetes instalados (README de `@codama/renderers-js` 2.8.0 y
tipos `.d.ts` de `@solana/kit` 8.6.0 y `@solana-program/token-2022` 0.16.1), y comprobado compilando:

- **Con kit 8.2.0 no compila.** El cliente que genera `@codama/renderers-js` 2.8.0 importa
  `HasAddress` de `@solana/kit` e `InstructionAccountInput`, `InstructionSignerInput` y
  `ResolvedInstructionAccountMeta` de `program-client-core`, que la 8.2.0 no tiene. El propio
  renderer avisa: pide `@solana/kit ^8.5.0`. **Decisión:** kit sube a **8.6.0**, la última estable
  (28 de octubre de 2026; la 8.7 sólo existe como *canary*), en un commit propio. `npm audit
  --audit-level=high` en verde; los 10 avisos moderados son de `eslint`/`minimatch`, previos.
- `@solana-program/token-2022` y `@solana-program/token` 0.16.1 piden `@solana/kit ^8.0.0`: valen
  con la 8.6.0 sin cambios. Hay una 0.20.1 de token-2022 que no hace falta.
- Generadores, sólo en desarrollo y a versión exacta: `@codama/nodes-from-anchor` 1.5.6,
  `@codama/renderers-js` 2.8.0 y `codama` 1.11.0 (`createFromRoot`). El `@solana/codecs ^8.3.0` de
  `nodes-from-anchor` se instala anidado (8.6.0) y no toca el código que se ejecuta. Licencias: MIT,
  salvo `jsonify` 0.0.1 (dominio público, vía `json-stable-stringify`), que entra en la lista
  permitida como dependencia de desarrollo.
- Opciones del renderer que importan aquí: `syncPackageJson: false` (si no, reescribe
  `package.json` con rangos `^`), `importExtension: 'js'` (`moduleResolution: nodenext`) y
  `kitImportStrategy: 'rootOnly'` (todo sale de `@solana/kit` y `@solana/kit/program-client-core`, la
  única dependencia directa).
- El *plugin* de cliente que genera (`chainAssetsProgram()`) no compila con
  `exactOptionalPropertyTypes`. El backend no lo usa: construye con `get*Instruction` y firma él.
  `scripts/codegen.mjs` le pone `// @ts-nocheck` sólo a ese fichero en vez de relajar el `tsconfig`.
- **API de kit 8.6.0 usada** (no difiere de los ejemplos en lo que importa): `pipe`,
  `createTransactionMessage({ version: 'legacy' })`, `setTransactionMessageFeePayerSigner`,
  `setTransactionMessageLifetimeUsingBlockhash`, `appendTransactionMessageInstructions`,
  `createKeyPairSignerFromPrivateKeyBytes`, `signTransactionMessageWithSigners`,
  `sendAndConfirmTransactionFactory`. Novedad útil: `getTransactionMessageSize` mide el tamaño de la
  transacción compilada, firmas incluidas, sin firmar, y `LEGACY_TRANSACTION_SIZE_LIMIT` vale 1.232.
- Organización: el IDL se copia de `target/idl/` a `backend/idl/chain_assets.json` y se versiona con
  el cliente (`backend/src/generated/`); `npm run codegen` lo regenera. La CI no necesita Anchor.

### V15 — Constructores, vectores fijos y devnet desde TypeScript (8 de noviembre de 2026)

- `item_seed := SHA-256(item_id)` (propuesta, 4.7). Vectores en `tests/addresses.test.ts`, calculados
  aparte con `sha256sum` y `solana find-program-derived-address` (CLI 4.1.2): la PDA `Game` de
  `oc2-1794140207` da `DVKimGfAe2H98Y6BVY1wmtbFPZGB4Z5YERGU54ZuVtEQ`, la misma que derivó `devnet_tx`
  en Rust (V12).
- **Los tamaños que mide TypeScript son exactamente los de Rust** (`tests/item-plan.test.ts`), con
  los mismos datos: `create_item` 472, 1.217 y 1.457 bytes (V10); `create_item` + `grant` 595, 507,
  1.132, 1.236 y 1.580 (V13). El cliente generado serializa igual que el programa.
- Prueba manual (`npm run test:devnet`), juego `b3-1794147458`, tipo `itm_vUfoe78NHFq3zQnQ`, tenedor
  aleatorio `FUyp9oBrARFaPwL7QUX4mr9UJomS4gAGpyqPpxTk1suw`, mint
  `BFiApoiWA2KKLEZ4RQxxHmktAnVVMonUD1eSA4pHtCLu`. `getTransaction` da **una firma** en cada una:

| Paso | CU | Firma |
|---|---|---|
| `initialize_game` | 11.947 | `58WnLke56xhKRDRE9uCw6X4nZgRhevcUHdofTqsADVJqfu3jUso5G6BfPGNMW2NGCnF2ifSuQ3eAvTRuB9RWoFPM` |
| `create_item` + `grant` típico, una transacción | 98.459 | `5vWB91TQdaektGzuZ26ECpdyLifi6LaDxKPtjYGWuCS1z5dvx4Ft5GEayGdYShkKrwtS7sc3GrszXCGudbhdBFyQ` |

  El tenedor tiene 1 unidad y no firmó nada. La autoridad fue el monedero de WSL; la derivación
  desde la semilla maestra la cubren los vectores de `keys.test.ts`.

### V16 — Inventario, parseo del mint y transferencia desde TypeScript (bloque 4, 9 de noviembre de 2026)

**Formato del mint, leído antes de parsear** (CLAUDE.md, 4): interfaz oficial
`solana-program/token-metadata`, `interface/src/state.rs` (rama `main`), y el decodificador de
`@solana-program/token-2022` 0.16.1 instalado (`getMintDecoder`). La página de la documentación de
Solana sobre la extensión respondió 429 y no se pudo leer. Coinciden en lo que importa:

- 82 bytes del mint base, relleno hasta el byte 165 con el tipo de cuenta (`1` = mint) y entradas TLV
  de Token-2022 (`u16` tipo, `u16` longitud).
- `TokenMetadata` va en Borsh: `update_authority` (32 bytes, ceros si no hay), `mint`, `name`, `symbol`,
  `uri` con prefijo `u32` y `additional_metadata: Vec<(String, String)>`, que el decodificador
  devuelve como `Map` **en el orden de la cadena**: `collection` primero y después las cualidades.
- El campo `mint` de los metadatos existe para evitar la suplantación: `parseItemMint` lo compara con
  la dirección leída.

**Fixture:** `getAccountInfo` del mint de V15 (`BFiApoiWA2KKLEZ4RQxxHmktAnVVMonUD1eSA4pHtCLu`, slot
520497539): 481 bytes, propiedad de Token-2022. `tests/inventory.test.ts` comprueba que es el mint de
`itm_vUfoe78NHFq3zQnQ` en `b3-1794147458` y que su autoridad es la PDA `Game` de ese juego.

**De dónde sale cada dato del inventario** (decidido por el responsable el 9-nov-2026):

- **El `item_id` no se puede recuperar de la cadena.** `create_item` guarda `name`, `symbol`, `uri`,
  `collection` y las cualidades; del `item_id` sólo llega SHA-256(item_id), como semilla del mint y en
  el evento `ItemCreated` (logs, no estado). Se traduce mint → `item_id` con `items.mint`, que es
  `UNIQUE` desde el bloque 2 y no depende de la Q12. Un mint del juego que no está en `items` no
  aparece.
- **Los datos del tipo salen de `items`**, como fija la propuesta (4.4): el backend no lee los
  metadatos de la cadena en cada consulta. De la cadena salen los **saldos**, en `finalized` (contrato,
  5.2), y **la pertenencia al juego**: la autoridad de acuñación del mint es la PDA `Game`, el mismo
  criterio que el programa (V11). El parseo de metadatos sirve para ese filtro y para comprobar en
  `test:devnet` que lo escrito en la cadena es lo enviado.

**Transferencia:** `planTransfer` rechaza sin tocar la cadena una cantidad que no sea entero de 1 al
máximo de `u64` y un emisor igual al receptor, y lee en `confirmed` la cuenta asociada del emisor:
si no existe, no se envía. El saldo insuficiente es del bloque 5.

**Prueba manual** (`npm run test:devnet`), juego `b4-1794255336`, tipo `itm_FaKCh6ZFbC0Hm3Ow`, mint
`DsrtqbADsPZaYPyuEmSSQhzHhq5vnCSRrLprzy8LgqaK`, emisor `Cn3t9hRSLumPacDziKeQLEhAtDdUEVyQt4aTVBAzwgXd`,
receptor `GuQrMiNpioKYjBz9sJAK3QkAxA4Vzgx8LwGCmnuduaai`, los dos con clave aleatoria. `getTransaction`
da **una firma** en cada una:

| Paso | CU | Firma |
|---|---|---|
| `initialize_game` | 7.447 | `2giBnhYQNpskz7uXwepLJWTSgVZXcQXbfXLUubV84xt58R87XiQ8iUS5DBXBb96zPDkiCVxHe1oD6wuBsveTE9g8` |
| `create_item` + `grant` 3 | 104.459 | `5XWd8qAdHdbBESYRsxc8rUYoPE25jUMKZgPB9zeXRTZEAVoU2g11QZ7uZgYwKgvdjuQYQ61Tob3VrupdiJFFeWSe` |
| `transfer` 2, crea la cuenta del receptor | 37.276 | `3sjd8Uf8eNoLnVXucweyKfqRr67bz8jv624N31E3G9iiPKGMcuiaLBfJemTHgStz1vUG28Lg5JPps21B3j7QmtZG` |

Ya en `finalized`, `readHolderInventory` da 1 unidad al emisor y 2 al receptor, con los datos del tipo
en la forma del contrato. Ninguno de los dos firmó. Quedan 3,369 SOL en el monedero de WSL.

---

## Pendiente

P1 (V12) y P7 (V10 y V13) quedan cerrados en OC2. P3 y P10 (V14), en el bloque 3. P11 queda decidido
el 12-nov-2026: `operations.step` y `operations.payload` (propuesta, revisión del 12 de noviembre).

| # | Qué hay que verificar | Bloquea | Cómo |
|---|---|---|---|
| P2 | Si el delegado permanente puede reasignarse tras la creación del activo. Ya no condiciona la rotación: el delegado es una PDA que no cambia | Nada | Sólo si hace falta |
| P4 | Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas actuales de Google Play y App Store | Último bloque (aviso del README) | Leer las políticas, citar con fecha |
| P5 | Actualizar a la 4.7.2 el Godot de la máquina de desarrollo, que tiene la 4.7.1 | Fase A1 | Instalar y anotar |
| P12 | **Decisión pendiente del responsable:** alcance de OpenBao, que sugiere el tutor (Q12). A: guardar sólo la semilla en su almacén KV (~1 h). B: que la autoridad firme dentro de OpenBao con Transit (ed25519) y se rote con `rotate_authority` (~4 h; cambia 4.3). C: trabajo futuro en el README. Para B, verificar antes que Transit firma ed25519 puro sobre los bytes del mensaje, sin *prehash*. Leído el 12-nov-2026 en su documentación (2.7.x): Transit admite ed25519 para firmar y rotar, e importar claves; licencia MPL-2.0 y modo `server -dev` | Nada hasta que se decida; si es B, antes del último bloque | Decidir; si B, plazo de 4 h y vuelta a A si tras 2 h no hay una firma válida en devnet |
