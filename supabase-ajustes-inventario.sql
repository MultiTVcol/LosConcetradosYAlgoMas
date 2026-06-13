-- ============================================================
--  supabase-ajustes-inventario.sql
--  Tabla para los CONTEOS FÍSICOS del módulo Inventario.
-- ============================================================
--
--  QUÉ HACE:
--    1. Crea la tabla `ajustes_inventario` (si no existe).
--    2. Activa RLS con la misma política que el resto del POS
--       (solo terminales activadas / rol authenticated).
--    3. La agrega a la publicación de Realtime para que los
--       conteos se sincronicen EN VIVO entre terminales.
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    Supabase Dashboard → SQL Editor → pega este archivo → Run.
--    (Se puede correr varias veces sin problema: es idempotente.)
--
--  NOTA: el cambio de stock de cada conteo ya se sincroniza por la
--  función atómica ajustar_stock. Esta tabla guarda el DOCUMENTO del
--  ajuste (qué se contó, diferencia, valor) para el kardex/historial.
-- ============================================================

-- 1) Tabla -----------------------------------------------------
create table if not exists ajustes_inventario (
  id        text primary key,
  tenant_id text not null default 'default',
  numero    text,
  fecha     text,
  items     jsonb,          -- [{ producto_id, nombre, codigo, sistema, fisico, delta, costo, valor }]
  valor     numeric,
  nota      text,
  estado    text,
  creado    text
);

-- Índice por tenant (consultas filtradas por comercio)
create index if not exists ajustes_inventario_tenant_idx
  on ajustes_inventario (tenant_id);

-- 2) RLS + política (idéntica al resto de tablas) --------------
alter table ajustes_inventario enable row level security;

do $$
begin
  -- Limpiar políticas viejas para no dejar acceso libre
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'ajustes_inventario') then
    execute (
      select string_agg(format('drop policy %I on public.ajustes_inventario;', policyname), ' ')
      from pg_policies
      where schemaname = 'public' and tablename = 'ajustes_inventario'
    );
  end if;

  -- Acceso total solo para dispositivos activados (authenticated)
  execute 'create policy terminal_activada on ajustes_inventario for all to authenticated using (true) with check (true)';
end $$;

-- 3) Realtime: agregar la tabla a la publicación --------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'ajustes_inventario'
    ) then
      alter publication supabase_realtime add table ajustes_inventario;
    end if;
  end if;
end $$;

-- 4) Verificación ---------------------------------------------
select 'tabla' as chequeo, count(*)::text as ok
from information_schema.tables
where table_schema = 'public' and table_name = 'ajustes_inventario'
union all
select 'rls', rowsecurity::text from pg_tables
where schemaname = 'public' and tablename = 'ajustes_inventario'
union all
select 'realtime', (count(*) > 0)::text from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'ajustes_inventario';
