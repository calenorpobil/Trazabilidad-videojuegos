# CLAUDE.md — `godot-chain`

Activos de Solana en Godot 4 sin que el jugador vea la cadena.
Proyecto de fin de máster. Presupuesto: **unas 44 horas** (pendiente de confirmar, Q7), sólo la librería (el juego *Nidada* no cuenta).

---

## 0. Jerarquía de documentos — léela antes de nada

| Documento | Estatus | Cómo usarlo |
|---|---|---|
| `Propuesta_PFM_godot-chain_v1_reducida.md` | **ÚNICA FUENTE DE VERDAD** | Es la especificación. Todo lo que se construye sale de aquí, **salvo lo que cambia `docs/implementacion-android.md`** |
| `docs/implementacion-android.md` | Decisión del responsable, 6-oct-2026 | Cambia la arquitectura del cliente: Rust + GDExtension en `godot-chain` y `nidada-ext`. Sustituye al invariante 4. La propuesta **ya está actualizada** con esta decisión (revisión del 8-oct-2026); este documento sigue siendo el desarrollo detallado (toolchain, CI, fases A0–A5). La **Q7** (44 h frente a 40) sigue abierta |
| `docs/http-contract.md` | Congelado en el bloque 1 | Contrato del que cuelga el resto. Cambiarlo exige decisión explícita |
| `Documento de implementación.md` | Referencia | Aspiración, no guía de acción |
| `Viejo Documento de implementación.md` | **Histórico, superado** | Describe una arquitectura descartada (Rust + GDExtension + Metaplex). Sólo contexto de a dónde aspira el proyecto |

**Regla:** los documentos marcados como referencia describen *a lo que aspira* el
proyecto, **no lo que hay que hacer**. No se implementa nada porque aparezca en ellos.
Si algo de ahí parece necesario, se contrasta con la propuesta reducida; si no está en
ella, no entra. En particular, el documento viejo contiene decisiones **revertidas**
(GDExtension en Rust, `core` sans-io, Metaplex Token Metadata, `SigningContext`,
múltiples backends): citarlo como justificación es un error.

---

## 1. Invariantes — en imperativo, no negociables

1. **Firmante único.** Toda transacción tiene exactamente una firma requerida: la
   autoridad del juego, que es también la pagadora. Hay un test que lo verifica.
2. **Marcar primero, llamar después.** Ante una escritura, inserta la
   `Idempotency-Key` en SQLite *antes* de tocar Solana. Invertir el orden mintea dos veces.
3. **Cero vocabulario de cadena en `addon/`.** Ni `solana`, ni `pubkey`, ni `lamport`,
   ni `blockhash`, ni `base58`, ni `spl`, ni la palabra que designa la cuenta de acuñación.
   La CI lo comprueba con `grep`. Si aparece, la costura está rota.
4. **Rust en el cliente sólo para calcular, nunca para firmar ni para hablar con la cadena.**
   Sustituye al antiguo «GDScript puro» (decisión del 6-oct-2026, `docs/implementacion-android.md`
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
8. **Ningún programa on-chain propio.** Sólo programas ya desplegados.

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
| `backend/` | TypeScript, Node >= 22. El servicio y su suite de tests |
| `rust/` | Workspace de Cargo: `nidada-rules`, `nidada-ext`, `nidada-server` (hoy) y `godot-chain` (pendiente). Sustituye a `examples/game-server/` |
| `examples/godot-demo/` | Proyecto Godot de *Nidada* que ejecuta el hito |
| `docs/` | Contrato HTTP y notas de verificación |

## 4. Disciplina de sesión

- **Una sesión por bloque** de la sección 8 de la propuesta. Se empieza pegando el
  bloque. Se termina con CI en verde y commit. No se arrastra trabajo entre bloques.
- **Antes de tocar Token-2022, lee la documentación oficial vigente.** El orden de
  inicialización de extensiones y el cálculo de espacio TLV son exactamente el detalle
  que un modelo reconstruye de memoria y se inventa a medias. Leer, no recordar.
- **Tests antes que implementación en dos sitios y sólo dos:** los vectores fijos de
  derivación de claves (bloque 2) y el invariante de firmante único (bloque 3).
- **Commits pequeños y frecuentes.**

## 5. Estado actual

- Bloque 1 (esqueleto, contrato, CI): **hecho**.
- Juego *Nidada* (`rust/`, `examples/godot-demo/`): J1 (cuidado) y J5 (amigos y visitas) hechos,
  con límites por IP, tokens con hash y decisiones previas a J3/J4 en `docs/plan-juego.md` §9.
  No habla aún con `godot-chain`.
- Siguiente: bloque 2 — configuración, derivación de claves con vectores de test,
  SQLite, idempotencia, máquina de estados de operaciones.
- Ver `docs/verificaciones.md` para lo que hay que comprobar contra devnet antes de
  escribir el bloque 3, y `docs/preguntas-tutor.md` para lo que bloquea el proyecto.

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
