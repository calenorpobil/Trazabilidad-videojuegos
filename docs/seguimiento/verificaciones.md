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

---

## Pendiente

| # | Qué hay que verificar | Bloquea | Cómo |
|---|---|---|---|
| P1 | Coste real de renta de un activo con puntero de metadatos, metadatos y delegado permanente, y de una cuenta de tenencia asociada. **No usar cifras de memoria** | Bloque 3 | Contra devnet, midiendo |
| P2 | Si el delegado permanente puede reasignarse tras la creación del activo | Bloque 3, y el paso 3 del procedimiento de rotación (4.3 de la propuesta) | Documentación oficial de Token-2022 + prueba en devnet |
| P3 | Si el API de `@solana/kit` 8.2.0 con `@solana-program/token-2022` 0.16.1 difiere de los ejemplos publicados | Bloque 3 | Leer la documentación vigente antes de escribir la primera instrucción |
| P4 | Texto literal vigente de la regla de onboarding de Steam sobre blockchain, y las políticas actuales de Google Play y App Store | Bloque 10 (aviso del README) | Leer las políticas, citar con fecha |
| P5 | Versión de Godot que se instala finalmente, y fijarla en el README | Bloque 6 | Instalar y anotar |

**Godot no está instalado en la máquina de desarrollo a 6 de septiembre de 2026.** Hace
falta antes del bloque 6, y también para el trabajo de Godot en modo headless de la CI.
