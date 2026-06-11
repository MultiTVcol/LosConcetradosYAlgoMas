/**
 * services/sync.js — Sincronización entre IndexedDB (local) y Supabase (nube)
 *
 * Estrategia offline-first:
 *   1. Toda escritura va PRIMERO al local (IndexedDB) — instantáneo, siempre
 *      funciona aunque no haya internet.
 *   2. En paralelo, se intenta subir a Supabase.
 *   3. Si la nube falla (sin internet, error del servidor), el sistema NO
 *      rompe. Sigue funcionando con los datos locales.
 *   4. Cuando vuelve la conexión, se puede llamar a `flushPendientes()`
 *      para subir lo que faltó.
 *
 * Uso típico:
 *   import { Sync } from '../services/index.js';
 *
 *   // Guardar un producto (escribe local + intenta nube)
 *   await Sync.guardar('productos', producto);
 *
 *   // Bajar todo lo que hay en la nube al local
 *   await Sync.descargar('productos');
 *
 *   // Reintentar lo que quedó pendiente
 *   await Sync.flushPendientes();
 */

import * as db from './db.js';
import * as Supa from './supabase.js';
import { isFeatureEnabled, config, isSupabaseConfigured } from './config.js';

// ============================================================
//  ESTADO INTERNO
// ============================================================

/** Cola de operaciones que no se pudieron aplicar en la nube.
 *  Cada entrada: { tipo: 'upsert'|'delete', tabla, item?, id?, intentos }.
 *  Se persiste en localStorage para sobrevivir recargas/cierres de la
 *  pestaña — sin esto, lo vendido offline nunca llegaba a la nube. */
const _pendientes = [];

const PENDIENTES_KEY = 'pospunto:sync-pendientes';

function persistirPendientes() {
  try {
    localStorage.setItem(PENDIENTES_KEY, JSON.stringify(_pendientes));
  } catch (e) {
    // localStorage lleno o no disponible: la cola sigue en memoria
    console.warn('No se pudo persistir la cola de sync:', e);
  }
}

function restaurarPendientes() {
  try {
    const raw = localStorage.getItem(PENDIENTES_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      // Compatibilidad: entradas viejas sin 'tipo' eran upserts
      for (const p of arr) {
        if (!p.tipo) p.tipo = 'upsert';
        _pendientes.push(p);
      }
      if (_pendientes.length > 0) {
        console.log(`🔄 Sync: ${_pendientes.length} operación(es) pendiente(s) restauradas de la sesión anterior`);
      }
    }
  } catch (e) { /* JSON corrupto: ignorar */ }
}

restaurarPendientes();

/** Listeners que escuchan cambios de estado (online/offline, sync activo) */
const _listeners = [];

/** Canales de realtime activos por tabla: { 'productos': RealtimeChannel } */
const _canales = new Map();

/** Listeners por tabla: { 'productos': Set<Function> } */
const _realtimeListeners = new Map();

/** Tenant id (se filtra realtime para no recibir cambios de otros tenants) */
const TENANT_ID = config.supabase.tenantId || 'default';

// ============================================================
//  HELPERS INTERNOS
// ============================================================

/**
 * Indica si la sincronización está habilitada en la configuración.
 * Si el cliente desactivó `sincronizacionNube`, el sistema trabaja
 * solo en modo local sin intentar conexión.
 */
function sincronizacionActiva() {
  return isFeatureEnabled('sincronizacionNube') && Supa.isReady();
}

/**
 * Notifica a los listeners sobre un evento de sync.
 *
 * @param {Object} evento - { tipo, tabla, item, error }
 */
