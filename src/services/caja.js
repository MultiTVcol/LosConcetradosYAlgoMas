/**
 * services/caja.js — Identidad LOCAL de esta caja / terminal.
 *
 * Se guarda SOLO en este equipo (localStorage). NUNCA se sincroniza, para que
 * cada computador tenga su propio prefijo de numeración (A, B, C…). Así, si dos
 * cajas venden al mismo tiempo en computadores distintos, sus facturas usan
 * series independientes (A-0001, B-0001…) y nunca se repite el número.
 *
 * Si una caja no tiene prefijo configurado, se usa 'V' (compatibilidad con el
 * histórico de ventas, que ya venían como V-0001).
 */

const KEY = 'pospunto.caja';

/** Deja solo letras/números, en mayúsculas, máximo 4 caracteres. */
export function normalizarPrefijo(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** Lee la caja de este equipo: { prefijo, nombre }. */
export function getCaja() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      prefijo: normalizarPrefijo(o.prefijo),
      nombre: String(o.nombre || ''),
    };
  } catch (e) {
    return { prefijo: '', nombre: '' };
  }
}

/** Guarda la caja de este equipo (solo local). Devuelve lo guardado. */
export function setCaja({ prefijo, nombre } = {}) {
  const limpio = {
    prefijo: normalizarPrefijo(prefijo),
    nombre: String(nombre || '').trim().slice(0, 40),
  };
  try { localStorage.setItem(KEY, JSON.stringify(limpio)); } catch (e) { /* localStorage no disponible */ }
  return limpio;
}

/** Prefijo a usar en la numeración de ventas ('V' si no hay caja configurada). */
export function prefijoNumeracion() {
  return getCaja().prefijo || 'V';
}
