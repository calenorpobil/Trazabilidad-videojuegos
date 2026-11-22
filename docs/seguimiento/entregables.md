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
| Diagramas de arquitectura y de flujo de datos, en Mermaid | Hecho | `docs/diagramas.md`: 7 diagramas, comprobados con Mermaid 11 |
| 5 capturas o más en `screenshots/` | **1 de 7** | Lista abajo. Falta levantar el despliegue de devnet |
| Vídeo de 5 minutos como máximo | **Guion hecho** | `docs/seguimiento/guion-video.md` |
| README: descripción, problema, tecnologías, arquitectura, instalación, Program ID, casos de uso, innovaciones | Hecho | README |
| README: diagramas, capturas, vídeo, uso de IA, autor | Hecho, salvo el enlace del vídeo y las capturas de devnet | README |

## Capturas

Del dashboard web, como piden las instrucciones (principal, formulario, datos, transacción en el explorador y
verificación), y de la demo. Nombres con número para que se ordenen solas.

| Fichero | Qué enseña | Cómo |
|---|---|---|
| `01-consola-catalogo.png` | Listado de catálogo con tipos en `settled` y sus cualidades | Consola, `#catalog` |
| `02-consola-crear-tipo.png` | El formulario de un tipo, relleno: cualidades y entrega inicial | Consola, `#items` |
| `03-consola-operaciones.png` | Operaciones con su estado y el enlace a la transacción | Consola, `#operations` |
| `04-explorador-transferencia.png` | La transacción de una transferencia: una firma, `chain-assets` y Token-2022 | Explorer de Solana, devnet |
| `05-explorador-mint.png` | El mint de un tipo con sus metadatos y extensiones | Explorer de Solana, devnet |
| `06-consola-inventario.png` | Inventario de `player-b`, leído de la cadena | Consola, `#inventory` |
| `07-demo-live.png` | La demo con los inventarios de A y B tras una transferencia | Godot, `--write-movie` |
| `demo-mock.png` | La demo en modo MOCK, sin red | **Hecha** |

Las capturas de la consola y del explorador se sacan con Playwright contra el backend en marcha; las de Godot,
con `--write-movie`, que guarda los fotogramas sin capturar la pantalla. Al añadirlas, se enlazan en la sección
«Capturas» del README.
