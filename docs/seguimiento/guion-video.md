# Guion del vídeo

Lo que pide el máster (propuesta, 0.1): **5 minutos como máximo, estricto**, 720p o más, con voz, una
demostración práctica con **una transacción en un explorador** y un enlace público. Pesa un 15 % de la
nota. El guion es el hito (propuesta, 7), como dice la propia propuesta.

**Objetivo: 4:30.** El margen es para no rozar el límite al montar. Si algo se alarga, se recorta el
bloque 6, no la demostración.

---

## Antes de grabar

### Preparación

- [ ] **Saldo de la autoridad.** `npm run init-game` lo imprime. Con 0,05 SOL hay de sobra para una toma.
- [ ] **Si la autoridad está en OpenBao:** OpenBao arrancado y con la clave, y el backend con
      `CHAIN_AUTHORITY_SIGNER=transit`. Es lo que se enseña en el bloque 5. Con OpenBao en modo `-dev`
      todo se pierde al pararlo: no se para entre tomas.
- [ ] Backend (`npm start`), servidor de juego (`npm start`) y demo con `CHAIN_DEMO_READ_TOKEN`, como en
      `docs/vision-general/lanzar-el-proyecto.md`, sección 4.
- [ ] **El catálogo de la toma no existe todavía.** Se crea en el vídeo. Para que A tenga más de un tipo
      sin esperar, crear antes uno con `npm run seed-demo` (con un `SEED_TAG` nuevo).
- [ ] Una transferencia de A a B ya hecha y en `settled`, por si devnet tarda en la toma: su enlace al
      explorador sirve de plan B para el bloque 4.
- [ ] Pestañas abiertas: la consola en `http://127.0.0.1:8787/admin`, `docs/diagramas.md` en GitHub (los
      diagramas se ven renderizados) y el programa en el explorador
      (`https://explorer.solana.com/address/4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz?cluster=devnet`).
- [ ] Grabación a 1280×720 o 1920×1080, con el micrófono probado. Zoom del navegador al 125 % para que
      se lea el texto a 720p.

### Lo que no puede salir en pantalla

- **`~/.godot-chain/env.sh`, la semilla, `CHAIN_ADMIN_KEY`, `CHAIN_WRITE_KEY` y el token de OpenBao.** Ni en
  una terminal ni en el historial de la shell. Las terminales se graban ya arrancadas, o no se graban.
- El `read_token` es público de facto (limitación 5), pero tampoco hace falta enseñarlo.
- Notificaciones del sistema: modo «no molestar».

---

## Guion

Los tiempos son acumulados. Lo que va entre comillas es una propuesta de voz, no un texto que leer.

### 1. El problema (0:00 – 0:30)

**Pantalla:** el README en GitHub, arriba del todo.

«Un estudio que quiere que los objetos de su juego sean activos reales en Solana se encuentra con tres
problemas: el jugador tiene que entender la cadena, con wallet, frase semilla y comisiones; el
desarrollador tiene que escribir código on-chain; y si el juego firma, la clave viaja dentro del binario.
`godot-chain` es un addon de Godot 4 que resuelve los tres: el juego llama a una API en GDScript que no
habla de la cadena, y los objetos son tokens Token-2022 reales.»

### 2. Arquitectura (0:30 – 1:05)

**Pantalla:** `docs/diagramas.md`, diagrama 1.

- El juego **sólo lee** directamente. Las escrituras van al servidor de juego, que decide si se permiten
  y quién da, y las reenvía con su credencial. «Una clave dentro del binario se extrae en minutos, y
  quien decide qué se gana un jugador no puede ser el cliente.»
- El backend custodia las claves, registra cada escritura **antes** de tocar Solana y firma con **una
  sola firma**: la autoridad del juego, que también paga. El jugador no firma nunca.
- El programa `chain-assets` tiene los poderes sobre los activos a través de una PDA, y los ejerce por
  CPI sobre Token-2022.

### 3. El estudio crea el catálogo (1:05 – 2:00)

**Pantalla:** la consola `/admin`.

