/**
 * components/index.js — Archivo "barril" de los componentes UI
 *
 * Re-exporta todos los componentes desde un único punto, para que el
 * resto del sistema los importe con una sola línea:
 *
 *   import {
 *     Toast,
 *     Modal,
 *     Confirm,
 *     Autocomplete,
 *     Dropdown,
 *   } from '../components/index.js';
 *
 * Componentes disponibles:
 *   - Toast        → Notificaciones flotantes (ok, error, warn, info)
 *   - Modal        → Ventanas emergentes genéricas
 *   - Confirm      → Diálogos sí/no con Promesa (preguntar, peligro, exito, aviso)
 *   - Autocomplete → Buscador con sugerencias en tiempo real
 *   - Dropdown     → Menú desplegable con opciones
 *
 * Fase 5 completa. Próxima fase: módulos del POS (ventas, productos, etc.)
 */

// ============================================================
//  TOAST — Notificaciones flotantes
//  Uso: Toast.ok('Mensaje'), Toast.error('Error'), etc.
// ============================================================
export * as Toast from './toast.js';

// ============================================================
//  MODAL — Ventanas emergentes
//  Uso: Modal.abrir({ titulo, contenido, ancho, ... })
// ============================================================
export * as Modal from './modal.js';

// ============================================================
//  CONFIRM — Diálogos de confirmación con Promesa
//  Uso: const ok = await Confirm.preguntar('¿Continuar?')
// ============================================================
export * as Confirm from './confirmBox.js';

// ============================================================
//  AUTOCOMPLETE — Buscador con sugerencias
//  Uso: Autocomplete.crear({ input, items, campoTexto, onSelect, ... })
// ============================================================
export * as Autocomplete from './autocomplete.js';

// ============================================================
//  DROPDOWN — Menú desplegable
//  Uso: Dropdown.crear({ trigger, opciones, onSelect, ... })
// ============================================================
export * as Dropdown from './dropdown.js';