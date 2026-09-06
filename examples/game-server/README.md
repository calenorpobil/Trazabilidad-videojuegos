# game-server de ejemplo

**Bloque 8 del plan.** Todavia no existe.

Servidor de juego minimo en Node. No es un producto: es la pieza que demuestra que la
arquitectura es segura. Sin el, el proyecto ensena una arquitectura insegura.

Su unica responsabilidad: autorizar la operacion con sus propios datos de juego y
reenviarla al backend con la clave de escritura, que nunca puede viajar dentro del
binario del juego.
