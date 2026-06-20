-- ============================================================
--  PosPunto · Cierre de caja POR CAJERO
--  Sella en cada movimiento quién lo registró, para poder
--  hacer el cierre filtrando por cajero.
--
--  POR QUÉ: el POS agregó los campos "cajero" y "cajero_id" a
--  ventas, gastos y compras. Supabase rechaza columnas que no
--  existen ("Could not find the 'cajero' column of 'ventas'"),
--  así que hay que crearlas. Mientras no se ejecute, el guardado
--  LOCAL sigue funcionando y la nube reintenta sola después.
--
--  Cómo correrlo: Supabase → SQL Editor → pega esto → Run.
--  Es idempotente: se puede ejecutar varias veces sin problema.
-- ============================================================

-- VENTAS ----------------------------------------------------
alter table ventas  add column if not exists cajero     text;
alter table ventas  add column if not exists cajero_id  text;

-- GASTOS ----------------------------------------------------
alter table gastos  add column if not exists cajero     text;
alter table gastos  add column if not exists cajero_id  text;

-- COMPRAS ---------------------------------------------------
alter table compras add column if not exists cajero     text;
alter table compras add column if not exists cajero_id  text;

-- USUARIOS — prefijo de numeración por cajero ----------------
-- El admin asigna a cada cajero un prefijo (A, B, C…) en Usuarios.
-- Sus ventas se numeran A-0001, B-0001… para no repetir folios.
alter table usuarios add column if not exists prefijo    text;

-- Nota: los abonos llevan su propio cajero DENTRO del jsonb
-- "abonos" (no requieren columna nueva).

-- Verificación (opcional)
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ventas', 'gastos', 'compras')
  and column_name in ('cajero', 'cajero_id')
order by table_name, column_name;
