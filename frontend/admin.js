/*
 * Consola de administración de godot-chain (propuesta, 3; bloque W1), a partir de la maqueta
 * docs/especificacion/mockup-admin/index.html. Sin paso de compilación ni dependencias.
 *
 * Sólo habla con /admin/api del propio backend, con la cookie de sesión. Nunca ve la clave de
 * escritura ni el token de lectura: las rutas de /admin llaman por dentro a los mismos manejadores
 * que la API.
 *
 * Qué hace (hito, 5-nov-2026): crear colecciones y tipos, listar el catálogo, consultar operaciones
 * con enlace a su transacción en un explorador, y consultar inventarios. Entregar y transferir se
 * hacen desde la demo; importar un catálogo y editar tipos quedan bajo la línea de corte (8.1).
 */
"use strict";

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* Reescribe sólo si cambió: las vistas que se refrescan solas no pierden clics ni selecciones. */
function setHtml(el, html) { if (el && el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } }
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function randomSuffix(n = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}
const badge = state => `<span class="badge ${esc(state)}">${esc(state)}</span>`;
const qualitiesHtml = q => Object.entries(q).map(([k, v]) => `<code>${esc(k)}=${esc(v)}</code>`).join(" ") || "—";
const KIND = { create_item: "Crear tipo", grant: "Entregar", transfer: "Transferir" };
/* Las marcas de tiempo llegan en UTC (ISO 8601); se muestran en la hora local del navegador. */
const localTime = iso => new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
/** Qué hace una operación, en una línea: el tipo y, en una transferencia, de quién a quién. */
function actionHtml(o) {
  let html = esc(KIND[o.kind] || o.kind);
  if (o.transfer && o.item) html += ` «${esc(o.item.name)}»<div class="muted small">${esc(o.transfer.from.external_id)} → ${esc(o.transfer.to.external_id)}</div>`;
  else if (o.item) html += ` <span class="muted">«${esc(o.item.name)}»</span>`;
  return html;
}

