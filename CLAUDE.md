# CLAUDE.md — `godot-chain`

Activos de Solana en Godot 4 sin que el jugador vea la cadena.
Proyecto de fin de máster. **Entrega: 30 de noviembre de 2026.** Presupuesto: **unas 54 horas**, sólo la librería (ni la demo ni *Nidada* cuentan), sin margen; calendario en la propuesta, 8.2.

---

## 0. Jerarquía de documentos — léela antes de nada

| Documento | Estatus | Cómo usarlo |
|---|---|---|
| `docs/especificacion/propuesta-pfm.md` | **ÚNICA FUENTE DE VERDAD** | Es la especificación. Todo lo que se construye sale de aquí, **salvo lo que cambia `docs/especificacion/arquitectura-cliente-rust.md`** |
| `docs/especificacion/arquitectura-cliente-rust.md` | Decisión del responsable, 6-oct-2026 | Cambia la arquitectura del cliente: Rust + GDExtension en `godot-chain` y `nidada-ext`. Sustituye al invariante 4. La propuesta **ya está actualizada** con esta decisión (revisión del 8-oct-2026); este documento sigue siendo el desarrollo detallado (toolchain, CI, fases A0–A5). Lo que dice de *Nidada* en el hito, de Android y de sus horas queda superado por las revisiones de la propuesta del 4 y el 5-nov-2026 |
| `docs/especificacion/http-contract.md` | Congelado en el bloque 1 | Contrato del que cuelga el resto. Cambiarlo exige decisión explícita |
| `docs/archivo/` | **Superado, sólo en local** | Ignorado por git. Contiene decisiones **revertidas** (`core` sans-io, Metaplex Token Metadata, `SigningContext`, múltiples backends): citarlo como justificación es un error |

**Regla:** si algo de `docs/archivo/` o de los documentos de *Nidada* parece necesario, se contrasta con
la propuesta; si no está en ella, no entra.

---

## 1. Invariantes — en imperativo, no negociables

1. **Firmante único.** Toda transacción tiene exactamente una firma requerida: la
   autoridad del juego, que es también la pagadora. Hay un test que lo verifica. Las PDA
   firman por CPI, y eso no cuenta como firma de la transacción.
2. **Marcar primero, llamar después.** Ante una escritura, inserta la
   `Idempotency-Key` en SQLite *antes* de tocar Solana. Invertir el orden mintea dos veces.
3. **Cero vocabulario de cadena en `addon/`.** Ni `solana`, ni `pubkey`, ni `lamport`,
   ni `blockhash`, ni `base58`, ni `spl`, ni la palabra que designa la cuenta de acuñación.
   La CI lo comprueba con `grep`. Si aparece, la costura está rota.
4. **Rust en el cliente sólo para calcular, nunca para firmar ni para hablar con la cadena.**
   Sustituye al antiguo «GDScript puro» (decisión del 6-oct-2026, `docs/especificacion/arquitectura-cliente-rust.md`
   §3). Cinco reglas, comprobadas en la CI:
   - Cero vocabulario de cadena en `godot-chain` y `nidada-ext` (`src/` y API registrada en Godot).
   - Cero crates `solana-*` ni `spl-*` en el dispositivo (`cargo tree`).
   - Sin red propia ni hilos en las GDExtension: ni `tokio`, ni `reqwest`, ni `std::thread`. El
     HTTP pasa por `HTTPRequest` de Godot. `nidada-server` sí usa `tokio`.
   - `nidada-rules` es puro: sin Godot, sin red, sin reloj ni aleatoriedad propios.
   - Rust calcula, GDScript muestra: ninguna escena en Rust, ninguna regla en GDScript.
5. **El juego sólo escribe estado en `settled`.** `applied` es cosmético.
6. **Nada fuera del hito de la sección 7** de la propuesta. Si surge «ya que estamos,
   añadimos…», la respuesta es no.
7. **Las claves privadas nunca están en el binario del juego.** Las escrituras pasan
   siempre por el servidor de juego.
8. **Un solo programa on-chain propio, `chain-assets`, mínimo y sin lógica de juego.**
   Decisión del 4-nov-2026 (propuesta, 4.7), que revierte el «ningún programa propio». Tiene
   los poderes sobre los activos mediante PDA y opera por CPI. Los activos son Token-2022: no
   reimplementes tokens ni guardes saldos. Sólo las instrucciones de 4.7, cada una con su test
   negativo. El vocabulario de cadena se queda en `programs/` y `backend/`.

