// Acreditaciones del Salón — lógica de la app sobre Supabase.
const $ = (id) => document.getElementById(id);

let sb = null, session = null;
let eventos = [], invitados = [], evId = null, filtro = "pendiente";
let chEventos = null, chInv = null, subscribedFor = null, scanner = null;

const fmtFecha = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const hora = (ts) => ts ? new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t) {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); document.body.appendChild(box); }
  const d = document.createElement("div"); d.className = "toast"; d.textContent = t; box.appendChild(d); setTimeout(() => d.remove(), 3200);
}
function confirmBox(title, text) {
  return new Promise((res) => {
    $("cfTitle").textContent = title; $("cfText").textContent = text;
    const d = $("dlgConfirm");
    const done = (v) => { d.close(); $("cfYes").onclick = $("cfNo").onclick = null; res(v); };
    $("cfYes").onclick = () => done(true); $("cfNo").onclick = () => done(false);
    d.showModal();
  });
}
function fail(error, prefix = "No se pudo guardar") {
  console.error(error);
  const m = error?.message || String(error);
  toast(/permission|policy|JWT/i.test(m) ? "Tu sesión no tiene permiso. Volvé a ingresar." : `${prefix}: ${m}`);
}

// ---------- Arranque y sesión ----------
async function boot() {
  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("TU-PROYECTO")) {
    $("status").textContent = "Falta configurar Supabase: completá SUPABASE_URL y SUPABASE_ANON_KEY en config.js.";
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  onSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => { if ((s?.user?.id) !== (session?.user?.id)) onSession(s); });
}

let rol = null;
async function onSession(s) {
  session = s;
  stopAll(); eventos = []; invitados = []; rol = null;
  const logged = !!s;
  $("loginPanel").hidden = logged;
  $("btnLogout").hidden = !logged;
  showAdminChrome(false);
  $("door").hidden = true; document.body.classList.remove("is-door");
  $("noEv").hidden = $("evPanel").hidden = $("main").hidden = true;
  $("who").textContent = logged ? s.user.email : "";
  $("status").textContent = "";
  if (!logged) return;
  const { data, error } = await sb.from("perfiles").select("rol").eq("user_id", s.user.id).maybeSingle();
  if (error || !data) { $("status").textContent = "Tu usuario todavía no tiene un rol asignado. Pedile acceso a la administradora."; return; }
  rol = data.rol;
  if (rol === "admin") { showAdminChrome(true); startEventos(); }
  else startDoor();
}
function showAdminChrome(on) {
  $("btnNewEv").hidden = $("btnStaff").hidden = !on;
  $("evSel").parentElement.querySelector("label").hidden = $("evSel").hidden = !on;
}

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("loginMsg").textContent = "Ingresando…";
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("loginMsg").textContent = error ? "Email o contraseña incorrectos." : "";
  if (!error) $("loginForm").reset();
};
$("btnLogout").onclick = () => sb.auth.signOut();

function stopAll() {
  if (!sb) return;
  if (chEventos) { sb.removeChannel(chEventos); chEventos = null; }
  if (chInv) { sb.removeChannel(chInv); chInv = null; }
  if (doorTimer) { clearInterval(doorTimer); doorTimer = null; }
  subscribedFor = null; stopCam();
}

// ---------- Eventos ----------
async function loadEventos() {
  const { data, error } = await sb.from("eventos").select("*").order("fecha", { ascending: true });
  if (error) { $("status").textContent = "Error al leer eventos: " + error.message; return; }
  eventos = data; renderEventos();
}
function startEventos() {
  stopAll();
  loadEventos();
  chEventos = sb.channel("eventos").on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, loadEventos).subscribe();
}

function renderEventos() {
  const sel = $("evSel");
  if (!eventos.length) { sel.innerHTML = ""; $("noEv").hidden = false; $("evPanel").hidden = true; $("main").hidden = true; setEvento(null); return; }
  $("noEv").hidden = true;
  if (!evId || !eventos.find((e) => e.id === evId)) {
    let saved = null; try { saved = localStorage.getItem("evId"); } catch (e) {}
    const hoy = new Date().toISOString().slice(0, 10);
    evId = (eventos.find((e) => e.id === saved) || eventos.find((e) => e.fecha >= hoy) || eventos[eventos.length - 1]).id;
  }
  sel.innerHTML = eventos.map((e) => `<option value="${e.id}">${esc(fmtFecha(e.fecha))} · ${esc(e.nombre)}</option>`).join("");
  sel.value = evId; setEvento(evId);
}

