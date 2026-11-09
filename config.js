// Datos públicos del proyecto de Supabase (Project Settings → API).
// La "publishable key" (sb_publishable_...) es pública por diseño: la seguridad la dan las políticas RLS de supabase/schema.sql.
// NUNCA pongas acá la "secret key" (sb_secret_...).
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_TU-CLAVE",
};
