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

Comisión por transacción: 5.000 lamports (una firma). **Falta** la cuenta de token asociada,
que se crea en `grant` (OC2).

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
- **Falta** medir `create_item` + `grant` juntos, en OC2.

---

## Pendiente

| # | Qué hay que verificar | Bloquea | Cómo |
|---|---|---|---|
| P1 | Renta de la cuenta de tenencia asociada. La del activo ya está medida (V9) | OC2 | Contra devnet, midiendo |
| P2 | Si el delegado permanente puede reasignarse tras la creación del activo. Ya no condiciona la rotación: el delegado es una PDA que no cambia | Nada | Sólo si hace falta |
| P3 | Si el API de `@solana/kit` 8.2.0 con `@solana-program/token-2022` 0.16.1 difiere de los ejemplos publicados | Bloque 3 | Leer la documentación vigente antes de escribir la primera instrucción |
| P4 | Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas actuales de Google Play y App Store | Último bloque (aviso del README) | Leer las políticas, citar con fecha |
| P5 | Actualizar a la 4.7.2 el Godot de la máquina de desarrollo, que tiene la 4.7.1 | Fase A1 | Instalar y anotar |
| P7 | `create_item` más `grant` juntos, en tamaño y cómputo. `create_item` solo ya está medido (V10): el máximo del contrato no cabe ni así | OC2 y bloque 3 | Transacción real con el caso máximo |
| P10 | Que el cliente de Codama (V6) funciona con `@solana/kit` 8.2.0, o si hay que subir kit a 8.3 | Bloque 3 | Generar el cliente y compilar |