1. Entrar con la clave de administración (campo de contraseña: no se ve).
2. **Colecciones:** crear «Arsenal». «Una colección no toca la cadena: es una agrupación del catálogo.»
3. **Tipos de ítem:** «Arco de tejo», símbolo `BOW`, cualidades `rarity: rare` y `range: 30`,
   entrega inicial de 5 unidades a `player-a`. Enviar.
4. **Operaciones:** la operación aparece en `pending` y pasa a `settled`. «`applied` es que la red la ha
   aceptado; `settled`, que es definitiva. El juego sólo guarda estado en `settled`.»
5. Abrir su enlace al explorador. Señalar: **una sola firma**, el programa `chain-assets`, y dentro las
   instrucciones de Token-2022 (creación del mint con sus extensiones y la acuñación). Abrir el mint:
   los metadatos (nombre, símbolo y cualidades) están en el propio mint, sin Metaplex.

### 4. El juego transfiere (2:00 – 3:15) — el centro del vídeo

**Pantalla:** la demo de Godot, en modo LIVE.

1. «Releer inventarios»: A tiene 5 arcos y B ninguno. «El juego conoce a sus jugadores por su propio
   identificador, `player-a`. No hay direcciones ni wallets en ninguna parte.»
2. Pulsar **«Dar 1 a B»** en la línea del arco. La línea de la operación pasa por `pending → applied → settled`. «En devnet
   `applied` y `settled` llegan casi a la vez.»
3. Los inventarios se actualizan: A tiene 4 arcos, B tiene 1.
4. Volver a la consola, **Operaciones**: la transferencia, en `settled`. Abrir su enlace al explorador.
   **Esta es la transacción del vídeo.** Señalar:
   - Una sola firma, la de la autoridad. «Ni A ni B han firmado: la PDA del juego mueve las unidades
     como delegado permanente.»
   - La instrucción `transfer` de `chain-assets` y, dentro, la transferencia de Token-2022 por CPI.
   - Los cambios de saldo de los dos tenedores.
5. **Inventario** en la consola, `player-b`: 1 arco, leído de la cadena.

### 5. Seguridad y fiabilidad (3:15 – 3:55)

**Pantalla:** `docs/diagramas.md`, diagramas 2 y 7.

- **Idempotencia.** «Cada escritura lleva una clave que el addon calcula a partir de un identificador del
  juego. Se guarda antes de llamar a Solana, así que si la red falla y el juego repite la petición, la
  operación no se ejecuta dos veces.»
- **Simular antes de aceptar.** Si el emisor no tiene saldo o la autoridad no puede pagar, la respuesta es
  un error claro y la clave no se guarda.
- **La autoridad, en OpenBao.** «La clave que lo controla todo puede no salir nunca de OpenBao: el backend
  le pide cada firma y la comprueba. Se rota con una instrucción, `rotate_authority`, sin tocar los
  activos, porque los poderes son de la PDA.»

### 6. Programa, calidad y uso de IA (3:55 – 4:30)

**Pantalla:** el programa en el explorador (Program ID), y la pestaña de Actions de GitHub en verde.

- «`chain-assets` tiene cinco instrucciones, cada una con sus tests negativos: 30 tests con LiteSVM. El
  backend tiene unos 200 tests, y la CI comprueba además que el addon no menciona la cadena, no usa hilos
  y no lleva binarios.»
- Una frase sobre Claude Code: el `CLAUDE.md` con los invariantes, una sesión por bloque y la regla de
  leer la documentación de Token-2022 en vez de recordarla.
- Cierre: «Sólo devnet, y con las limitaciones escritas en el README. El código y estos diagramas están
  en el repositorio.»

---

## Después de grabar

- [ ] Duración **menor de 5:00** en el fichero final, no en el montaje.
- [ ] Revisar a 720p que se leen los estados y la firma del explorador.
- [ ] Subir con enlace público (YouTube «oculto» sirve si cualquiera con el enlace puede verlo) y probar
      el enlace en una ventana privada.
- [ ] Poner el enlace en el README, sección «Vídeo».
