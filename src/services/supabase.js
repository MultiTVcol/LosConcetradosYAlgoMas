/**
 * services/supabase.js — Cliente y helpers de Supabase
 *
 * Wrapper alrededor del cliente Supabase. Se inicializa una sola vez
 * al importarse, lee las credenciales de `config.js` y queda listo
 * para que el resto del sistema haga consultas.
 *
 * Estrategia:
 *   - Si las credenciales NO están configuradas → modo "solo local"
 *     (el sistema sigue funcionando con IndexedDB, sin nube)
 *   - Si las credenciales están OK → conexión establecida
 *
 * Uso típico:
 *   import * as Supa from '../services/supabase.js';
 *
 *   // Insertar un producto
 *   await Supa.upsert('productos', producto);
 *
 *   // Leer todos los productos del tenant actual
 *   const productos = await Supa.selectAll('productos');
 *
 *   // Acceso al cliente raw (para queries complejas)
 *   const { data, error } = await Supa.client.from('productos').select('*');
 */

import { config, isSupabaseConfigured } from './config.js';

// ============================================================
//  ESTADO INTERNO
// ============================================================

/** Cliente Supabase (null hasta que se inicialice) */
let _client = null;

/** Indica si la conexión está activa */
let _ready = false;

/** TenantId actual (se lee de config) */
const TENANT_ID = config.supabase.tenantId || 'default';

// ============================================================
//  INICIALIZACIÓN
// ============================================================

/**
 * Crea el cliente Supabase usando las credenciales de config.js.
 * Se llama automáticamente al importar este módulo.
 *
 * Tolerante a errores: si algo falla, _client queda en null y el
 * sistema sigue funcionando solo con IndexedDB.
 */
function initClient() {
  // Verificar que el SDK de Supabase haya cargado (script CDN en index.html)
  if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) {
    console.warn('⚠️ Supabase SDK no disponible. ¿Falta el <script> en index.html?');
    return;
  }

  // Verificar que las credenciales estén configuradas
  if (!isSupabaseConfigured()) {
    console.info('ℹ️ Supabase no configurado (modo solo local activo)');
    return;
  }

  try {
    _client = window.supabase.createClient(
      config.supabase.url,
      config.supabase.anonKey,
      {
        auth: { persistSession: false },
      }
    );
    _ready = true;
    console.log(`☁️ Supabase conectado (tenant: ${TENANT_ID})`);
  } catch (err) {
    console.error('❌ Error inicializando Supabase:', err);
    _client = null;
    _ready = false;
  }
}

// Auto-inicialización al importar este módulo
initClient();

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Indica si Supabase está conectado y listo para usar.
 * Útil para que los módulos sepan si pueden sincronizar o no.
 *
 * @returns {boolean}
 */
export function isReady() {
  return _ready;
}

/**
 * Espera a que Supabase esté listo (el SDK del CDN puede cargar
 * después que main.js). Se rinde tras `timeoutMs` y devuelve false.
 *
 * @param {number} timeoutMs - tiempo máximo a esperar
 * @returns {Promise<boolean>}
 */