## 2. Convenciones

- **Español** en documentación y comentarios. **Inglés** en todos los identificadores
  de código, en la API pública del addon y en el contrato HTTP.
- Identificadores opacos con prefijo: `col_`, `itm_`, `opr_`, `hld_`. Nunca una
  dirección en crudo cruza la API pública.
- Ante la duda entre genérico y simple, **simple**. Cero *hooks* especulativos: no hay
  un segundo cliente al que servir.
- Versiones **exactas** en `package.json` (sin `^` ni `~`) y en `Cargo.toml` (`=x.y.z`).

## 3. Estructura

| Directorio | Contenido |
|---|---|
| `addon/addons/godot_chain/` | Envoltorio de la GDExtension `godot-chain` (`.gdextension`, `bin/`, `plugin.cfg`). Aún no existe |
| `programs/chain-assets/` | Programa Anchor, con `Anchor.toml` en la raíz. Aún no existe |
| `backend/` | TypeScript, Node >= 22. El servicio y su suite de tests |
| `frontend/` | Dashboard web: consola de administración que sirve el backend, sin compilación. Aún no existe |
| `rust/` | Workspace de Cargo: `nidada-rules`, `nidada-ext`, `nidada-server` (hoy) y `godot-chain` (pendiente) |
| `examples/chain-demo/` | Proyecto Godot de la demo sencilla que ejecuta el hito. Aún no existe |
| `examples/game-server/` | Servidor de juego mínimo del hito, en TypeScript. Aún no existe |
| `examples/godot-demo/` | Proyecto Godot de *Nidada*, fuera del hito |
| `examples/Proyecto finalizado/` | Proyecto de ejemplo del curso. Ignorado por git: **nunca lo publiques** |
| `docs/especificacion/` | Qué se construye: propuesta, arquitectura del cliente, contrato HTTP y maqueta de la consola |
| `docs/seguimiento/` | Qué falta por resolver: preguntas al tutor y verificaciones |
| `docs/guia/` | Guías breves de consulta, como los roles del proyecto |
| `docs/juego/` | Diseño y plan de *Nidada*, fuera del cómputo de horas |
| `docs/archivo/` | Lo que ya no se sigue. Ignorado por git; sólo contexto, nunca justificación |

## 4. Disciplina de sesión

- **Una sesión por bloque** de la sección 8 de la propuesta. Se empieza pegando el
  bloque. Se termina con CI en verde y commit. No se arrastra trabajo entre bloques.
- **Antes de tocar Token-2022 o Anchor, lee la documentación oficial vigente.** El orden de
  inicialización de extensiones y el cálculo de espacio TLV son exactamente el detalle
  que un modelo reconstruye de memoria y se inventa a medias. Leer, no recordar.
- **Tests antes que implementación en dos sitios y sólo dos:** los vectores fijos de
  derivación de claves (bloque 2) y el invariante de firmante único (bloque 3).
- **Commits pequeños y frecuentes.**

## 5. Estado actual

- Bloque 1 (esqueleto, contrato, CI): **hecho**.
- *Nidada* (`rust/`, `examples/godot-demo/`): J1 (cuidado) y J5 (amigos y visitas) hechos, con límites
  por IP, tokens con hash y decisiones previas a J3/J4 en `docs/juego/plan.md` §9. **Fuera del hito**
  desde el 4-nov-2026: no se trabaja en ella para el PFM. Android, tampoco (5-nov-2026).
- Siguiente: bloque 2 — configuración, derivación de claves con vectores de test,
  SQLite, idempotencia, máquina de estados de operaciones. Después, OC1 y OC2: el programa.
- Requisitos de entrega del máster: propuesta, 0.1. Revísalos antes de planificar un bloque.
- Ver `docs/seguimiento/verificaciones.md` para lo que hay que comprobar antes de OC1 y del
  bloque 3, y `docs/seguimiento/preguntas-tutor.md` para lo que bloquea el proyecto.

## 6. Comandos

```bash
cd backend
npm ci
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # vitest run
npm run test:devnet   # tests contra devnet, FUERA de la CI (aún no existe)

cd ../rust            # Git Bash o PowerShell, no WSL; ver rust/README.md
cargo test
cargo clippy --all-targets -- -D warnings
./build-ext.sh        # compila nidada-ext y la copia al proyecto Godot
```
