extends Control

## La escena del hito (propuesta, 7): un botón por operación, los inventarios de los jugadores A y B,
## y el estado de cada operación. Sin arte y sin reglas de juego.
##
## Las escrituras van al servidor de juego (`examples/game-server`), que decide que quien transfiere es
## el jugador A; las lecturas van directas al backend. Este proyecto sólo habla con `Chain`.
##
## Configuración por variables de entorno:
##   CHAIN_DEMO_READ_TOKEN  el `read_token` del backend. Sin él, la demo arranca en modo MOCK
##   CHAIN_DEMO_WRITE_URL   el servidor de juego; por defecto http://127.0.0.1:8788
##   CHAIN_DEMO_READ_URL    el backend; por defecto http://127.0.0.1:8787
##
## El estado del juego (la colección, el tipo y los jugadores) sólo se guarda en `settled`; `applied`
## sólo se enseña (invariante 5). Nada se guarda al cerrar: cada ejecución empieza por crear la colección.

const PLAYER_A := "player-a"
const PLAYER_B := "player-b"
const ITEM_AMOUNT := 3

var _collection_id := ""
var _item_id := ""
var _holder_a := ""
var _holder_b := ""

var _item_button: Button
var _transfer_button: Button
var _inventory_a: Label
var _inventory_b: Label
var _operations: VBoxContainer
## Una fila por operación: `label`, `title`, `handle` y `trail`, los estados por los que ha pasado.
var _rows: Array[Dictionary] = []


func _ready() -> void:
	var config := _config()
	Chain.configure(config)
	_build(config)
	_update_buttons()
	_show_inventory(_inventory_a, PLAYER_A, [])
	_show_inventory(_inventory_b, PLAYER_B, [])


## El identificador de la operación llega al aceptarla, sin señal: se repinta mientras está en curso.
func _process(_delta: float) -> void:
	for row in _rows:
		if not row["handle"].is_finished():
			_paint(row)


# --- Operaciones: una por botón ---------------------------------------------------------

func create_collection() -> ChainHandle:
	var handle := Chain.create_collection("Armería de la demo", _call_id("collection"))
	_track("Crear colección", handle)
	_after_collection(handle)
	return handle


func create_item() -> ChainHandle:
	var qualities := {"rarity": "common", "damage": "12"}
	var handle := Chain.create_item(
		_collection_id, "Espada de hierro", "SWORD", "", qualities, PLAYER_A, ITEM_AMOUNT, _call_id("item"))
	_track("Crear objeto: %d para A" % ITEM_AMOUNT, handle)
	_after_item(handle)
	return handle


func transfer_one() -> ChainHandle:
	# Antes de su primera transferencia, B no tiene `holder_id`: se le nombra por su identificador.
	var recipient := _holder_b if not _holder_b.is_empty() else PLAYER_B
	var handle := Chain.transfer(_item_id, 1, recipient, _call_id("transfer"))
	_track("Transferir 1 de A a B", handle)
	_after_transfer(handle)
	return handle


func refresh_inventories() -> void:
	await _refresh(_inventory_a, PLAYER_A, _holder_a)
	await _refresh(_inventory_b, PLAYER_B, _holder_b)


# --- Lo que se hace al acabar cada una: sólo en `settled` --------------------------------

func _after_collection(handle: ChainHandle) -> void:
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		_collection_id = handle.result["collection_id"]
		_item_id = ""
	_update_buttons()


func _after_item(handle: ChainHandle) -> void:
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		_item_id = handle.result["item_id"]
		_holder_a = handle.result["holder_id"]
		await refresh_inventories()
	_update_buttons()


func _after_transfer(handle: ChainHandle) -> void:
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		_holder_b = handle.result["to_holder_id"]
		await refresh_inventories()


## Un `call_id` nuevo por pulsación: cada pulsación es una acción nueva. Los reintentos de red de una
## misma acción los hace `Chain` con su misma clave.
static func _call_id(kind: String) -> String:
	return "%s-%d-%d" % [kind, int(Time.get_unix_time_from_system()), randi() % 1000000]


# --- Inventarios ------------------------------------------------------------------------

func _refresh(label: Label, player: String, holder_id: String) -> void:
	if holder_id.is_empty():
		_show_inventory(label, player, [])
		return
	var handle := Chain.inventory(holder_id)
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.FAILED:
		label.text = "%s\n\nNo se pudo leer: %s" % [player, handle.error]
		return
	_show_inventory(label, player, handle.result.get("items", []))


