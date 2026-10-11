# Contrato HTTP — `godot-chain` v1

**Estado: CONGELADO el 6 de septiembre de 2026 (bloque 1).**

Este documento es el artefacto del que cuelga todo lo demás: el backend, el addon, el
modo mock y el servidor de juego de ejemplo. Se implementa contra él, no contra el
código. Cambiarlo después del bloque 1 exige una decisión explícita y una nota en el
apartado 10 (Historial).

**Regla de vocabulario:** ningún nombre de campo, ningún código de error y ningún valor
de este contrato menciona conceptos de cadena. Si un endpoint necesita hablar de
*blockhash*, de una clave pública o de comisiones de red, la costura está rota y el
error es de diseño.

---

## 1. Modelo

| Concepto | Qué es | Prefijo del identificador |
|---|---|---|
| `Collection` | Agrupación lógica del catálogo. **No existe on-chain** | `col_` |
| `Item` | Un **tipo** de objeto (no un ejemplar) | `itm_` |
| `Quality` | Atributo del tipo, no del ejemplar. Pares clave-valor de texto | — |
| `Holder` | Un jugador, identificado de forma opaca | `hld_` |
| `Operation` | Una escritura asíncrona en curso | `opr_` |

Un despliegue del backend sirve a **un** juego. El `game_id` es configuración del
servidor, **no** un campo de ninguna petición.

Los identificadores son opacos: el cliente no los interpreta, no los construye y no
asume longitud. Nunca viaja una dirección en crudo por este contrato.

---

## 2. Autenticación

| Tipo de endpoint | Cabecera | Quién la tiene |
|---|---|---|
| Escritura | `Authorization: Bearer <write_key>` | Sólo el servidor de juego |
| Lectura | `Authorization: Bearer <read_token>` | El binario del juego, y por tanto **es público de facto** |

- El `write_key` **nunca** viaja en el binario del juego. Se extrae de un APK con
  herramientas triviales.
- El `read_token` es de sólo lectura y va limitado por tasa. Se asume que cualquiera
  puede extraerlo y consultar el inventario de cualquier jugador de ese juego
  (limitación 12.5 de la propuesta).
- Las lecturas exigen `read_token` **exactamente**; un `write_key` en un endpoint de
  lectura se rechaza. El servidor de juego, si necesita leer, porta ambos.
- Los dos tipos pueden servirse desde bases distintas (`write_url` / `read_url` en
  `ChainConfig`) si hay un proxy delante. Las rutas son las mismas.

Credencial ausente o inválida: `401` con código `REJECTED`.

La consola de administración del backend (`/admin`) tiene su propia credencial y sus propias
rutas, internas del backend. **No forman parte de este contrato** y ni el addon ni el servidor
de juego las usan.

---

## 3. Idempotencia

Toda escritura exige `Idempotency-Key: <cadena opaca, 1..128 caracteres>`. Sin ella:
`400` con código `REJECTED`.

**Quién la genera.** Desde el 9-oct-2026 la construye el plugin (`Chain`) como SHA-256 en
hexadecimal de `(operación, call_id)`, donde `call_id` es el identificador de llamada que
aporta el juego (propuesta 4.4). El servidor de juego la reenvía sin modificarla. Para el backend
es una cadena opaca: no valida cómo se construyó. Un llamador que no use el plugin aporta la suya.

Garantía: **marcar primero, llamar después.** El backend inserta la clave en SQLite
dentro de una transacción antes de construir nada. Si la clave ya existe, devuelve el
resultado anterior **con el mismo cuerpo y el mismo `operation_id`**, sin volver a
tocar la cadena. Las claves no caducan.

Reutilizar una clave con un cuerpo distinto devuelve el resultado original, no un
error: el cliente que reintenta con datos distintos bajo la misma clave tiene un fallo
de programación, y devolverle su propio resultado anterior es la respuesta menos
dañina.

---

## 4. Escrituras

