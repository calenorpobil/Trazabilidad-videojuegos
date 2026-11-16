extends RefCounted

## El servidor del modo MOCK: en memoria, sin red y dentro del addon.
##
## Responde con la misma forma que el contrato HTTP (un código y un cuerpo), de modo que
## `Chain` trata sus respuestas igual que las reales. Sólo cubre el camino feliz: una
## operación aceptada avanza un paso por consulta, `pending -> applied -> settled`, y
## nunca falla después. Nada se guarda al cerrar el juego.
##
## No hay tests de conformidad con el servidor real: puede divergir de él.

const CREATE_COLLECTION := "create_collection"
const CREATE_ITEM := "create_item"
const TRANSFER := "transfer"
const INVENTORY := "inventory"
## Traduce el identificador que el juego da a su jugador a su `holder_id` (contrato, 5.5).
const HOLDER := "holder"
const OPERATION := "operation"

var _collections: Dictionary = {}  # collection_id -> nombre
var _items: Dictionary = {}  # item_id -> datos del tipo
var _holders: Dictionary = {}  # identificador del juego -> holder_id
var _balances: Dictionary = {}  # holder_id -> { item_id: unidades }
var _operations: Dictionary = {}  # operation_id -> { state, holder_id, item_id, amount }
var _accepted: Dictionary = {}  # clave de idempotencia -> respuesta aceptada
var _next_id: int = 0


## Devuelve `[código, cuerpo]`.
func respond(route: String, target: String, payload: Dictionary, key: String) -> Array:
	var answer: Array
	match route:
		OPERATION:
			answer = _poll(target)
		INVENTORY:
			answer = _inventory(target)
		HOLDER:
			answer = _holder(target)
		_:
			# Marcar primero: una clave ya aceptada devuelve lo mismo y no repite nada.
			if _accepted.has(key):
				answer = _accepted[key]
			else:
				answer = _write(route, target, payload)
				if answer[0] < 300:
					_accepted[key] = answer
	return [answer[0], answer[1].duplicate(true)]


func _write(route: String, target: String, payload: Dictionary) -> Array:
	match route:
		CREATE_COLLECTION:
			var collection_id := _new_id("col")
			_collections[collection_id] = payload.get("name", "")
			return [201, {"collection_id": collection_id}]
		CREATE_ITEM:
			return _create_item(payload)
		TRANSFER:
			return _transfer(target, payload)
	return _error(404, ChainError.NOT_FOUND, "ruta desconocida")


func _create_item(payload: Dictionary) -> Array:
	var collection_id: String = payload.get("collection_id", "")
	if not _collections.has(collection_id):
		return _error(404, ChainError.NOT_FOUND, "la colección no existe")
	var grant: Dictionary = payload.get("initial_grant", {})
	var holder_id := _resolve(grant.get("holder", {}))
	if holder_id.is_empty():
		return _error(404, ChainError.NOT_FOUND, "el jugador no existe")
	var item_id := _new_id("itm")
	_items[item_id] = {
		"item_id": item_id,
		"collection_id": collection_id,
		"name": payload.get("name", ""),
		"symbol": payload.get("symbol", ""),
		"uri": payload.get("uri", ""),
		"qualities": payload.get("qualities", {}),
	}
	var operation_id := _new_operation(holder_id, item_id, int(grant.get("amount", 0)))
	return [202, {"operation_id": operation_id, "item_id": item_id, "holder_id": holder_id}]


func _transfer(item_id: String, payload: Dictionary) -> Array:
	if not _items.has(item_id):
		return _error(404, ChainError.NOT_FOUND, "el objeto no existe")
	if not payload.has("from"):
		return _error(400, ChainError.REJECTED, "falta mock_sender en la configuración")
	var from_id := _resolve(payload["from"])
	var to_id := _resolve(payload.get("to", {}))
	if from_id.is_empty() or to_id.is_empty():
		return _error(404, ChainError.NOT_FOUND, "el jugador no existe")
	if from_id == to_id:
		return _error(400, ChainError.REJECTED, "emisor y receptor son el mismo jugador")
	var amount := int(payload.get("amount", 0))
	if _balance(from_id, item_id) < amount:
		return _error(409, ChainError.INSUFFICIENT_BALANCE, "no hay unidades suficientes")
	# Las unidades salen del emisor al aceptar y llegan al receptor al final: así dos
	# transferencias en curso no pueden gastar las mismas.
	_balances[from_id][item_id] -= amount
	var operation_id := _new_operation(to_id, item_id, amount)
	return [202, {"operation_id": operation_id, "from_holder_id": from_id, "to_holder_id": to_id}]


func _poll(operation_id: String) -> Array:
	if not _operations.has(operation_id):
		return _error(404, ChainError.NOT_FOUND, "la operación no existe")
	var operation: Dictionary = _operations[operation_id]
	match operation["state"]:
		ChainHandle.PENDING:
			operation["state"] = ChainHandle.APPLIED
		ChainHandle.APPLIED:
			operation["state"] = ChainHandle.SETTLED
			var held: Dictionary = _balances[operation["holder_id"]]
			held[operation["item_id"]] = held.get(operation["item_id"], 0) + operation["amount"]
	return [200, {"operation_id": operation_id, "state": operation["state"], "error": null}]


func _inventory(holder_id: String) -> Array:
	if not _balances.has(holder_id):
		return _error(404, ChainError.NOT_FOUND, "el jugador no existe")
	var items: Array = []
	for item_id: String in _balances[holder_id]:
		var amount: int = _balances[holder_id][item_id]
		if amount > 0:
			var item: Dictionary = _items[item_id].duplicate(true)
			item["amount"] = amount
			items.append(item)
	return [200, {"holder_id": holder_id, "items": items}]


## Como el servidor: sólo traduce, no da de alta. Un jugador que ninguna escritura ha
## nombrado no existe.
func _holder(external_id: String) -> Array:
	if not _holders.has(external_id):
		return _error(404, ChainError.NOT_FOUND, "el jugador no existe")
	return [200, {"holder_id": _holders[external_id], "external_id": external_id}]


## El `holder_id` de una referencia del contrato, o vacío si nombra un `holder_id` que
## nadie ha recibido antes. Un identificador del juego se da de alta la primera vez.
func _resolve(reference: Dictionary) -> String:
	if reference.has("holder_id"):
		var holder_id: String = reference["holder_id"]
		return holder_id if _balances.has(holder_id) else ""
	var external_id: String = reference.get("external_id", "")
	if external_id.is_empty():
		return ""
	if not _holders.has(external_id):
		var created := _new_id("hld")
		_holders[external_id] = created
		_balances[created] = {}
	return _holders[external_id]


func _balance(holder_id: String, item_id: String) -> int:
	return _balances[holder_id].get(item_id, 0)


func _new_operation(holder_id: String, item_id: String, amount: int) -> String:
	var operation_id := _new_id("opr")
	_operations[operation_id] = {
		"state": ChainHandle.PENDING,
		"holder_id": holder_id,
		"item_id": item_id,
		"amount": amount,
	}
	return operation_id


func _new_id(prefix: String) -> String:
	_next_id += 1
	return "%s_mock%d" % [prefix, _next_id]


static func _error(status: int, code: String, message: String) -> Array:
	return [status, {"error": {"code": code, "message": message}}]
