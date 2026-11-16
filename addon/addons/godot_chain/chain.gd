extends Node

## Punto de entrada del addon. Autoload `Chain`, registrado por `plugin.gd`.
##
## Habla el contrato de `docs/especificacion/http-contract.md` y nada más. En modo LIVE
## las escrituras van a `write_url` (el servidor de juego, que autoriza y reenvía) y las
## lecturas, a `read_url` con el `read_token`. En modo MOCK responde `chain_mock.gd`, en
## memoria y sin red, y el resto del camino es el mismo.
##
## Todo ocurre en el hilo principal: las peticiones salen por un pool de `HTTPRequest` y
## el estado de las operaciones se consulta a intervalo fijo con un `Timer`.
##
## `Chain` guarda los handles pendientes; un handle no guarda a `Chain`. Los handles no
## se persisten: si se cierra el juego, la operación sigue su curso en el servidor y al
## reabrir se relee el inventario.

const VERSION := "0.1.0"

## Peticiones simultáneas como máximo. Las que no caben esperan al siguiente tic.
const POOL_SIZE := 4

const Mock := preload("chain_mock.gd")

const _HOLDER_PREFIX := "hld_"
const _JSON_HEADER := "Content-Type: application/json; charset=utf-8"


## Lo que `Chain` sabe de un handle pendiente y el handle no necesita saber.
class _Job:
	extends RefCounted
	var handle: ChainHandle
	## Qué se pide: una de las constantes de ruta de `chain_mock.gd`.
	var route: String
	## El identificador sobre el que actúa la ruta, si lo hay.
	var target: String = ""
	var payload: Dictionary = {}
	## Clave de idempotencia. Sólo en las escrituras.
	var key: String = ""
	var is_write: bool = false
	var busy: bool = false
	## No consultar antes de este instante (ms). Sólo lo mueve un `Retry-After`.
	var due_ms: int = 0
	## Instante (ms) en que se deja de seguir. 0: sin límite.
	var deadline_ms: int = 0


var config: ChainConfig = null

var _jobs: Array[_Job] = []
var _idle: Array[HTTPRequest] = []
var _pool_count: int = 0
var _timer: Timer
var _mock: Mock = null


func _ready() -> void:
	# El seguimiento no se detiene aunque el juego esté en pausa.
	process_mode = Node.PROCESS_MODE_ALWAYS
	_timer = Timer.new()
	_timer.timeout.connect(_on_tick)
	add_child(_timer)


## Fija la configuración. Se llama una vez, antes de la primera operación. En modo MOCK
## empieza con un servidor en memoria vacío.
func configure(new_config: ChainConfig) -> void:
	config = new_config
	_mock = Mock.new() if config != null and config.mode == ChainConfig.Mode.MOCK else null


## Crea una colección. No es una operación en curso: el handle pasa a `settled` en cuanto
## el servidor responde, con `collection_id` en `result`.
func create_collection(collection_name: String, call_id: String) -> ChainHandle:
	return _write(Mock.CREATE_COLLECTION, "", {"name": collection_name}, call_id)


## Crea un tipo de objeto y entrega `amount` unidades a `holder`. `result` trae
## `item_id` y `holder_id` desde que el servidor acepta, pero el objeto sólo es
## utilizable en `settled`.
##
## `holder` es un `hld_...` o el identificador que el juego da a su jugador.
func create_item(
	collection_id: String,
	item_name: String,
	symbol: String,
	uri: String,
	qualities: Dictionary,
	holder: String,
	amount: int,
	call_id: String,
) -> ChainHandle:
	var payload := {
		"collection_id": collection_id,
		"name": item_name,
		"symbol": symbol,
		"uri": uri,
		"qualities": qualities,
		"initial_grant": {"holder": _holder_ref(holder), "amount": amount},
	}
	return _write(Mock.CREATE_ITEM, "", payload, call_id, amount)


## Transfiere `amount` unidades de un tipo a `recipient`: entran todas o ninguna.
##
## No hay argumento para el emisor: lo decide el servidor de juego, que es quien sabe
## qué jugador hace la petición, y lo añade al reenviarla. En modo MOCK, que no tiene
## servidor de juego, el emisor es `mock_sender` de la configuración.
func transfer(item_id: String, amount: int, recipient: String, call_id: String) -> ChainHandle:
	var payload := {"to": _holder_ref(recipient), "amount": amount}
	if _mock != null and not config.mock_sender.is_empty():
		payload["from"] = _holder_ref(config.mock_sender)
	return _write(Mock.TRANSFER, item_id, payload, call_id, amount)


