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

Un **addon de Godot 4**, una GDExtension en Rust, que permite a un desarrollador crear
objetos de juego que existen como activos reales en Solana y transferirlos entre
jugadores, sin escribir código on-chain y sin que el jugador final sepa que hay una
blockchain debajo. El addon sólo calcula: no firma ni habla con la cadena, y su HTTP
pasa por `HTTPRequest` de Godot.

Proyecto de fin de máster. **Sólo devnet.** No apto para producción tal cual: ver
limitaciones.

## Arquitectura

```
Dispositivo del jugador
    Proyecto Godot 4  +  addon godot-chain (GDExtension en Rust)
        | escrituras                          | lecturas
        v                                     |
    game-server de ejemplo (nidada-server)    |
        | clave de escritura                  |
        v                                     v
    chain-backend  (TypeScript + SQLite)
        | claves derivadas de una semilla maestra por juego
        v
    Solana devnet  -  Token-2022
```

Las **escrituras** van del juego al servidor de juego y de ahí al backend, nunca
directas: la credencial que autoriza operaciones no puede viajar dentro del binario del
juego, y quien decide que un jugador se ha ganado un objeto tiene que ser un servidor
autoritativo, no el cliente. Las **lecturas** van directas del juego al backend con un
token de sólo lectura.

## Estructura del repositorio

| Directorio | Contenido |
|---|---|
| `addon/addons/godot_chain/` | El addon. Hoy, un esqueleto en GDScript; será el envoltorio de la GDExtension |
| `backend/` | El servicio: TypeScript, Node >= 22, SQLite |
| `rust/` | Workspace de Cargo: reglas, GDExtension y servidor de *Nidada*. `godot-chain` irá aquí, aún no existe |
| `examples/godot-demo/` | Proyecto Godot que ejecuta el hito |
| `docs/especificacion/propuesta-pfm.md` | **La especificación.** Única fuente de verdad |
| `docs/especificacion/http-contract.md` | **Contrato HTTP, congelado.** El artefacto del que cuelga todo |
| `docs/seguimiento/verificaciones.md` | Hechos comprobados, con fecha, y lo que falta por comprobar |
| `docs/seguimiento/preguntas-tutor.md` | Lo que bloquea el proyecto y no decide quien implementa |
| `docs/juego/` | Diseño y plan del juego de ejemplo, *Nidada* |
| `docs/archivo/` | Documentos superados. Sólo contexto |

## Estado

**Librería:** bloque 1 de 10 completado (esqueleto, contrato congelado, CI). El backend
y el addon todavía no hacen nada. Plan de trabajo en la sección 8 de
`docs/especificacion/propuesta-pfm.md`.

**Juego de ejemplo, *Nidada*:** fases J1 (cuidado) y J5 (amigos y visitas) hechas, en
escritorio. Todavía no usa `godot-chain`. Plan en `docs/juego/plan.md`.

## Requisitos

- Node >= 22 (desarrollado con 24.12.0)
- Rust 1.94.0, fijado en `rust/rust-toolchain.toml`. En Windows, ver `rust/README.md`
- Godot 4.7.1

## Desarrollo

```bash
cd backend
npm ci
npm run typecheck
npm run lint
npm test

cd ../rust
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

## Procedimiento de rotación ante compromiso de la semilla

Escrito, no implementado:

1. Generar una semilla maestra nueva y una autoridad nueva.
2. Para cada activo existente, transferir la autoridad de emisión a la nueva autoridad.
3. Para cada tenedor, mover su saldo a la dirección derivada de la nueva semilla usando
   el delegado permanente antiguo, mientras siga siendo válido.
4. Republicar el mapa `holder_id` -> dirección.
5. Destruir la semilla comprometida.

El paso 3 depende de si el delegado permanente puede reasignarse tras la creación del
activo: pendiente de verificar (`docs/seguimiento/verificaciones.md`, P2).

## Licencia

MIT OR Apache-2.0. Ver `LICENSE-MIT` y `LICENSE-APACHE`.
