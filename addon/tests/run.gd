extends SceneTree
## Suite del addon en modo MOCK: sin red y sin servidor.
## Uso: godot --headless --path addon --script res://tests/run.gd
## (la primera vez, antes: godot --headless --path addon --import).
## Sale con código 1 si algo falla, para la CI.

var _failures := 0
var _chain: Node


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	_chain = root.get_node("Chain")
	_test_pure_functions()
	await _test_without_config()
	await _test_validation()
	await _test_collection()
	await _test_item_signals()
	await _test_transfer()
	await _test_rejections()
	await _test_same_call_id()
	await _test_finished_handle_is_safe()
	check(_chain._jobs.is_empty() and _chain._timer.is_stopped(), "al acabar no queda nada pendiente")
	if _failures == 0:
		print("godot-chain: todo bien")
	quit(1 if _failures > 0 else 0)


func check(cond: bool, what: String) -> void:
	if not cond:
		_failures += 1
		printerr("godot-chain: FALLO: ", what)


## El patrón de espera seguro del addon.
func _wait(handle: ChainHandle) -> void:
	if not handle.is_finished():
		await handle.finished


func _mock_config(sender: String = "player-a") -> ChainConfig:
	var config := ChainConfig.new()
	config.mode = ChainConfig.Mode.MOCK
	config.poll_interval = 0.02
	config.mock_sender = sender
	return config


## Crea una colección y un tipo con `amount` unidades para `player-a`, y espera al final.
func _seed(amount: int, tag: String) -> ChainHandle:
	var collection: ChainHandle = _chain.create_collection("Armería", "col_" + tag)
	await _wait(collection)
	var item: ChainHandle = _chain.create_item(
		collection.result["collection_id"], "Espada", "SWORD", "", {"rarity": "common"}, "player-a", amount, "item_" + tag)
	await _wait(item)
	return item


func _amount(holder_id: String, item_id: String) -> int:
	var handle: ChainHandle = _chain.inventory(holder_id)
	await _wait(handle)
	if handle.state != ChainHandle.SETTLED:
		return -1
	for item: Dictionary in handle.result["items"]:
		if item["item_id"] == item_id:
			return item["amount"]
	return 0


func _test_pure_functions() -> void:
	# Vector fijo: SHA-256 de «transfer:gift_42». La consola del servidor usa la misma fórmula.
	check(_chain._idempotency_key("transfer", "gift_42")
		== "4fa7743ace01e7c9de2b229d51ee5d2be1c06b543320da5056730c41381917fc", "clave: vector fijo")
	check(_chain._idempotency_key("create_item", "gift_42") != _chain._idempotency_key("transfer", "gift_42"),
		"clave: la operación entra en la clave")
	check(_chain._holder_ref("hld_c3d4") == {"holder_id": "hld_c3d4"}, "jugador: por holder_id")
	check(_chain._holder_ref("player-42") == {"external_id": "player-42"}, "jugador: por identificador del juego")
	check(_chain._retry_after(PackedStringArray(["Content-Type: x", "Retry-After: 3"])) == 3.0, "Retry-After")
	check(_chain._retry_after(PackedStringArray([])) == 0.0, "Retry-After ausente")

	var retryable := {
		"NETWORK": true, "REJECTED": false, "NOT_FOUND": false, "RATE_LIMITED": true, "INSUFFICIENT_BALANCE": false,
		"INSUFFICIENT_FUNDS": true, "CONFIG": false, "EXPIRED": true, "INTERNAL": true,
	}
	for code: String in retryable:
		var error := ChainError.new(code, "")
		check(error.code == code and error.retryable == retryable[code], "categoría %s" % code)
	check(ChainError.new("OTRA", "").code == ChainError.INTERNAL, "categoría desconocida: INTERNAL")

	var by_status := {400: "REJECTED", 401: "REJECTED", 403: "REJECTED", 404: "NOT_FOUND",
		409: "INSUFFICIENT_BALANCE", 429: "RATE_LIMITED", 503: "INSUFFICIENT_FUNDS", 500: "INTERNAL"}
	for status: int in by_status:
		check(ChainError.from_response(status, null).code == by_status[status], "HTTP %d sin cuerpo" % status)
	var expired := ChainError.from_response(0, {"error": {"code": "EXPIRED", "message": "caducó", "retryable": true}})
	check(expired.code == ChainError.EXPIRED and expired.retryable and expired.message == "caducó", "error del cuerpo")

	var live := ChainConfig.new()
	check(not live.problem().is_empty(), "configuración LIVE vacía: no sirve")
	live.write_url = "https://juego.test"
	live.read_url = "https://lecturas.test"
	live.read_token = "rt"
	check(live.problem().is_empty(), "configuración LIVE completa: sirve")
	live.poll_interval = 0.0
	check(not live.problem().is_empty(), "poll_interval 0: no sirve")
	check(_mock_config().problem().is_empty(), "configuración MOCK sin URL: sirve")


