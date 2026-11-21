# Visión general de `godot-chain`

## Índice

- [Qué es](#qué-es)
- [Quién participa](#quién-participa)
- [Credenciales y semilla](#credenciales-y-semilla)
- [El hueco del ejemplo: quién es el jugador](#el-hueco-del-ejemplo-quién-es-el-jugador)
- [Los roles sin roles en la cadena](#los-roles-sin-roles-en-la-cadena)
- [Quién manda sobre los activos](#quién-manda-sobre-los-activos)
- [Cómo llama el backend al programa](#cómo-llama-el-backend-al-programa)

## Qué es

`godot-chain` permite a un juego de Godot 4 crear objetos que existen como activos reales en Solana y transferirlos entre jugadores, sin que el jugador vea la cadena: nadie usa una wallet y las transacciones las firma el backend.

## Quién participa

Cada actor tiene su propia credencial, salvo la autoridad, que tiene una clave, y el jugador, que no tiene nada
(ver [Credenciales y semilla](#credenciales-y-semilla)). El programa `chain-assets` sólo conoce a la autoridad del juego; el resto de permisos los aplica el backend, salvo los del jugador, que no tiene ninguno.

| Actor | Credencial o clave | Qué puede hacer | Dónde vive |
|---|---|---|---|
| **Autoridad del juego** | Clave derivada de la semilla maestra | Firmar y pagar todas las transacciones, y cambiar de autoridad con `rotate_authority` | Backend |
| **Servidor de juego** | `write_key` | Pedir transferencias; la creación la rechaza con `403` | Servidor del estudio |
| **Administrador del estudio** | Credencial propia y cookie de sesión | Crear colecciones y tipos, con la entrega inicial, desde el dashboard | Navegador, contra el backend |
| **Cliente del juego** | `read_token` | Sólo leer inventarios y operaciones; es público de facto | Binario del juego |
| **Jugador** | Ninguna | Tener activos, identificado con un `hld_…`; no firma nada | Dirección derivada |

## Credenciales y semilla

Son dos cosas distintas, y conviene no mezclarlas:

- Una **credencial** es un permiso para *pedirle algo al backend*. Es un texto secreto compartido: quien
  lo presenta, entra por las rutas que le corresponden. No sirve de nada fuera del backend.
- La **semilla maestra** no es una credencial: no se presenta ante nadie ni abre ninguna ruta. Es el
  material del que el backend *deriva las claves*: la de la autoridad, que firma en la cadena, y las
  direcciones de los jugadores.

### Las tres credenciales

| Credencial | La tiene | Qué abre | Dónde se comprueba |
|---|---|---|---|
| `write_key` (`CHAIN_WRITE_KEY`) | El servidor de juego, como `GAME_SERVER_WRITE_KEY` (`examples/game-server/src/main.ts`) | Las escrituras del contrato | `backend/src/server.ts`, al principio de cada escritura |
| `read_token` (`CHAIN_READ_TOKEN`) | El juego: va en el binario (`addon/addons/godot_chain/chain_config.gd`) | Sólo lecturas: inventarios, catálogo y operaciones. Tiene un límite por IP, porque se considera público (`backend/src/rate-limit.ts`) | `backend/src/server.ts`, al principio de cada lectura |
| `CHAIN_ADMIN_KEY` | El equipo del estudio | La consola `/admin`. Se cambia por una cookie de sesión | `backend/src/admin.ts`, en `POST /admin/api/session` |

El backend se protege de que se mezclen:

- **Tienen que ser distintas.** El backend no arranca si dos coinciden (`backend/src/config.ts`): quien
  extraiga el `read_token` del binario no puede así escribir ni entrar en la consola.
- **La consola no reparte credenciales de la API.** El navegador del estudio nunca recibe el `write_key`
  ni el `read_token`.
- **Se comparan en tiempo constante**, sobre su SHA-256 (`timingSafeEqual`), para que el tiempo de
  respuesta no dé pistas.

### La semilla maestra

Llega al backend por `CHAIN_MASTER_SEED` o por un fichero, `CHAIN_MASTER_SEED_FILE`, que en Linux y macOS debe
tener permisos `0600` (`backend/src/config.ts`). El backend deriva de ella, con HKDF
(`backend/src/keys.ts`):

```
semilla maestra ──"authority"──────► clave de la autoridad: firma y paga todas las transacciones
               └──"player:<id>"────► clave de cada jugador: sólo da su dirección, nunca firma
```

Nunca sale del backend: ni el servidor de juego, ni el juego ni la consola la ven.

### Qué pasa si se filtra cada una

| Se filtra | Consecuencia | Remedio |
|---|---|---|
| `read_token` | Cualquiera lee los inventarios del juego. Se da por hecho: es público | Ninguno necesario; el límite por IP frena el abuso |
| `write_key` | Cualquiera escribe como el servidor de juego, y con más poder: el backend acepta cualquier emisor en una transferencia y también la creación de tipos con su entrega inicial, porque el `403` lo pone el servidor de juego, no el backend | Cambiar `CHAIN_WRITE_KEY` en el backend y en el servidor de juego. La cadena no se toca |
| `CHAIN_ADMIN_KEY` | Cualquiera crea colecciones y tipos desde la consola, y con ellos emite unidades | Cambiarla y reiniciar el backend. La cadena no se toca |
| **Semilla maestra** | **Quien la tenga controla todos los activos del juego**: deriva la clave de la autoridad y firma lo que quiera | El procedimiento de rotación del README, que es una carrera contra quien la tiene |

Por eso son de naturaleza distinta: una credencial filtrada se cambia y se olvida; la semilla filtrada
compromete el juego entero. Es la limitación 2 del README, y lo que mejoraría guardarla en OpenBao
(`docs/seguimiento/verificaciones.md`, P12).

## El hueco del ejemplo: quién es el jugador

Entre el juego y el servidor de juego **no hay credencial**. El servidor de juego de ejemplo
(`examples/game-server/src/server.ts`) acepta todas las peticiones que le llegan y pone siempre como
emisor de una transferencia al jugador configurado en `GAME_SERVER_PLAYER` (por defecto, `player-a`).
No sabe quién le escribe.

Es a propósito: saber qué jugador hace cada petición es la **autenticación del estudio**, no de la
librería. Cada juego ya tiene la suya: cuentas propias, Steam, la consola o el servicio que use. El
servidor de juego es el sitio donde encaja: valida la sesión del jugador, decide si la acción está
permitida y pone como emisor a *ese* jugador, en vez de uno fijo. `godot-chain` deja el hueco y no
impone ningún sistema de cuentas.

Sin esa autenticación, cualquiera que llegue al servidor de juego puede mover los objetos del jugador
configurado. Por eso el ejemplo escucha por defecto sólo en `127.0.0.1` (`GAME_SERVER_HOST`), y por eso es un ejemplo y no un servidor
para producción (README, limitación 12).

## Los roles sin roles en la cadena

`chain-assets` no define roles: la autoridad del juego puede hacerlo todo y nadie más puede hacer nada.
Los roles los hacen tres piezas, cada una con su credencial, y el backend decide qué rutas acepta cada
credencial. Al final, todas las operaciones las firma la misma autoridad.

- **Dashboard** (`/admin`, con `CHAIN_ADMIN_KEY`): es el **administrador**. El estudio crea desde aquí las
  colecciones y los tipos, y hace la entrega inicial. También consulta las operaciones y los inventarios.
- **Servidor de juego** (con el `write_key`): es el **operador**. Decide qué puede hacer cada jugador,
  registra cada escritura antes de llamar al backend y la reenvía. Sólo deja pasar transferencias, y el
  emisor lo pone él: si el juego manda un `from`, lo rechaza. A la creación de colecciones o tipos
  responde `403`, para que un jugador no pueda crearse los objetos que quiera.
- **Juego** (el addon, con el `read_token`): es el **lector**. Lee inventarios y operaciones directamente
  del backend. Para escribir, pasa siempre por el servidor de juego, porque no tiene el `write_key`. El
  `read_token` va dentro del binario, así que se considera público.

Con esta separación, el binario no lleva ninguna credencial que permita escribir. La contrapartida es que
la separación sólo existe en el backend: si alguien lo compromete, en la cadena no hay ningún rol que
limite el daño, y lo único que queda es cambiar la clave con `rotate_authority`.

**Trabajo futuro: la consola con wallet.** El estudio podría entrar al dashboard con una wallet, en vez de
con `CHAIN_ADMIN_KEY`. Eso sólo cambiaría cómo se autentica: todas las operaciones las seguiría firmando la
autoridad del juego. Para que la wallet tuviera poder propio en la cadena, el programa necesitaría un rol de
administrador aparte (ver el README, «Trabajo futuro»).

## Quién manda sobre los activos

Los derechos los tiene la cuenta `Game`, una PDA del programa; la que decide es la autoridad del juego.
`Game` es a la vez la autoridad de emisión, la de actualización y el delegado permanente de todos los
activos del juego (propuesta, 4.7). Como una PDA no tiene clave privada, no puede firmar una transacción:
sólo el programa puede firmar en su nombre, y sólo cuando la autoridad guardada en `Game` lo pide.

```
autoridad firma ──► chain-assets comprueba game.authority ──► firma como Game (CPI) ──► Token-2022 obedece a Game
```

Por eso cambiar de autoridad (`rotate_authority`) no obliga a tocar ningún activo: cambia quién puede
dar órdenes a `Game`, y `Game` sigue siendo la misma.

## Cómo llama el backend al programa

El IDL (*Interface Definition Language*) es un JSON que `anchor build` genera a partir del programa.
Describe las instrucciones, sus cuentas (cuáles firman y cuáles son escribibles), sus argumentos y tipos,
los discriminadores, los eventos y los errores. Sirve para que otros lenguajes sepan cómo llamar al
programa sin leer el Rust.

Aquí vive en `backend/idl/chain_assets.json`, copiado desde la compilación en WSL. `npm run codegen`
ejecuta `backend/scripts/codegen.mjs`, que lo lee para que Codama escriba el cliente TypeScript.

## Vocabulario

call_id: el nombre que el juego le da a una acción. Lo elige el juego y tiene sentido para él: "regalo-42", "compra-7". Es un argumento de las funciones de Chain (Chain.transfer(..., "regalo-42")). El juego nunca ve HTTP.
Clave de idempotencia (Idempotency-Key): una cabecera HTTP que el backend usa para detectar repeticiones. Si llega una clave que ya vio, devuelve la respuesta anterior en vez de volver a ejecutar. Para el backend es un texto opaco: no sabe de dónde sale ni qué significa, sólo lo compara.