Todas devuelven `202 Accepted` salvo `POST /v1/collections`, que devuelve `201` porque
no toca la cadena y por eso **no** devuelve `operation_id`.

### 4.1 Referencia a un tenedor

Varios cuerpos necesitan nombrar a un jugador. Se usa siempre esta forma, con
**exactamente una** de las dos claves:

```json
{ "external_id": "player-42" }
```
```json
{ "holder_id": "hld_9fK2s1Qd8Xa4Rb0T" }
```

El `external_id` lo aporta el juego; el backend no lo crea ni lo verifica, y debe ser
**inmutable** (limitación 12.8). Toda respuesta que resuelva un tenedor devuelve su
`holder_id`, que es como el juego lo nombra a partir de entonces.

### 4.2 `POST /v1/collections`

```json
{ "name": "Armería" }
```
→ `201`
```json
{ "collection_id": "col_7Hs2..." }
```

No produce transacción. No devuelve `operation_id`.

### 4.3 `POST /v1/items`

Crea el tipo y emite la cantidad inicial. Dos efectos, una operación.

```json
{
  "collection_id": "col_7Hs2...",
  "name": "Espada de hierro",
  "symbol": "SWORD",
  "uri": "https://ejemplo.test/espada.json",
  "qualities": { "rarity": "common", "damage": "12" },
  "initial_grant": { "holder": { "external_id": "player-42" }, "amount": 1 }
}
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `collection_id` | sí | Debe existir |
| `name` | sí | 1..32 caracteres |
| `symbol` | sí | 1..10 caracteres |
| `uri` | no | Cadena vacía si se omite. Máximo 200 caracteres |
| `qualities` | no | Mapa texto→texto, máximo 8 pares, claves 1..32, valores 1..64. La clave `collection` está **reservada**: la escribe el backend |
| `initial_grant` | sí | `amount` entero >= 1. El tipo nace con existencias porque un tipo sin ejemplares no es demostrable |

→ `202`
```json
{ "operation_id": "opr_3Kd9...", "item_id": "itm_a1b2...", "holder_id": "hld_9fK2..." }
```

El `item_id` se devuelve **antes** de que la operación termine: existe en cuanto se
registra. Que el objeto sea utilizable depende de llegar a `settled`.

### 4.4 `POST /v1/items/{item_id}/grants`

Entrega unidades a un tenedor. Emisión nueva, no mueve nada de nadie.

```json
{ "holder": { "external_id": "player-77" }, "amount": 3 }
```
→ `202`
```json
{ "operation_id": "opr_5Bn1...", "holder_id": "hld_2Tp7..." }
```

### 4.5 `POST /v1/items/{item_id}/transfer`

```json
{
  "from": { "external_id": "player-42" },
  "to": { "holder_id": "hld_2Tp7..." },
  "amount": 1
}
```
→ `202`
```json
{ "operation_id": "opr_8Wq4...", "from_holder_id": "hld_9fK2...", "to_holder_id": "hld_2Tp7..." }
```

- `amount` es **obligatorio**. Entero >= 1.
- No existe la transferencia parcial: o entra la cantidad pedida entera, o no entra.
- El emisor **no firma nunca**. La autoridad del juego mueve el saldo como delegado
  permanente (decisión 4.2 y limitación 12.3 de la propuesta).
- Saldo insuficiente: comprobación optimista en el backend →
  `409` / `INSUFFICIENT_BALANCE`. La cadena queda como red de seguridad, no como
  primera defensa.
- `from` y `to` no pueden resolver al mismo tenedor: `400` / `REJECTED`.

### 4.6 `PATCH /v1/items/{item_id}`

**Edita el tipo en el sitio.** Cambia los datos de un tipo ya creado, sin crear otro: el
`item_id` no cambia y los tenedores conservan sus unidades. Decidido el 11-oct-2026; sustituye
al borrador anterior (`PATCH …/qualities`, sólo cualidades).

**Fuera del hito (8.1).** No se implementa hasta que se construya la consola de administración,
que es quien la necesita (el catálogo declarativo aplica con ella los cambios en entradas ya
creadas). Mientras no exista: `404`.

```json
{
  "name": "Brasa de fuego",
  "uri": "https://ejemplo.test/brasa.json",
  "qualities": { "kind": "pet", "element": "fire", "rarity": "common", "growth_hours": "96" }
}
```
→ `202` `{ "operation_id": "opr_..." }`

| Campo | Reglas |
|---|---|
| `name`, `uri` | Opcionales. Mismos límites que en 4.3 |
| `qualities` | Opcional. Es el conjunto **completo** nuevo, no un parche: las claves que falten se **eliminan**. Mismos límites que en 4.3; `collection` está reservada y se conserva |

- Al menos uno de los tres. Cualquier otro campo, incluidos `symbol` y `collection_id`,
  se rechaza: `400` / `REJECTED`. El `symbol` no se edita porque es la clave con la que un
  servidor de juego puede emparejar sus objetos con el catálogo (plan de juego 10.3).
- El tipo debe existir (`404`) y su creación debe estar en `settled`; si no, `400` / `REJECTED`.
- **Afecta a todas las unidades a la vez.** Las unidades no guardan datos propios: si `damage`
  pasa de 12 a 14, lo reflejan todas las ya repartidas. Para un cambio de significado que no
  deba alcanzar a lo ya entregado, se crea un tipo nuevo (propuesta 3).
- Es una operación como las demás: `pending → applied → settled | failed`. Hasta `settled`, las
  lecturas siguen devolviendo los datos antiguos. Si falla, el tipo queda como estaba.
- **Una edición a la vez por tipo.** Mientras la anterior no ha llegado a `settled` o `failed`, otra
  edición del mismo tipo se rechaza: `400` / `REJECTED`.
- **`revision`.** Sube en 1 al **aceptar** cada edición (`202`), no al liquidarla. Así una edición
  que falla ya consumió su número, y reintentarla produce una clave nueva en vez de devolver el fallo
  anterior (contrato 8).
- Si el cambio encarece la operación, el backend lo costea con la autoridad del juego. Si no puede:
  `INSUFFICIENT_FUNDS`.
- Una edición cuyo resultado no cabe en una sola operación se rechaza: `400` / `REJECTED`. Con valores
  de tamaño normal no ocurre; sólo con los ocho pares al máximo de longitud (propuesta, sección 13).
- Cada edición exige su propia `Idempotency-Key`: repetir una clave devolvería la edición anterior.

---

## 5. Lecturas

### 5.1 `GET /v1/operations/{operation_id}`

→ `200`
```json
{ "operation_id": "opr_3Kd9...", "state": "applied", "error": null }
```

`state` ∈ `pending` | `applied` | `settled` | `failed`.
`error` es `null` salvo en `failed`, donde lleva el objeto del apartado 6.

Este endpoint es el que sondea el addon. No expone jamás el estado de confirmación de
la cadena, ni la firma de la transacción, ni ningún dato de red: eso vive dentro del
backend.

### 5.2 `GET /v1/holders/{holder_id}/items`

→ `200`
```json
{
  "holder_id": "hld_9fK2...",
  "items": [
    {
      "item_id": "itm_a1b2...",
      "collection_id": "col_7Hs2...",
      "name": "Espada de hierro",
      "symbol": "SWORD",
      "uri": "https://ejemplo.test/espada.json",
      "qualities": { "rarity": "common", "damage": "12" },
      "amount": 2
    }
  ]
}
```

- Refleja el estado **liquidado** en la cadena. Una operación en `pending` o `applied`
  puede no aparecer todavía: es coherente con que el juego sólo escriba en `settled`.
- Los ejemplares no se distinguen entre sí. Sólo hay `amount`, porque los activos son
  fungibles (limitación 12.1).
- Tenedor sin objetos: `200` con `items: []`, no `404`.

### 5.3 `GET /v1/collections`

Añadido el 11-oct-2026 para la web de administración. Lectura (`read_token`).

→ `200`
```json
{
  "collections": [
    { "collection_id": "col_7Hs2...", "name": "Armería", "created_at": "2026-10-11T09:30:00Z" }
  ]
}
```

- Orden: la más reciente primero. Sin paginación (sección 8).
- Sin colecciones: `200` con `collections: []`.

### 5.4 `GET /v1/items`

Añadido el 11-oct-2026 para la web de administración. Lectura (`read_token`).

Parámetro opcional: `?collection_id=col_...`. Con un identificador que no existe: `404` /
`NOT_FOUND`. Sin parámetro, devuelve todos los tipos.

→ `200`
```json
{
  "items": [
    {
      "item_id": "itm_a1b2...",
      "collection_id": "col_7Hs2...",
      "name": "Espada de hierro",
      "symbol": "SWORD",
      "uri": "https://ejemplo.test/espada.json",
      "qualities": { "rarity": "common", "damage": "12" },
      "operation_id": "opr_3Kd9...",
      "state": "settled",
      "revision": 1,
      "edit": { "operation_id": "opr_9Xc2...", "state": "settled" },
      "created_at": "2026-10-11T09:31:00Z"
    }
  ]
}
```

- `revision` empieza en `0` y sube en 1 cada vez que se acepta una edición (4.6).
- `edit` describe la **última** edición aceptada, o es `null` si el tipo nunca se editó. Con
  `state` en `pending` o `applied`, hay una edición en curso y los datos mostrados son todavía los
  antiguos.

- `state` es el de la operación que **creó** el tipo (`pending` | `applied` | `settled` |
  `failed`). Un tipo cuya creación falló **sigue apareciendo**, con `state: "failed"`: es
  lo que permite al administrador verlo y decidir qué hacer (la política de reintento está
  en `docs/plan-juego.md` 10.5). Nunca aparece en el inventario de un tenedor.
- `qualities` no incluye la clave reservada `collection`.
- Los datos salen de SQLite, no de la cadena: el backend guarda las `qualities` al crear
  el tipo. No refleja existencias; para eso, el inventario de un tenedor (5.2).
- Orden: el más reciente primero. Sin paginación (sección 8).
- Es una lectura con `read_token`, y por tanto de acceso público de facto como el resto
  (limitación 12.5): el catálogo ya es público en la cadena.

---

## 6. Errores

Toda respuesta de error, sea cual sea el endpoint, tiene esta forma:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "...", "retryable": false } }
```

