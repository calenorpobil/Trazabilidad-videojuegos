# Preguntas para el tutor

Sección 14 de la propuesta. **No las responde quien implementa.** Revisadas el 5 de
noviembre de 2026 contra las instrucciones de entrega y la documentación del máster, que
definen lo que se valora y lo que se exige. Sólo queda aquí lo que esos documentos no
resuelven.

## Abiertas, por orden de importancia

| # | Pregunta | Por qué se pregunta | Si la respuesta es la que no esperamos |
|---|---|---|---|
| Q9 | ¿Se admite un tema propio, una librería de activos para Godot, fuera de los cinco TFM que lista el máster? | El índice lista cinco, todos de trazabilidad o certificación, con su proyecto de referencia. Ningún documento menciona videojuegos ni dice si la lista es cerrada. El vídeo debe citar un «proyecto de referencia» de esa lista | **Puede invalidar el proyecto entero.** Habría que reorientarlo a uno de los cinco temas |
| Q11 | ¿Cuáles son las fechas reales de entrega? ¿Los avances intermedios son obligatorios? | El calendario es incoherente: avance 1 en la semana 1, avance 2 en la semana 3 y entrega final en la «semana 1». El retraso penaliza: −10 % a 1 día, −20 % a 2-3 días, y más de 3 días no se acepta | El plan de la sección 8 de la propuesta podría no caber. Hay que aplicar la línea de corte 8.1 |
| Q4 | ¿Hay memoria escrita o defensa, además del vídeo? | Las instrucciones no las incluyen entre los entregables obligatorios ni en la rúbrica, pero el enunciado y el índice dicen «escribir la memoria» (4-6 h) | Unas 4-6 h sin presupuestar |
| Q8 | ¿Las capturas «del dashboard» pueden ser de la demo de Godot y de un explorador? | Se piden al menos 5: dashboard, formulario, visualización de datos, transacción y verificación. La demo no es una web, y la consola de administración está bajo la línea de corte | La consola deja de ser recortable y hay que presupuestarla |
| Q10 | ¿Se admite adaptar la «estructura obligatoria» y el flujo con wallet a esta arquitectura, justificándolo en el README? | Las instrucciones piden `frontend/` y una wallet conectada, y el jugador de este proyecto no tiene wallet por diseño. También dicen «usa una arquitectura diferente si tiene sentido» y «justifica tu arquitectura» | Habría que añadir un frontend web con wallet, lo que contradice la premisa 1 de la propuesta |

## Resueltas por la documentación

| # | Pregunta | Respuesta | Fuente |
|---|---|---|---|
| Q1 | ¿Hace falta un programa on-chain propio? | **Sí:** Anchor, 5 instrucciones o más, PDAs, desplegado en devnet. Vale un 25 % de la nota. Ya incorporado como `chain-assets` (propuesta, 4.7) | Instrucciones, 7.1, 10 y 11 |
| Q2 | ¿Se exige el backend en Rust? | **No.** El modelo de README y los diagramas indican Node.js, como el nuestro | Instrucciones, 2.1 y 2.2 |
| Q3 | ¿Basta con devnet? | **Sí.** «Devnet es suficiente»; mainnet es opcional | Instrucciones, 10 |
| Q5 | ¿Hay que desplegar el backend en un servidor público? | **No se pide.** Lo único que debe estar desplegado es el programa. Es una deducción: los documentos no lo niegan de forma expresa | Instrucciones, 5.2 y 11 |
| Q6 | ¿Debe ser original? | **Sí, respecto al esqueleto base.** Se premia la diferenciación (15 %) y usar el esqueleto no es obligatorio. Hay que documentar las innovaciones y mencionarlas en el vídeo | Instrucciones, 7.2 y 8 |
| Q7 | ¿Se aceptan 48 h en lugar de 40 h? | **No hay límite de horas.** El índice orienta entre 30 y 55 h según el TFM. La cifra de 40 h no aparece en ningún documento del máster | Índice de documentación, flujos de estudio |
