extends RefCounted
## Casos de test_ext.gd. Los mismos valores que needs::tests en nidada-rules.

const HOUR := 3600


func run(t: Object) -> void:
	# Adulta, 10 h de juego a escala 1: hambre 60, ánimo 70, energía 80.
	var view := PetView.create("gota", 100.0, 100.0, 100.0, 100.0, 0, 0, 0, 1.0)
	t.check(view != null, "PetView.create devuelve una vista")
	view.refresh(10 * HOUR)
	t.check(is_equal_approx(view.hunger(), 60.0), "hambre a las 10 h: %s" % view.hunger())
	t.check(is_equal_approx(view.mood(), 70.0), "ánimo a las 10 h: %s" % view.mood())
	t.check(is_equal_approx(view.energy(), 80.0), "energía a las 10 h: %s" % view.energy())
	t.check(view.stage() == "adult", "etapa adulta")
	t.check(view.is_growing(), "crece con bienestar 70")

	# Cría: doble ritmo.
	var baby := PetView.create("gota", 100.0, 100.0, 100.0, 0.0, 0, 0, 0, 1.0)
	baby.refresh(10 * HOUR)
	t.check(is_equal_approx(baby.hunger(), 20.0), "cría, hambre a las 10 h: %s" % baby.hunger())
	t.check(baby.stage() == "baby", "etapa cría")

	# Escala de tiempo: 10 h de juego son 300 s con escala 120.
	var fast := PetView.create("gota", 100.0, 100.0, 100.0, 100.0, 0, 0, 0, 120.0)
	fast.refresh(300)
	t.check(is_equal_approx(fast.hunger(), 60.0), "escala 120: %s" % fast.hunger())

	# Entradas inválidas.
	t.check(PetView.create("dragon", 1, 1, 1, 0, 0, 0, 0, 1.0) == null, "especie desconocida da null")
	t.check(PetView.create("gota", 1, 1, 1, 0, 0, 0, 0, 0.0) == null, "escala 0 da null")

	# Catálogo.
	t.check(SpeciesCatalog.display_name("cienaga") == "Ciénaga", "nombre con tilde")
	t.check(SpeciesCatalog.rarity("vaho") == "rare", "Vaho es rara")
	t.check(SpeciesCatalog.element("vaho") == "fire+water", "elementos de Vaho")
	t.check(SpeciesCatalog.display_name("dragon") == "", "especie desconocida, nombre vacío")
