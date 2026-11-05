# Roles del proyecto

## Índice

- [Descripción](#descripción)
- [Roles](#roles)

## Descripción

Quién participa en `godot-chain`, con qué credencial y qué puede hacer. Nadie usa una wallet.

## Roles

Cada actor tiene su propia credencial. El programa `chain-assets` sólo conoce a la autoridad del juego; el resto de permisos los aplica el backend, salvo los del jugador, que no tiene ninguno.

| Actor | Credencial | Qué puede hacer | Dónde vive |
|---|---|---|---|
| **Autoridad del juego** | Clave derivada de la semilla maestra | Firmar y pagar todas las transacciones, y cambiar de autoridad con `rotate_authority` | Backend |
| **Servidor de juego** | `write_key` | Pedir escrituras: crear, entregar y transferir | Servidor del estudio |
| **Administrador del estudio** | Credencial propia y cookie de sesión | Usar el dashboard | Navegador, contra el backend |
| **Cliente del juego** | `read_token` | Sólo leer inventarios y operaciones; es público de facto | Binario del juego |
| **Jugador** | Ninguna | Tener activos, identificado con un `hld_…`; no firma nada | Dirección derivada |