export function waitForReady(timeoutMs = 3000) {
  if (_ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      // Intentar inicializar si aún no se ha hecho (puede que el SDK
      // del CDN no estuviera disponible al cargar el module)
      if (!_ready) initClient();
      if (_ready) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * Cliente Supabase raw. Usalo solo si necesitás funciones avanzadas
 * que no están en los helpers de este archivo (realtime, storage, auth).
 *
 * @returns {Object|null} - El cliente, o null si no está inicializado
 */
export function getClient() {
  return _client;
}

/**
 * El tenant_id actual (cliente activo).
 * Lo agregamos automáticamente a todas las inserciones.
 */
export const tenantId = TENANT_ID;

/**
 * Inserta o actualiza UN registro en una tabla.
 * Agrega automáticamente el campo tenant_id.
 *
 * @param {string} tabla - Nombre de la tabla ('productos', 'ventas', etc.)
 * @param {Object} item - El registro a guardar (debe tener `id`)
 * @returns {Promise<Object|null>} - El registro guardado, o null si falló
 *
 * @example
 *   await Supa.upsert('productos', { id: 'p1', nombre: 'Alimento', precio: 50000 });
 */
export async function upsert(tabla, item) {
  if (!_ready) {
    console.warn(`⚠️ Supabase no disponible. No se sincronizó ${tabla}/${item.id}`);
    return null;
  }
  if (!item || !item.id) {
    throw new Error(`Supa.upsert: el item debe tener un campo 'id'`);
  }

  // Garantizar que el tenant_id esté presente
  const payload = { ...item, tenant_id: TENANT_ID };

  const { data, error } = await _client
    .from(tabla)
    .upsert(payload)
    .select()
    .single();

  if (error) {
    console.error(`❌ Error en Supa.upsert(${tabla}):`, error.message);
    throw error;
  }
  return data;
}

/**
 * Lee todos los registros de una tabla, filtrando por el tenant actual.
 *
 * @param {string} tabla - Nombre de la tabla
 * @returns {Promise<Array>} - Array de registros (vacío si no hay)
 *
 * @example
 *   const productos = await Supa.selectAll('productos');
 */
export async function selectAll(tabla) {
  if (!_ready) {
    console.warn(`⚠️ Supabase no disponible. selectAll(${tabla}) devolvió vacío.`);
    return [];
  }

  const { data, error } = await _client
    .from(tabla)
    .select('*')
    .eq('tenant_id', TENANT_ID);

  if (error) {
    console.error(`❌ Error en Supa.selectAll(${tabla}):`, error.message);
    return [];
  }
  return data || [];
}

/**
 * Lee UN registro por su ID, verificando que pertenezca al tenant actual.
 *
 * @param {string} tabla - Nombre de la tabla
 * @param {string} id - ID del registro
 * @returns {Promise<Object|null>}
 *
 * @example
 *   const p = await Supa.selectOne('productos', 'p1');
 */
export async function selectOne(tabla, id) {
  if (!_ready) return null;

  const { data, error } = await _client
    .from(tabla)
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`❌ Error en Supa.selectOne(${tabla}, ${id}):`, error.message);
    return null;
  }
  return data;
}

/**
 * Borra un registro por su ID (solo dentro del tenant actual).
 *
 * @param {string} tabla - Nombre de la tabla
 * @param {string} id - ID del registro a borrar
 * @returns {Promise<boolean>} - true si se borró
 *
 * @example
 *   await Supa.remove('productos', 'p1');
 */
export async function remove(tabla, id) {
  if (!_ready) return false;

  const { error } = await _client
    .from(tabla)
    .delete()
    .eq('tenant_id', TENANT_ID)
    .eq('id', id);

  if (error) {
    console.error(`❌ Error en Supa.remove(${tabla}, ${id}):`, error.message);
    return false;
  }
  return true;
}

/**
 * Hace un "ping" simple a Supabase para verificar la conexión.
 * Intenta leer la tabla `productos` con LIMIT 1.
 *
 * @returns {Promise<{ok: boolean, mensaje: string}>}
 *
 * @example
 *   const r = await Supa.ping();
 *   console.log(r.ok ? '✅' : '❌', r.mensaje);
 */
export async function ping() {
  if (!_ready) {
    return { ok: false, mensaje: 'Supabase no inicializado' };
  }

  try {
    const { error } = await _client.from('productos').select('id').limit(1);
    if (error) {
      return { ok: false, mensaje: `Error: ${error.message}` };
    }
    return { ok: true, mensaje: `Conectado al tenant '${TENANT_ID}'` };
  } catch (err) {
    return { ok: false, mensaje: `Excepción: ${err.message}` };
  }
}