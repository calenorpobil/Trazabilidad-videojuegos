extends Control
## Escena principal: el corral del jugador, la pestaña de amigos y las visitas.
##
## El servidor es la autoridad. Esta escena pide el corral, dibuja cada mascota con su
## `PetView` y manda las acciones. Entre respuestas, las barras bajan solas porque
## `PetView` aplica las mismas reglas que el servidor.

## Cada cuánto se vuelve a pedir el corral aunque el jugador no haga nada.
const RESYNC_SECONDS := 30.0
const TAB_CORRAL := 0
const TAB_FRIENDS := 1

var _api: GameApi
var _pet_card_script: GDScript
## Diferencia entre el reloj del servidor y el del dispositivo, en segundos.
var _clock_offset := 0
var _busy := false
## Código del amigo que se está visitando, o vacío.
var _visiting := ""

var _food_label: Label
var _code_label: Label
var _message: Label
var _tabs: TabContainer
var _cards: VBoxContainer
var _friends: VBoxContainer
var _visit_view: VBoxContainer
var _visit_title: Label
var _visit_cards: VBoxContainer


func _ready() -> void:
	# Sin la GDExtension no hay reglas con las que dibujar. Se comprueba antes de cargar
	# nada que la use, para enseñar un mensaje en vez de un error de script.
	if not ClassDB.class_exists("PetView"):
		_build_message_only("Falta la extensión de Nidada. Compílala con rust/build-ext.sh.")
		push_error("nidada-ext no está cargada: PetView no existe")
		return
	_pet_card_script = load("res://scripts/pet_card.gd")

	_api = GameApi.new(ProjectSettings.get_setting("nidada/server_url", "http://127.0.0.1:8080"))
	add_child(_api)
	_build_ui()

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
	timer.timeout.connect(_on_resync)
	add_child(timer)


func _process(_delta: float) -> void:
	if _cards == null:
		return
	var now := int(Time.get_unix_time_from_system()) + _clock_offset
	for card in _cards.get_children():
		card.tick(now)
	for card in _visit_cards.get_children():
		card.tick(now)


func _refresh() -> void:
	_apply(await _api.corral())


func _on_resync() -> void:
	if _visiting != "":
		_open_visit(_visiting, _visit_title.get_meta("label", _visiting))
	else:
		_refresh()


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
	_code_label.text = data.friend_code
	_fill_cards(_cards, data.pets, float(data.time_scale), food, false)
	print("Nidada: corral con %d mascotas, comida %d" % [data.pets.size(), food])


func _fill_cards(container: Container, pets: Array, time_scale: float, food: int, read_only: bool) -> void:
	for card in container.get_children():
		card.queue_free()
	for pet: Dictionary in pets:
		var card: PanelContainer = _pet_card_script.new()
		card.read_only = read_only
		container.add_child(card)
		card.setup(pet, time_scale, food)
		if not read_only:
			card.action_requested.connect(_on_action)
			card.rename_requested.connect(_on_rename)


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


func _on_tab_changed(tab: int) -> void:
	_show_message("")
	if tab == TAB_FRIENDS:
		_friends.reload()


func _open_visit(code: String, label: String) -> void:
	var res := await _api.visit(code)
	if not res.ok:
		_show_message(res.message)
		return
	_show_message("")
	_visiting = code
	_visit_title.text = "Corral de %s" % label
	_visit_title.set_meta("label", label)
	var data: Dictionary = res.data
	_clock_offset = int(data.server_time) - int(Time.get_unix_time_from_system())
	_fill_cards(_visit_cards, data.pets, float(data.time_scale), 0, true)
	_tabs.visible = false
	_visit_view.visible = true
	print("Nidada: visitando %s, %d mascotas" % [code, data.pets.size()])


func _close_visit() -> void:
	_visiting = ""
	for card in _visit_cards.get_children():
		card.queue_free()
	_visit_view.visible = false
	_tabs.visible = true
	_show_message("")


func _show_message(text: String) -> void:
	_message.text = text
	_message.visible = text != ""


func _build_ui() -> void:
	var column := _build_frame()

	var header := HBoxContainer.new()
	column.add_child(header)
	var title := Label.new()
	title.text = "Nidada"
	title.add_theme_font_size_override("font_size", 28)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title)
	_food_label = Label.new()
	header.add_child(_food_label)

	var code_row := HBoxContainer.new()
	code_row.add_theme_constant_override("separation", 8)
	column.add_child(code_row)
	var code_caption := Label.new()
	code_caption.text = "Tu código de amigo:"
	code_caption.modulate = Color(1, 1, 1, 0.7)
	code_row.add_child(code_caption)
	_code_label = Label.new()
	_code_label.add_theme_font_size_override("font_size", 20)
	_code_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	code_row.add_child(_code_label)
	var copy := Button.new()
	copy.text = "Copiar"
	copy.pressed.connect(func() -> void: DisplayServer.clipboard_set(_code_label.text))
	code_row.add_child(copy)

	_message = Label.new()
	_message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_message.add_theme_color_override("font_color", Color("#ffb4a2"))
	_message.visible = false
	column.add_child(_message)

	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(_tabs)

	var corral_scroll := ScrollContainer.new()
	corral_scroll.name = "Mi corral"
	corral_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_tabs.add_child(corral_scroll)
	_cards = VBoxContainer.new()
	_cards.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_cards.add_theme_constant_override("separation", 12)
	corral_scroll.add_child(_cards)

	_friends = load("res://scripts/friends_panel.gd").new()
	_friends.name = "Amigos"
	_friends.setup(_api)
	_friends.visit_requested.connect(_open_visit)
	_friends.message.connect(_show_message)
	_tabs.add_child(_friends)
	_tabs.tab_changed.connect(_on_tab_changed)

	_visit_view = VBoxContainer.new()
	_visit_view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_visit_view.add_theme_constant_override("separation", 12)
	_visit_view.visible = false
	column.add_child(_visit_view)
	var visit_header := HBoxContainer.new()
	visit_header.add_theme_constant_override("separation", 12)
	_visit_view.add_child(visit_header)
	var back := Button.new()
	back.text = "‹ Volver"
	back.custom_minimum_size = Vector2(0, 44)
	back.pressed.connect(_close_visit)
	visit_header.add_child(back)
	_visit_title = Label.new()
	_visit_title.add_theme_font_size_override("font_size", 22)
	visit_header.add_child(_visit_title)
	var visit_scroll := ScrollContainer.new()
	visit_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	visit_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_visit_view.add_child(visit_scroll)
	_visit_cards = VBoxContainer.new()
	_visit_cards.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_visit_cards.add_theme_constant_override("separation", 12)
	visit_scroll.add_child(_visit_cards)


## Fondo y márgenes. Devuelve la columna donde va todo lo demás.
func _build_frame() -> VBoxContainer:
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
	return column


func _build_message_only(text: String) -> void:
	var column := _build_frame()
	_message = Label.new()
	_message.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_message.add_theme_color_override("font_color", Color("#ffb4a2"))
	column.add_child(_message)
	_show_message(text)
