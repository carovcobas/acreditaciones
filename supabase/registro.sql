-- Registro público de invitados con un link por evento.
-- Ejecutar en Supabase DESPUÉS de schema.sql y roles.sql. Se puede volver a ejecutar.

-- 1. Columnas nuevas ------------------------------------------------------------
alter table public.eventos
  add column if not exists registro_token   text unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  add column if not exists registro_abierto boolean not null default false,
  add column if not exists cupo             integer check (cupo is null or cupo > 0);
update public.eventos set registro_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) where registro_token is null;

alter table public.invitados
  add column if not exists email    text not null default '',
  add column if not exists telefono text not null default '',
  add column if not exists origen   text not null default 'admin' check (origen in ('admin', 'registro')),
  add column if not exists email_enviado_en timestamptz;

-- 2. Código de credencial único --------------------------------------------------
create or replace function public.nuevo_codigo() returns text
language plpgsql volatile set search_path = public as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    select 'AC-' || string_agg(substr(a, 1 + floor(random() * 32)::int, 1), '') into c from generate_series(1, 6);
    exit when not exists (select 1 from invitados where codigo = c);
  end loop;
  return c;
end $$;

-- 3. Datos públicos del evento para la página de registro ------------------------
create or replace function public.info_registro(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nombre', e.nombre, 'fecha', e.fecha, 'hora', e.hora, 'sala', e.sala,
    'abierto', e.registro_abierto and e.fecha >= public.hoy_ar(),
    'completo', e.cupo is not null and (select count(*) from invitados i where i.evento_id = e.id) >= e.cupo)
  from eventos e where e.registro_token = p_token;
$$;

-- 4. Registro de un invitado -----------------------------------------------------
create or replace function public.registrar_invitado(
  p_token text, p_nombre text, p_dni text, p_email text, p_telefono text default '', p_empresa text default ''
) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  e        eventos;
  v_nombre text := left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 120);
  v_dni    text := upper(regexp_replace(coalesce(p_dni, ''), '[^0-9A-Za-z]', '', 'g'));
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_tel    text := left(trim(coalesce(p_telefono, '')), 40);
  v_emp    text := left(trim(coalesce(p_empresa, '')), 120);
  v_inv    invitados;
  v_total  int;
begin
  select * into e from eventos where registro_token = p_token;
  if e.id is null then return json_build_object('estado', 'link_invalido'); end if;
  if not e.registro_abierto or e.fecha < public.hoy_ar() then return json_build_object('estado', 'cerrado'); end if;

  if length(v_nombre) < 3 then return json_build_object('estado', 'error', 'mensaje', 'Escribí tu nombre y apellido.'); end if;
  if length(v_dni) < 6 or length(v_dni) > 15 then return json_build_object('estado', 'error', 'mensaje', 'Revisá el DNI o pasaporte.'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then return json_build_object('estado', 'error', 'mensaje', 'Revisá el email.'); end if;

  -- Un registro a la vez por evento: evita duplicados y pasarse del cupo.
  perform pg_advisory_xact_lock(hashtext(e.id::text));

  select * into v_inv from invitados
   where evento_id = e.id and upper(regexp_replace(dni, '[^0-9A-Za-z]', '', 'g')) = v_dni
   limit 1;
  if v_inv.id is not null then
    if lower(v_inv.email) = v_email then
      return json_build_object('estado', 'existente', 'codigo', v_inv.codigo, 'nombre', v_inv.nombre, 'categoria', v_inv.categoria);
    end if;
    return json_build_object('estado', 'duplicado');
  end if;

  if e.cupo is not null then
    select count(*) into v_total from invitados where evento_id = e.id;
    if v_total >= e.cupo then return json_build_object('estado', 'completo'); end if;
  end if;

  insert into invitados (evento_id, nombre, dni, email, telefono, empresa, categoria, codigo, origen)
  values (e.id, v_nombre, v_dni, v_email, v_tel, v_emp, 'General', public.nuevo_codigo(), 'registro')
  returning * into v_inv;

  return json_build_object('estado', 'ok', 'codigo', v_inv.codigo, 'nombre', v_inv.nombre, 'categoria', v_inv.categoria);
end $$;

-- 5. Permisos: la página pública (sin sesión) solo puede llamar a estas dos funciones.
revoke all on function public.nuevo_codigo() from public, anon, authenticated;
revoke all on function public.info_registro(text) from public;
revoke all on function public.registrar_invitado(text, text, text, text, text, text) from public;
grant execute on function public.info_registro(text) to anon, authenticated;
grant execute on function public.registrar_invitado(text, text, text, text, text, text) to anon, authenticated;
