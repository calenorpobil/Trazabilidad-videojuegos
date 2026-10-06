class_name GameApi
extends Node
## Cliente del servidor de juego de Nidada (docs/plan-juego.md, sección 4).
##
## Sin lógica de juego: pide y devuelve. Cada petición devuelve un diccionario
## { ok = true, data } o { ok = false, code, message }, con el mensaje listo para
## enseñarlo al jugador.

const SESSION_PATH := "user://session.cfg"
const TIMEOUT_SECONDS := 10.0

var base_url: String
var token := ""


func _init(url: String) -> void:
	base_url = url.trim_suffix("/")


## Recupera la sesión guardada. Una sesión de otro servidor no vale.
func load_session() -> bool:
	var cfg := ConfigFile.new()
	if cfg.load(SESSION_PATH) != OK:
		return false
	if cfg.get_value("session", "server_url", "") != base_url:
		return false
	token = cfg.get_value("session", "token", "")
	return token != ""


func create_player() -> Dictionary:
	token = ""
	var res := await request(HTTPClient.METHOD_POST, "/v1/players")
	if res.ok:
		token = res.data.session_token
		var cfg := ConfigFile.new()
		cfg.set_value("session", "server_url", base_url)
		cfg.set_value("session", "token", token)
		cfg.save(SESSION_PATH)
	return res


func corral() -> Dictionary:
	return await request(HTTPClient.METHOD_GET, "/v1/corral")


## `action` es `feed`, `play` o `sleep`.
func act(pet_id: String, action: String) -> Dictionary:
	return await request(HTTPClient.METHOD_POST, "/v1/pets/%s/%s" % [pet_id.uri_encode(), action])


func rename(pet_id: String, pet_name: String) -> Dictionary:
	return await request(HTTPClient.METHOD_PUT, "/v1/pets/%s/name" % pet_id.uri_encode(), {"name": pet_name})


func request(method: HTTPClient.Method, path: String, body: Variant = null) -> Dictionary:
	var http := HTTPRequest.new()
	http.timeout = TIMEOUT_SECONDS
	add_child(http)
	var headers := PackedStringArray(["Content-Type: application/json"])
	if token != "":
		headers.append("Authorization: Bearer " + token)
	var payload := "" if body == null else JSON.stringify(body)
	if http.request(base_url + path, headers, method, payload) != OK:
		http.queue_free()
		return _failure("NETWORK", "No se pudo contactar con el servidor.")

	var result: Array = await http.request_completed
	http.queue_free()
	if result[0] != HTTPRequest.RESULT_SUCCESS:
		return _failure("NETWORK", "No hay conexión con el servidor.")

	var status: int = result[1]
	var data: Variant = JSON.parse_string((result[3] as PackedByteArray).get_string_from_utf8())
	if status >= 200 and status < 300 and data is Dictionary:
		return {"ok": true, "data": data}
	if data is Dictionary and data.has("error"):
		return _failure(data.error.get("code", "INTERNAL"), data.error.get("message", "Algo ha fallado."))
	return _failure("INTERNAL", "Algo ha fallado. Inténtalo de nuevo.")


func _failure(code: String, message: String) -> Dictionary:
	return {"ok": false, "code": code, "message": message}
