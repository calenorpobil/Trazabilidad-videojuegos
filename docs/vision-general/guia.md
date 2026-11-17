# Visión general de `godot-chain`

## Índice

- [Qué es](#qué-es)
- [Quién participa](#quién-participa)
- [Los roles sin roles en la cadena](#los-roles-sin-roles-en-la-cadena)
- [Quién manda sobre los activos](#quién-manda-sobre-los-activos)
- [Cómo llama el backend al programa](#cómo-llama-el-backend-al-programa)

## Qué es

`godot-chain` permite a un juego de Godot 4 crear objetos que existen como activos reales en Solana y transferirlos entre jugadores, sin que el jugador vea la cadena: nadie usa una wallet y las transacciones las firma el backend.

## Quién participa

Cada actor tiene su propia credencial. El programa `chain-assets` sólo conoce a la autoridad del juego; el resto de permisos los aplica el backend, salvo los del jugador, que no tiene ninguno.

| Actor | Credencial | Qué puede hacer | Dónde vive |
|---|---|---|---|
| **Autoridad del juego** | Clave derivada de la semilla maestra | Firmar y pagar todas las transacciones, y cambiar de autoridad con `rotate_authority` | Backend |
| **Servidor de juego** | `write_key` | Pedir transferencias; la creación la rechaza con `403` | Servidor del estudio |
| **Administrador del estudio** | Credencial propia y cookie de sesión | Crear colecciones y tipos, con la entrega inicial, desde el dashboard | Navegador, contra el backend |
| **Cliente del juego** | `read_token` | Sólo leer inventarios y operaciones; es público de facto | Binario del juego |
| **Jugador** | Ninguna | Tener activos, identificado con un `hld_…`; no firma nada | Dirección derivada |

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