function setEvento(id) {
  evId = id; try { id && localStorage.setItem("evId", id); } catch (e) {}
  const ev = eventos.find((e) => e.id === id);
  if (ev) {
    $("evPanel").hidden = false; $("main").hidden = false; $("evName").textContent = ev.nombre;
    $("evMeta").textContent = [fmtFecha(ev.fecha), ev.hora && ev.hora.slice(0, 5) + " h", ev.sala].filter(Boolean).join(" · ");
    renderReg(ev);
  }
  if (subscribedFor === id) return;
  if (chInv) { sb.removeChannel(chInv); chInv = null; }
  subscribedFor = id; invitados = []; renderInv(); $("result").innerHTML = "";
  if (!id) return;
  loadInvitados(id);
  loadStaff(id);
  chInv = sb.channel("inv-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "invitados", filter: `evento_id=eq.${id}` }, (p) => {
      if (subscribedFor !== id) return;
      if (p.eventType === "DELETE") invitados = invitados.filter((i) => i.id !== p.old.id);
      else { const i = invitados.findIndex((x) => x.id === p.new.id); if (i >= 0) invitados[i] = p.new; else invitados.push(p.new); }
      renderInv();
    })
    .subscribe((status) => { if (status === "SUBSCRIBED") loadInvitados(id); });
}
$("evSel").onchange = (e) => setEvento(e.target.value);

async function loadInvitados(id) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("invitados").select("*").eq("evento_id", id).range(from, from + 999);
    if (error) { fail(error, "Error al leer invitados"); return; }
    all.push(...data);
    if (data.length < 1000) break;
  }
  if (subscribedFor === id) { invitados = all; renderInv(); }
}

