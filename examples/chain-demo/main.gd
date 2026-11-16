extends Control

## La escena del hito (propuesta, 7): los inventarios de los jugadores A y B, un botón para dar
## una unidad de cada tipo de A a B, y el estado de cada operación. Sin arte y sin reglas de juego.
##
## El catálogo no se crea aquí: la colección y el tipo, con su entrega inicial a A, los crea el
## estudio desde la consola `/admin` (revisión del 16 de noviembre de 2026). El juego sólo lee y
## transfiere. Las transferencias van al servidor de juego (`examples/game-server`), que decide que
## quien da es el jugador A; las lecturas van directas al backend.
##
## Configuración por variables de entorno:
##   CHAIN_DEMO_READ_TOKEN  el `read_token` del backend. Sin él, la demo arranca en modo MOCK
##   CHAIN_DEMO_WRITE_URL   el servidor de juego; por defecto http://127.0.0.1:8788
##   CHAIN_DEMO_READ_URL    el backend; por defecto http://127.0.0.1:8787
##
## Los inventarios sólo se releen en `settled`; `applied` sólo se enseña (invariante 5).

const PLAYER_A := "player-a"
const PLAYER_B := "player-b"

var _inventory_a: VBoxContainer
var _inventory_b: VBoxContainer
var _operations: VBoxContainer
## Una fila por operación: `label`, `title`, `handle` y `trail`, los estados por los que ha pasado.
var _rows: Array[Dictionary] = []


func _ready() -> void:
	var config := _config()
	Chain.configure(config)
	_build(config)
	if config.mode == ChainConfig.Mode.MOCK:
		await _seed_mock()
	refresh_inventories()


## El identificador de la operación llega al aceptarla, sin señal: se repinta mientras está en curso.
func _process(_delta: float) -> void:
	for row in _rows:
		if not row["handle"].is_finished():
			_paint(row)


# --- Lo que hace el jugador ---------------------------------------------------------------

## Da una unidad del tipo `item_id` a B. Quien da lo decide el servidor de juego: el jugador A.
func give_one(item_id: String, item_name: String) -> ChainHandle:
	var handle := Chain.transfer(item_id, 1, PLAYER_B, _call_id("transfer"))
	_track("Dar 1 «%s» a B" % item_name, handle)
	_after_transfer(handle)
	return handle


func refresh_inventories() -> void:
	await _refresh(_inventory_a, PLAYER_A, true)
	await _refresh(_inventory_b, PLAYER_B, false)


func _after_transfer(handle: ChainHandle) -> void:
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		await refresh_inventories()


## Un `call_id` nuevo por pulsación: cada pulsación es una acción nueva. Los reintentos de red de una
## misma acción los hace `Chain` con su misma clave.
static func _call_id(kind: String) -> String:
	return "%s-%d-%d" % [kind, int(Time.get_unix_time_from_system()), randi() % 1000000]


## En MOCK no hay consola: la demo se crea un tipo de prueba en memoria para tener algo que dar.
## En LIVE, `create_collection` y `create_item` no se usan; el servidor de juego los rechaza.
func _seed_mock() -> void:
	var collection := Chain.create_collection("Armería de prueba", _call_id("collection"))
	_track("Datos de prueba: colección", collection)
	if not collection.is_finished():
		await collection.finished
	if collection.state != ChainHandle.SETTLED:
		return
	var item := Chain.create_item(collection.result["collection_id"], "Espada de hierro", "SWORD", "",
		{"rarity": "common", "damage": "12"}, PLAYER_A, 3, _call_id("item"))
	_track("Datos de prueba: 3 espadas para A", item)
	if not item.is_finished():
		await item.finished


# --- Inventarios --------------------------------------------------------------------------

func _refresh(box: VBoxContainer, player: String, can_give: bool) -> void:
	var handle := Chain.inventory(player)
	if not handle.is_finished():
		await handle.finished
	if handle.state == ChainHandle.SETTLED:
		_show_inventory(box, player, handle.result.get("holder_id", ""), handle.result.get("items", []), can_give)
	elif handle.error.code == ChainError.NOT_FOUND:
		# Nunca ha recibido nada: el servidor todavía no lo conoce.
		_show_inventory(box, player, "", [], can_give)
	else:
		_show_message(box, player, "No se pudo leer: %s" % handle.error)


func _show_inventory(box: VBoxContainer, player: String, holder_id: String, items: Array, can_give: bool) -> void:
	_clear(box)
	_add_label(box, "%s   %s" % [player, holder_id]).add_theme_font_size_override("font_size", 18)
	if items.is_empty():
		_add_label(box, "(sin objetos)")
	for item: Dictionary in items:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		box.add_child(row)
		var lines := PackedStringArray(["%d × %s (%s)   %s" % [item["amount"], item["name"], item["symbol"], item["item_id"]]])
		var qualities: Dictionary = item.get("qualities", {})
		for key: String in qualities:
			lines.append("    %s: %s" % [key, qualities[key]])
		var text := _add_label(row, "\n".join(lines))
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if can_give:
			var button := Button.new()
			button.text = "Dar 1 a B"
			button.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			button.pressed.connect(give_one.bind(item["item_id"], item["name"]))
			row.add_child(button)


func _show_message(box: VBoxContainer, player: String, message: String) -> void:
	_clear(box)
	_add_label(box, player).add_theme_font_size_override("font_size", 18)
	_add_label(box, message)


static func _clear(box: VBoxContainer) -> void:
	for child in box.get_children():
		box.remove_child(child)
		child.queue_free()


static func _add_label(parent: Control, text: String) -> Label:
	var label := Label.new()
	label.text = text
	parent.add_child(label)
	return label


# --- Estado de las operaciones ------------------------------------------------------------

func _track(title: String, handle: ChainHandle) -> void:
	var label := Label.new()
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
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


# --- Configuración e interfaz -------------------------------------------------------------

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
		mode.text = "Modo MOCK: en memoria y sin red, con un tipo de prueba (define CHAIN_DEMO_READ_TOKEN para el modo LIVE)."
	else:
		mode.text = ("Modo LIVE. Transferencias: servidor de juego en %s. Lecturas: %s.\n"
			+ "Los objetos se crean desde la consola del backend, en /admin.") % [config.write_url, config.read_url]
	column.add_child(mode)

	var refresh := Button.new()
	refresh.text = "Releer inventarios"
	refresh.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	refresh.pressed.connect(refresh_inventories)
	column.add_child(refresh)

	# Si los inventarios no caben, se recorren con su barra; las operaciones guardan siempre su sitio abajo.
	var inventory_scroll := ScrollContainer.new()
	inventory_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	inventory_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(inventory_scroll)
	var inventories := HBoxContainer.new()
	inventories.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inventories.add_theme_constant_override("separation", 16)
	inventory_scroll.add_child(inventories)
	_inventory_a = _panel(inventories)
	_inventory_b = _panel(inventories)
	_show_message(_inventory_a, PLAYER_A, "Leyendo…")
	_show_message(_inventory_b, PLAYER_B, "Leyendo…")

	var heading := Label.new()
	heading.text = "Operaciones (la más reciente arriba)"
	column.add_child(heading)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 120)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(scroll)
	_operations = VBoxContainer.new()
	_operations.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_operations)


static func _panel(parent: Control) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	parent.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 12)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	margin.add_child(box)
	return box
