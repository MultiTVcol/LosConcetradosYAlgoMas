/**
 * services/realtime.js — Gestor global de Realtime
 *
 * Se conecta a todas las tablas sincronizables al inicio de sesión.
 * Mantiene un bus de eventos que cualquier módulo puede escuchar para
 * refrescar su vista cuando llega un cambio remoto.
 */

import * as Sync from './sync.js';

/** Tablas que sincronizamos en vivo */
const TABLAS = [
  'productos',
  'clientes',
  'ventas',
  'compras',
  'proveedores',
  'gastos',
  'usuarios',
  'kvs',
];

/** Listeners globales: módulos que quieren saber cuándo algo cambió */
const _listeners = new Map();   // tabla → Set<callback>

/** Suscripciones activas (para poder limpiarlas al logout) */
const _suscripciones = [];

/** Estado de conexión por tabla: { 'productos': true/false } */
const _estado = new Map();

/** Listeners de estado global */
const _estadoListeners = new Set();

/**
 * Cleanups de la VISTA ACTUAL. Cada `escuchar()` lo registra aquí.
 * Al cambiar de módulo, el shell llama `detenerVistaActual()` y se
 * desuscriben todos los listeners del módulo anterior. Esto evita que,
 * por ejemplo, el dashboard siga escuchando cambios en productos cuando
 * el usuario está en otra pantalla (lo que causaba re-renders incorrectos).
 */
let _cleanupsVista = [];

// ============================================================
//  ARRANQUE / PARADA
// ============================================================

/**
 * Inicia la sincronización en vivo de todas las tablas.
 * Llamar después del login y de inicializar Supabase.
 */
export function iniciar() {
  if (_suscripciones.length > 0) return; // ya iniciado

  if (!Sync.estaActiva()) {
    console.info('ℹ️ Realtime no iniciado (sync no activa)');
    return;
  }

  for (const tabla of TABLAS) {
    _estado.set(tabla, false);

    const off = Sync.suscribir(tabla, (evento) => {
      // Notificar a los módulos suscritos a esta tabla
      const set = _listeners.get(tabla);
      if (set) {
        for (const cb of set) {
          try { cb(evento); } catch (e) { console.warn('Listener error:', e); }
        }
      }
    });
    _suscripciones.push(off);
  }

  // Observar estado de conexión a través de eventos de Sync
  Sync.onChange((e) => {
    if (e.tipo === 'realtime-conectado') {
      _estado.set(e.tabla, true);
      notificarCambioEstado();
    } else if (e.tipo === 'realtime-desconectado') {
      _estado.set(e.tabla, false);
      notificarCambioEstado();
    }
  });
}

/**
 * Detiene todas las suscripciones (al cerrar sesión).
 */
export function detener() {
  for (const off of _suscripciones) {
    try { off(); } catch (e) { /**/ }
  }
  _suscripciones.length = 0;
  _listeners.clear();
  _estado.clear();
  Sync.cerrarTodosCanales();
}

// ============================================================
//  SUSCRIPCIÓN DE MÓDULOS
// ============================================================

/**
 * Permite a un módulo escuchar cambios remotos en una tabla.
 *
 * @param {string} tabla - 'productos', 'ventas', etc.
 * @param {Function} callback - se ejecuta con { tabla, evento, item, viejo }
 * @returns {Function} - función para desuscribir
 *
 * @example
 *   // En productos.view.js, al montar:
 *   const off = Realtime.escuchar('productos', () => recargarLista());
 *   // En el cleanup (al salir del módulo):
 *   off();
 */
export function escuchar(tabla, callback) {
  if (!_listeners.has(tabla)) _listeners.set(tabla, new Set());
  _listeners.get(tabla).add(callback);
  const off = () => {
    const set = _listeners.get(tabla);
    if (set) set.delete(callback);
  };
  // Registrar el cleanup para la vista actual
  _cleanupsVista.push(off);
  return off;
}

/**
 * Suscribe a varios módulos a la vez. Útil para vistas que muestran datos
 * de múltiples tablas (Dashboard, Reportes, Cierre de Caja).
 *
 * @param {string[]} tablas
 * @param {Function} callback
 * @returns {Function} - función para desuscribir todas
 */
export function escucharVarias(tablas, callback) {
  const offs = tablas.map((t) => escuchar(t, callback));
  return () => offs.forEach((off) => off());
}

/**
 * Limpia TODAS las suscripciones de la vista actual. El shell la llama
 * automáticamente cada vez que el usuario cambia de módulo, evitando
 * que listeners de pantallas anteriores sigan activos y re-rendericen
 * encima del módulo nuevo.
 */
export function detenerVistaActual() {
  for (const off of _cleanupsVista) {
    try { off(); } catch (e) { /**/ }
  }
  _cleanupsVista = [];
}

// ============================================================
//  ESTADO DE CONEXIÓN
// ============================================================

export function tablasConectadas() {
  return Array.from(_estado.entries())
    .filter(([, conectada]) => conectada)
    .map(([t]) => t);
}

export function todoConectado() {
  if (_estado.size === 0) return false;
  for (const conectada of _estado.values()) {
    if (!conectada) return false;
  }
  return true;
}

/**
 * Suscribirse a cambios en el estado de conexión (para UI tipo badge).
 */
export function onEstadoChange(callback) {
  _estadoListeners.add(callback);
  // Notificar estado actual inmediatamente
  try { callback(estadoActual()); } catch (e) { /**/ }
  return () => _estadoListeners.delete(callback);
}

function notificarCambioEstado() {
  const estado = estadoActual();
  for (const cb of _estadoListeners) {
    try { cb(estado); } catch (e) { /**/ }
  }
}

function estadoActual() {
  return {
    activo: Sync.realtimeActivo(),
    tablas: tablasConectadas(),
    total: TABLAS.length,
  };
}