// ---------- Lista ----------
function renderInv() {
  const conf = invitados.filter((i) => i.estado === "aprobado");
  const pend = invitados.filter((i) => i.estado === "pendiente").length;
  const tot = conf.length, inn = conf.filter((i) => i.acreditado).length;
  renderRegCount();
  $("cIn").textContent = inn; $("cTot").textContent = tot; $("cBar").style.width = tot ? (inn / tot * 100) + "%" : "0";
  $("cPend").textContent = pend ? `${pend} por confirmar` : "";
  $("bulkBar").hidden = !pend; $("btnBulk").textContent = pend === 1 ? "Confirmar al pendiente" : `Confirmar los ${pend} pendientes`;
  document.querySelector('.seg button[data-f="pendiente"]').textContent = pend ? `Por confirmar (${pend})` : "Por confirmar";
  const cats = {}; conf.forEach((i) => { const k = i.categoria || "General"; cats[k] = cats[k] || [0, 0]; cats[k][1]++; if (i.acreditado) cats[k][0]++; });
  $("cCats").innerHTML = Object.entries(cats).map(([k, [a, b]]) => `<span class="chip">${esc(k)} <b>${a}/${b}</b></span>`).join("");
  const q = norm($("q").value);
  let list = invitados.filter((i) => filtro === "todos" || (filtro === "in" ? i.acreditado : i.estado === filtro));
  if (q) list = list.filter((i) => norm([i.nombre, i.dni, i.empresa, i.email, i.codigo, i.categoria].join(" ")).includes(q));
  list.sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
  const tb = $("tbody");
  if (!invitados.length) { tb.innerHTML = `<tr><td colspan="5" class="empty">Todavía no hay inscriptos. Abrí el registro y compartí el link de arriba.</td></tr>`; return; }
  if (!list.length) { tb.innerHTML = `<tr><td colspan="5" class="empty">Nadie coincide con el filtro.</td></tr>`; return; }
  tb.innerHTML = list.map((i) => `<tr>
    <td><b>${esc(i.nombre)}</b>${i.origen === "registro" ? '<span class="tag">registro</span>' : ""}<div class="status">${esc([i.email, i.telefono, i.empresa].filter(Boolean).join(" · "))}</div></td>
    <td class="mono">${esc(i.dni || "—")}</td>
    <td>${esc(i.categoria || "General")}</td>
    <td>${pillEstado(i)}</td>
    <td><div class="acts">${accionesInv(i)}
      <button class="btn small danger" data-a="del" data-id="${i.id}" aria-label="Eliminar" title="Eliminar">✕</button>
    </div></td></tr>`).join("");
}
function pillEstado(i) {
  if (i.estado === "pendiente") return `<span class="pill wait">Por confirmar</span>`;
  if (i.estado === "rechazado") return `<span class="pill no">Rechazado</span>`;
  if (i.acreditado) return `<span class="pill in" title="${esc(i.acreditado_por_email || "")}">Ingresó ${hora(i.acreditado_en)}</span>`;
  return `<span class="pill out">Confirmado</span>`;
}
function accionesInv(i) {
  const b = (a, txt, cls = "") => `<button class="btn small ${cls}" data-a="${a}" data-id="${i.id}">${txt}</button>`;
  if (i.estado === "pendiente") return b("ok", "Confirmar", "primary") + b("no", "Rechazar");
  if (i.estado === "rechazado") return b("ok", "Confirmar");
  const mail = i.email ? `<button class="btn small" data-a="mail" data-id="${i.id}" title="${i.email_enviado_en ? "Enviada " + fmtFecha(i.email_enviado_en.slice(0, 10)) + " " + hora(i.email_enviado_en) : "Todavía no se envió"}">${i.email_enviado_en ? "Reenviar" : "Enviar"} email</button>` : "";
  return (i.acreditado ? b("undo", "Deshacer ingreso") : b("in", "Acreditar") + b("no", "Rechazar")) + b("qr", "Credencial") + mail;
}
$("q").oninput = renderInv;
document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => {
  filtro = b.dataset.f;
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  renderInv();
});
$("tbody").onclick = async (e) => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const g = invitados.find((i) => i.id === b.dataset.id); if (!g) return;
  if (b.dataset.a === "in") acreditar(g);
  if (b.dataset.a === "qr") showBadge(g);
  if (b.dataset.a === "mail") { b.disabled = true; await enviarEmail(g); b.disabled = false; }
  if (b.dataset.a === "ok") { b.disabled = true; await confirmar(g); b.disabled = false; }
  if (b.dataset.a === "no" && await confirmBox("Rechazar", `${g.nombre} no va a poder entrar. Si ya tenía la credencial, deja de funcionar.`)) {
    const { error } = await sb.from("invitados").update({ estado: "rechazado", revisado_en: new Date().toISOString() }).eq("id", g.id);
    if (error) fail(error); else { Object.assign(g, { estado: "rechazado" }); renderInv(); toast("Rechazado"); }
  }
  if (b.dataset.a === "undo" && await confirmBox("Deshacer ingreso", `${g.nombre} volverá a figurar como pendiente.`)) {
    const { error } = await sb.from("invitados").update({ acreditado: false, acreditado_en: null, acreditado_por_email: null }).eq("id", g.id);
    error ? fail(error) : toast("Ingreso deshecho");
  }
  if (b.dataset.a === "del" && await confirmBox("Eliminar invitado", `Se quita a ${g.nombre} de la lista de este evento.`)) {
    const { error } = await sb.from("invitados").delete().eq("id", g.id);
    error ? fail(error) : toast("Invitado eliminado");
  }
};

// ---------- Acreditación ----------
// Toda acreditación pasa por la función acreditar() de la base: marca el ingreso una sola vez
// aunque dos puertas escaneen el mismo QR al mismo tiempo.
async function rpcAcreditar(evento, valor) {
  const { data, error } = await sb.rpc("acreditar", { p_evento: evento, p_valor: valor });
  if (error) { fail(error, "No se pudo acreditar"); return null; }
  return data;
}
function veredicto(r) {
  const meta = [r.categoria, r.empresa, r.dni && "DNI " + r.dni].filter(Boolean).join(" · ");
  if (r.estado === "ok") return ["ok", "Acceso permitido", r.nombre, meta];
  if (r.estado === "ya_ingreso") return ["warn", "Ya ingresó", `${r.nombre} · ${hora(r.acreditado_en)}`, [meta, r.acreditado_por && "por " + r.acreditado_por].filter(Boolean).join(" · ")];
  if (r.estado === "pendiente") return ["bad", "Sin confirmar", r.nombre, "Su registro todavía no fue confirmado"];
  if (r.estado === "rechazado") return ["bad", "No autorizado", r.nombre, "Su registro fue rechazado"];
  if (r.estado === "otro_evento") return ["bad", "Otro evento", `La credencial es de “${r.evento}”`, r.valor];
  return ["bad", "Acceso denegado", "No está en la lista de este evento", r.valor];
}
async function acreditar(g) {
  const r = await rpcAcreditar(g.evento_id, g.codigo);
  if (r) showResult(...veredicto(r));
}
function showResult(kind, verdict, text, meta) {
  $("result").innerHTML = `<div class="result ${kind}" role="status"><div class="verdict">${esc(verdict)}</div>
   <div class="who">${esc(text)}</div>${meta ? `<div class="status">${esc(meta)}</div>` : ""}</div>`;
}

