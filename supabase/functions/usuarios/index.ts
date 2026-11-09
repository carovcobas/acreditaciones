// Gestión de usuarios del personal. Solo responde a usuarios con rol "admin".
// Acciones: crear, rol, password, eliminar.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) { try { const k = JSON.parse(keys)["default"]; if (k) return k; } catch { /* usa la clave legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const ROLES = ["admin", "puerta"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  // Quién llama: tiene que tener sesión y rol admin.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sin sesión" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json({ error: "Sesión inválida. Volvé a ingresar." }, 401);
  const { data: perfil } = await admin.from("perfiles").select("rol").eq("user_id", user.id).maybeSingle();
  if (perfil?.rol !== "admin") return json({ error: "Solo la administradora puede gestionar usuarios." }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const { accion, user_id } = body;
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const rol = body.rol || "puerta";

  if (user_id && user_id === user.id && (accion === "rol" || accion === "eliminar"))
    return json({ error: "No podés cambiar tu propio rol ni eliminar tu usuario." }, 400);
  if ((accion === "crear" || accion === "password") && password.length < 8)
    return json({ error: "La contraseña tiene que tener al menos 8 caracteres." }, 400);
  if ((accion === "crear" || accion === "rol") && !ROLES.includes(rol))
    return json({ error: "Rol inválido." }, 400);

  switch (accion) {
    case "crear": {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email inválido." }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? "Ya existe un usuario con ese email." : error.message }, 400);
      // El trigger crea el perfil como "puerta"; si se pidió admin, se actualiza.
      await admin.from("perfiles").upsert({ user_id: data.user.id, email, rol });
      return json({ ok: true, user_id: data.user.id });
    }
    case "rol": {
      const { error } = await admin.from("perfiles").update({ rol }).eq("user_id", user_id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    case "password": {
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    case "eliminar": {
      const { error } = await admin.auth.admin.deleteUser(user_id); // el perfil y sus asignaciones se borran en cascada
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    default:
      return json({ error: "Acción desconocida" }, 400);
  }
});
