-- Esquema de Supabase para "Mi Carrera · UNLaM".
-- Ejecutá TODO esto en tu proyecto: Supabase → SQL Editor → New query → Run.
--
-- Guarda el estado del planificador (materias, notas, escenarios, etc.) de cada
-- usuario en una fila propia, protegida por Row-Level Security: cada persona
-- solo puede ver y editar SUS datos. Las contraseñas las gestiona Supabase Auth
-- (hasheadas con bcrypt); esta tabla nunca las toca.

-- 1) Tabla: una fila por usuario.
create table if not exists public.planner_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Activar Row-Level Security.
alter table public.planner_states enable row level security;

-- 3) Políticas: cada usuario, solo su propia fila.
drop policy if exists "planner_select_own" on public.planner_states;
create policy "planner_select_own"
  on public.planner_states for select
  using (auth.uid() = user_id);

drop policy if exists "planner_insert_own" on public.planner_states;
create policy "planner_insert_own"
  on public.planner_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "planner_update_own" on public.planner_states;
create policy "planner_update_own"
  on public.planner_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "planner_delete_own" on public.planner_states;
create policy "planner_delete_own"
  on public.planner_states for delete
  using (auth.uid() = user_id);
