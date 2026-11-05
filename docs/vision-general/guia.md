# Visión general de `godot-chain`

## Índice

- [Qué es](#qué-es)
- [Quién participa](#quién-participa)

## Qué es

`godot-chain` permite a un juego de Godot 4 crear objetos que existen como activos reales en Solana y transferirlos entre jugadores, sin que el jugador vea la cadena: nadie usa una wallet y las transacciones las firma el backend.

## Quién participa

Cada actor tiene su propia credencial. El programa `chain-assets` sólo conoce a la autoridad del juego; el resto de permisos los aplica el backend, salvo los del jugador, que no tiene ninguno.

| Actor | Credencial | Qué puede hacer | Dónde vive |
|---|---|---|---|
| **Autoridad del juego** | Clave derivada de la semilla maestra | Firmar y pagar todas las transacciones, y cambiar de autoridad con `rotate_authority` | Backend |
| **Servidor de juego** | `write_key` | Pedir escrituras: crear, entregar y transferir | Servidor del estudio |
| **Administrador del estudio** | Credencial propia y cookie de sesión | Usar el dashboard | Navegador, contra el backend |
| **Cliente del juego** | `read_token` | Sólo leer inventarios y operaciones; es público de facto | Binario del juego |
| **Jugador** | Ninguna | Tener activos, identificado con un `hld_…`; no firma nada | Dirección derivada |