El mismo objeto es el que viaja en `error` dentro de una operación `failed`.

| `code` | HTTP | `retryable` | Cuándo |
|---|---|---|---|
| `REJECTED` | 400, 401, 403 | no | Petición mal formada, credencial inválida, regla de negocio violada |
| `NOT_FOUND` | 404 | no | El identificador no existe |
| `RATE_LIMITED` | 429 | **sí** | Límite de tasa. Respeta `Retry-After` si viene |
| `INSUFFICIENT_BALANCE` | 409 | no | El tenedor no tiene unidades suficientes del objeto |
| `INSUFFICIENT_FUNDS` | 503 | **sí** | La autoridad del juego no puede pagar el coste de la operación. Es operativo: se resuelve recargando, y por eso reintentar tiene sentido |
| `EXPIRED` | — | **sí** | Sólo dentro de una operación `failed`: la ventana de validez de la transacción se agotó antes de confirmarse. **No es un estado propio** |
| `INTERNAL` | 500 | **sí** | Fallo no clasificado del backend |
| `CONFIG` | — | no | Sólo lo produce el addon: configuración ausente o incoherente. Nunca viaja por HTTP |
| `NETWORK` | — | **sí** | Sólo lo produce el addon: no hubo respuesta. Nunca viaja por HTTP |