function emit(evento) {
  for (const listener of _listeners) {
    try {
      listener(evento);
    } catch (e) {
      console.error('Error en listener de sync:', e);
    }
  }
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Suscribirse a eventos de sincronización.
 * Útil para mostrar al usuario indicadores visuales ("sincronizando…").
 *
 * @param {Function} listener - Callback que recibe { tipo, tabla, item, error }
 * @returns {Function} - Función para desuscribirse
 *
 * @example
 *   const off = Sync.onChange((e) => console.log('Sync evento:', e));
 *   // luego...
 *   off(); // desuscribirse
 */
export function onChange(listener) {
  _listeners.push(listener);
  return () => {
    const idx = _listeners.indexOf(listener);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

/**
 * Guarda un item: SIEMPRE en local + (si hay nube) sube a Supabase.
 *
 * Esta es la función estrella. La mayoría del sistema va a llamar a esta
 * en lugar de tocar db o Supa directamente.
 *
 * @param {string} tabla - Nombre de la tabla ('productos', 'ventas', etc.)
 * @param {Object} item - Item a guardar (debe tener `id`)
 * @returns {Promise<{local: boolean, nube: boolean}>} - Estado de cada destino
 *
 * @example
 *   const r = await Sync.guardar('productos', {
 *     id: uid(), nombre: 'Alimento', precio: 50000
 *   });
 *   if (!r.nube) console.warn('Queda pendiente subir a la nube');
 */
export async function guardar(tabla, item) {
  if (!item || !item.id) {
    throw new Error(`Sync.guardar: el item debe tener un campo 'id'`);
  }

  const resultado = { local: false, nube: false };

  // 1) Escribir en local SIEMPRE (offline-first)
  try {
    await db.put(tabla, item);
    resultado.local = true;
    emit({ tipo: 'local-ok', tabla, item });
  } catch (err) {
    emit({ tipo: 'local-error', tabla, item, error: err });
    throw err; // Si falla el local, es grave: relanzamos
  }

  // 2) Intentar subir a la nube SI la sync está activa
  if (sincronizacionActiva()) {
    try {
      emit({ tipo: 'nube-intentando', tabla, item });
      await Supa.upsert(tabla, item);
      resultado.nube = true;
      emit({ tipo: 'nube-ok', tabla, item });
    } catch (err) {
      // No-throw: el local ya quedó guardado, no rompemos el flujo
      console.warn(`⚠️ Sync: fallo al subir ${tabla}/${item.id} a la nube. Queda pendiente.`);
      _pendientes.push({ tipo: 'upsert', tabla, item, intentos: 1 });
      persistirPendientes();
      emit({ tipo: 'nube-error', tabla, item, error: err });
    }
  } else if (isFeatureEnabled('sincronizacionNube') && isSupabaseConfigured()) {
    // La nube está configurada pero no disponible ahora (offline o SDK
    // cargando): encolar para subir cuando vuelva la conexión.
    _pendientes.push({ tipo: 'upsert', tabla, item, intentos: 0 });
    persistirPendientes();
  }

  return resultado;
}

/**
 * Borra un item: en local + (si hay nube) en Supabase.
 *
 * @param {string} tabla - Nombre de la tabla
 * @param {string} id - ID del item a borrar
 * @returns {Promise<{local: boolean, nube: boolean}>}
 *
 * @example
 *   await Sync.borrar('productos', 'p1');
 */
export async function borrar(tabla, id) {
  const resultado = { local: false, nube: false };

  try {
    await db.remove(tabla, id);
    resultado.local = true;
  } catch (err) {
    console.error(`❌ Error borrando ${tabla}/${id} en local:`, err);
    throw err;
  }

  if (sincronizacionActiva()) {
    try {
      const ok = await Supa.remove(tabla, id);
      if (!ok) throw new Error('remove devolvió false');
      resultado.nube = true;
    } catch (err) {
      console.warn(`⚠️ Sync: fallo al borrar ${tabla}/${id} en la nube. Queda pendiente.`);
      _pendientes.push({ tipo: 'delete', tabla, id, intentos: 1 });
      persistirPendientes();
    }
  } else if (isFeatureEnabled('sincronizacionNube') && isSupabaseConfigured()) {
    _pendientes.push({ tipo: 'delete', tabla, id, intentos: 0 });
    persistirPendientes();
  }

  return resultado;
}

/**
 * Descarga TODOS los items de una tabla desde la nube y los guarda en local.
 *
 * Útil cuando un dispositivo se conecta por primera vez o se necesita
 * forzar una resincronización.
 *
 * @param {string} tabla - Nombre de la tabla
 * @returns {Promise<number>} - Cantidad de items descargados
 *
 * @example
 *   const n = await Sync.descargar('productos');
 *   console.log(`${n} productos descargados`);
 */
export async function descargar(tabla) {
  if (!sincronizacionActiva()) {
    console.warn('⚠️ Sync no activa. No se puede descargar de la nube.');
    return 0;
  }

  emit({ tipo: 'descargando', tabla });

  try {
    const items = await Supa.selectAll(tabla);
    for (const item of items) {
      await db.put(tabla, item);
    }
    emit({ tipo: 'descargado', tabla, total: items.length });
    return items.length;
  } catch (err) {
    emit({ tipo: 'descarga-error', tabla, error: err });
    console.error(`❌ Error descargando ${tabla}:`, err);
    return 0;
  }
}

/**
 * Reintenta subir todos los items que quedaron pendientes (sin nube).
 * Llamala cuando detectes que volvió la conexión.
 *
 * @returns {Promise<{exitos: number, fallos: number}>}
 *
 * @example
 *   const r = await Sync.flushPendientes();
 *   console.log(`✅ ${r.exitos} subidos, ❌ ${r.fallos} aún pendientes`);
 */
export async function flushPendientes() {
  if (!sincronizacionActiva()) {
    return { exitos: 0, fallos: _pendientes.length };
  }
  if (_pendientes.length === 0) {
    return { exitos: 0, fallos: 0 };
  }

  let exitos = 0;
  let fallos = 0;
  const cola = [..._pendientes];
  _pendientes.length = 0; // Vaciar la cola

  for (const p of cola) {
    try {
      if (p.tipo === 'delete') {
        const ok = await Supa.remove(p.tabla, p.id);
        if (!ok) throw new Error('remove devolvió false');
      } else {
        await Supa.upsert(p.tabla, p.item);
      }
      exitos++;
    } catch (err) {
      p.intentos = (p.intentos || 0) + 1;
      _pendientes.push(p); // Volver a la cola
      fallos++;
    }
  }

  persistirPendientes();
  console.log(`🔄 Flush: ✅ ${exitos} subidos, ❌ ${fallos} aún pendientes`);
  return { exitos, fallos };
}

/**
 * Cuántos items quedaron pendientes de subir a la nube.
 *
 * @returns {number}
 */
export function pendientes() {
  return _pendientes.length;
}

/**
 * Indica si el sistema actualmente está sincronizando con la nube.
 *
 * @returns {boolean}
 */
export function estaActiva() {
  return sincronizacionActiva();
}

// ============================================================
//  REALTIME (suscripciones a cambios desde la nube)
// ============================================================

/**
 * Maneja un evento de postgres_changes recibido desde Supabase Realtime.
 * Aplica el cambio al IndexedDB local y notifica a los listeners.
 */
async function procesarCambioRemoto(tabla, payload) {
  try {
    const evento = payload.eventType;  // 'INSERT' | 'UPDATE' | 'DELETE'
    const nuevo = payload.new;
    const viejo = payload.old;

    // Si tenemos un objeto, validar que sea de este tenant
    const item = nuevo || viejo;
    if (item && item.tenant_id && item.tenant_id !== TENANT_ID) {
      return; // Otro tenant: ignorar
    }

    if (evento === 'INSERT' || evento === 'UPDATE') {
      if (nuevo && nuevo.id) {
        await db.put(tabla, nuevo);
      }
    } else if (evento === 'DELETE') {
      if (viejo && viejo.id) {
        try { await db.remove(tabla, viejo.id); } catch (e) { /* puede no existir */ }
      }
    }

    // Notificar a los listeners de esta tabla
    const set = _realtimeListeners.get(tabla);
    if (set) {
      for (const cb of set) {
        try { cb({ tabla, evento, item, viejo }); } catch (e) { console.warn('Error en listener realtime:', e); }
      }
    }
  } catch (err) {
    console.error(`Error procesando cambio realtime de ${tabla}:`, err);
  }
}

/**
 * Suscribe el listener a cambios remotos de una tabla específica.
 * Si todavía no había un canal abierto para esa tabla, lo crea automáticamente.
 *
 * El listener recibe { tabla, evento, item, viejo } cuando hay un cambio.
 *
 * @param {string} tabla - Nombre de la tabla (ej: 'productos')
 * @param {Function} callback - Se ejecuta en cada cambio
 * @returns {Function} - Función para desuscribirse
 *
 * @example
 *   const off = Sync.suscribir('productos', () => recargarLista());
 *   // luego, al desmontar la vista:
 *   off();
 */
export function suscribir(tabla, callback) {
  if (!sincronizacionActiva()) {
    console.warn(`⚠️ Realtime no disponible para ${tabla} (sync no activa).`);
    return () => {};
  }

  // Registrar el listener
  if (!_realtimeListeners.has(tabla)) _realtimeListeners.set(tabla, new Set());
  _realtimeListeners.get(tabla).add(callback);

  // Si no hay canal abierto para esa tabla, abrirlo
  if (!_canales.has(tabla)) {
    abrirCanal(tabla);
  }

  // Devolver función para desuscribir
  return () => {
    const set = _realtimeListeners.get(tabla);
    if (set) {
      set.delete(callback);
      // Si ya no quedan listeners, cerrar el canal
      if (set.size === 0) {
        cerrarCanal(tabla);
      }
    }
  };
}

/** Reintentos por tabla (para backoff exponencial). */
const _reintentos = new Map();

/** Timers de reconexión por tabla (para poder cancelarlos). */
const _timersReconexion = new Map();

/**
 * Programa la reapertura de un canal caído. Backoff exponencial:
 * 2s, 4s, 8s, 16s, 30s, 30s, 30s... (tope 30s).
 */
function programarReconexion(tabla) {
  // Si ya hay un timer programado, no encolar otro
  if (_timersReconexion.has(tabla)) return;

  const intento = (_reintentos.get(tabla) || 0) + 1;
  _reintentos.set(tabla, intento);

  // Backoff: 2s × 2^(n-1), tope 30s
  const delayMs = Math.min(30000, 2000 * Math.pow(2, intento - 1));

  // No spamear la consola con el intento: log solo cada 3
  if (intento === 1 || intento % 3 === 0) {
    console.warn(`📡 Realtime ${tabla}: reintento ${intento} en ${Math.round(delayMs / 1000)}s`);
  }

  const timer = setTimeout(() => {
    _timersReconexion.delete(tabla);
    // Solo reabrir si todavía hay listeners para esa tabla
    if (_realtimeListeners.has(tabla) && _realtimeListeners.get(tabla).size > 0) {
      // Cerrar canal viejo si quedó pegado
      const canalViejo = _canales.get(tabla);
      if (canalViejo) {
        try { Supa.getClient()?.removeChannel(canalViejo); } catch (e) { /**/ }
        _canales.delete(tabla);
      }
      abrirCanal(tabla);
    } else {
      // Ya nadie escucha, no reabrir
      _reintentos.delete(tabla);
    }
  }, delayMs);

  _timersReconexion.set(tabla, timer);
}

/**
 * Cancela un reintento programado de una tabla (cuando se reconectó manualmente).
 */
function cancelarReconexion(tabla) {
  const t = _timersReconexion.get(tabla);
  if (t) {
    clearTimeout(t);
    _timersReconexion.delete(tabla);
  }
  _reintentos.delete(tabla);
}

/**
 * Abre el canal de Supabase Realtime para una tabla.
 * Con auto-reconexión cuando se cae el WebSocket.
 */
function abrirCanal(tabla) {
  const client = Supa.getClient();
  if (!client) {
    console.warn(`Supabase no inicializado, no se puede suscribir a ${tabla}`);
    return;
  }

  const canalNombre = `pospunto:${TENANT_ID}:${tabla}`;
  const canal = client
    .channel(canalNombre)
    .on(
      'postgres_changes',
      {
        event: '*',  // INSERT, UPDATE, DELETE
        schema: 'public',
        table: tabla,
        filter: `tenant_id=eq.${TENANT_ID}`,
      },
      (payload) => procesarCambioRemoto(tabla, payload),
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        const habiaCaido = _reintentos.has(tabla);
        if (habiaCaido) {
          console.log(`📡 Realtime ${tabla}: ✅ reconectado tras ${_reintentos.get(tabla)} intento(s)`);
        } else {
          console.log(`📡 Realtime ${tabla}: conectado`);
        }
        // Limpiar reintentos
        cancelarReconexion(tabla);
        emit({ tipo: 'realtime-conectado', tabla });
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        // No spammear cada caída — el reintento ya tiene su propio log
        emit({ tipo: 'realtime-desconectado', tabla, error: err });
        // Programar reconexión
        programarReconexion(tabla);
      }
    });

  _canales.set(tabla, canal);
}

/**
 * Forzar reconexión de TODOS los canales caídos (al volver foco/internet).
 */
function reconectarTodos() {
  for (const tabla of _realtimeListeners.keys()) {
    // Si el canal no está activo, programar reconexión inmediata
    if (!_canales.has(tabla) || _reintentos.has(tabla)) {
      cancelarReconexion(tabla);
      // Reapertura inmediata
      const canalViejo = _canales.get(tabla);
      if (canalViejo) {
        try { Supa.getClient()?.removeChannel(canalViejo); } catch (e) { /**/ }
        _canales.delete(tabla);
      }
      abrirCanal(tabla);
    }
  }
}

// Reconectar cuando vuelve el foco a la pestaña o vuelve la red
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('🌐 Conexión recuperada, reconectando Realtime…');
    reconectarTodos();
    // Subir lo que quedó pendiente mientras no había internet.
    // Pequeño delay para que la conexión termine de estabilizarse.
    setTimeout(() => {
      flushPendientes().catch((e) => console.warn('Flush al reconectar falló:', e));
    }, 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Al volver a la pestaña, dar 500ms y revisar canales
      setTimeout(() => {
        // Solo reconectar si hay listeners y algún canal cayó
        let necesitaReconectar = false;
        for (const tabla of _realtimeListeners.keys()) {
          if (!_canales.has(tabla)) { necesitaReconectar = true; break; }
        }
        if (necesitaReconectar) reconectarTodos();
      }, 500);
    }
  });
}

