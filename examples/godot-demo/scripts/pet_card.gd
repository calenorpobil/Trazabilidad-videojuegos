extends PanelContainer
## Tarjeta de una mascota en el corral.
##
## Dibuja lo que predice `PetView` (reglas en Rust, nidada-ext) a partir de la instantánea
## del servidor. No decide nada: los botones piden la acción y el servidor responde.

signal action_requested(pet_id: String, action: String)
signal rename_requested(pet_id: String, pet_name: String)

## Seis tonos (diseño 3.3).
const PALETTE: Array[Color] = [
	Color("#f28c38"), Color("#4a90d9"), Color("#5cb85c"),
	Color("#f2c94c"), Color("#e86f9c"), Color("#9b6fd1"),
]
const PATTERN_NAMES := {"plain": "liso", "spots": "manchas", "stripes": "rayas"}
const STAGE_NAMES := {"baby": "Cría", "young": "Joven", "adult": "Adulta"}

var pet_id := ""
var _view: PetView
var _food := 0

var _title: Label
var _subtitle: Label
var _body: Panel
var _bars := {}
var _growth: ProgressBar
var _status: Label
var _feed: Button
var _play: Button
var _sleep: Button
var _name_row: HBoxContainer
var _name_edit: LineEdit


func _init() -> void:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	add_child(box)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 12)
	box.add_child(header)

	_body = Panel.new()
	_body.custom_minimum_size = Vector2(64, 64)
	header.add_child(_body)

	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 22)
	titles.add_child(_title)
	_subtitle = Label.new()
	_subtitle.modulate = Color(1, 1, 1, 0.7)
	titles.add_child(_subtitle)

	_name_row = HBoxContainer.new()
	box.add_child(_name_row)
	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Ponle nombre"
	_name_edit.max_length = 16
	_name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_row.add_child(_name_edit)
	var name_button := Button.new()
	name_button.text = "Bautizar"
	name_button.pressed.connect(func() -> void: rename_requested.emit(pet_id, _name_edit.text))
	_name_row.add_child(name_button)

	_bars.hunger = _add_bar(box, "Hambre", Color("#e8a33d"))
	_bars.mood = _add_bar(box, "Ánimo", Color("#e86f9c"))
	_bars.energy = _add_bar(box, "Energía", Color("#4a90d9"))
	_growth = _add_bar(box, "Crecimiento", Color("#5cb85c"))

	_status = Label.new()
	_status.modulate = Color(1, 1, 1, 0.7)
	box.add_child(_status)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	box.add_child(actions)
	_feed = _add_action(actions, "Dar de comer", "feed")
	_play = _add_action(actions, "Jugar", "play")
	_sleep = _add_action(actions, "Dormir", "sleep")


## Carga los datos de una mascota tal como los manda el servidor.
func setup(pet: Dictionary, time_scale: float, food: int) -> void:
	pet_id = pet.pet_id
	_food = food
	var s: Dictionary = pet.snapshot
	_view = PetView.create(
		pet.species, s.hunger, s.mood, s.energy, s.growth_hours,
		int(s.at), int(s.sleep_until), int(s.play_ready_at), time_scale)

	var species_name := SpeciesCatalog.display_name(pet.species)
	var has_name: bool = pet.name != null
	_title.text = pet.name if has_name else species_name
	_name_row.visible = not has_name
	var rarity := "rara" if SpeciesCatalog.rarity(pet.species) == "rare" else "común"
	_subtitle.set_meta("base", "%s · %s · %s" % [species_name, rarity, PATTERN_NAMES.get(pet.pattern, "")])

	var style := StyleBoxFlat.new()
	style.bg_color = PALETTE[int(pet.color) % PALETTE.size()]
	style.set_corner_radius_all(32)
	_body.add_theme_stylebox_override("panel", style)


## Recalcula con el reloj del servidor. Se llama en cada fotograma.
func tick(now: int) -> void:
	if _view == null:
		return
	_view.refresh(now)
	_set_bar(_bars.hunger, _view.hunger())
	_set_bar(_bars.mood, _view.mood())
	_set_bar(_bars.energy, _view.energy())
	_set_bar(_growth, _view.growth_progress() * 100.0)

	_subtitle.text = "%s · %s" % [STAGE_NAMES.get(_view.stage(), ""), _subtitle.get_meta("base", "")]
	var sleeping := _view.is_sleeping()
	if sleeping:
		_status.text = "Durmiendo…"
	elif not _view.is_growing():
		_status.text = "Está triste y ha dejado de crecer. Cuídala."
	elif _view.stage() == "adult":
		_status.text = "Adulta."
	else:
		_status.text = "Creciendo."
	_feed.disabled = sleeping or _food <= 0
	_feed.text = "Dar de comer (%d)" % _food
	_play.disabled = sleeping or not _view.can_play()
	_sleep.disabled = sleeping


## Fila con nombre, barra y valor. El fondo de la barra se ve aunque esté vacía:
## una necesidad a 0 tiene que parecer vacía, no ausente.
func _add_bar(parent: Container, caption: String, fill: Color) -> ProgressBar:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var label := Label.new()
	label.text = caption
	label.custom_minimum_size = Vector2(120, 0)
	row.add_child(label)

	var bar := ProgressBar.new()
	bar.max_value = 100.0
	bar.show_percentage = false
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.custom_minimum_size = Vector2(0, 14)
	var background := StyleBoxFlat.new()
	background.bg_color = Color(1, 1, 1, 0.12)
	background.set_corner_radius_all(7)
	bar.add_theme_stylebox_override("background", background)
	var fill_style := StyleBoxFlat.new()
	fill_style.bg_color = fill
	fill_style.set_corner_radius_all(7)
	bar.add_theme_stylebox_override("fill", fill_style)
	row.add_child(bar)

	var value := Label.new()
	value.custom_minimum_size = Vector2(44, 0)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(value)
	bar.set_meta("value_label", value)
	return bar


func _set_bar(bar: ProgressBar, value: float) -> void:
	bar.value = value
	(bar.get_meta("value_label") as Label).text = "%d" % roundi(value)


func _add_action(parent: Container, caption: String, action: String) -> Button:
	var button := Button.new()
	button.text = caption
	# Tamaño de dedo: 48 px de alto y el ancho repartido entre los tres botones.
	button.custom_minimum_size = Vector2(0, 48)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	button.pressed.connect(func() -> void: action_requested.emit(pet_id, action))
	parent.add_child(button)
	return button
