class_name ChainError
extends RefCounted

## Error de una operación, con una categoría sobre la que el juego puede actuar.
##
## Las categorías son las del contrato HTTP (sección 6). `CONFIG` y `NETWORK` las produce
## sólo el addon: nunca llegan del servidor.

const NETWORK := "NETWORK"
const REJECTED := "REJECTED"
const NOT_FOUND := "NOT_FOUND"
const RATE_LIMITED := "RATE_LIMITED"
const INSUFFICIENT_BALANCE := "INSUFFICIENT_BALANCE"
const INSUFFICIENT_FUNDS := "INSUFFICIENT_FUNDS"
const CONFIG := "CONFIG"
const EXPIRED := "EXPIRED"
const INTERNAL := "INTERNAL"

## Si reintentar tiene sentido, por categoría. Un reintento tras `failed` exige un
## `call_id` nuevo; uno tras `NETWORK`, el mismo.
const _RETRYABLE := {
	NETWORK: true,
	REJECTED: false,
	NOT_FOUND: false,
	RATE_LIMITED: true,
	INSUFFICIENT_BALANCE: false,
	INSUFFICIENT_FUNDS: true,
	CONFIG: false,
	EXPIRED: true,
	INTERNAL: true,
}

var code: String
var message: String
var retryable: bool


func _init(p_code: String = INTERNAL, p_message: String = "") -> void:
	# Una categoría desconocida se trata como fallo no clasificado.
	code = p_code if _RETRYABLE.has(p_code) else INTERNAL
	message = p_message
	retryable = _RETRYABLE[code]


func _to_string() -> String:
	return "%s: %s" % [code, message]


## Construye el error de una respuesta: el objeto `error` del contrato si viene, y si no,
## la categoría que corresponde al código HTTP.
static func from_response(status: int, data: Variant) -> ChainError:
	var detail: Variant = data.get("error") if data is Dictionary else null
	if detail is Dictionary and detail.get("code") is String:
		return ChainError.new(detail["code"], str(detail.get("message", "")))
	match status:
		400, 401, 403:
			return ChainError.new(REJECTED, "HTTP %d" % status)
		404:
			return ChainError.new(NOT_FOUND, "HTTP %d" % status)
		409:
			return ChainError.new(INSUFFICIENT_BALANCE, "HTTP %d" % status)
		429:
			return ChainError.new(RATE_LIMITED, "HTTP %d" % status)
		503:
			return ChainError.new(INSUFFICIENT_FUNDS, "HTTP %d" % status)
	return ChainError.new(INTERNAL, "respuesta inesperada, HTTP %d" % status)
