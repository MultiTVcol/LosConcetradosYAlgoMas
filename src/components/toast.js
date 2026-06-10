/**
 * components/toast.js — Notificaciones flotantes (toasts)
 *
 * Muestra mensajes breves que aparecen arriba al centro, viven unos
 * segundos y desaparecen solos. Útiles para confirmar acciones
 * ("Guardado"), avisar errores ("Sin conexión") o dar feedback rápido.
 *
 * Uso típico:
 *   import { Toast } from '../components/index.js';
 *
 *   Toast.ok('Producto guardado');
 *   Toast.error('Error al imprimir');
 *   Toast.warn('Stock bajo');
 *   Toast.info('Sincronizando...');
 *
 * El CSS ya está definido en components.css con la clase .toast y
 * sus variantes .toast-ok, .toast-error, .toast-warn, .toast-info.
 */

// ============================================================
//  CONSTANTES
// ============================================================

/** Contenedor donde viven todos los toasts (se crea automáticamente) */
const CONTAINER_ID = 'toast-container';

/** Duración por defecto en milisegundos (3.5 segundos) */
const DURACION_DEFAULT = 3500;

/** Estilos para el contenedor (inline para no depender de CSS extra) */
const ESTILOS_CONTAINER = `
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
`;

// ============================================================
//  HELPERS INTERNOS
// ============================================================

/**
 * Garantiza que exista el contenedor de toasts en el DOM.
 * Si no existe, lo crea.
 */
function ensureContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.style.cssText = ESTILOS_CONTAINER;
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Devuelve el ícono SVG correspondiente al tipo de toast.
 */
function iconoPorTipo(tipo) {
  const iconos = {
    ok: '✓',
    error: '✕',
    warn: '!',
    info: 'i',
  };
  return iconos[tipo] || iconos.info;
}

/**
 * Crea y muestra un toast en pantalla.
 *
 * @param {string} mensaje - Texto a mostrar
 * @param {string} tipo - 'ok' | 'error' | 'warn' | 'info'
 * @param {number} duracion - Milisegundos antes de desaparecer
 */
function crearToast(mensaje, tipo = 'info', duracion = DURACION_DEFAULT) {
  const container = ensureContainer();

  // Crear el elemento del toast
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.style.cssText = `
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 16px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,.15), 0 8px 10px -6px rgba(0,0,0,.10);
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 280px;
    max-width: 420px;
    font-family: Inter, system-ui, sans-serif;
    font-size: 14px;
    color: #0f172a;
    pointer-events: auto;
    opacity: 0;
    transform: translateY(-20px);
    transition: opacity .25s ease, transform .25s ease;
  `;

  // Color del borde izquierdo según tipo
  const colorBorde = {
    ok: '#15803d',
    error: '#dc2626',
    warn: '#d97706',
    info: '#0284c7',
  };
  toast.style.borderLeft = `4px solid ${colorBorde[tipo] || colorBorde.info}`;

  // Crear el ícono
  const icono = document.createElement('div');
  icono.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: ${colorBorde[tipo] || colorBorde.info};
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 14px;
    flex-shrink: 0;
  `;
  icono.textContent = iconoPorTipo(tipo);

  // Crear el texto
  const texto = document.createElement('div');
  texto.textContent = mensaje;
  texto.style.cssText = `flex: 1; line-height: 1.4;`;

  // Botón de cerrar
  const cerrar = document.createElement('button');
  cerrar.textContent = '×';
  cerrar.style.cssText = `
    background: transparent;
    border: 0;
    color: #94a3b8;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  `;
  cerrar.onclick = () => removerToast(toast);

  // Armar el toast
  toast.appendChild(icono);
  toast.appendChild(texto);
  toast.appendChild(cerrar);
  container.appendChild(toast);

  // Animar la entrada (esperamos un frame para que el browser registre el estado inicial)
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-remover después de la duración
  if (duracion > 0) {
    setTimeout(() => removerToast(toast), duracion);
  }

  return toast;
}

/**
 * Anima la salida del toast y lo remueve del DOM.
 */
function removerToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-20px)';
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 250);
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Muestra un toast de éxito (verde).
 *
 * @param {string} mensaje - El texto a mostrar
 * @param {number} [duracion=3500] - Milisegundos antes de auto-cerrarse
 *
 * @example
 *   Toast.ok('Producto guardado correctamente');
 */
export function ok(mensaje, duracion) {
  return crearToast(mensaje, 'ok', duracion);
}

/**
 * Muestra un toast de error (rojo).
 *
 * @param {string} mensaje
 * @param {number} [duracion=3500]
 *
 * @example
 *   Toast.error('No se pudo guardar el producto');
 */
export function error(mensaje, duracion) {
  return crearToast(mensaje, 'error', duracion);
}

/**
 * Muestra un toast de advertencia (naranja).
 *
 * @param {string} mensaje
 * @param {number} [duracion=3500]
 *
 * @example
 *   Toast.warn('Stock bajo en algunos productos');
 */
export function warn(mensaje, duracion) {
  return crearToast(mensaje, 'warn', duracion);
}

/**
 * Muestra un toast informativo (azul).
 *
 * @param {string} mensaje
 * @param {number} [duracion=3500]
 *
 * @example
 *   Toast.info('Sincronizando datos...');
 */
export function info(mensaje, duracion) {
  return crearToast(mensaje, 'info', duracion);
}

/**
 * Limpia todos los toasts activos de la pantalla.
 *
 * @example
 *   Toast.clear();
 */
export function clear() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;
  const toasts = container.querySelectorAll('.toast');
  toasts.forEach(removerToast);
}