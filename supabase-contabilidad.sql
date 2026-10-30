-- ============================================================
--  supabase-contabilidad.sql
--  Tablas del módulo Contabilidad: asientos, terceros y documentos.
-- ============================================================
--
--  QUÉ HACE:
--    1. Crea las tablas `asientos`, `terceros` y `documentos` (si no existen).
--    2. Activa RLS con la misma política que el resto del POS
--       (solo terminales activadas / rol authenticated).
--    3. Las agrega a la publicación de Realtime.
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    Supabase Dashboard → SQL Editor → pega este archivo → Run.
--    (Se puede correr varias veces sin problema: es idempotente.)
--
--  NOTAS:
--    - Cada asiento es UNA fila con sus líneas en `lineas` (jsonb), igual
--      que los items de una venta. Los asientos nunca se borran: se
--      reversan con otro asiento (estado 'reversado' + reversado_por).
--    - `terceros` guarda la ficha tributaria (NIT, DV, RUT). Los clientes
--      y proveedores del POS usan el MISMO id en esta tabla.
--    - `documentos` guarda recibos de caja, egresos, notas, cotizaciones,
--      remisiones, órdenes de compra y traslados; lo propio de cada tipo
--      va en `data` (jsonb).
--    - La configuración contable, los periodos cerrados, los activos
--      fijos y las cuentas propias del PUC viven en `kvs`.
-- ============================================================

-- 1) Tablas ----------------------------------------------------
create table if not exists asientos (
  id             text primary key,
  tenant_id      text not null default 'default',
  numero         text,
  fecha          text,          -- 'YYYY-MM-DD'
  periodo        text,          -- 'YYYY-MM'
  origen_tipo    text,          -- venta | recaudo | compra | pago | gasto | baja | ajuste_inventario | apertura | manual | cierre | depreciacion | activo_compra | recibo_caja | egreso | nota_credito | nota_debito | traslado | reversion
  origen_id      text,
  doc_tabla      text,          -- tabla del documento fuente (ventas, compras, documentos…)
  doc_id         text,          -- id del documento fuente
  descripcion    text,
  lineas         jsonb,         -- [{ cuenta, tercero_id, tercero_nombre, detalle, debito, credito, activo_id? }]
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

create table if not exists terceros (
  id                 text primary key,
  tenant_id          text not null default 'default',
  tipo_doc           text,      -- CC | NIT | CE | PP | TI | PEP | NE
  numero_doc         text,
  dv                 text,
  tipo_persona       text,      -- natural | juridica
  nombre             text,
  nombre_comercial   text,
  roles              jsonb,     -- ['cliente','proveedor','empleado','otro']
  responsable_iva    boolean,
  responsabilidades  jsonb,     -- ['O-13','O-15',…]
  email              text,
  telefono           text,
  direccion          text,
  ciudad             text,
  departamento       text,
  activo             boolean,
  creado             text
);
create index if not exists terceros_tenant_idx on terceros (tenant_id);

create table if not exists documentos (
  id              text primary key,
  tenant_id       text not null default 'default',
  tipo            text,         -- recibo_caja | egreso | nota_credito | nota_debito | cotizacion | remision | orden_compra | traslado
  numero          text,
  fecha           text,
  estado          text,         -- activo | pendiente | facturada | convertida | recibida | anulado
  tercero_id      text,
  tercero_nombre  text,
  total           numeric,
  items           jsonb,
  data            jsonb,
  creado          text,
  creado_por      text
);
create index if not exists documentos_tenant_idx on documentos (tenant_id, tipo);

-- 2) RLS + política (idéntica al resto de tablas) --------------
do $$
declare t text;
begin
  foreach t in array array['asientos', 'terceros', 'documentos'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute (
        select string_agg(format('drop policy %I on public.%I;', policyname, t), ' ')
        from pg_policies where schemaname = 'public' and tablename = t
      );
    end if;
    execute format('create policy terminal_activada on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 3) Realtime: agregar las tablas a la publicación -------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['asientos', 'terceros', 'documentos'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- 4) Verificación ---------------------------------------------
select t.tabla,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tabla) as existe,
       (select rowsecurity from pg_tables where schemaname = 'public' and tablename = t.tabla) as rls,
       exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t.tabla) as realtime
from (values ('asientos'), ('terceros'), ('documentos')) as t(tabla);