/**
 * Cierra el canal de una tabla (definitivo — cancela reconexiones también).
 */
function cerrarCanal(tabla) {
  cancelarReconexion(tabla);
  const canal = _canales.get(tabla);
  if (canal) {
    try {
      const client = Supa.getClient();
      if (client) client.removeChannel(canal);
    } catch (e) { /**/ }
  }
  _canales.delete(tabla);
  _realtimeListeners.delete(tabla);
  console.log(`📡 Realtime ${tabla}: desconectado`);
}

/**
 * Cierra TODOS los canales activos.
 */
export function cerrarTodosCanales() {
  for (const tabla of Array.from(_canales.keys())) {
    cerrarCanal(tabla);
  }
}

/**
 * Indica si hay al menos un canal de realtime conectado.
 */
export function realtimeActivo() {
  return _canales.size > 0 && sincronizacionActiva();
}

/**
 * Devuelve la lista de tablas con realtime activo.
 */
export function tablasEnVivo() {
  return Array.from(_canales.keys());
}

// ============================================================
//  BORRADO MASIVO (local + nube)
// ============================================================

/**
 * Guarda muchos items en paralelo por lotes — mucho más rápido que un
 * await por cada uno. Ideal para imports y resets masivos.
 *
 * @param {string} tabla
 * @param {Array} items
 * @param {Object} opts - { batchSize?: 20, onProgress?: (n, total) => void }
 * @returns {Promise<{ok: number, fail: number}>}
 */
