/**
 * core/router.js — Sistema de rutas simple (sin dependencias)
 *
 * Maneja la navegación entre módulos del POS sin recargar la página.
 * Usa el hash de la URL (#productos, #ventas, etc.) para que cada
 * pantalla sea "linkeable" y permita usar el botón "Atrás" del navegador.
 *
 * Uso típico:
 *   import { Router } from '../core/router.js';
 *
 *   // Registrar una ruta
 *   Router.registrar('productos', async (params) => {
 *     // params = { ... } extras pasados por el navegante
 *     return await import('../modules/productos/productos.js');
 *   });
 *
 *   // Navegar programáticamente
 *   Router.navegar('ventas');
 *
 *   // Iniciar el router (al arrancar la app)
 *   Router.iniciar({
 *     onCambio: (rutaActual) => {
 *       // Acá renderizamos el módulo activo
 *     },
 *     rutaInicial: 'ventas',
 *   });
 */

// ============================================================
//  ESTADO
// ============================================================

/** Mapa de rutas registradas: 'ventas' → función que carga el módulo */
const _rutas = new Map();

/** Callback que se ejecuta cuando cambia la ruta */
let _onCambio = null;

/** Ruta activa actualmente */
let _rutaActual = null;

/** Si ya se inicializó */
let _iniciado = false;

// ============================================================
//  HELPERS INTERNOS
// ============================================================

/**
 * Lee la ruta actual desde el hash de la URL.
 * Ejemplo: "#productos" → "productos"
 */
function leerHash() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return hash || null;
}

/**
 * Maneja el cambio de ruta (sea por hash o programático).
 */
async function manejarCambio() {
  const nueva = leerHash();
  if (nueva === _rutaActual) return;
  _rutaActual = nueva;

  if (typeof _onCambio === 'function') {
    try {
      await _onCambio(_rutaActual);
    } catch (err) {
      console.error('Router onCambio error:', err);
    }
  }
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Registra una ruta y la función que carga su módulo.
 *
 * @param {string} nombre - Identificador único ('ventas', 'productos', etc.)
 * @param {Function} cargador - async function que devuelve el módulo
 *
 * @example
 *   Router.registrar('productos', async () => {
 *     return await import('../modules/productos/productos.js');
 *   });
 */
export function registrar(nombre, cargador) {
  _rutas.set(nombre, cargador);
}

/**
 * Devuelve el cargador registrado para una ruta.
 *
 * @param {string} nombre
 * @returns {Function|null}
 */
export function obtenerCargador(nombre) {
  return _rutas.get(nombre) || null;
}

/**
 * Lista todas las rutas registradas.
 *
 * @returns {Array<string>}
 */
export function listarRutas() {
  return Array.from(_rutas.keys());
}

/**
 * Navega a una ruta. Actualiza el hash de la URL.
 *
 * @param {string} ruta
 *
 * @example
 *   Router.navegar('productos');
 */
export function navegar(ruta) {
  if (window.location.hash === `#${ruta}`) {
    // Ya estamos en esa ruta — forzar el cambio
    manejarCambio();
  } else {
    window.location.hash = `#${ruta}`;
  }
}

/**
 * Devuelve la ruta activa actualmente.
 *
 * @returns {string|null}
 */
export function rutaActual() {
  return _rutaActual;
}

/**
 * Inicia el router. Llamalo UNA sola vez al arrancar la app.
 *
 * @param {Object} opciones
 * @param {Function} opciones.onCambio - Callback (ruta) => void
 * @param {string} [opciones.rutaInicial] - Ruta por defecto si no hay hash
 *
 * @example
 *   Router.iniciar({
 *     onCambio: (ruta) => renderizarModulo(ruta),
 *     rutaInicial: 'ventas',
 *   });
 */
export function iniciar(opciones = {}) {
  if (_iniciado) {
    console.warn('Router ya iniciado, ignorando segunda llamada');
    return;
  }
  _iniciado = true;
  _onCambio = opciones.onCambio || null;

  // Escuchar cambios en el hash de la URL (incluye botón Atrás del navegador)
  window.addEventListener('hashchange', manejarCambio);

  // Si no hay hash y hay ruta inicial, navegar a ella
  const hashActual = leerHash();
  if (!hashActual && opciones.rutaInicial) {
    window.location.hash = `#${opciones.rutaInicial}`;
  } else {
    // Disparar el cambio inicial
    manejarCambio();
  }
}