`CONFIG` y `NETWORK` figuran en la tabla porque son categorías de `ChainError` en el
addon, no porque el backend las emita.

---

## 7. Máquina de estados de una operación

```
pending ──▶ applied ──▶ settled
   │           │
   └───────────┴──────▶ failed
```

| Estado | Significado | Qué puede hacer el juego |
|---|---|---|
| `pending` | Enviada, sin confirmar | Nada. Como mucho, mostrar que hay algo en curso |
| `applied` | Confirmada, **no final** | Animar. **No** persistir estado |
| `settled` | Finalizada, irreversible | Comprometer. Persistir |
| `failed` | Terminal, con `error` | Revertir la animación optimista |

`applied → failed` es una transición **posible**, no un caso teórico: una transacción
confirmada y no finalizada puede desaparecer. Ésa es toda la razón de que existan dos
estados y de que el juego sólo escriba en `settled`.

Un backend con el bucle de seguimiento parado deja operaciones en `applied` para
siempre. El addon no interpreta eso como éxito; sigue sondeando con backoff.

---

## 8. Reglas transversales

- `Content-Type: application/json; charset=utf-8` en petición y respuesta.
- Todo cuerpo con campos desconocidos se rechaza (`400` / `REJECTED`). Validación
  estricta, no permisiva.
