-- Confirmación manual de los registrados.
-- Ejecutar DESPUÉS de registro.sql. Se puede volver a ejecutar.
-- Quien se registra por el link queda "pendiente"; solo la admin lo pasa a "aprobado" (y ahí recibe el QR)
-- o a "rechazado". En la puerta solo entran los aprobados. El cupo cuenta solo aprobados.

alter table public.invitados
  add column if not exists estado      text not null default 'aprobado' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  add column if not exists revisado_en timestamptz;

-- No se puede aprobar por encima del cupo del evento.
create or replace function public.controlar_cupo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cupo int; v_aprob int;
begin
  if new.estado = 'aprobado' and (tg_op = 'INSERT' or old.estado is distinct from 'aprobado') then
    perform pg_advisory_xact_lock(hashtext(new.evento_id::text));
    select cupo into v_cupo from eventos where id = new.evento_id;
    if v_cupo is not null then
      select count(*) into v_aprob from invitados where evento_id = new.evento_id and estado = 'aprobado' and id <> new.id;
      if v_aprob >= v_cupo then raise exception 'Cupo completo: ya hay % confirmados.', v_aprob; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cupo_aprobados on public.invitados;
create trigger cupo_aprobados before insert or update of estado on public.invitados
  for each row execute function public.controlar_cupo();
revoke all on function public.controlar_cupo() from public, anon, authenticated;

create or replace function public.info_registro(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nombre', e.nombre, 'fecha', e.fecha, 'hora', e.hora, 'sala', e.sala,
    'abierto', e.registro_abierto and e.fecha >= public.hoy_ar(),
    'completo', e.cupo is not null and (select count(*) from invitados i where i.evento_id = e.id and i.estado = 'aprobado') >= e.cupo)
  from eventos e where e.registro_token = p_token;
$$;

-- El registro ya no devuelve el código: la credencial solo llega por email una vez confirmada.
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

  perform pg_advisory_xact_lock(hashtext(e.id::text));

  select * into v_inv from invitados
   where evento_id = e.id and upper(regexp_replace(dni, '[^0-9A-Za-z]', '', 'g')) = v_dni
   limit 1;
  if v_inv.id is not null then
    if lower(v_inv.email) = v_email then
      return json_build_object('estado', 'existente', 'solicitud', v_inv.estado);
    end if;
    return json_build_object('estado', 'duplicado');
  end if;

  if e.cupo is not null then
    select count(*) into v_total from invitados where evento_id = e.id and estado = 'aprobado';
    if v_total >= e.cupo then return json_build_object('estado', 'completo'); end if;
  end if;

  insert into invitados (evento_id, nombre, dni, email, telefono, empresa, categoria, codigo, origen, estado)
  values (e.id, v_nombre, v_dni, v_email, v_tel, v_emp, 'General', public.nuevo_codigo(), 'registro', 'pendiente');

  return json_build_object('estado', 'ok');
end $$;

-- En la puerta solo pasan los aprobados.
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

  select * into v_inv from invitados
   where evento_id = p_evento
     and (codigo = v_valor or (length(v_num) >= 6 and regexp_replace(dni, '\D', '', 'g') = v_num))
   order by (estado = 'aprobado') desc, (codigo = v_valor) desc, acreditado asc
   limit 1;

  if v_inv.id is null then
    select e.nombre into v_otro from invitados i join eventos e on e.id = i.evento_id
     where i.codigo = v_valor limit 1;
    return json_build_object('estado', case when v_otro is null then 'no_existe' else 'otro_evento' end,
                             'evento', v_otro, 'valor', v_valor);
  end if;

  if v_inv.estado <> 'aprobado' then
    return json_build_object('estado', case v_inv.estado when 'pendiente' then 'pendiente' else 'rechazado' end,
      'nombre', v_inv.nombre, 'dni', v_inv.dni);
  end if;

  v_id := v_inv.id;
  update invitados set acreditado = true, acreditado_en = now(), acreditado_por_email = v_email
   where id = v_id and acreditado = false
   returning * into v_inv;

  if found then
    return json_build_object('estado', 'ok', 'nombre', v_inv.nombre, 'categoria', v_inv.categoria,
      'empresa', v_inv.empresa, 'dni', v_inv.dni, 'acreditado_en', v_inv.acreditado_en, 'acreditado_por', v_inv.acreditado_por_email);
  end if;

  select * into v_inv from invitados where id = v_id;
  return json_build_object('estado', 'ya_ingreso', 'nombre', v_inv.nombre, 'categoria', v_inv.categoria,
    'empresa', v_inv.empresa, 'dni', v_inv.dni, 'acreditado_en', v_inv.acreditado_en, 'acreditado_por', v_inv.acreditado_por_email);
end $$;

-- El contador de la puerta cuenta solo confirmados.
create or replace function public.resumen_evento(p_evento uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when public.puede_usar_evento(p_evento) then
    json_build_object('total', count(*), 'ingresados', count(*) filter (where acreditado))
  end from invitados where evento_id = p_evento and estado = 'aprobado';
$$;
