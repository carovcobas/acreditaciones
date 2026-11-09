// Acreditaciones del Salón — lógica de la app sobre Supabase.
const CATS = ["General", "VIP", "Prensa", "Staff", "Expositor", "Proveedor"];
const $ = (id) => document.getElementById(id);

let sb = null, session = null;
let eventos = [], invitados = [], evId = null, filtro = "todos";
let chEventos = null, chInv = null, subscribedFor = null, scanner = null;

const fmtFecha = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const hora = (ts) => ts ? new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function code() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const r = crypto.getRandomValues(new Uint32Array(6)); for (const n of r) s += a[n % a.length]; return "AC-" + s; }
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
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
$("gCat").innerHTML = CATS.map((c) => `<option>${c}</option>`).join("");

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

function onSession(s) {
  session = s;
  const logged = !!s;
  $("loginPanel").hidden = logged;
  $("btnNewEv").hidden = $("btnLogout").hidden = !logged;
  $("evSel").parentElement.querySelector("label").hidden = $("evSel").hidden = !logged;
  $("who").textContent = logged ? s.user.email : "";
  $("status").textContent = "";
  if (logged) { startEventos(); }
  else {
    stopAll(); eventos = []; invitados = [];
    $("noEv").hidden = $("evPanel").hidden = $("main").hidden = true;
  }
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
  if (chEventos) { sb.removeChannel(chEventos); chEventos = null; }
  if (chInv) { sb.removeChannel(chInv); chInv = null; }
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
  }
  if (subscribedFor === id) return;
  if (chInv) { sb.removeChannel(chInv); chInv = null; }
  subscribedFor = id; invitados = []; renderInv(); $("result").innerHTML = "";
  if (!id) return;
  loadInvitados(id);
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
  const tot = invitados.length, inn = invitados.filter((i) => i.acreditado).length;
  $("cIn").textContent = inn; $("cTot").textContent = tot; $("cBar").style.width = tot ? (inn / tot * 100) + "%" : "0";
  const cats = {}; invitados.forEach((i) => { const k = i.categoria || "General"; cats[k] = cats[k] || [0, 0]; cats[k][1]++; if (i.acreditado) cats[k][0]++; });
  $("cCats").innerHTML = Object.entries(cats).map(([k, [a, b]]) => `<span class="chip">${esc(k)} <b>${a}/${b}</b></span>`).join("");
  const q = norm($("q").value);
  let list = invitados.filter((i) => filtro === "todos" || (filtro === "in" ? i.acreditado : !i.acreditado));
  if (q) list = list.filter((i) => norm([i.nombre, i.dni, i.empresa, i.codigo, i.categoria].join(" ")).includes(q));
  list.sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
  const tb = $("tbody");
  if (!tot) { tb.innerHTML = `<tr><td colspan="5" class="empty">Este evento todavía no tiene invitados. Agregalos abajo o importá una lista.</td></tr>`; return; }
  if (!list.length) { tb.innerHTML = `<tr><td colspan="5" class="empty">Nadie coincide con el filtro.</td></tr>`; return; }
  tb.innerHTML = list.map((i) => `<tr>
    <td><b>${esc(i.nombre)}</b>${i.empresa ? `<div class="status">${esc(i.empresa)}</div>` : ""}</td>
    <td class="mono">${esc(i.dni || "—")}</td>
    <td>${esc(i.categoria || "General")}</td>
    <td>${i.acreditado ? `<span class="pill in" title="${esc(i.acreditado_por_email || "")}">Ingresó ${hora(i.acreditado_en)}</span>` : `<span class="pill out">Pendiente</span>`}</td>
    <td><div class="acts">
      ${i.acreditado ? `<button class="btn small" data-a="undo" data-id="${i.id}">Deshacer</button>` : `<button class="btn small primary" data-a="in" data-id="${i.id}">Acreditar</button>`}
      <button class="btn small" data-a="qr" data-id="${i.id}">Credencial</button>
      <button class="btn small danger" data-a="del" data-id="${i.id}" aria-label="Eliminar">✕</button>
    </div></td></tr>`).join("");
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
// El update solo aplica si todavía no estaba acreditado: si dos puertas escanean a la vez, gana una sola.
async function acreditar(g) {
  const { data, error } = await sb.from("invitados")
    .update({ acreditado: true, acreditado_en: new Date().toISOString(), acreditado_por_email: session?.user?.email || null })
    .eq("id", g.id).eq("acreditado", false).select();
  if (error) { fail(error); return; }
  if (data.length) { showResult("ok", "Acceso permitido", data[0].nombre, data[0]); return; }
  const { data: cur } = await sb.from("invitados").select("*").eq("id", g.id).maybeSingle();
  if (!cur) showResult("bad", "No encontrado", "El invitado fue eliminado.");
  else showResult("warn", "Ya ingresó", `${cur.nombre} se acreditó a las ${hora(cur.acreditado_en)}${cur.acreditado_por_email ? " (" + cur.acreditado_por_email + ")" : ""}.`, cur);
}
function showResult(kind, verdict, text, g) {
  $("result").innerHTML = `<div class="result ${kind}" role="status"><div class="verdict">${esc(verdict)}</div>
   <div class="who">${esc(text)}</div>${g ? `<div class="status">${esc([g.categoria, g.empresa, g.dni && "DNI " + g.dni].filter(Boolean).join(" · "))}</div>` : ""}</div>`;
}