/** Clave de idempotencia de la consola: SHA-256 en hexadecimal de «operación:call_id». */
async function idempotencyKey(op, callId) {
  if (!crypto.subtle) throw new Error("El navegador no permite calcular la clave: abre la consola por HTTPS o en 127.0.0.1.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${op}:${callId}`));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- Llamadas al backend ---------- */
class ApiError extends Error {
  constructor(status, body) {
    const e = body && body.error;
    super(e ? `${e.code} — ${e.message}` : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function api(method, path, body, idemKey) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  const res = await fetch("/admin/api" + path, {
    method, headers, credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && path !== "/session") showLogin();
  if (!res.ok) throw new ApiError(res.status, json);
  return { status: res.status, body: json };
}

/* ---------- Formularios con identificador de llamada ---------- */
function callIdField(prefix) {
  return `<div class="field"><label for="callid">Identificador de llamada <span class="hint">(call_id: misma acción reintentada, mismo identificador)</span></label>
    <div class="row"><input type="text" id="callid" value="${prefix}_${randomSuffix()}" maxlength="64" autocomplete="off">
    <button class="btn secondary fixed" type="button" id="callid-new">Nuevo</button></div>
    <div class="key" id="callid-key" aria-live="polite"></div></div>`;
}
function bindCallId(op, prefix) {
  const input = $("#callid"), out = $("#callid-key");
  const upd = async () => {
    const v = input.value.trim();
    if (!v) { out.innerHTML = `<span class="muted">Escribe un identificador.</span>`; return; }
    try { out.innerHTML = `<span class="muted">Idempotency-Key:</span> ${await idempotencyKey(op, v)}`; }
    catch (e) { out.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
  input.addEventListener("input", upd);
  $("#callid-new").addEventListener("click", () => { input.value = `${prefix}_${randomSuffix()}`; upd(); });
  upd();
}
function showResult(el, ok, body, extra = "") {
  el.innerHTML = `<div class="result"><pre class="${ok ? "ok" : "bad"}">${esc(JSON.stringify(body, null, 2))}</pre>${extra}</div>`;
}
/** Envía una escritura con su clave. Una respuesta repetida (misma clave) devuelve lo de la primera vez. */
async function submitWrite(path, op, body, onOk) {
  const out = $("#result"), callId = $("#callid").value.trim();
  if (!callId) { out.innerHTML = `<p class="error">El identificador de llamada es obligatorio.</p>`; return; }
  try {
    const res = await api("POST", path, body, await idempotencyKey(op, callId));
    showResult(out, true, res.body, onOk ? onOk(res.body) : "");
  } catch (e) {
    if (e instanceof ApiError && e.body) showResult(out, false, e.body);
    else out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}
const operationLink = id => `<button class="link mono" type="button" data-op="${esc(id)}">${esc(id)}</button>`;

/* ---------- Vistas ---------- */
const views = {};

views.collections = {
  title: "Colecciones", sub: "Agrupaciones lógicas del catálogo. No generan ninguna operación.",
  render: () => `<div class="card"><form id="f">
      <div class="field"><label for="name">Nombre</label><input type="text" id="name" maxlength="64" placeholder="Armería" autocomplete="off" required></div>
      ${callIdField("col")}
      <button class="btn" type="submit">Crear colección</button></form><div id="result"></div></div>
    <div class="card"><h2>Colecciones</h2><div id="list"></div></div>`,
  mount() {
    bindCallId("create_collection", "col");
    $("#f").addEventListener("submit", async e => {
      e.preventDefault();
      await submitWrite("/collections", "create_collection", { name: $("#name").value.trim() });
      this.tick();
    });
    this.tick();
  },
  async tick() {
    const { body } = await api("GET", "/collections");
    setHtml($("#list"), `<table><tr><th>Nombre</th><th>Identificador</th><th class="num">Tipos en settled</th><th>Creada</th></tr>${
      body.collections.map(c => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.collection_id)}</td><td class="num">${c.settled_items}</td><td>${esc(c.created_at)}</td></tr>`).join("")
      || `<tr><td colspan="4" class="muted">No hay colecciones.</td></tr>`}</table>`);
  }
};

views.items = {
  title: "Tipos de ítem", sub: "Crea un tipo y emite su cantidad inicial. Dos efectos, una operación.",
  render: () => `<div class="card"><form id="f">
    <div class="grid2">
      <div class="field"><label for="col">Colección</label><select id="col" required></select></div>
      <div class="field"><label for="name">Nombre <span class="hint">(1..32)</span></label><input type="text" id="name" maxlength="32" autocomplete="off" required></div>
      <div class="field"><label for="symbol">Símbolo <span class="hint">(1..10)</span></label><input type="text" id="symbol" maxlength="10" autocomplete="off" required></div>
      <div class="field"><label for="uri">URI <span class="hint">(opcional, máx. 200)</span></label><input type="text" id="uri" maxlength="200" autocomplete="off"></div>
    </div>
    <div class="field pairs"><label>Cualidades <span class="hint">— atributos del <em>tipo</em>, no del ejemplar. Máximo 8 pares.</span></label>
      <div id="pairs"></div>
      <button class="btn secondary small" type="button" id="addpair">Añadir cualidad</button> <span class="muted" id="pcount"></span></div>
    <h2>Existencias iniciales</h2>
    <div class="grid2">
      <div class="field"><label for="holder">Tenedor que las recibe <span class="hint">(identificador del jugador en el juego)</span></label><input type="text" id="holder" value="game-reserve" maxlength="64" autocomplete="off" required></div>
      <div class="field"><label for="amount">Cantidad <span class="hint">(entero ≥ 1)</span></label><input type="number" id="amount" min="1" step="1" value="1" required></div>
    </div>
    ${callIdField("item")}
    <button class="btn" type="submit">Crear tipo</button></form><div id="result"></div></div>`,
  async mount() {
    bindCallId("create_item", "item");
    const pairs = $("#pairs");
    const count = () => { const n = pairs.children.length; $("#pcount").textContent = `${n} de 8`; $("#addpair").disabled = n >= 8; };
    const add = (k = "", v = "") => {
      const d = document.createElement("div"); d.className = "pair";
      d.innerHTML = `<input type="text" placeholder="clave" maxlength="32" value="${esc(k)}" aria-label="Clave"><input type="text" placeholder="valor" maxlength="64" value="${esc(v)}" aria-label="Valor"><button class="btn secondary small" type="button" aria-label="Quitar">✕</button>`;
      d.lastChild.addEventListener("click", () => { d.remove(); count(); });
      pairs.append(d); count();
    };
    add("rarity", "common"); add("damage", "12");
    $("#addpair").addEventListener("click", () => add());
    $("#f").addEventListener("submit", e => {
      e.preventDefault();
      const qualities = {};
      for (const p of pairs.children) { const [k, v] = [...p.querySelectorAll("input")].map(i => i.value.trim()); if (k || v) qualities[k] = v; }
      const body = { collection_id: $("#col").value, name: $("#name").value.trim(), symbol: $("#symbol").value.trim() };
      if ($("#uri").value.trim()) body.uri = $("#uri").value.trim();
      if (Object.keys(qualities).length) body.qualities = qualities;
      body.initial_grant = { holder: { external_id: $("#holder").value.trim() }, amount: Number($("#amount").value) };
      submitWrite("/items", "create_item", body, r => `<p class="spaced">Sigue la operación en ${operationLink(r.operation_id)}.</p>`);
    });
    const { body } = await api("GET", "/collections");
    $("#col").innerHTML = body.collections.map(c => `<option value="${esc(c.collection_id)}">${esc(c.name)}</option>`).join("")
      || `<option value="">Crea antes una colección</option>`;
  }
};

/* Listado de catálogo: GET /v1/items (contrato 5.4). Un tipo cuya creación falló sigue apareciendo, con su estado. */
views.catalog = {
  title: "Listado de catálogo", sub: "Tipos de ítem con el estado de la operación que los creó. Sólo los de «settled» son utilizables.",
  render: () => `<div class="card"><div class="filters">
      <div class="field"><label for="fcol">Colección</label><select id="fcol"><option value="">Todas</option></select></div>
      <div class="field"><label for="fstate">Estado de la creación</label><select id="fstate">
        <option value="">Todos</option><option value="settled">settled (utilizables)</option><option value="open">En curso (pending, applied)</option><option value="failed">failed</option></select></div>
      <div class="field"><label for="fq">Buscar <span class="hint">(nombre, símbolo o identificador)</span></label><input type="text" id="fq" autocomplete="off"></div></div>
      <div id="items"></div></div>`,
  filter: "", state: "", query: "",
  async mount() {
    this.filter = ""; this.state = ""; this.query = "";
    const { body } = await api("GET", "/collections");
    this.names = Object.fromEntries(body.collections.map(c => [c.collection_id, c.name]));
    $("#fcol").innerHTML += body.collections.map(c => `<option value="${esc(c.collection_id)}">${esc(c.name)}</option>`).join("");
    $("#fcol").addEventListener("change", e => { this.filter = e.target.value; this.tick(); });
    $("#fstate").addEventListener("change", e => { this.state = e.target.value; this.tick(); });
    $("#fq").addEventListener("input", e => { this.query = e.target.value.trim().toLowerCase(); this.tick(); });
    this.tick();
  },
  async tick() {
    const { body } = await api("GET", "/items" + (this.filter ? `?collection_id=${encodeURIComponent(this.filter)}` : ""));
    const byState = i => !this.state || (this.state === "open" ? i.state === "pending" || i.state === "applied" : i.state === this.state);
    const q = this.query;
    const rows = body.items.filter(i => byState(i) && (!q || [i.name, i.symbol, i.item_id].some(s => s.toLowerCase().includes(q))));
    setHtml($("#items"), `<table><tr><th>Tipo</th><th>Colección</th><th>Cualidades</th><th>Creación</th><th>Creado</th></tr>${rows.map(i =>
      `<tr><td>${esc(i.name)} <span class="muted">(${esc(i.symbol)})</span><div class="mono muted">${esc(i.item_id)}</div></td>
       <td>${esc(this.names[i.collection_id] || i.collection_id)}</td>
       <td>${qualitiesHtml(i.qualities)}</td>
       <td>${badge(i.state)}<div>${operationLink(i.operation_id)}</div></td>
       <td>${esc(i.created_at)}</td></tr>`).join("")
      || `<tr><td colspan="5" class="muted">No hay tipos que coincidan.</td></tr>`}</table>`);
  }
};

views.operations = {
  title: "Operaciones", sub: "Estado de cada escritura y su transacción. Sólo en «settled» es definitiva.",
  render: () => `<div class="card"><form id="f"><div class="row"><div><label for="op">Identificador de operación</label>
    <input type="text" id="op" placeholder="opr_…" autocomplete="off"></div><button class="btn fixed" type="submit">Consultar</button></div></form>
    <div id="detail"></div></div>
    <div class="card"><h2>Últimas operaciones</h2><div id="list"></div>
    <p class="muted small spaced">Las 50 más recientes, también las que llegan del servidor de juego. En un tipo que no cabía en una transacción, el enlace es el del paso en curso.</p></div>`,
  current: null,
  mount() {
    this.current = pendingOperation; pendingOperation = null;
    if (this.current) $("#op").value = this.current;
    $("#f").addEventListener("submit", e => { e.preventDefault(); this.current = $("#op").value.trim() || null; this.tick(); });
    $("#list").addEventListener("click", e => {
      const b = e.target.closest("[data-op]"); if (!b) return;
      $("#op").value = b.dataset.op; this.current = b.dataset.op; this.tick();
    });
    this.tick();
  },
  async tick() {
    const { body } = await api("GET", "/operations");
    setHtml($("#list"), `<table><tr><th>Hora</th><th>Acción</th><th>Operación</th><th>Estado</th><th>Transacción</th><th>Actualizada</th></tr>${
      body.operations.map(o => `<tr><td>${esc(localTime(o.created_at))}</td><td>${actionHtml(o)}</td><td>${operationLink(o.operation_id)}</td>
        <td>${badge(o.state)}${o.error ? `<div class="error">${esc(o.error.code)}</div>` : ""}</td><td>${explorer(o)}</td><td>${esc(localTime(o.updated_at))}</td></tr>`).join("")
      || `<tr><td colspan="6" class="muted">Aún no hay operaciones.</td></tr>`}</table>`);
    if (!this.current) { setHtml($("#detail"), ""); return; }
    try {
      const { body: op } = await api("GET", `/operations/${encodeURIComponent(this.current)}`);
      setHtml($("#detail"), `<h2>${esc(op.operation_id)} ${badge(op.state)}</h2>${steps(op)}
        <p>${esc(KIND[op.kind] || op.kind)}${op.item ? ` del tipo «${esc(op.item.name)}» <span class="mono muted">${esc(op.item.item_id)}</span>` : ""}${op.step === 2 ? " — segundo paso (entrega)" : ""}</p>
        ${op.transfer ? `<p>De ${esc(op.transfer.from.external_id)} <span class="mono muted">${esc(op.transfer.from.holder_id)}</span> a ${esc(op.transfer.to.external_id)} <span class="mono muted">${esc(op.transfer.to.holder_id)}</span></p>` : ""}
        ${op.state === "applied" ? `<p class="muted small">Confirmada pero no final: todavía puede pasar a failed. No la des por buena.</p>` : ""}
        ${op.error ? `<p class="error">${esc(op.error.code)} — ${esc(op.error.message)}</p>` : ""}
        <p>Transacción: ${explorer(op)}</p>
        <p class="muted small">Creada ${esc(localTime(op.created_at))} · actualizada ${esc(localTime(op.updated_at))}</p>`);
    } catch (e) {
      setHtml($("#detail"), `<p class="error">${esc(e.message)}</p>`);
    }
  }
};
function steps(op) {
  const order = ["pending", "applied", "settled"], at = order.indexOf(op.state);
  return `<div class="steps">${order.map((s, i) => {
    const cls = op.state === "failed" ? "" : i < at ? "done" : i === at ? "on" : "";
    return `<span class="${cls}">${s}</span>`;
  }).join("")}${op.state === "failed" ? `<span class="bad">failed</span>` : ""}</div>`;
}
function explorer(op) {
  if (!op.explorer_url) return `<span class="muted">—</span>`;
  return `<a href="${esc(op.explorer_url)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(op.signature.slice(0, 12))}…</a>`;
}
/* Saltar desde otra vista a una operación. */
let pendingOperation = null;
function openOperation(e) {
  const b = e.target.closest("[data-op]"); if (!b) return;
  pendingOperation = b.dataset.op; go("operations");
}

views.inventory = {
  title: "Inventario de un tenedor", sub: "Qué tiene un jugador, leído de la cadena en su estado definitivo (settled).",
  render: () => `<div class="card"><form id="f"><div class="row"><div><label for="h">Tenedor <span class="hint">(hld_… o el identificador del jugador en el juego)</span></label>
    <input type="text" id="h" placeholder="player-42" autocomplete="off"></div>
    <button class="btn fixed" type="submit">Consultar</button></div></form><div id="inv"></div></div>
    <p class="muted small">Sólo aparecen tenedores que ya han pasado por el backend. Consultar no registra ninguno nuevo.</p>`,
  mount() {
    $("#f").addEventListener("submit", async e => {
      e.preventDefault();
      const ref = $("#h").value.trim(); if (!ref) return;
      const out = $("#inv");
      out.innerHTML = `<p class="muted spaced">Consultando…</p>`;
      try {
        const { body } = await api("GET", `/holders/${encodeURIComponent(ref)}/items`);
        out.innerHTML = `<h2>${esc(body.external_id)} <span class="mono muted">${esc(body.holder_id)}</span></h2>` + (body.items.length
          ? `<table><tr><th>Ítem</th><th>Cualidades</th><th class="num">Cantidad</th></tr>${body.items.map(r =>
            `<tr><td>${esc(r.name)} <span class="muted">(${esc(r.symbol)})</span><div class="mono muted">${esc(r.item_id)}</div></td><td>${qualitiesHtml(r.qualities)}</td><td class="num">${r.amount}</td></tr>`).join("")}</table>`
          : `<p class="muted">Inventario vacío.</p>`);
      } catch (err) {
        out.innerHTML = `<p class="error spaced">${esc(err.message)}</p>`;
      }
    });
  }
};

/* ---------- Navegación ---------- */
const NAV = [
  ["Catálogo", [["collections", "Colecciones"], ["items", "Tipos de ítem"], ["catalog", "Listado de catálogo"]]],
  ["Seguimiento", [["operations", "Operaciones"], ["inventory", "Inventario"]]],
];
let currentView = null;
function buildNav() {
  $("#nav").innerHTML = `<div class="brand">Administración de activos</div>` + NAV.map(([g, items]) =>
    `<div class="group">${esc(g)}</div>` + items.map(([id, label]) => `<button type="button" data-view="${id}">${esc(label)}</button>`).join("")).join("");
}
function go(id) {
  const v = views[id] || views.items;
  currentView = v;
  for (const b of document.querySelectorAll("nav button")) {
    if (b.dataset.view === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  $("#title").textContent = v.title; $("#subtitle").textContent = v.sub;
  $("#view").innerHTML = v.render();
  Promise.resolve(v.mount()).catch(reportError);
  history.replaceState(null, "", "#" + id);
}
function reportError(e) {
  if (e instanceof ApiError && e.status === 401) return;
  console.error(e);
}

/* ---------- Acceso ---------- */
function showLogin() {
  $("#app").hidden = true; $("#login").hidden = false; $("#key").focus();
}
function showApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  const start = location.hash.slice(1);
  go(views[start] ? start : "catalog");
}

document.addEventListener("DOMContentLoaded", async () => {
  buildNav();
  $("#nav").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b) go(b.dataset.view); });
  $("#view").addEventListener("click", e => { if (currentView !== views.operations) openOperation(e); });
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      await api("POST", "/session", { key: $("#key").value });
      $("#key").value = "";
      showApp();
    } catch (err) {
      $("#loginError").textContent = err.status === 401 ? "Credencial incorrecta." : err.message;
    }
  });
  $("#logout").addEventListener("click", async () => {
    await api("DELETE", "/session").catch(() => {});
    showLogin();
  });
  try { await api("GET", "/session"); showApp(); } catch { showLogin(); }

  /* Las vistas con datos que cambian se refrescan solas; el inventario lee la cadena y no. */
  setInterval(() => {
    if (document.hidden || !$("#login").hidden || !currentView || !currentView.tick) return;
    currentView.tick().catch(reportError);
  }, 3000);
});