async function buscar(raw) {
  raw = raw.trim(); if (!raw) return;
  const up = raw.toUpperCase(), n = norm(raw), digits = raw.replace(/\D/g, "");
  const hit = invitados.find((i) => (i.codigo || "").toUpperCase() === up) ||
    (digits.length >= 6 && invitados.find((i) => (i.dni || "").replace(/\D/g, "") === digits));
  if (hit) { acreditar(hit); return; }
  if (/^AC-/.test(up)) { const r = await rpcAcreditar(evId, up); if (r) showResult(...veredicto(r)); return; }
  const ms = invitados.filter((i) => norm(i.nombre).includes(n) || norm(i.empresa).includes(n)).slice(0, 8);
  if (!ms.length) { showResult("bad", "Acceso denegado", `“${raw}” no está en la lista de este evento.`); return; }
  $("result").innerHTML = `<div class="status" style="margin-top:12px">${ms.length} coincidencia(s) para “${esc(raw)}”:</div><div class="matches">${ms.map((i) => `<div class="match"><div><b>${esc(i.nombre)}</b><div class="status">${esc([i.categoria, i.empresa].filter(Boolean).join(" · "))}</div></div>${i.acreditado ? `<span class="pill in">Ingresó ${hora(i.acreditado_en)}</span>` : `<button class="btn small primary" data-m="${i.id}">Acreditar</button>`}</div>`).join("")}</div>`;
}
$("scanForm").onsubmit = (e) => {
  e.preventDefault();
  const raw = $("scanIn").value; $("scanIn").value = ""; $("scanIn").focus();
  buscar(raw);
};
$("result").onclick = (e) => { const b = e.target.closest("button[data-m]"); if (b) { const g = invitados.find((i) => i.id === b.dataset.m); g && acreditar(g); } };

// ---------- Cámara ----------
// Un solo lector a la vez: el panel de admin usa #reader y la pantalla de puerta #doorReader.
let lastScan = { text: "", t: 0 }, camEl = null;
async function startCam(elId, onText) {
  if (!window.Html5Qrcode) { toast("El lector de cámara no cargó."); return false; }
  await stopCam();
  camEl = elId; $(elId).hidden = false;
  scanner = new Html5Qrcode(elId);
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.7); return { width: m, height: m }; } }, (text) => {
      const now = Date.now();
      if (text === lastScan.text && now - lastScan.t < 4000) return; // evita lecturas repetidas del mismo QR
      lastScan = { text, t: now };
      onText(text);
    });
    return true;
  } catch (err) { await stopCam(); return false; }
}
async function stopCam() {
  if (scanner) { try { await scanner.stop(); scanner.clear(); } catch (e) {} scanner = null; }
  if (camEl === "reader") $("reader").hidden = true;
  camEl = null; $("btnCam").textContent = "Escanear con la cámara";
}
$("btnCam").onclick = async () => {
  if (scanner) { stopCam(); return; }
  $("btnCam").textContent = "Cerrar cámara";
  if (!await startCam("reader", (t) => { navigator.vibrate?.(80); buscar(t); })) toast("No se pudo abrir la cámara. Revisá el permiso del navegador.");
};

