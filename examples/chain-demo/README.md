# Demo del hito

Una escena de Godot 4.7.2 que ejecuta el hito de la propuesta (sección 7): crear una colección, crear un
objeto con cualidades y 3 unidades para el jugador A, transferir una unidad de A a B y ver los dos
inventarios. Cada operación muestra su estado (`pending → applied → settled`). No tiene arte ni reglas de juego.

Las escrituras van del juego al servidor de juego de ejemplo (`examples/game-server`), y de ahí al backend
con el `write_key`. Las lecturas van directas al backend con el `read_token`. En devnet `applied` y
`settled` llegan casi a la vez (verificaciones, V18).

`addons/godot_chain` es una copia de `addon/addons/godot_chain`, como la tendría cualquier juego. La CI
comprueba que las dos son idénticas: si cambias el addon, cópialo de nuevo.

## Sin red: modo MOCK

Sin `CHAIN_DEMO_READ_TOKEN`, la demo arranca en modo MOCK y responde en memoria. Abre el proyecto en el
editor y ejecútalo.

## En devnet: modo LIVE

Hacen falta tres procesos: backend, servidor de juego y demo. Las variables pueden ir en un fichero fuera
del repositorio que se carga con `source` en cada terminal.

```bash
export CHAIN_GAME_ID=chain-demo                       # [a-z0-9-], de 1 a 32
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
2. **Backend.** `cd backend && npm start`. Escucha en `127.0.0.1:8787`; la consola, en `/admin`.
3. **Servidor de juego.** `cd examples/game-server && npm ci && npm start`. Escucha en `127.0.0.1:8788`.
   El jugador que transfiere es `player-a` (`GAME_SERVER_PLAYER`).
4. **Demo.** Ejecuta el proyecto con `CHAIN_DEMO_READ_TOKEN` en el entorno y pulsa los botones en orden.
   `CHAIN_DEMO_WRITE_URL` y `CHAIN_DEMO_READ_URL` cambian las direcciones por defecto.

Las transacciones se ven en la consola (`http://127.0.0.1:8787/admin`, con `CHAIN_ADMIN_KEY`): cada
operación enlaza a su transacción en el explorador. La demo no las enseña, porque no sabe que hay una
cadena debajo.

Nada se guarda al cerrar la demo: cada ejecución empieza creando una colección. El backend y el servidor
de juego sí guardan lo suyo en SQLite.
