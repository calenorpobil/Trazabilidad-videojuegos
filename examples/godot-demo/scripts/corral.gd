extends Control
## Escena principal de la fase J1: el corral del jugador.
##
## El servidor es la autoridad. Esta escena pide el corral, dibuja cada mascota con su
## `PetView` y manda las acciones. Entre respuestas, las barras bajan solas porque
## `PetView` aplica las mismas reglas que el servidor.

## Cada cuánto se vuelve a pedir el corral aunque el jugador no haga nada.
const RESYNC_SECONDS := 30.0

var _api: GameApi
var _pet_card_script: GDScript
## Diferencia entre el reloj del servidor y el del dispositivo, en segundos.
var _clock_offset := 0
var _busy := false

var _food_label: Label
var _message: Label
var _cards: VBoxContainer


func _ready() -> void:
	_build_ui()
	# Sin la GDExtension no hay reglas con las que dibujar. Se comprueba antes de cargar
	# nada que use `PetView`, para enseñar un mensaje en vez de un error de script.
	if not ClassDB.class_exists("PetView"):
		_show_message("Falta la extensión de Nidada. Compílala con rust/build-ext.sh.")
		push_error("nidada-ext no está cargada: PetView no existe")
		return
	_pet_card_script = load("res://scripts/pet_card.gd")

	_api = GameApi.new(ProjectSettings.get_setting("nidada/server_url", "http://127.0.0.1:8080"))
	add_child(_api)

	if not _api.load_session():
		var created := await _api.create_player()
		if not created.ok:
			_show_message(created.message)
			return
		print("Nidada: jugador nuevo ", created.data.player_id)
	await _refresh()

	var timer := Timer.new()
	timer.wait_time = RESYNC_SECONDS
	timer.autostart = true
	timer.timeout.connect(_refresh)
	add_child(timer)


func _process(_delta: float) -> void:
	var now := int(Time.get_unix_time_from_system()) + _clock_offset
	for card in _cards.get_children():
		card.tick(now)


func _refresh() -> void:
	_apply(await _api.corral())


## Pinta un corral recibido del servidor, o el mensaje de error.
func _apply(res: Dictionary) -> void:
	if not res.ok:
		if res.code == "UNAUTHORIZED":
			# La sesión ya no vale (p. ej. se borró la base de datos del servidor).
			var created := await _api.create_player()
			if created.ok:
				_refresh()
				return
		_show_message(res.message)
		return
	_show_message("")
	var data: Dictionary = res.data
	_clock_offset = int(data.server_time) - int(Time.get_unix_time_from_system())
	var food := int(data.food)
	_food_label.text = "Comida: %d" % food

	for card in _cards.get_children():
		card.queue_free()
	for pet: Dictionary in data.pets:
		var card: PanelContainer = _pet_card_script.new()
		_cards.add_child(card)
		card.setup(pet, float(data.time_scale), food)
		card.action_requested.connect(_on_action)
		card.rename_requested.connect(_on_rename)
	print("Nidada: corral con %d mascotas, comida %d" % [data.pets.size(), food])


func _on_action(pet_id: String, action: String) -> void:
	if _busy:
		return
	_busy = true
	_apply(await _api.act(pet_id, action))
	_busy = false


func _on_rename(pet_id: String, pet_name: String) -> void:
	if _busy:
		return
	_busy = true
	_apply(await _api.rename(pet_id, pet_name))
	_busy = false


func _show_message(text: String) -> void:
	_message.text = text
	_message.visible = text != ""


func _build_ui() -> void:
	var background := ColorRect.new()
	background.color = Color("#1e2a24")
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16)
	add_child(margin)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	margin.add_child(column)

	var header := HBoxContainer.new()
	column.add_child(header)
	var title := Label.new()
	title.text = "Tu corral"
	title.add_theme_font_size_override("font_size", 28)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title)
	_food_label = Label.new()
	header.add_child(_food_label)

	_message = Label.new()
	_message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_message.add_theme_color_override("font_color", Color("#ffb4a2"))
	_message.visible = false
	column.add_child(_message)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(scroll)
	_cards = VBoxContainer.new()
	_cards.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_cards.add_theme_constant_override("separation", 12)
	scroll.add_child(_cards)
