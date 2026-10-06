extends SceneTree
## Comprueba que nidada-ext carga y que sus cálculos coinciden con nidada-rules.
## Sin red ni servidor. Uso: godot --headless --path . --script res://tests/test_ext.gd
## Sale con código 1 si algo falla, para la CI.

var _failures := 0


func _initialize() -> void:
	if not ClassDB.class_exists("PetView"):
		_fail("nidada-ext no está cargada")
		quit(1)
		return
	# Se carga en tiempo de ejecución: si la extensión falta, el script no debe ni compilar.
	(load("res://tests/ext_cases.gd").new() as RefCounted).call("run", self)
	if _failures == 0:
		print("test_ext: todo bien")
	quit(1 if _failures > 0 else 0)


func check(cond: bool, what: String) -> void:
	if not cond:
		_fail(what)


func _fail(what: String) -> void:
	_failures += 1
	printerr("test_ext: FALLO: ", what)