## Lee lo que tiene un jugador. `result["items"]` es una lista de diccionarios con
## `item_id`, `collection_id`, `name`, `symbol`, `uri`, `qualities` y `amount`. Sólo
## refleja lo ya final: una operación en curso puede no verse todavía.
func inventory(holder_id: String) -> ChainHandle:
	var handle := ChainHandle.new()
	var problem := _config_problem()
	if not problem.is_empty():
		return _fail_later(handle, ChainError.CONFIG, problem)
	_enqueue(_new_job(handle, Mock.INVENTORY, holder_id))
	return handle


# --- Escrituras ---------------------------------------------------------------------

func _write(route: String, target: String, payload: Dictionary, call_id: String, amount: int = 1) -> ChainHandle:
	var handle := ChainHandle.new()
	var problem := _config_problem()
	if not problem.is_empty():
		return _fail_later(handle, ChainError.CONFIG, problem)
	if call_id.is_empty() or call_id.length() > 64:
		return _fail_later(handle, ChainError.REJECTED, "call_id debe tener de 1 a 64 caracteres")
	if amount < 1:
		return _fail_later(handle, ChainError.REJECTED, "amount debe ser 1 o más")
	var job := _new_job(handle, route, target)
	job.payload = payload
	job.key = _idempotency_key(route, call_id)
	job.is_write = true
	_enqueue(job)
	return handle


## La clave sale sólo de la operación y del `call_id`: la misma acción reintentada, aun
## tras reabrir el juego, da la misma clave, y el servidor devuelve el resultado
## anterior en vez de repetirla.
static func _idempotency_key(operation: String, call_id: String) -> String:
	return (operation + ":" + call_id).sha256_text()


## Un `hld_...` nombra al jugador por su identificador; cualquier otra cosa es el
## identificador que le da el juego.
static func _holder_ref(holder: String) -> Dictionary:
	if holder.begins_with(_HOLDER_PREFIX):
		return {"holder_id": holder}
	return {"external_id": holder}


# --- Cola y pool --------------------------------------------------------------------

func _config_problem() -> String:
	if config == null:
		return "falta la configuración: llama antes a Chain.configure()"
	return config.problem()


func _new_job(handle: ChainHandle, route: String, target: String) -> _Job:
	var job := _Job.new()
	job.handle = handle
	job.route = route
	job.target = target
	if config.operation_timeout > 0.0:
		job.deadline_ms = Time.get_ticks_msec() + int(config.operation_timeout * 1000.0)
	return job


## Nada de lo que resuelve un handle corre en el bloque síncrono que lo creó: el primer
## envío y los fallos de validación se difieren, y el resto llega por señales.
func _enqueue(job: _Job) -> void:
	_jobs.append(job)
	_advance.call_deferred(job)
	if _timer.is_stopped():
		_timer.start(config.poll_interval)


func _fail_later(handle: ChainHandle, code: String, message: String) -> ChainHandle:
	handle._fail.call_deferred(ChainError.new(code, message))
	return handle


func _on_tick() -> void:
	for job in _jobs.duplicate():
		_advance(job)


func _advance(job: _Job) -> void:
	if job.busy or job.handle.is_finished():
		return
	var now := Time.get_ticks_msec()
	if job.deadline_ms > 0 and now >= job.deadline_ms:
		# No se sabe cómo acabó. Reintentar con el mismo `call_id` es seguro.
		_fail(job, ChainError.new(ChainError.NETWORK, "sin resultado tras %d s" % int(config.operation_timeout)))
		return
	if now < job.due_ms:
		return
	if _mock != null:
		var answer := _mock.respond(job.route, job.target, job.payload, job.key)
		_on_response(job, answer[0], answer[1], 0.0)
		return
	var http := _acquire()
	if http == null:
		return
	http.timeout = config.request_timeout
	http.request_completed.connect(_on_completed.bind(job, http), CONNECT_ONE_SHOT)
	job.busy = true
	var method := HTTPClient.METHOD_POST if _is_submission(job) else HTTPClient.METHOD_GET
	var body := JSON.stringify(job.payload) if _is_submission(job) else ""
	if http.request(_url(job), _headers(job), method, body) != OK:
		http.request_completed.disconnect(_on_completed.bind(job, http))
		_release(http)
		job.busy = false
		_on_no_response(job, "no se pudo iniciar la petición")


## Una escritura que el servidor todavía no ha aceptado. Después pasa a ser una consulta
## del estado de su operación.
static func _is_submission(job: _Job) -> bool:
	return job.is_write and job.route != Mock.OPERATION


