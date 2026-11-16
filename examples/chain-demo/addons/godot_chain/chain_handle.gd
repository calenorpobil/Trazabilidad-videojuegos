class_name ChainHandle
extends RefCounted

## Lo que devuelve cada operación de `Chain`: un buzón pasivo.
##
## No hace nada por sí mismo ni conoce a `Chain`; es `Chain` quien lo va rellenando. Nunca
## se resuelve dentro del bloque síncrono que lo creó, así que conectar las señales justo
## después de la llamada es seguro.
##
## Esperar una señal ya emitida cuelga para siempre. El patrón seguro es:
## [codeblock]
## var handle := Chain.transfer("itm_a1b2", 1, "hld_c3d4", "gift_42")
## handle.settled.connect(_on_settled)
## if not handle.is_finished():
##     await handle.finished
## [/codeblock]

## Confirmada, no final. Para animar; no garantiza nada.
signal applied
## Final e irreversible. Aquí se persiste estado.
signal settled
## Falló. Aquí se revierte lo que se hubiera animado.
signal failed(error: ChainError)
## Tras `settled` o `failed`.
signal finished

const PENDING := "pending"
const APPLIED := "applied"
const SETTLED := "settled"
const FAILED := "failed"

## `pending`, `applied`, `settled` o `failed`.
var state: String = PENDING
## Identificador de la operación, vacío hasta que el servidor la acepta y siempre vacío
## en lo que no es una operación: crear una colección o leer un inventario.
var operation_id: String = ""
## Cuerpo de la respuesta aceptada: `item_id`, `holder_id`, `collection_id`, `items`...
var result: Dictionary = {}
## El error, sólo en `failed`.
var error: ChainError = null


func is_finished() -> bool:
	return state == SETTLED or state == FAILED


# Lo que sigue lo llama sólo `Chain`.

func _accept(p_result: Dictionary, p_operation_id: String = "") -> void:
	if is_finished():
		return
	result = p_result
	operation_id = p_operation_id


func _apply() -> void:
	if state != PENDING:
		return
	state = APPLIED
	applied.emit()


func _settle() -> void:
	if is_finished():
		return
	# Una operación puede llegar a final sin que se haya visto el paso intermedio: se
	# emite igualmente, para que quien anima en `applied` no se quede sin animar.
	if not operation_id.is_empty():
		_apply()
	state = SETTLED
	settled.emit()
	finished.emit()


func _fail(p_error: ChainError) -> void:
	if is_finished():
		return
	state = FAILED
	error = p_error
	failed.emit(p_error)
	finished.emit()
