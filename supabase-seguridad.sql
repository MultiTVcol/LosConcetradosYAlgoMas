-- ============================================================
--  supabase-seguridad.sql — Protección de la base de datos
-- ============================================================
--
--  QUÉ HACE:
--    1. Agrega la columna pass_hash a usuarios (contraseñas cifradas).
--    2. Activa Row Level Security (RLS) en todas las tablas.
--    3. Crea políticas: SOLO los dispositivos activados (sesión de
--       Supabase Auth) pueden leer/escribir. La anon key sola queda
--       sin acceso a nada.
--
--  CÓMO USARLO (una vez por proyecto de Supabase):
--    1. Supabase Dashboard → Authentication → Users → "Add user"
--         Email:    pos@tunegocio.com   (el correo que tú quieras)
--         Password: una clave fuerte (esta es la "clave de activación")
--         Marca "Auto Confirm User".
--    2. Supabase Dashboard → SQL Editor → pega este archivo → Run.
--    3. Abre el POS en cada terminal: aparecerá la pantalla
--       "Activar esta terminal" → ingresa ese correo y clave.
--       Solo se hace una vez por computador.
--
--  PARA UN COMERCIO NUEVO: crea su proyecto de Supabase, corre el
--  SQL maestro de tablas, luego este archivo, y crea su usuario de
--  activación propio (paso 1).
--
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columna para contraseñas cifradas (hash PBKDF2)
-- ------------------------------------------------------------
alter table if exists usuarios add column if not exists pass_hash jsonb;
-- La columna password vieja queda en null (el POS la limpia solo);
-- nos aseguramos de que acepte null:
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'usuarios' and column_name = 'password') then
    alter table usuarios alter column password drop not null;
  end if;
exception when others then null;
end $$;

-- kvs necesita poder guardar valor nulo (el código admin pasa a hash en datos)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'kvs' and column_name = 'valor') then
    alter table kvs alter column valor drop not null;
  end if;
exception when others then null;
end $$;

-- ------------------------------------------------------------
-- 2) Activar RLS en todas las tablas del POS
-- ------------------------------------------------------------
alter table if exists productos   enable row level security;
alter table if exists ventas      enable row level security;
alter table if exists clientes    enable row level security;
alter table if exists compras     enable row level security;
alter table if exists proveedores enable row level security;
alter table if exists gastos      enable row level security;
alter table if exists usuarios    enable row level security;
alter table if exists kvs         enable row level security;
alter table if exists cierres     enable row level security;

-- ------------------------------------------------------------
-- 3) Políticas: acceso total SOLO para dispositivos activados
--    (rol "authenticated" = sesión iniciada con la cuenta del
--    comercio). La anon key sin sesión no puede ver ni tocar nada.
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['productos','ventas','clientes','compras','proveedores','gastos','usuarios','kvs','cierres']
  loop
    if exists (select 1 from information_schema.tables where table_name = t) then
      -- borrar políticas previas con el mismo nombre (idempotente)
      execute format('drop policy if exists terminal_activada on %I', t);
      execute format(
        'create policy terminal_activada on %I for all to authenticated using (true) with check (true)',
        t
      );
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4) Verificación (debería mostrar todas las tablas con RLS = true)
-- ------------------------------------------------------------
select tablename, rowsecurity as rls_activado
from pg_tables
where schemaname = 'public'
  and tablename in ('productos','ventas','clientes','compras','proveedores','gastos','usuarios','kvs','cierres')
order by tablename;
