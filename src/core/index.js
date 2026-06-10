/**
 * core/index.js — Archivo "barril" del core
 *
 * Re-exporta todos los helpers del núcleo desde un único punto:
 *
 *   import { $, money, todayISO, uid, esc, Router } from '../core/index.js';
 *
 * Helpers disponibles:
 *   - dom        → Selectores DOM ($, $$)
 *   - format     → Formato números/moneda (num, fmt, money, pct, round)
 *   - strings    → Manipulación strings (esc, uid, slug, truncate, cap)
 *   - dates      → Manejo de fechas (todayISO, fmtDate, parseISO, etc.)
 *   - Router     → Sistema de rutas/navegación entre módulos
 */

// DOM helpers
export { $, $$ } from './dom.js';

// Format helpers
export { num, fmt, money, pct, round } from './format.js';

// Strings helpers
export { esc, uid, slug, truncate, cap } from './strings.js';

// Dates helpers
export {
  todayISO,
  nowISO,
  parseISO,
  fmtDate,
  fmtTime,
  fmtDateTime,
  diffDays,
  addDays,
  startOfMonth,
  endOfMonth,
} from './dates.js';

// Router (sistema de navegación)
export * as Router from './router.js';