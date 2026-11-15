class_name ChainConfig
extends Resource

## Configuración del addon. Se crea en el editor como recurso o por código, y se pasa a
## `Chain.configure()`.
##
## No lleva ninguna credencial de escritura: las escrituras van al servidor de juego, que
## es quien la tiene. El `read_token` sí viaja en el juego y es público de hecho.

enum Mode { LIVE, MOCK }

## Base del servidor de juego, que recibe las escrituras. Sin barra final.
@export var write_url: String = ""
## Base del servicio de lecturas: inventarios y estado de las operaciones.
@export var read_url: String = ""
## Credencial de sólo lectura.
@export var read_token: String = ""
## Identificador del juego. Es informativo: no viaja en ninguna petición.
@export var game_id: String = ""
## Segundos que se espera la respuesta de una petición.
@export var request_timeout: float = 10.0
## Segundos que se sigue una operación antes de darla por fallida con `NETWORK`.
## Con 0 se sigue sin límite.
@export var operation_timeout: float = 120.0
## Segundos entre dos consultas del estado de una operación. Intervalo fijo.
@export var poll_interval: float = 1.0
@export var mode: Mode = Mode.LIVE


## Devuelve por qué la configuración no sirve, o una cadena vacía si sirve.
func problem() -> String:
	if not _is_http(write_url):
		return "write_url debe empezar por http:// o https://"
	if not _is_http(read_url):
		return "read_url debe empezar por http:// o https://"
	if read_token.is_empty():
		return "falta read_token"
	if request_timeout <= 0.0:
		return "request_timeout debe ser mayor que 0"
	if operation_timeout < 0.0:
		return "operation_timeout no puede ser negativo"
	if poll_interval <= 0.0:
		return "poll_interval debe ser mayor que 0"
	return ""


static func _is_http(url: String) -> bool:
	return url.begins_with("http://") or url.begins_with("https://")
