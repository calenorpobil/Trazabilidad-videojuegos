# Preguntas para el tutor

Sección 14 de la propuesta. **No las responde quien implementa.** Revisadas el 5 de
noviembre de 2026 contra las instrucciones de entrega y la documentación del máster, que
definen lo que se valora y lo que se exige. Sólo queda aquí lo que esos documentos no
resuelven.

## Abiertas, por orden de importancia

| # | Pregunta | Por qué se pregunta | Si la respuesta es la que no esperamos |
|---|---|---|---|
| Q4 | ¿Hay memoria escrita o defensa, además del vídeo? | «Memoria» sólo aparece en dos sitios: el paso 9 de «Próximos pasos» del enunciado (70, línea 790) y los flujos de estudio del índice (10, líneas 223, 280, 308, 336 y 364: «Escribir memoria TFM (4-6 horas)»). Las instrucciones de entrega (20) no la nombran: ni en los entregables obligatorios, ni en la rúbrica, ni en el checklist final. La defensa no aparece en ninguno. **Por eso el plan no la incluye** | Unas 4-6 h sin presupuestar, ya sin margen |
| Q11 | ¿Los avances intermedios son obligatorios, y con qué fechas? | Las instrucciones (20, sección 6.1, líneas 573-574) citan el avance 1 (diseño y programa inicial, «semana 1») y el avance 2 (MVP y código en GitHub, «semana 3»), sin fechas reales. No aparecen en los entregables obligatorios, ni en la rúbrica, ni en el checklist final. La entrega final es el 30 de noviembre de 2026 | Habría que adelantar el programa y el MVP, que hoy se terminan el 21 y el 28 de noviembre |

## Resueltas por la documentación

| # | Pregunta | Respuesta | Fuente |
|---|---|---|---|
| Q1 | ¿Hace falta un programa on-chain propio? | **Sí:** Anchor, 5 instrucciones o más, PDAs, desplegado en devnet. Vale un 25 % de la nota. Ya incorporado como `chain-assets` (propuesta, 4.7) | Instrucciones, 7.1, 10 y 11 |
| Q2 | ¿Se exige el backend en Rust? | **No.** El modelo de README y los diagramas indican Node.js, como el nuestro | Instrucciones, 2.1 y 2.2 |
| Q3 | ¿Basta con devnet? | **Sí.** «Devnet es suficiente»; mainnet es opcional | Instrucciones, 10 |
| Q5 | ¿Hay que desplegar el backend en un servidor público? | **No se pide.** Lo único que debe estar desplegado es el programa. Es una deducción: los documentos no lo niegan de forma expresa | Instrucciones, 5.2 y 11 |
| Q6 | ¿Debe ser original? | **Sí, respecto al esqueleto base.** Se premia la diferenciación (15 %) y usar el esqueleto no es obligatorio. Hay que documentar las innovaciones y mencionarlas en el vídeo | Instrucciones, 7.2 y 8 |
| Q7 | ¿Se aceptan más de 40 h? | **No hay límite de horas.** El índice orienta entre 30 y 55 h según el TFM. La cifra de 40 h no aparece en ningún documento del máster. El plan está en 44 h | Índice de documentación, flujos de estudio |

## Resueltas por el responsable, 5 de noviembre de 2026

| # | Pregunta | Respuesta |
|---|---|---|
| Q8 | ¿Valen capturas de la demo como «dashboard»? | Deja de hacer falta: **habrá un dashboard web** (propuesta, sección 3) |
| Q9 | ¿Se admite un tema propio, fuera de los cinco TFM? | **Sí** |
| Q10 | ¿Se usa una wallet? | **No: el usuario no usará wallet.** Firma sólo la autoridad, desde el backend. Las instrucciones la dan por hecha (Phantom en los requisitos del README y en el checklist del vídeo), pero la rúbrica no la puntúa y admiten «una arquitectura diferente si tiene sentido». Se justifica en el README y se presenta como innovación |
| Q11 (fecha) | ¿Cuándo es la entrega? | **30 de noviembre de 2026.** Sigue abierto lo de los avances |