// ---------- Pantalla de puerta ----------
let doorEv = null, doorTimer = null, doorReset = null, audio = null;
function beep(ok) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = ok ? "sine" : "square";
    g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.15 : 0.45));
  } catch (e) {}
}
function doorShow(kind, verdict, who, meta) {
  const d = $("dResult");
  d.className = "dres " + (kind || "");
  d.innerHTML = `<div class="verdict">${esc(verdict)}</div><div class="who">${esc(who || "")}</div>${meta ? `<div class="status">${esc(meta)}</div>` : ""}`;
  clearTimeout(doorReset);
  if (kind) doorReset = setTimeout(() => doorShow("", "Listo", "Apuntá la cámara al QR de la credencial"), kind === "ok" ? 3500 : 6000);
}
async function startDoor() {
  document.body.classList.add("is-door");
  $("door").hidden = false;
  const { data, error } = await sb.from("eventos").select("*").order("fecha", { ascending: false }).order("hora", { ascending: true });
  if (error) { doorShow("bad", "Error", "No se pudieron leer los eventos", error.message); return; }
  eventos = data;
  const sel = $("dEv");
  if (!eventos.length) {
    sel.innerHTML = `<option>Sin eventos para hoy</option>`; sel.disabled = true;
    doorShow("", "Sin eventos", "No tenés eventos asignados para hoy.");
    return;
  }
  sel.disabled = eventos.length === 1;
  sel.innerHTML = eventos.map((e) => `<option value="${e.id}">${esc(e.nombre)}${e.hora ? " · " + e.hora.slice(0, 5) : ""}${e.sala ? " · " + esc(e.sala) : ""}</option>`).join("");
  let saved = null; try { saved = localStorage.getItem("doorEv"); } catch (e) {}
  doorEv = (eventos.find((e) => e.id === saved) || eventos[0]).id;
  sel.value = doorEv;
  doorCount();
  doorTimer = setInterval(doorCount, 20000);
  doorShow("", "Listo", "Apuntá la cámara al QR de la credencial");
  openDoorCam();
}
async function openDoorCam() {
  const ok = await startCam("doorReader", doorScan);
  $("dCamBtn").hidden = ok; $("doorReader").hidden = !ok;
  if (!ok) doorShow("warn", "Cámara cerrada", "Tocá “Abrir cámara” y permití el acceso", "Si no aparece el permiso, revisá la configuración del navegador.");
}
$("dCamBtn").onclick = openDoorCam;
$("dEv").onchange = (e) => {
  doorEv = e.target.value; try { localStorage.setItem("doorEv", doorEv); } catch (err) {}
  doorCount(); doorShow("", "Listo", "Apuntá la cámara al QR de la credencial");
};
async function doorCount() {
  if (!doorEv) return;
  const { data } = await sb.rpc("resumen_evento", { p_evento: doorEv });
  if (data) { $("dIn").textContent = data.ingresados; $("dTot").textContent = data.total; }
}
let doorBusy = false;
async function doorScan(text) {
  if (doorBusy || !doorEv) return;
  doorBusy = true;
  doorShow("", "Verificando…", text.toUpperCase());
  const { data, error } = await sb.rpc("acreditar", { p_evento: doorEv, p_valor: text });
  doorBusy = false;
  if (error) { beep(false); navigator.vibrate?.([80, 60, 80]); doorShow("bad", "Error", "No se pudo acreditar", error.message); return; }
  const [kind, verdict, who, meta] = veredicto(data);
  beep(kind === "ok"); navigator.vibrate?.(kind === "ok" ? 120 : [80, 60, 80, 60, 80]);
  doorShow(kind, verdict, who, meta);
  if (kind === "ok") doorCount();
}
$("dForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("dManual").value.trim(); if (!v) return;
  $("dManual").value = ""; lastScan = { text: "", t: 0 };
  doorScan(v);
};

// ---------- Asignación de personal (admin) ----------
async function loadStaff(id) {
  const [{ data: perfiles }, { data: asig }] = await Promise.all([
    sb.from("perfiles").select("user_id,email,rol").eq("rol", "puerta").order("email"),
    sb.from("asignaciones").select("user_id").eq("evento_id", id),
  ]);
  if (evId !== id) return;
  const marcados = new Set((asig || []).map((a) => a.user_id));
  $("staffSum").textContent = marcados.size ? `${marcados.size} persona(s)` : "todo el personal";
  $("staffList").innerHTML = (perfiles || []).length
    ? perfiles.map((p) => `<label class="chip pick"><input type="checkbox" data-u="${p.user_id}" ${marcados.has(p.user_id) ? "checked" : ""}> ${esc(p.email)}</label>`).join("")
    : `<span class="status">Todavía no hay usuarios de puerta. Crealos en Supabase → Authentication → Users.</span>`;
}
$("staffList").onchange = async (e) => {
  const cb = e.target.closest("input[data-u]"); if (!cb || !evId) return;
  const row = { user_id: cb.dataset.u, evento_id: evId };
  const { error } = cb.checked ? await sb.from("asignaciones").insert(row)
    : await sb.from("asignaciones").delete().eq("user_id", row.user_id).eq("evento_id", row.evento_id);
  if (error) { cb.checked = !cb.checked; fail(error); return; }
  loadStaff(evId);
};