func _url(job: _Job) -> String:
	var target := job.target.uri_encode()
	match job.route:
		Mock.CREATE_COLLECTION:
			return _base(config.write_url) + "/v1/collections"
		Mock.CREATE_ITEM:
			return _base(config.write_url) + "/v1/items"
		Mock.TRANSFER:
			return "%s/v1/items/%s/transfer" % [_base(config.write_url), target]
		Mock.INVENTORY:
			return "%s/v1/holders/%s/items" % [_base(config.read_url), target]
	return "%s/v1/operations/%s" % [_base(config.read_url), target]


func _headers(job: _Job) -> PackedStringArray:
	if _is_submission(job):
		return PackedStringArray([_JSON_HEADER, "Idempotency-Key: " + job.key])
	return PackedStringArray(["Authorization: Bearer " + config.read_token])


func _acquire() -> HTTPRequest:
	if not _idle.is_empty():
		return _idle.pop_back()
	if _pool_count >= POOL_SIZE:
		return null
	var http := HTTPRequest.new()
	add_child(http)
	_pool_count += 1
	return http


func _release(http: HTTPRequest) -> void:
	_idle.append(http)


func _fail(job: _Job, error: ChainError) -> void:
	_drop(job)
	job.handle._fail(error)


func _settle(job: _Job) -> void:
	_drop(job)
	job.handle._settle()


## Sin nada pendiente, el temporizador se para: el addon no hace nada en reposo.
func _drop(job: _Job) -> void:
	_jobs.erase(job)
	if _jobs.is_empty():
		_timer.stop()


# --- Respuestas ---------------------------------------------------------------------

func _on_completed(result: int, status: int, headers: PackedStringArray, body: PackedByteArray, job: _Job, http: HTTPRequest) -> void:
	_release(http)
	job.busy = false
	if result != HTTPRequest.RESULT_SUCCESS:
		_on_no_response(job, "sin respuesta (resultado %d)" % result)
		return
	var json := JSON.new()
	var data: Variant = json.data if json.parse(body.get_string_from_utf8()) == OK else null
	_on_response(job, status, data, _retry_after(headers))


## Una respuesta, venga de la red o del modo MOCK.
func _on_response(job: _Job, status: int, data: Variant, retry_after: float) -> void:
	if status >= 200 and status < 300 and data is Dictionary:
		if job.route == Mock.OPERATION:
			_on_polled(job, data)
		else:
			_on_accepted(job, data)
		return
	var error := ChainError.from_response(status, data)
	# Durante el seguimiento, un fallo pasajero del servidor no dice nada de la
	# operación: se sigue consultando.
	if job.route == Mock.OPERATION and error.retryable:
		if error.code == ChainError.RATE_LIMITED:
			job.due_ms = Time.get_ticks_msec() + int(retry_after * 1000.0)
		return
	_fail(job, error)


## No hubo respuesta. Una escritura se reenvía en el siguiente tic con la misma clave, y
## una consulta de estado se repite; una lectura falla, y el juego decide si la repite.
func _on_no_response(job: _Job, message: String) -> void:
	if job.is_write:
		return
	_fail(job, ChainError.new(ChainError.NETWORK, message))


func _on_accepted(job: _Job, data: Dictionary) -> void:
	var operation_id: Variant = data.get("operation_id")
	if job.is_write and operation_id is String and not operation_id.is_empty():
		job.handle._accept(data, operation_id)
		job.route = Mock.OPERATION
		job.target = operation_id
		return
	# Sin operación que seguir: una colección creada o un inventario leído.
	job.handle._accept(_with_whole_amounts(data))
	_settle(job)


func _on_polled(job: _Job, data: Dictionary) -> void:
	match data.get("state"):
		ChainHandle.APPLIED:
			job.handle._apply()
		ChainHandle.SETTLED:
			_settle(job)
		ChainHandle.FAILED:
			_fail(job, ChainError.from_response(0, data))


static func _base(url: String) -> String:
	return url.trim_suffix("/")


## Segundos de `Retry-After`, o 0 si no viene.
static func _retry_after(headers: PackedStringArray) -> float:
	for header in headers:
		if header.to_lower().begins_with("retry-after:"):
			return maxf(header.substr(header.find(":") + 1).strip_edges().to_float(), 0.0)
	return 0.0


## JSON no distingue enteros: las cantidades de un inventario llegan como `2.0`.
static func _with_whole_amounts(data: Dictionary) -> Dictionary:
	var items: Variant = data.get("items")
	if items is Array:
		for item: Variant in items:
			if item is Dictionary and item.has("amount"):
				item["amount"] = int(item["amount"])
	return data