func _test_without_config() -> void:
	_chain.configure(null)
	var handle: ChainHandle = _chain.inventory("hld_x")
	check(not handle.is_finished(), "sin configurar: no se resuelve en el bloque que lo crea")
	await _wait(handle)
	check(handle.state == ChainHandle.FAILED and handle.error.code == ChainError.CONFIG, "sin configurar: CONFIG")


func _test_validation() -> void:
	_chain.configure(_mock_config())
	var handle: ChainHandle = _chain.transfer("itm_x", 1, "player-b", "")
	check(not handle.is_finished(), "call_id vacío: no se resuelve en el bloque que lo crea")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.REJECTED, "call_id vacío: REJECTED")
	handle = _chain.transfer("itm_x", 1, "player-b", "x".repeat(65))
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.REJECTED, "call_id de 65: REJECTED")
	handle = _chain.transfer("itm_x", 0, "player-b", "t_0")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.REJECTED, "amount 0: REJECTED")


func _test_collection() -> void:
	_chain.configure(_mock_config())
	var handle: ChainHandle = _chain.create_collection("Armería", "col_1")
	check(not handle.is_finished(), "colección: no se resuelve en el bloque que la crea")
	await _wait(handle)
	check(handle.state == ChainHandle.SETTLED, "colección: settled")
	check(str(handle.result.get("collection_id", "")).begins_with("col_"), "colección: collection_id")
	check(handle.operation_id.is_empty(), "colección: sin operación")


func _test_item_signals() -> void:
	_chain.configure(_mock_config())
	var collection: ChainHandle = _chain.create_collection("Armería", "col_1")
	await _wait(collection)
	var seen: Array[String] = []
	var states: Array[String] = []
	var handle: ChainHandle = _chain.create_item(
		collection.result["collection_id"], "Espada", "SWORD", "", {"rarity": "common", "damage": "12"}, "player-a", 2, "item_1")
	handle.applied.connect(func() -> void:
		seen.append("applied")
		states.append(handle.state))
	handle.settled.connect(func() -> void:
		seen.append("settled")
		states.append(handle.state))
	handle.failed.connect(func(_error: ChainError) -> void: seen.append("failed"))
	handle.finished.connect(func() -> void: seen.append("finished"))
	check(handle.state == ChainHandle.PENDING and not handle.is_finished(), "tipo: nace pendiente")
	await handle.applied
	var holder_id: String = handle.result.get("holder_id", "")
	check(handle.operation_id.begins_with("opr_") and holder_id.begins_with("hld_")
		and str(handle.result.get("item_id", "")).begins_with("itm_"), "tipo: identificadores desde que se acepta")
	check(await _amount(holder_id, handle.result["item_id"]) == 0, "tipo: en applied el inventario no lo muestra")
	await _wait(handle)
	check(seen == ["applied", "settled", "finished"], "tipo: applied, settled, finished (%s)" % [seen])
	check(states == ["applied", "settled"], "tipo: el estado ya está puesto al emitir (%s)" % [states])

	var inventory: ChainHandle = _chain.inventory(holder_id)
	await _wait(inventory)
	var items: Array = inventory.result.get("items", [])
	check(items.size() == 1, "inventario: un tipo")
	if items.size() == 1:
		var item: Dictionary = items[0]
		check(typeof(item["amount"]) == TYPE_INT and item["amount"] == 2, "inventario: amount entero")
		check(item["name"] == "Espada" and item["symbol"] == "SWORD" and item["qualities"] == {"rarity": "common", "damage": "12"}
			and item["collection_id"] == collection.result["collection_id"], "inventario: datos del tipo")


func _test_transfer() -> void:
	_chain.configure(_mock_config())
	var item: ChainHandle = await _seed(3, "t")
	var item_id: String = item.result["item_id"]
	var a_id: String = item.result["holder_id"]

	var transfer: ChainHandle = _chain.transfer(item_id, 1, "player-b", "gift_1")
	await _wait(transfer)
	check(transfer.state == ChainHandle.SETTLED, "transferencia: settled")
	check(transfer.result.get("from_holder_id") == a_id, "transferencia: el emisor es mock_sender")
	var b_id: String = transfer.result.get("to_holder_id", "")
	check(await _amount(a_id, item_id) == 2 and await _amount(b_id, item_id) == 1, "transferencia: mueve una unidad")

	# Ahora el receptor se nombra por su holder_id, que ya se conoce.
	transfer = _chain.transfer(item_id, 2, b_id, "gift_2")
	await _wait(transfer)
	check(await _amount(a_id, item_id) == 0 and await _amount(b_id, item_id) == 3, "transferencia: por holder_id")
	var emptied: ChainHandle = _chain.inventory(a_id)
	await _wait(emptied)
	check(emptied.state == ChainHandle.SETTLED and emptied.result["items"].is_empty(), "inventario vacío: lista vacía")