// ---------- Gestión de usuarios (admin) ----------
// Crear, cambiar rol, cambiar contraseña y eliminar pasan por la función "usuarios" de Supabase,
// que verifica que quien llama sea admin. La lista se lee de la tabla perfiles.
async function usuarios(body) {
  const { data, error } = await sb.functions.invoke("usuarios", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return data;
}
function genPass() {
  const a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => a[n % a.length]).join("");
}
async function loadUsers() {
  const { data, error } = await sb.from("perfiles").select("user_id,email,rol").order("rol").order("email");
  if (error) { $("uList").innerHTML = `<div class="status">No se pudo leer el personal: ${esc(error.message)}</div>`; return; }
  const me = session?.user?.id;
  $("uList").innerHTML = data.map((u) => `<div class="urow" data-u="${u.user_id}" data-email="${esc(u.email)}">
    <span class="em">${esc(u.email)}${u.user_id === me ? ' <span class="status">(vos)</span>' : ""}</span>
    <select data-k="rol" aria-label="Rol" ${u.user_id === me ? "disabled" : ""}>
      <option value="puerta" ${u.rol === "puerta" ? "selected" : ""}>Puerta</option>
      <option value="admin" ${u.rol === "admin" ? "selected" : ""}>Admin</option>
    </select>
    <button class="btn small" data-k="pass" type="button">Contraseña</button>
    ${u.user_id === me ? "" : `<button class="btn small danger" data-k="del" type="button">Eliminar</button>`}
  </div>`).join("");
}
$("btnStaff").onclick = () => { $("uMsg").innerHTML = ""; $("uPass").value = genPass(); $("dlgStaff").showModal(); loadUsers(); };
$("uClose").onclick = () => $("dlgStaff").close();
$("uGen").onclick = () => { $("uPass").value = genPass(); };
function showCred(email, pass, titulo) {
  $("uMsg").innerHTML = `<div class="cred"><b>${esc(titulo)}</b>
    <div>Email: <span class="mono">${esc(email)}</span></div>
    <div>Contraseña: <span class="mono">${esc(pass)}</span></div>
    <div class="status">Pasale estos datos a la persona. La contraseña no se vuelve a mostrar.</div>
    <div><button class="btn small" type="button" id="uCopy">Copiar datos</button></div></div>`;
  $("uCopy").onclick = () => navigator.clipboard?.writeText(`Acreditaciones: https://acreditaciones.carolinacobas.com\nUsuario: ${email}\nContraseña: ${pass}`)
    .then(() => toast("Datos copiados"), () => toast("Copialos a mano"));
}
$("uForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("uEmail").value.trim(), password = $("uPass").value, rol = $("uRol").value;
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await usuarios({ accion: "crear", email, password, rol });
    showCred(email, password, `Usuario creado (${rol === "admin" ? "Admin" : "Puerta"})`);
    $("uEmail").value = ""; $("uPass").value = genPass(); $("uRol").value = "puerta";
    loadUsers(); if (evId) loadStaff(evId);
  } catch (err) { $("uMsg").innerHTML = `<div class="status" style="color:var(--bad)">${esc(err.message)}</div>`; }
  finally { if (btn) btn.disabled = false; }
};
$("uList").onchange = async (e) => {
  const sel = e.target.closest("select[data-k=rol]"); if (!sel) return;
  const row = sel.closest(".urow");
  try { await usuarios({ accion: "rol", user_id: row.dataset.u, rol: sel.value }); toast("Rol actualizado"); if (evId) loadStaff(evId); }
  catch (err) { toast(err.message); loadUsers(); }
};
$("uList").onclick = async (e) => {
  const b = e.target.closest("button[data-k]"); if (!b) return;
  const row = b.closest(".urow"), email = row.dataset.email;
  if (b.dataset.k === "del") {
    if (!await confirmBox("Eliminar usuario", `${email} ya no va a poder ingresar.`)) return;
    try { await usuarios({ accion: "eliminar", user_id: row.dataset.u }); toast("Usuario eliminado"); loadUsers(); if (evId) loadStaff(evId); }
    catch (err) { toast(err.message); }
  }
  if (b.dataset.k === "pass") {
    if (row.querySelector("form")) { row.querySelector("form").remove(); return; }
    const f = document.createElement("form");
    f.innerHTML = `<input placeholder="Nueva contraseña (mínimo 8)" minlength="8" required aria-label="Nueva contraseña" value="${genPass()}"><button class="btn small primary">Guardar</button>`;
    row.appendChild(f);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const password = f.querySelector("input").value;
      try { await usuarios({ accion: "password", user_id: row.dataset.u, password }); f.remove(); showCred(email, password, "Contraseña cambiada"); }
      catch (err) { toast(err.message); }
    };
  }
};

