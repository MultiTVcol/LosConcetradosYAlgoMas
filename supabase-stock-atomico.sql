-- ============================================================
--  supabase-stock-atomico.sql — Stock atómico multi-caja
-- ============================================================
--
--  QUÉ HACE:
--    Crea la función `ajustar_stock` que suma/resta unidades al stock
--    DENTRO de la base de datos, en una sola operación atómica.
--
--  POR QUÉ:
--    Antes el POS hacía "leer stock → calcular → guardar la fila".
--    Si dos cajas vendían el mismo producto al mismo tiempo, una
--    resta pisaba a la otra y el inventario quedaba mal. Con esta
--    función, cada venta envía solo el delta (-2, +10) y Postgres
--    garantiza que ninguna resta se pierde.
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    SQL Editor → pegar este archivo → Run.
--    (Para un comercio nuevo: correrlo junto con el SQL maestro de
--     tablas y supabase-seguridad.sql.)
--
-- ============================================================

create or replace function ajustar_stock(
  p_id     text,
  p_tenant text,
  p_delta  numeric,
  p_costo  numeric default null
)
returns numeric
language sql
volatile
as $$
  update productos
     set stock = coalesce(stock, 0) + p_delta,
         costo = coalesce(p_costo, costo)
   where id = p_id
     and tenant_id = p_tenant
  returning stock;
$$;

-- Solo las terminales activadas (rol authenticated) pueden ejecutarla.
-- La función corre con los permisos del invocador, así que también
-- respeta las políticas RLS de la tabla productos.
revoke execute on function ajustar_stock(text, text, numeric, numeric) from public;
revoke execute on function ajustar_stock(text, text, numeric, numeric) from anon;
grant  execute on function ajustar_stock(text, text, numeric, numeric) to authenticated;

-- ------------------------------------------------------------
--  Verificación: debe devolver una fila con la función creada
-- ------------------------------------------------------------
select proname as funcion, provolatile as volatilidad
from pg_proc
where proname = 'ajustar_stock';
