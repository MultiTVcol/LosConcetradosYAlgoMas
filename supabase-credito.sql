-- ============================================================
--  supabase-credito.sql
--  Columnas para VENTAS a crédito (cuentas por cobrar) y para las
--  CUENTAS POR PAGAR de migración en compras.
-- ============================================================
--
--  POR QUÉ: el POS agregó campos nuevos a las ventas/compras. Supabase
--  rechaza el guardado si la tabla no tiene esas columnas
--  ("Could not find the 'abonos' column of 'ventas'").
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    Supabase Dashboard → SQL Editor → pega este archivo → Run.
--    Es idempotente (add column if not exists): se puede correr varias
--    veces sin problema.
--
--  NOTA sobre mayúsculas: las columnas camelCase van entre comillas
--  ("tipoPago") para conservar el nombre EXACTO que envía el POS.
-- ============================================================

-- VENTAS — ventas a crédito (lo que deben los clientes) ---------
alter table ventas add column if not exists "tipoPago" text;
alter table ventas add column if not exists saldo      numeric;
alter table ventas add column if not exists vence      text;
alter table ventas add column if not exists abonos     jsonb;

-- COMPRAS — cuentas por pagar de migración (sin inventario) ------
-- (tipoPago/saldo/vence/abonos ya pueden existir por las compras a
--  crédito; el "if not exists" las deja igual si ya están)
alter table compras add column if not exists "tipoPago"      text;
alter table compras add column if not exists saldo           numeric;
alter table compras add column if not exists vence           text;
alter table compras add column if not exists abonos          jsonb;
alter table compras add column if not exists origen          text;
alter table compras add column if not exists "sinInventario" boolean;

-- Verificación: listar las columnas relevantes -----------------
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ventas', 'compras')
  and column_name in ('tipoPago', 'saldo', 'vence', 'abonos', 'origen', 'sinInventario')
order by table_name, column_name;
