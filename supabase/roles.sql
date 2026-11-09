-- Roles: administradora y personal de puerta.
-- Ejecutar en Supabase (SQL Editor → New query → Run) DESPUÉS de schema.sql.
-- Se puede volver a ejecutar sin problema.

-- 1. Perfiles con rol ---------------------------------------------------------
create table if not exists public.perfiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text not null,
  rol      text not null default 'puerta' check (rol in ('admin', 'puerta'))
);
alter table public.perfiles enable row level security;

-- Todo usuario nuevo arranca como "puerta".
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- Perfiles para los usuarios que ya existían.
insert into public.perfiles (user_id, email)
select id, email from auth.users on conflict (user_id) do nothing;

-- Administradora.
update public.perfiles set rol = 'admin' where lower(email) = 'carovcobas@gmail.com';

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where user_id = auth.uid() and rol = 'admin');
$$;

create or replace function public.tiene_rol() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where user_id = auth.uid());
$$;

-- Asignación de personal de puerta a eventos.
-- Si un evento tiene personas asignadas, solo ellas lo ven; si no tiene, lo ve todo el personal de puerta.
create table if not exists public.asignaciones (
  user_id   uuid not null references public.perfiles(user_id) on delete cascade,
  evento_id uuid not null references public.eventos(id) on delete cascade,
  primary key (user_id, evento_id)
);
alter table public.asignaciones enable row level security;

create or replace function public.hoy_ar() returns date
language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

-- Puerta: eventos de hoy (y de ayer, para los que terminan pasada la medianoche),
-- abiertos o asignados a esa persona. Admin: todos.
create or replace function public.puede_usar_evento(p_evento uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin() or (
    public.tiene_rol() and exists (
      select 1 from eventos e
       where e.id = p_evento
         and e.fecha between public.hoy_ar() - 1 and public.hoy_ar()
         and ( not exists (select 1 from asignaciones a where a.evento_id = e.id)
               or exists (select 1 from asignaciones a where a.evento_id = e.id and a.user_id = auth.uid()) )));
$$;

-- 2. Permisos -----------------------------------------------------------------
drop policy if exists "personal eventos"   on public.eventos;
drop policy if exists "personal invitados" on public.invitados;
drop policy if exists "ver eventos"        on public.eventos;
drop policy if exists "admin eventos"      on public.eventos;
drop policy if exists "admin invitados"    on public.invitados;
drop policy if exists "ver mi perfil"      on public.perfiles;
drop policy if exists "admin asignaciones" on public.asignaciones;

-- Eventos: admin ve todos; puerta solo los que puede usar hoy. Solo admin los modifica.
create policy "ver eventos"   on public.eventos for select to authenticated using (public.puede_usar_evento(id));
create policy "admin eventos" on public.eventos for all    to authenticated using (public.es_admin()) with check (public.es_admin());

-- Invitados: solo admin lee y modifica. La puerta acredita con la función acreditar().
create policy "admin invitados" on public.invitados for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Perfiles: cada uno ve el suyo; admin ve todos. Los roles se cambian desde el panel de Supabase.
create policy "admin asignaciones" on public.asignaciones for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "ver mi perfil" on public.perfiles for select to authenticated using (user_id = auth.uid() or public.es_admin());

-- 3. Acreditar (puerta y admin) ----------------------------------------------
-- Busca por código QR o DNI dentro del evento y marca el ingreso una sola vez.
create or replace function public.acreditar(p_evento uuid, p_valor text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_valor  text := upper(trim(coalesce(p_valor, '')));
  v_num    text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
  v_email  text;
  v_id     uuid;
  v_inv    invitados;
  v_otro   text;
begin
  if not public.puede_usar_evento(p_evento) then raise exception 'No tenés acceso a este evento'; end if;
  select email into v_email from perfiles where user_id = auth.uid();

  select id into v_id from invitados
   where evento_id = p_evento
     and (codigo = v_valor or (length(v_num) >= 6 and regexp_replace(dni, '\D', '', 'g') = v_num))
   order by (codigo = v_valor) desc, acreditado asc
   limit 1;

  if v_id is null then
    select e.nombre into v_otro from invitados i join eventos e on e.id = i.evento_id
     where i.codigo = v_valor limit 1;
    return json_build_object('estado', case when v_otro is null then 'no_existe' else 'otro_evento' end,
                             'evento', v_otro, 'valor', v_valor);
  end if;

  update invitados set acreditado = true, acreditado_en = now(), acreditado_por_email = v_email
   where id = v_id and acreditado = false
   returning * into v_inv;

  if v_inv.id is not null then
    return json_build_object('estado', 'ok', 'nombre', v_inv.nombre, 'categoria', v_inv.categoria,
      'empresa', v_inv.empresa, 'dni', v_inv.dni, 'acreditado_en', v_inv.acreditado_en, 'acreditado_por', v_inv.acreditado_por_email);
  end if;

  select * into v_inv from invitados where id = v_id;
  return json_build_object('estado', 'ya_ingreso', 'nombre', v_inv.nombre, 'categoria', v_inv.categoria,
    'empresa', v_inv.empresa, 'dni', v_inv.dni, 'acreditado_en', v_inv.acreditado_en, 'acreditado_por', v_inv.acreditado_por_email);
end $$;

-- Contador para la pantalla de puerta.
create or replace function public.resumen_evento(p_evento uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when public.puede_usar_evento(p_evento) then
    json_build_object('total', count(*), 'ingresados', count(*) filter (where acreditado))
  end from invitados where evento_id = p_evento;
$$;

revoke all on function public.puede_usar_evento(uuid) from public, anon;
grant execute on function public.puede_usar_evento(uuid) to authenticated;
revoke all on function public.acreditar(uuid, text)  from public, anon;
revoke all on function public.resumen_evento(uuid)   from public, anon;
grant execute on function public.acreditar(uuid, text) to authenticated;
grant execute on function public.resumen_evento(uuid)  to authenticated;
