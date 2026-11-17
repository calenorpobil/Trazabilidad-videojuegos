# Demo del hito

Una escena de Godot 4.7.2 que ejecuta la parte del juego del hito (propuesta, sección 7): ver los inventarios
de los jugadores A y B y dar unidades de A a B. Cada transferencia muestra su estado
(`pending → applied → settled`). No tiene arte ni reglas de juego.

**El juego no crea objetos.** La colección y el tipo, con su entrega inicial al jugador A, los crea el estudio
desde la consola del backend (`/admin`). El servidor de juego rechaza crear: si lo hiciera desde el cliente,
cualquier jugador podría crearse lo que quisiera.

Las transferencias van del juego al servidor de juego de ejemplo (`examples/game-server`), que decide que quien
da es el jugador A y las reenvía al backend con el `write_key`. Las lecturas van directas al backend con el
`read_token`. En devnet `applied` y `settled` llegan casi a la vez (verificaciones, V18).

`addons/godot_chain` es una copia de `addon/addons/godot_chain`, como la tendría cualquier juego. La CI
comprueba que las dos son idénticas: si cambias el addon, cópialo de nuevo.

## Sin red: modo MOCK

Sin `CHAIN_DEMO_READ_TOKEN`, la demo arranca en modo MOCK, responde en memoria y se crea un tipo de prueba
con 3 unidades para A. Abre el proyecto en el editor y ejecútalo.

## En devnet: modo LIVE

Hacen falta tres procesos: backend, servidor de juego y demo. Las variables pueden ir en un fichero fuera
del repositorio que se carga con `source` en cada terminal.

```bash
export CHAIN_GAME_ID=chain-demo                       # [a-z0-9-], de 1 a 32, único en devnet
export CHAIN_MASTER_SEED_FILE=/fuera/del/repo/chain-demo.seed
export CHAIN_WRITE_KEY=...                            # openssl rand -hex 32, las tres distintas
export CHAIN_READ_TOKEN=...
export CHAIN_ADMIN_KEY=...
export GAME_SERVER_WRITE_KEY=$CHAIN_WRITE_KEY         # el servidor de juego es quien tiene el write_key
export CHAIN_DEMO_READ_TOKEN=$CHAIN_READ_TOKEN        # el juego sólo tiene el read_token
```

1. **Crear el juego, una vez.** `cd backend && npm run init-game`. Imprime la autoridad del juego. Si no
   tiene fondos, lo dice y da el comando para financiarla; se financia y se repite. Si el juego ya existe,
   no hace nada.
2. **Backend.** `cd backend && npm start`. Escucha en `127.0.0.1:8787`.
3. **Crear el objeto en la consola.** Entra en `http://127.0.0.1:8787/admin` con `CHAIN_ADMIN_KEY`. Crea una
   colección y, dentro, un tipo con sus cualidades y una entrega inicial a `player-a`. Espera a que su
   operación llegue a `settled`. Para probar, `npm run seed-demo` en `examples/game-server/` crea una colección
   y tres tipos de una vez, y repetirlo no duplica nada.
4. **Servidor de juego.** `cd examples/game-server && npm ci && npm start`. Escucha en `127.0.0.1:8788`.
   El jugador que da es `player-a` (`GAME_SERVER_PLAYER`).
5. **Demo.** Ejecuta el proyecto con `CHAIN_DEMO_READ_TOKEN` en el entorno. Muestra lo que tienen `player-a`
   y `player-b`; cada tipo de A tiene su botón «Dar 1 a B». `CHAIN_DEMO_WRITE_URL` y `CHAIN_DEMO_READ_URL`
   cambian las direcciones por defecto.

Las transacciones se ven en la consola: cada operación enlaza a su transacción en el explorador. La demo no
las enseña, porque no sabe qué hay debajo.

Cada línea del inventario muestra el identificador del tipo: dos tipos pueden llamarse igual y ser activos
distintos, que no se suman ni se mueven juntos.