export async function guardarVarios(tabla, items, opts = {}) {
  const batchSize = opts.batchSize || 20;
  const onProgress = opts.onProgress || (() => {});
  let ok = 0, fail = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const lote = items.slice(i, i + batchSize);
    const resultados = await Promise.allSettled(
      lote.map((item) => guardar(tabla, item))
    );
    for (const r of resultados) {
      if (r.status === 'fulfilled') ok++; else fail++;
    }
    onProgress(Math.min(i + batchSize, items.length), items.length);
  }
  return { ok, fail };
}

/**
 * Borra TODOS los registros del tenant actual en una tabla, tanto en
 * IndexedDB local como en Supabase.
 *
 * @param {string} tabla
 * @returns {Promise<{ local: number, nube: number, error?: any }>}
 */
export async function vaciarTabla(tabla) {
  const resultado = { local: 0, nube: 0 };

  // 1) Contar y borrar local
  try {
    const todos = await db.getAll(tabla);
    resultado.local = todos.length;
    await db.clear(tabla);
  } catch (err) {
    console.error(`Error vaciando local ${tabla}:`, err);
    resultado.error = err;
    return resultado;
  }

  // 2) Borrar todo en la nube si está activa (DELETE WHERE tenant_id = X)
  if (sincronizacionActiva()) {
    try {
      const client = Supa.getClient();
      const tenantId = config.supabase.tenantId || 'default';
      const { count, error } = await client
        .from(tabla)
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId);
      if (error) throw error;
      resultado.nube = count || 0;
      emit({ tipo: 'tabla-vaciada', tabla, ...resultado });
    } catch (err) {
      console.error(`Error vaciando nube ${tabla}:`, err);
      resultado.error = err;
    }
  }

  return resultado;
}