extends VBoxContainer
## Pestaña «Amigos» (fase J5): añadir por código, poner alias, quitar y visitar.
##
## La amistad va en un sentido: añadir a alguien es guardar su código. El alias sólo lo
## ves tú. El servidor decide todo; aquí sólo se valida el formato del código, con la
## misma regla que el servidor (`FriendCode`, de nidada-ext).

signal visit_requested(code: String, label: String)
signal message(text: String)

const BAD_CODE := "Un código de amigo tiene 6 letras y números, sin 0, O, 1, I ni L."

var _api: GameApi
var _busy := false

var _code_edit: LineEdit
var _alias_edit: LineEdit
var _list: VBoxContainer


func _init() -> void:
	add_theme_constant_override("separation", 10)

	var hint := Label.new()
	hint.text = "Añade a alguien con su código de amigo. El alias que le pongas sólo lo ves tú."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.modulate = Color(1, 1, 1, 0.7)
	add_child(hint)

	var form := HBoxContainer.new()
	form.add_theme_constant_override("separation", 8)
	add_child(form)
	_code_edit = LineEdit.new()
	_code_edit.placeholder_text = "Código"
	_code_edit.max_length = 8
	_code_edit.custom_minimum_size = Vector2(110, 44)
	form.add_child(_code_edit)
	_alias_edit = LineEdit.new()
	_alias_edit.placeholder_text = "Alias (opcional)"
	_alias_edit.max_length = 16
	_alias_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	form.add_child(_alias_edit)
	var add_button := Button.new()
	add_button.text = "Añadir"
	add_button.custom_minimum_size = Vector2(0, 44)
	add_button.pressed.connect(_on_add)
	form.add_child(add_button)
	_code_edit.text_submitted.connect(func(_t: String) -> void: _on_add())

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 10)
	scroll.add_child(_list)


func setup(api: GameApi) -> void:
	_api = api


func reload() -> void:
	_apply(await _api.friends())


func _apply(res: Dictionary) -> void:
	if not res.ok:
		message.emit(res.message)
		return
	message.emit("")
	for child in _list.get_children():
		child.queue_free()
	var friends: Array = res.data.friends
	if friends.is_empty():
		var empty := Label.new()
		empty.text = "Todavía no has añadido a nadie."
		empty.modulate = Color(1, 1, 1, 0.6)
		_list.add_child(empty)
	for friend: Dictionary in friends:
		_list.add_child(_row(friend))


func _row(friend: Dictionary) -> Control:
	var code: String = friend.code
	var alias: String = friend.alias if friend.alias != null else ""

	# Fondo propio: el panel por defecto es del mismo color que el de la pestaña.
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(1, 1, 1, 0.06)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(12)
	panel.add_theme_stylebox_override("panel", style)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)

	var alias_edit := LineEdit.new()
	alias_edit.text = alias
	alias_edit.placeholder_text = "Sin alias — escribe uno y pulsa Intro"
	alias_edit.max_length = 16
	alias_edit.text_submitted.connect(func(text: String) -> void: _on_alias(code, text))
	box.add_child(alias_edit)

	var pets: PackedStringArray = []
	for pet: Dictionary in friend.pets:
		pets.append(pet.name if pet.name != null else SpeciesCatalog.display_name(pet.species))
	var details := Label.new()
	details.text = "Código %s · %s" % [code, ", ".join(pets)]
	details.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	details.modulate = Color(1, 1, 1, 0.7)
	box.add_child(details)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	box.add_child(actions)
	var visit := Button.new()
	visit.text = "Visitar"
	visit.custom_minimum_size = Vector2(0, 44)
	visit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	visit.pressed.connect(func() -> void: visit_requested.emit(code, alias if alias != "" else code))
	actions.add_child(visit)
	var remove := Button.new()
	remove.text = "Quitar"
	remove.custom_minimum_size = Vector2(0, 44)
	remove.pressed.connect(func() -> void: _on_remove(code))
	actions.add_child(remove)
	return panel


func _on_add() -> void:
	var code := FriendCode.normalize(_code_edit.text)
	if code == "":
		message.emit(BAD_CODE)
		return
	if _busy:
		return
	_busy = true
	var res := await _api.add_friend(code, _alias_edit.text.strip_edges())
	_busy = false
	if res.ok:
		_code_edit.text = ""
		_alias_edit.text = ""
	_apply(res)


func _on_alias(code: String, text: String) -> void:
	if _busy:
		return
	_busy = true
	var res := await _api.set_alias(code, text.strip_edges())
	_busy = false
	_apply(res)


func _on_remove(code: String) -> void:
	if _busy:
		return
	_busy = true
	var res := await _api.remove_friend(code)
	_busy = false
	_apply(res)
