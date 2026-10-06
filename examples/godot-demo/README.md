# Nidada — proyecto Godot

Fase J1 de [`docs/plan-juego.md`](../../docs/plan-juego.md): el bucle de cuidado. Un corral con
dos mascotas, sus necesidades bajando en tiempo real y botones para alimentar, jugar y dormir.
Todavía no usa `godot-chain`.

## Arrancar

1. Compilar la GDExtension y copiarla aquí: `rust/build-ext.sh` (ver el README de `rust/`).
2. Arrancar el servidor de juego: `TIME_SCALE=120 cargo run -p nidada-server` desde `rust/`.
3. Abrir este directorio con Godot 4.7.x y ejecutar.

La URL del servidor está en `Proyecto → Configuración → nidada/server_url`. La sesión se guarda
en `user://session.cfg`; borrarla crea un jugador nuevo.

Más adelante, este proyecto también ejecutará el hito de la sección 7 de la propuesta (fase J3).
