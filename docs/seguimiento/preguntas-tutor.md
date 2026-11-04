# Preguntas para el tutor

Sección 14 de la propuesta. **No las responde quien implementa.** La primera puede
invalidar el proyecto entero, así que se preguntan cuanto antes.

Estado a 6 de septiembre de 2026: **ninguna respondida**. El bloque 1 se ha ejecutado
igualmente porque el esqueleto, el contrato HTTP y la CI sobreviven a cualquiera de las
respuestas; los bloques 2 y 3 **no**, y por eso Q1 y Q2 tienen que estar cerradas antes
de empezar el bloque 2.

| # | Pregunta | Si la respuesta es la que no esperamos | Estado |
|---|---|---|---|
| Q1 | ¿El PFM exige escribir un programa on-chain propio (Anchor)? Esta propuesta usa exclusivamente programas ya desplegados | Hay que **rediseñar** el proyecto, no ajustarlo. Invalida las secciones 3, 4 y 8 enteras | Sin responder |
| Q2 | ¿Se exige que el backend esté en Rust? | Entre 8 y 12 horas más de presupuesto, y aplicar la línea de corte 8.1 desde el principio | Sin responder |
| Q3 | ¿Basta con devnet o hay que demostrar algo en mainnet? | Mainnet está fuera de alcance y tiene coste real | Sin responder |
| Q4 | ¿La memoria escrita y la presentación cuentan dentro de las 40 horas o van aparte? | El plan de la sección 8 asume que van aparte, salvo el bloque 10 | Sin responder |
| Q5 | ¿Hay que desplegar el backend en un servidor público o basta con ejecutarlo en local durante la defensa? | Un despliegue público añade trabajo no presupuestado | Sin responder |
| Q6 | ¿El proyecto debe ser original respecto a la propuesta de la que deriva, o se admite explícitamente como versión reducida de ella? | — | Sin responder |
| Q7 | ¿Se aceptan unas 44 h de librería en lugar de 40 h por usar Rust en el cliente (`docs/implementacion-android.md`, §13), o se aplica la línea de corte 8.1 desde el principio? | Sin respuesta, el plan de esa sección no tiene presupuesto | Sin responder |

## Supuestos que conviene confirmar de paso

Sección 0.1 de la propuesta. No constan por escrito.

| # | Supuesto | Cómo lo cumple el proyecto |
|---|---|---|
| R1 | Uso real y no trivial de Solana | Transacciones reales en devnet con Token-2022 y la extensión de metadatos |
| R2 | Producto demostrable de extremo a extremo | Hito de la sección 7, ejecutable en vivo desde Godot |
| R3 | Decisiones de arquitectura justificadas | Secciones 3, 4 y 12 de la propuesta |
| R4 | Calidad de ingeniería: tests, CI, documentación | Secciones 9 y 8, bloques 7 y 10 |
| R5 | Alcance realista para el tiempo disponible | Sección 8, con presupuesto horario y línea de corte |
