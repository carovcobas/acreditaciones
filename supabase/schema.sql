-- Esquema de Acreditaciones del Salón.
-- Ejecutar una vez en Supabase: SQL Editor → New query → pegar y Run.

create table if not exists public.eventos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  fecha      date not null,
  hora       time,
  sala       text default '',
  creado_en  timestamptz not null default now()
);

create table if not exists public.invitados (
  id                    uuid primary key default gen_random_uuid(),
  evento_id             uuid not null references public.eventos(id) on delete cascade,
  nombre                text not null,
  dni                   text default '',
  empresa               text default '',
  categoria             text not null default 'General',
  codigo                text not null unique,
  acreditado            boolean not null default false,
  acreditado_en         timestamptz,
  acreditado_por_email  text,
  creado_en             timestamptz not null default now()
);

create index if not exists invitados_evento_idx on public.invitados (evento_id);
create index if not exists invitados_dni_idx on public.invitados (dni);

-- Seguridad: solo el personal con usuario (autenticado) puede leer y modificar.
alter table public.eventos   enable row level security;
alter table public.invitados enable row level security;

drop policy if exists "personal eventos"   on public.eventos;
drop policy if exists "personal invitados" on public.invitados;
create policy "personal eventos"   on public.eventos   for all to authenticated using (true) with check (true);
create policy "personal invitados" on public.invitados for all to authenticated using (true) with check (true);

-- Tiempo real: todas las puertas ven los ingresos al instante.
do $$
begin
  begin alter publication supabase_realtime add table public.eventos;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.invitados; exception when duplicate_object then null; end;
end $$;