async function buscar(raw) {
  raw = raw.trim(); if (!raw) return;
  const up = raw.toUpperCase(), n = norm(raw), digits = raw.replace(/\D/g, "");
  const hit = invitados.find((i) => (i.codigo || "").toUpperCase() === up) ||
    (digits.length >= 6 && invitados.find((i) => (i.dni || "").replace(/\D/g, "") === digits));
  if (hit) { acreditar(hit); return; }
  if (/^AC-/.test(up)) {
    const { data } = await sb.from("invitados").select("evento_id").eq("codigo", up).maybeSingle();
    const ev = data && eventos.find((e) => e.id === data.evento_id);
    showResult("bad", "Acceso denegado", ev ? `El código ${up} es del evento “${ev.nombre}”.` : `El código ${up} no existe.`);
    return;
  }
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
let lastScan = { text: "", t: 0 };
async function startCam() {
  if (!window.Html5Qrcode) { toast("El lector de cámara no cargó."); return; }
  $("reader").hidden = false; $("btnCam").textContent = "Cerrar cámara";
  scanner = new Html5Qrcode("reader");
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (text) => {
      const now = Date.now();
      if (text === lastScan.text && now - lastScan.t < 4000) return; // evita lecturas repetidas del mismo QR
      lastScan = { text, t: now };
      if (navigator.vibrate) navigator.vibrate(80);
      buscar(text);
    });
  } catch (err) { toast("No se pudo abrir la cámara. Revisá el permiso del navegador."); stopCam(); }
}
async function stopCam() {
  if (scanner) { try { await scanner.stop(); scanner.clear(); } catch (e) {} scanner = null; }
  $("reader").hidden = true; $("btnCam").textContent = "Escanear con la cámara";
}
$("btnCam").onclick = () => scanner ? stopCam() : startCam();

// ---------- Alta e importación ----------
$("addForm").onsubmit = async (e) => {
  e.preventDefault(); if (!evId) return;
  const g = { evento_id: evId, nombre: $("gNombre").value.trim(), dni: $("gDni").value.trim(), empresa: $("gEmpresa").value.trim(), categoria: $("gCat").value, codigo: code() };
  if (!g.nombre) return;
  const { error } = await sb.from("invitados").insert(g);
  if (error) { fail(error); return; }
  toast("Invitado agregado"); $("addForm").reset(); $("gNombre").focus();
};
$("impForm").onsubmit = async (e) => {
  e.preventDefault(); if (!evId) return;
  const rows = $("impText").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(/\t|;|,/).map((x) => x.trim());
    return { evento_id: evId, nombre: p[0], dni: p[1] || "", empresa: p[2] || "", categoria: CATS.find((c) => norm(c) === norm(p[3])) || "General", codigo: code() };
  }).filter((r) => r.nombre);
  if (!rows.length) return;
  $("impMsg").textContent = `Importando ${rows.length}…`;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("invitados").insert(rows.slice(i, i + 500));
    if (error) { $("impMsg").textContent = `Se cortó después de ${i} invitados: ${error.message}`; return; }
  }
  $("impMsg").textContent = `${rows.length} invitados importados.`; $("impText").value = "";
};

// ---------- Eventos: alta y baja ----------
$("btnNewEv").onclick = () => { $("eFecha").value = new Date().toISOString().slice(0, 10); $("dlgEv").showModal(); $("eNombre").focus(); };
$("evCancel").onclick = () => $("dlgEv").close();
$("evForm").onsubmit = async (e) => {
  e.preventDefault();
  const ev = { nombre: $("eNombre").value.trim(), fecha: $("eFecha").value, hora: $("eHora").value || null, sala: $("eSala").value.trim() };
  if (!ev.nombre || !ev.fecha) return;
  const { data, error } = await sb.from("eventos").insert(ev).select().single();
  if (error) { fail(error); return; }
  evId = data.id; $("dlgEv").close(); $("evForm").reset(); toast("Evento creado"); loadEventos();
};
$("btnDelEv").onclick = async () => {
  const ev = eventos.find((e) => e.id === evId); if (!ev) return;
  if (!await confirmBox("Eliminar evento", `Se borra “${ev.nombre}” y sus ${invitados.length} invitados. No se puede deshacer.`)) return;
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
  const rows = [["Nombre", "DNI", "Empresa", "Categoria", "Codigo", "Estado", "Hora ingreso", "Acreditado por"],
    ...invitados.map((i) => [i.nombre, i.dni, i.empresa, i.categoria, i.codigo, i.acreditado ? "Ingresó" : "Pendiente", hora(i.acreditado_en), i.acreditado_por_email])];
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `acreditaciones-${ev.fecha}-${ev.nombre.replace(/[^\w-]+/g, "_")}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

boot();
