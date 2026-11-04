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
| `fastify` | 5.12.3 |
| `better-sqlite3` | 13.0.3 |
| `zod` | 4.5.4 |
| `vitest` | 5.0.0 |
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
  `--script` funciona después. No depende de la versión ni de la extensión. **Sin
  comprobar en Linux:** es un paso de la CI, que nunca se ha ejecutado en GitHub (0
  ejecuciones en esa fecha).

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

---

## Pendiente

| # | Qué hay que verificar | Bloquea | Cómo |
|---|---|---|---|
| P1 | Coste real de renta de un activo con puntero de metadatos, metadatos y delegado permanente, y de una cuenta de tenencia asociada. **No usar cifras de memoria** | OC1 | Contra devnet, midiendo |
| P2 | Si el delegado permanente puede reasignarse tras la creación del activo. Ya no condiciona la rotación: el delegado es una PDA que no cambia | Nada | Sólo si hace falta |
| P3 | Si el API de `@solana/kit` 8.2.0 con `@solana-program/token-2022` 0.16.1 difiere de los ejemplos publicados | Bloque 3 | Leer la documentación vigente antes de escribir la primera instrucción |
| P4 | Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas actuales de Google Play y App Store | Último bloque (aviso del README) | Leer las políticas, citar con fecha |
| P5 | Actualizar a la 4.7.2 el Godot de la máquina de desarrollo, que tiene la 4.7.1 | Fase A1 | Instalar y anotar |
| P6 | Que un mint PDA con estas extensiones se puede crear por CPI, con una sola firma en la transacción | OC1, primera prueba. Sostiene 4.2 y 4.7 de la propuesta | Prueba en devnet |
| P7 | Que `create_item` más `grant` caben en una transacción con el máximo del contrato (8 pares de 32 y 64 caracteres), en tamaño y en unidades de cómputo | OC1 y bloque 3 | Transacción real con el caso máximo |
| P8 | Qué toolchain de Solana pide Anchor 1.2.2, y cuánto ocupa. El disco C: está al 99 % | OC1 | Documentación de Anchor y medir |
| P9 | Qué herramienta genera hoy un cliente sobre `@solana/kit` desde un IDL de Anchor 1.x, y qué arnés de tests conviene usar sin devnet | OC1 y bloque 3 | Documentación vigente |
