# Entregables del máster

Estado de lo que exige la propuesta, 0.1, a 22 de noviembre de 2026. La entrega es **actualizar el
repositorio y un vídeo de 5 minutos** (revisión del 21 de noviembre): no hay memoria ni defensa. Entrega:
**30 de noviembre de 2026**; un día de retraso cuesta un 10 %.

| Entregable | Estado | Dónde |
|---|---|---|
| Repositorio público | Hecho | `main` es la rama de entrega (`f85d435`) |
| `LICENSE` | Hecho | `LICENSE` declara la licencia dual y apunta a `LICENSE-MIT` y `LICENSE-APACHE` |
| 5 tests o más | Hecho | Unos 200 en el backend, 30 del programa con LiteSVM, 15 del servidor de juego y la suite del addon |
| Programa Anchor en devnet, Program ID en el README | Hecho | README, «Programa `chain-assets`» |
| Diagramas de arquitectura y de flujo de datos, en Mermaid | Hecho | `docs/diagramas.md`: 7 diagramas, comprobados con Mermaid 11. Exportados en `docs/diagramas.pdf` |
| 5 capturas o más en `screenshots/` | Hecho | 5 en devnet y la demo en MOCK, enlazadas en el README. Lista abajo |
| Vídeo de 5 minutos como máximo | **Guion hecho** | `docs/seguimiento/guion-video.md` |
| README: descripción, problema, tecnologías, arquitectura, instalación, Program ID, casos de uso, innovaciones | Hecho | README |
| README: diagramas, capturas, vídeo, uso de IA, autor | Hecho, salvo el enlace del vídeo | README |

## Capturas

Las cinco que piden las instrucciones (principal, formulario, datos, transacción en el explorador y
verificación), del juego `estudio-b` en devnet, el 22 de noviembre, y la de la demo. Los nombres siguen los de
las instrucciones, con número para que se ordenen solos. `Godot-chain - Capturas de pantalla.pdf` las reúne con
un índice.

| Fichero | Qué enseña | De dónde |
|---|---|---|
| `1 - Dashboard principal.png` | El listado de catálogo: cinco tipos en dos colecciones, todos en `settled`, con sus cualidades y la operación que los creó | Consola, `#catalog` |
| `2 - Formulario de registro.png` | Un tipo nuevo relleno: cualidades, existencias iniciales para `game-reserve` y la `Idempotency-Key` que sale del identificador de llamada | Consola, `#items` |
| `3 - Visualización de datos.png` | El inventario de `player-a`, leído de la cadena | Consola, `#inventory` |
| `4 - Transacción confirmada.png` | Una transferencia de «Moneda 2» de `player-a` a `player-b`, `pending → applied → settled`, y su transacción en el explorador: correcta y finalizada | Consola, `#operations`, y Explorer de Solana |
| `5 - Verificación exitosa.png` | El inventario de `player-a` con su cuenta y los mints enlazados, junto a la pestaña Tokens de esa transferencia en el explorador: coinciden la cuenta (`CzZ1M5…`), el mint (`HojYaK…`) y el saldo (299) | Consola, `#inventory`, y Explorer de Solana |
| `demo-mock.png` | La demo en modo MOCK, sin red | Godot |

Queda sin hacer, y no hace falta para el mínimo: una captura de la demo en LIVE tras una transferencia. Sale en
el vídeo.

**Qué es aquí la «verificación exitosa de certificado/trazabilidad».** El «certificado» es el ítem del
jugador. Verificarlo es comprobar en la cadena, sin fiarse del backend, que la cuenta del jugador tiene
ese mint con la cantidad que da la consola, y que la autoridad del mint es la PDA `Game` del juego
(`mint::authority = game`): nadie fuera de `chain-assets` puede emitir un ítem que pase por bueno. La captura 5
enseña la primera mitad, el saldo; la autoridad del mint se ve en el vídeo (guion, bloque 4, paso 5).

Las capturas se sacaron a mano, con la consola y el explorador lado a lado. Para rehacerlas, la consola enlaza
desde el inventario la cuenta del jugador y cada mint al explorador.