- Las escrituras no son operaciones en lote: ocho objetos son ocho peticiones.
- El backend no reintenta por su cuenta una operación `failed`. Reintentar es decisión
  del servidor de juego, y exige una clave de idempotencia **nueva**.
- No hay paginación en v1: un inventario de demostración cabe entero en una respuesta.

---

## 9. Huecos de la propuesta resueltos aquí

La propuesta fija la tabla de endpoints pero no los cuerpos. Estos huecos se han
cerrado con la opción más simple, y quedan listados para que el cambio sea visible:

1. **Cómo se nombra a un tenedor.** La propuesta usa `hld_` en el lado Godot y
   `external_id` en el lado del servidor. Se admite una referencia con cualquiera de
   los dos, y toda escritura devuelve el `holder_id` resuelto. Evita añadir un endpoint
   de resolución, que habría sido alcance nuevo.
2. **`game_id` no es un campo de petición.** Es configuración del despliegue, porque
   el multi-tenant está fuera de alcance (sección 11).
3. **`POST /v1/items` exige `initial_grant`.** La propuesta dice que ese endpoint
   «crea el tipo y emite la cantidad inicial» y que el supply es >= 1; hacerlo
   obligatorio elimina el camino de un tipo sin existencias, que nadie necesita.
4. **`qualities` es un mapa texto→texto**, con `collection` reservada al backend, que
   es como la propuesta describe los atributos por tipo (4.5).
5. **Una clave de idempotencia reutilizada con cuerpo distinto** devuelve el resultado
   original en vez de un error de conflicto.

---

## 10. Historial

| Fecha | Cambio |
|---|---|
| 2026-09-06 | Versión inicial. Congelada. |
| 2026-10-09 | Sección 3: se documenta que la clave de idempotencia la construye el plugin a partir de un `call_id` del juego. Sin cambio de forma en ningún endpoint ni cabecera. |
| 2026-10-11 | Sección 4.6: la edición de un tipo pasa a ser `PATCH /v1/items/{item_id}` (antes `…/qualities`), con `name`, `uri` y `qualities` como conjunto completo; `symbol` y `collection_id` no se editan. Sigue fuera del hito. Sección 5.4: se añaden `revision` y `edit` a cada tipo. Una edición a la vez por tipo; `revision` sube al aceptarla. |
| 2026-10-11 | Secciones 5.3 y 5.4: `GET /v1/collections` y `GET /v1/items` (listados de catálogo para la web de administración). Sólo lecturas nuevas; ninguna ruta existente cambia. Fuera del hito: bajo la línea de corte. Sección 2: se aclara que las rutas `/admin` de la consola no son parte del contrato. |
