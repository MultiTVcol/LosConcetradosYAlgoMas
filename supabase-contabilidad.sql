-- ============================================================
--  supabase-contabilidad.sql
--  Tabla para los ASIENTOS CONTABLES del módulo Contabilidad.
-- ============================================================
--
--  QUÉ HACE:
--    1. Crea la tabla `asientos` (si no existe).
--    2. Activa RLS con la misma política que el resto del POS
--       (solo terminales activadas / rol authenticated).
--    3. La agrega a la publicación de Realtime.
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    Supabase Dashboard → SQL Editor → pega este archivo → Run.
--    (Se puede correr varias veces sin problema: es idempotente.)
--
--  NOTA: cada asiento es UNA fila con sus líneas en `lineas` (jsonb),
--  igual que los items de una venta. Los asientos nunca se borran: se
--  reversan con otro asiento (estado 'reversado' + reversado_por).
--  La configuración contable vive en kvs ('config_contable').
-- ============================================================

-- 1) Tabla -----------------------------------------------------
create table if not exists asientos (
  id             text primary key,
  tenant_id      text not null default 'default',
  numero         text,
  fecha          text,          -- 'YYYY-MM-DD'
  periodo        text,          -- 'YYYY-MM'
  origen_tipo    text,          -- venta | recaudo | compra | pago | gasto | baja | ajuste_inventario | apertura | reversion
  origen_id      text,
  doc_tabla      text,          -- tabla del documento fuente (ventas, compras…)
  doc_id         text,          -- id del documento fuente
  descripcion    text,
  lineas         jsonb,         -- [{ cuenta, tercero_id, tercero_nombre, detalle, debito, credito }]
  total_debito   numeric,
  total_credito  numeric,
  estado         text,          -- activo | reversado
  firma          text,
  reversa_de     text,
  reversado_por  text,
  creado_por     text,
  creado         text
);

create index if not exists asientos_tenant_idx on asientos (tenant_id);
create index if not exists asientos_doc_idx    on asientos (tenant_id, doc_id);
create index if not exists asientos_fecha_idx  on asientos (tenant_id, fecha);

-- 2) RLS + política (idéntica al resto de tablas) --------------
alter table asientos enable row level security;

do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'asientos') then
    execute (
      select string_agg(format('drop policy %I on public.asientos;', policyname), ' ')
      from pg_policies
      where schemaname = 'public' and tablename = 'asientos'
    );
  end if;

  execute 'create policy terminal_activada on asientos for all to authenticated using (true) with check (true)';
end $$;

-- 3) Realtime: agregar la tabla a la publicación --------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'asientos'
    ) then
      alter publication supabase_realtime add table asientos;
    end if;
  end if;
end $$;

-- 4) Verificación ---------------------------------------------
select 'tabla' as chequeo, count(*)::text as ok
from information_schema.tables
where table_schema = 'public' and table_name = 'asientos'
union all
select 'rls', rowsecurity::text from pg_tables
where schemaname = 'public' and tablename = 'asientos'
union all
select 'realtime', (count(*) > 0)::text from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'asientos';