func _show_inventory(label: Label, player: String, items: Array) -> void:
	var lines := PackedStringArray([player, ""])
	if items.is_empty():
		lines.append("(sin objetos)")
	for item: Dictionary in items:
		lines.append("%d × %s (%s)" % [item["amount"], item["name"], item["symbol"]])
		var qualities: Dictionary = item.get("qualities", {})
		for key: String in qualities:
			lines.append("    %s: %s" % [key, qualities[key]])
	label.text = "\n".join(lines)


# --- Estado de las operaciones ----------------------------------------------------------

func _track(title: String, handle: ChainHandle) -> void:
	var label := Label.new()
	_operations.add_child(label)
	_operations.move_child(label, 0)
	var index := _rows.size()
	_rows.append({"label": label, "title": title, "handle": handle, "trail": PackedStringArray(["pending"])})
	# Se ata el índice de la fila y no el handle: un handle que se guardara a sí mismo no se liberaría.
	handle.applied.connect(_on_state.bind(index, ChainHandle.APPLIED))
	handle.settled.connect(_on_state.bind(index, ChainHandle.SETTLED))
	handle.failed.connect(_on_failed.bind(index))
	_paint(_rows[index])


func _on_state(index: int, state: String) -> void:
	_rows[index]["trail"].append(state)
	_paint(_rows[index])


func _on_failed(error: ChainError, index: int) -> void:
	var retry := "se puede reintentar" if error.retryable else "no se puede reintentar"
	_rows[index]["trail"].append("failed (%s, %s)" % [error, retry])
	_paint(_rows[index])


func _paint(row: Dictionary) -> void:
	var handle: ChainHandle = row["handle"]
	var operation := handle.operation_id if not handle.operation_id.is_empty() else "—"
	row["label"].text = "%s   %s   %s" % [row["title"], operation, " → ".join(row["trail"])]


func _update_buttons() -> void:
	_item_button.disabled = _collection_id.is_empty()
	_transfer_button.disabled = _item_id.is_empty()


# --- Configuración e interfaz -----------------------------------------------------------

static func _config() -> ChainConfig:
	var config := ChainConfig.new()
	var token := OS.get_environment("CHAIN_DEMO_READ_TOKEN")
	if token.is_empty():
		config.mode = ChainConfig.Mode.MOCK
		config.mock_sender = PLAYER_A
		return config
	config.write_url = _env("CHAIN_DEMO_WRITE_URL", "http://127.0.0.1:8788")
	config.read_url = _env("CHAIN_DEMO_READ_URL", "http://127.0.0.1:8787")
	config.read_token = token
	return config


static func _env(name: String, fallback: String) -> String:
	var value := OS.get_environment(name)
	return value if not value.is_empty() else fallback


func _build(config: ChainConfig) -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	add_child(margin)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 16)
	margin.add_child(column)

	var title := Label.new()
	title.text = "godot-chain: demo del hito"
	title.add_theme_font_size_override("font_size", 24)
	column.add_child(title)

	var mode := Label.new()
	if config.mode == ChainConfig.Mode.MOCK:
		mode.text = "Modo MOCK: en memoria y sin red (define CHAIN_DEMO_READ_TOKEN para el modo LIVE)."
	else:
		mode.text = "Modo LIVE. Escrituras: servidor de juego en %s. Lecturas: %s." % [config.write_url, config.read_url]
	column.add_child(mode)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	column.add_child(buttons)
	_button(buttons, "1. Crear colección", create_collection)
	_item_button = _button(buttons, "2. Crear objeto (%d para A)" % ITEM_AMOUNT, create_item)
	_transfer_button = _button(buttons, "3. Transferir 1 de A a B", transfer_one)
	_button(buttons, "Releer inventarios", refresh_inventories)

	var inventories := HBoxContainer.new()
	inventories.add_theme_constant_override("separation", 16)
	column.add_child(inventories)
	_inventory_a = _panel(inventories)
	_inventory_b = _panel(inventories)

	var heading := Label.new()
	heading.text = "Operaciones (la más reciente arriba)"
	column.add_child(heading)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(scroll)
	_operations = VBoxContainer.new()
	_operations.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_operations)


static func _button(parent: Control, text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.pressed.connect(func() -> void: action.call())
	parent.add_child(button)
	return button


static func _panel(parent: Control) -> Label:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.custom_minimum_size = Vector2(0, 180)
	parent.add_child(panel)
	var label := Label.new()
	panel.add_child(label)
	return label
