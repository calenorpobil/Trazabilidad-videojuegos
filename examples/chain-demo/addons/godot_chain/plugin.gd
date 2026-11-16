@tool
extends EditorPlugin

## Registra el autoload `Chain` al activar el addon.
##
## Se usa `add_autoload_singleton` y no un nodo colocado a mano bajo la raiz porque
## es el mecanismo estandar del motor y sobrevive a que el juego cambie de escena
## principal.

const AUTOLOAD_NAME := "Chain"
const AUTOLOAD_PATH := "res://addons/godot_chain/chain.gd"


func _enter_tree() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)


func _exit_tree() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