// ---------- Link de registro (admin) ----------
const REG_BASE = location.origin + "/registro?e=";
function renderReg(ev) {
  if (!ev) return;
  const abierto = !!ev.registro_abierto, pasado = ev.fecha < hoyAR();
  $("regOpen").checked = abierto;
  $("regState").textContent = pasado ? "Evento terminado" : abierto ? "Abierto" : "Cerrado";
  $("regState").className = "pill " + (abierto && !pasado ? "on" : "out");
  $("regLink").value = ev.registro_token ? REG_BASE + ev.registro_token : "";
  if (document.activeElement !== $("regCupo")) $("regCupo").value = ev.cupo || "";
  renderRegCount();
}
function renderRegCount() {
  const ev = eventos.find((e) => e.id === evId); if (!ev) return;
  const conf = invitados.filter((i) => i.estado === "aprobado").length, pend = invitados.filter((i) => i.estado === "pendiente").length;
  $("regCount").textContent = (ev.cupo ? `${conf} de ${ev.cupo} confirmados` : `${conf} confirmados`) + (pend ? ` · ${pend} por confirmar` : "");
}
function hoyAR() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }); }
async function updateEvento(campos, msg) {
  const { error } = await sb.from("eventos").update(campos).eq("id", evId);
  if (error) { fail(error); loadEventos(); return false; }
  const ev = eventos.find((e) => e.id === evId); if (ev) Object.assign(ev, campos);
  renderReg(ev); if (msg) toast(msg); return true;
}
$("regOpen").onchange = (e) => updateEvento({ registro_abierto: e.target.checked }, e.target.checked ? "Registro abierto" : "Registro cerrado");
$("regCupo").onchange = (e) => {
  const v = parseInt(e.target.value, 10);
  updateEvento({ cupo: v > 0 ? v : null }, v > 0 ? `Cupo: ${v}` : "Sin límite de cupo");
};
$("regCopy").onclick = () => {
  const link = $("regLink").value; if (!link) return;
  navigator.clipboard?.writeText(link).then(() => toast("Link copiado"), () => { $("regLink").select(); toast("Copialo con Ctrl+C"); });
};
$("regNew").onclick = async () => {
  if (!await confirmBox("Generar link nuevo", "El link actual deja de funcionar. Las credenciales ya emitidas siguen siendo válidas.")) return;
  const t = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  updateEvento({ registro_token: t }, "Link nuevo generado");
};

// ---------- Confirmar registrados (admin) ----------
// Confirmar cambia el estado a "aprobado" y envía el QR por email. La base no deja pasarse del cupo.
async function confirmar(g, silencioso = false) {
  const { error } = await sb.from("invitados").update({ estado: "aprobado", revisado_en: new Date().toISOString() }).eq("id", g.id);
  if (error) { if (!silencioso) fail(error, "No se pudo confirmar"); return error; }
  Object.assign(g, { estado: "aprobado" }); renderInv();
  const ok = g.email ? await enviarEmail(g, true) : false;
  if (!silencioso) toast(ok ? `Confirmado. QR enviado a ${g.email}` : "Confirmado. El email no se pudo enviar: usá Reenviar email.");
  return null;
}
$("btnBulk").onclick = async () => {
  const pend = invitados.filter((i) => i.estado === "pendiente").sort((a, b) => (a.creado_en || "").localeCompare(b.creado_en || ""));
  if (!pend.length || !await confirmBox("Confirmar pendientes", `Se confirman ${pend.length} personas y a cada una le llega su QR por email.`)) return;
  $("btnBulk").disabled = true;
  let ok = 0, err = null;
  for (const g of pend) {
    $("btnBulk").textContent = `Confirmando ${ok + 1} de ${pend.length}…`;
    err = await confirmar(g, true);
    if (err) break;
    ok++;
  }
  $("btnBulk").disabled = false; renderInv();
  toast(err ? `Se confirmaron ${ok}. Se frenó: ${err.message}` : `${ok} confirmados y notificados por email`);
};

