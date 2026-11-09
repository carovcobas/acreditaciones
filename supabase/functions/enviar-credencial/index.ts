// Envía por email la credencial (con QR) a un invitado, usando Resend.
// Solo envía a invitados confirmados (estado "aprobado"). Dos formas de llamarla:
//  - Admin (con sesión): { invitado_id }. Se usa al confirmar y para reenviar.
//  - Página de registro (sin sesión): { token, dni, email }. Reenvía la credencial a quien ya está
//    confirmado, solo al email guardado y como máximo una vez cada 10 minutos.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import QRCode from "npm:qrcode@1.5.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
function fechaLarga(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ enviado: false, motivo: "sin_configurar" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }

  let inv: Record<string, any> | null = null;
  let esAdmin = false;

  if (body.invitado_id) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Sesión inválida. Volvé a ingresar." }, 401);
    const { data: p } = await db.from("perfiles").select("rol").eq("user_id", user.id).maybeSingle();
    if (p?.rol !== "admin") return json({ error: "Solo la administradora puede reenviar credenciales." }, 403);
    esAdmin = true;
    ({ data: inv } = await db.from("invitados").select("*, eventos(*)").eq("id", body.invitado_id).maybeSingle());
  } else if (body.token && body.dni && body.email) {
    const dni = String(body.dni).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const { data: lista } = await db.from("invitados").select("*, eventos!inner(*)")
      .eq("eventos.registro_token", body.token).eq("email", String(body.email).trim().toLowerCase()).eq("estado", "aprobado");
    inv = (lista || []).find((i) => String(i.dni).replace(/[^0-9A-Za-z]/g, "").toUpperCase() === dni) || null;
    if (!inv) return json({ enviado: false, motivo: "no_confirmado" });
  } else {
    return json({ error: "Faltan datos" }, 400);
  }

  if (!inv) return json({ error: "No se encontró la credencial." }, 404);
  if (inv.estado !== "aprobado") return json({ error: "El invitado todavía no está confirmado." }, 400);
  if (!inv.email) return json({ enviado: false, motivo: "sin_email" });
  if (!esAdmin && inv.email_enviado_en && Date.now() - new Date(inv.email_enviado_en).getTime() < 10 * 60 * 1000)
    return json({ enviado: true, motivo: "reciente" });

  const ev = inv.eventos;
  const qr = (await QRCode.toDataURL(inv.codigo, { width: 480, margin: 2, errorCorrectionLevel: "M" })).split(",")[1];
  const cuando = [fechaLarga(ev.fecha), ev.hora ? ev.hora.slice(0, 5) + " h" : ""].filter(Boolean).join(" · ");
  const html = `<!doctype html><html><body style="margin:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#16202E">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #DCE0E6" cellpadding="0" cellspacing="0">
    <tr><td style="padding:24px 24px 8px;text-align:center">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5C6675">Tu credencial</div>
      <div style="font-size:24px;font-weight:bold;margin-top:6px">${esc(ev.nombre)}</div>
      <div style="font-size:14px;color:#5C6675;margin-top:4px">${esc(cuando)}${ev.sala ? "<br>" + esc(ev.sala) : ""}</div>
    </td></tr>
    <tr><td align="center" style="padding:8px 24px">
      <img src="cid:qr" width="240" height="240" alt="Código QR ${esc(inv.codigo)}" style="display:block;border:0">
    </td></tr>
    <tr><td style="padding:0 24px 24px;text-align:center">
      <div style="font-size:20px;font-weight:bold">${esc(inv.nombre)}</div>
      ${inv.empresa ? `<div style="font-size:14px;color:#5C6675">${esc(inv.empresa)}</div>` : ""}
      <div style="display:inline-block;margin-top:8px;background:#D9480F;color:#ffffff;padding:3px 12px;border-radius:4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">${esc(inv.categoria || "General")}</div>
      <div style="font-family:'Courier New',monospace;font-size:18px;letter-spacing:.08em;margin-top:12px">${esc(inv.codigo)}</div>
      <p style="font-size:14px;line-height:1.5;color:#16202E;margin:16px 0 0">Mostrá este QR en la entrada desde el celular. Si no se puede escanear, decí tu DNI o el código.</p>
    </td></tr>
  </table></td></tr></table></body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") || "Acreditaciones <acreditaciones@carolinacobas.com>",
      to: [inv.email],
      subject: `Tu credencial para ${ev.nombre}`,
      html,
      text: `Tu credencial para ${ev.nombre}\n${cuando}${ev.sala ? "\n" + ev.sala : ""}\n\n${inv.nombre}\nCódigo: ${inv.codigo}\n\nMostrá el QR adjunto en la entrada. Si no se puede escanear, decí tu DNI o el código.`,
      attachments: [{ filename: `credencial-${inv.codigo}.png`, content: qr, content_id: "qr" }],
    }),
  });
  if (!r.ok) {
    const detalle = await r.text();
    console.error("Resend", r.status, detalle);
    return json({ enviado: false, motivo: "error_envio", detalle: esAdmin ? detalle : undefined }, 502);
  }
  await db.from("invitados").update({ email_enviado_en: new Date().toISOString() }).eq("id", inv.id);
  return json({ enviado: true });
});