func _test_rejections() -> void:
	_chain.configure(_mock_config())
	var item: ChainHandle = await _seed(3, "r")
	var item_id: String = item.result["item_id"]
	var a_id: String = item.result["holder_id"]

	var handle: ChainHandle = _chain.transfer(item_id, 5, "player-b", "r_1")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.INSUFFICIENT_BALANCE and not handle.error.retryable,
		"más de lo que hay: INSUFFICIENT_BALANCE")
	handle = _chain.transfer(item_id, 1, "player-a", "r_2")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.REJECTED, "a uno mismo: REJECTED")
	handle = _chain.transfer("itm_nada", 1, "player-b", "r_3")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.NOT_FOUND, "tipo que no existe: NOT_FOUND")
	handle = _chain.transfer(item_id, 1, "hld_nadie", "r_4")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.NOT_FOUND, "holder_id que no existe: NOT_FOUND")
	handle = _chain.inventory("hld_nadie")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.NOT_FOUND, "inventario de nadie: NOT_FOUND")
	handle = _chain.create_item("col_nada", "Espada", "SWORD", "", {}, "player-a", 1, "r_5")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.NOT_FOUND, "colección que no existe: NOT_FOUND")
	check(await _amount(a_id, item_id) == 3, "un rechazo no mueve nada")

	# Dos a la vez no pueden gastar las mismas unidades.
	var first: ChainHandle = _chain.transfer(item_id, 2, "player-b", "r_6")
	var second: ChainHandle = _chain.transfer(item_id, 2, "player-b", "r_7")
	await _wait(first)
	await _wait(second)
	check(first.state == ChainHandle.SETTLED and second.error != null
		and second.error.code == ChainError.INSUFFICIENT_BALANCE, "dos a la vez: la segunda no tiene saldo")
	check(await _amount(a_id, item_id) == 1, "dos a la vez: sólo sale una")

	_chain.configure(_mock_config(""))
	item = await _seed(1, "s")
	handle = _chain.transfer(item.result["item_id"], 1, "player-b", "r_8")
	await _wait(handle)
	check(handle.error != null and handle.error.code == ChainError.REJECTED, "sin mock_sender: REJECTED")


func _test_same_call_id() -> void:
	_chain.configure(_mock_config())
	var item: ChainHandle = await _seed(3, "i")
	var item_id: String = item.result["item_id"]
	var a_id: String = item.result["holder_id"]

	var first: ChainHandle = _chain.transfer(item_id, 1, "player-b", "gift_1")
	var again: ChainHandle = _chain.transfer(item_id, 1, "player-b", "gift_1")
	await _wait(first)
	await _wait(again)
	check(first.state == ChainHandle.SETTLED and again.state == ChainHandle.SETTLED, "mismo call_id: las dos acaban")
	check(first.operation_id == again.operation_id, "mismo call_id: la misma operación")
	check(await _amount(a_id, item_id) == 2, "mismo call_id: sólo se mueve una vez")

	# Con otros datos devuelve el resultado original (contrato, 9.5).
	var other: ChainHandle = _chain.transfer(item_id, 2, "player-c", "gift_1")
	await _wait(other)
	check(other.operation_id == first.operation_id and await _amount(a_id, item_id) == 2, "mismo call_id, otros datos: el original")

	# Otra operación con el mismo call_id no choca.
	var collection: ChainHandle = _chain.create_collection("Otra", "gift_1")
	await _wait(collection)
	check(collection.state == ChainHandle.SETTLED and collection.result.has("collection_id"), "mismo call_id, otra operación")

	var fresh: ChainHandle = _chain.transfer(item_id, 1, "player-b", "gift_2")
	await _wait(fresh)
	check(fresh.operation_id != first.operation_id and await _amount(a_id, item_id) == 1, "call_id nuevo: acción nueva")


func _test_finished_handle_is_safe() -> void:
	_chain.configure(_mock_config())
	var handle: ChainHandle = _chain.create_collection("Armería", "col_1")
	await _wait(handle)
	# Esperar `finished` aquí colgaría para siempre: por eso existe is_finished().
	check(handle.is_finished(), "handle acabado: is_finished")
	await _wait(handle)
	var count: Array[int] = [0]
	handle.finished.connect(func() -> void: count[0] += 1)
	handle._settle()
	handle._fail(ChainError.new(ChainError.INTERNAL, ""))
	check(count[0] == 0 and handle.state == ChainHandle.SETTLED and handle.error == null, "handle acabado: no cambia más")