// ---------- Reenviar credencial por email (admin) ----------
async function enviarEmail(g, silencioso = false) {
  const { data, error } = await sb.functions.invoke("enviar-credencial", { body: { invitado_id: g.id } });
  if (error) {
    let msg = error.message; try { const j = await error.context.json(); msg = j?.error || j?.detalle || msg; } catch (e) {}
    if (!silencioso) toast("No se pudo enviar: " + msg);
    return false;
  }
  if (!silencioso) {
    if (data?.enviado) toast("Credencial enviada a " + g.email);
    else toast(data?.motivo === "sin_configurar" ? "Falta configurar el envío de emails (Resend)." : "No se pudo enviar el email.");
  }
  return !!data?.enviado;
}

// ---------- Eventos: alta y baja ----------
let editandoEv = null;
function abrirEvento(ev) {
  editandoEv = ev ? ev.id : null;
  $("evDlgTitle").textContent = ev ? "Editar evento" : "Nuevo evento";
  $("evSubmit").textContent = ev ? "Guardar cambios" : "Crear evento";
  $("eNombre").value = ev ? ev.nombre : "";
  $("eFecha").value = ev ? ev.fecha : hoyAR();
  $("eHora").value = ev && ev.hora ? ev.hora.slice(0, 5) : "";
  $("eSala").value = ev ? ev.sala || "" : "";
  $("dlgEv").showModal(); $("eNombre").focus();
}
$("btnNewEv").onclick = () => abrirEvento(null);
$("btnEditEv").onclick = () => { const ev = eventos.find((e) => e.id === evId); if (ev) abrirEvento(ev); };
$("evCancel").onclick = () => $("dlgEv").close();
$("evForm").onsubmit = async (e) => {
  e.preventDefault();
  const ev = { nombre: $("eNombre").value.trim(), fecha: $("eFecha").value, hora: $("eHora").value || null, sala: $("eSala").value.trim() };
  if (!ev.nombre || !ev.fecha) return;
  if (editandoEv) {
    const { error } = await sb.from("eventos").update(ev).eq("id", editandoEv);
    if (error) { fail(error); return; }
    $("dlgEv").close(); toast("Evento actualizado"); loadEventos(); return;
  }
  const { data, error } = await sb.from("eventos").insert(ev).select().single();
  if (error) { fail(error); return; }
  evId = data.id; $("dlgEv").close(); toast("Evento creado"); loadEventos();
};
$("btnDelEv").onclick = async () => {
  const ev = eventos.find((e) => e.id === evId); if (!ev) return;
  if (!await confirmBox("Eliminar evento", `Se borra “${ev.nombre}” con sus ${invitados.length} registrados y el link de registro deja de funcionar. No se puede deshacer.`)) return;
  const { error } = await sb.from("eventos").delete().eq("id", ev.id); // los invitados se borran en cascada
  if (error) { fail(error); return; }
  evId = null; toast("Evento eliminado"); loadEventos();
};

// ---------- Credencial ----------
function showBadge(g) {
  const ev = eventos.find((e) => e.id === g.evento_id) || {};
  $("bEv").textContent = ev.nombre || ""; $("bName").textContent = g.nombre; $("bEmp").textContent = g.empresa || "";
  $("bCat").textContent = g.categoria || "General"; $("bCode").textContent = g.codigo;
  $("bQr").innerHTML = "";
  if (window.QRCode) new QRCode($("bQr"), { text: g.codigo, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  else $("bQr").textContent = "(QR no disponible)";
  $("bCopy").onclick = () => navigator.clipboard?.writeText(g.codigo).then(() => toast("Código copiado"), () => toast("Copialo a mano: " + g.codigo));
  $("dlgBadge").showModal();
}
$("bClose").onclick = () => $("dlgBadge").close();

// ---------- Exportar ----------
$("btnCsv").onclick = () => {
  const ev = eventos.find((e) => e.id === evId); if (!ev) return;
  const rows = [["Nombre", "DNI", "Email", "Telefono", "Empresa", "Categoria", "Codigo", "Origen", "Estado", "Hora ingreso", "Acreditado por"],
    ...invitados.map((i) => [i.nombre, i.dni, i.email, i.telefono, i.empresa, i.categoria, i.codigo, i.origen, i.acreditado ? "Ingresó" : ({ pendiente: "Por confirmar", aprobado: "Confirmado", rechazado: "Rechazado" }[i.estado] || i.estado), hora(i.acreditado_en), i.acreditado_por_email])];
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `acreditaciones-${ev.fecha}-${ev.nombre.replace(/[^\w-]+/g, "_")}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

boot();
