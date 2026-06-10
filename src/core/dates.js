/**
 * core/dates.js — Helpers de manejo de fechas
 *
 * Manejar fechas en JavaScript es notoriamente complicado:
 *   - Hay 3 formatos comunes y los navegadores los interpretan distinto
 *   - Hay problemas con zonas horarias
 *   - `new Date('2026-06-07')` puede dar el día 6 si estás en zona negativa
 *
 * Por eso centralizamos TODAS las operaciones de fecha en este archivo.
 *
 * Formato estándar que usamos internamente:
 *   ISO date:     'YYYY-MM-DD'           (ej: '2026-06-07')
 *   ISO datetime: 'YYYY-MM-DDTHH:mm:ss'  (ej: '2026-06-07T14:30:00')
 *
 * Para mostrar al usuario, usamos formato es-CO:
 *   '07/06/2026', '07/06/2026 14:30'
 *
 * Uso típico:
 *   import { todayISO, fmtDate, diffDays } from '../core/dates.js';
 *
 *   const factura = { fecha: todayISO(), ... };
 *   $('#fecha').textContent = fmtDate(factura.fecha);
 */

/**
 * Devuelve la fecha de HOY en formato ISO (YYYY-MM-DD), zona horaria local.
 *
 * Usá esto para guardar fechas en la base de datos (facturas, compras, etc.).
 *
 * IMPORTANTE: usa la zona horaria LOCAL del navegador, no UTC.
 * Esto evita el bug clásico de que "hoy" aparezca como "ayer" si tu
 * zona es negativa (Colombia es UTC-5, así que era propenso a este error).
 *
 * @returns {string} - Ej: "2026-06-07"
 */
export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Devuelve la fecha + hora ACTUAL en formato ISO completo.
 *
 * Usá esto para timestamps de auditoría (createdAt, updatedAt).
 *
 * @returns {string} - Ej: "2026-06-07T14:30:00.000Z"
 */
export function nowISO() {
  return new Date().toISOString();
}

/**
 * Devuelve un objeto Date a partir de un string ISO, sin problemas de zona.
 *
 * Si le pasás 'YYYY-MM-DD', interpreta como medianoche LOCAL (no UTC).
 * Eso evita que "2026-06-07" se vuelva "2026-06-06 19:00" por UTC-5.
 *
 * Si le pasás algo inválido o vacío, devuelve null (no Date inválido).
 *
 * @param {string} iso - Fecha en formato ISO
 * @returns {Date | null}
 */
export function parseISO(iso) {
  if (!iso) return null;
  // Para 'YYYY-MM-DD' construimos la fecha manualmente en zona LOCAL
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }
  // Otros formatos: dejamos que Date los interprete
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formatea una fecha ISO al formato visual colombiano (DD/MM/YYYY).
 *
 * @param {string} iso - Fecha en formato ISO
 * @returns {string} - Ej: "07/06/2026", o "" si la fecha es inválida
 *
 * @example
 *   fmtDate("2026-06-07")  → "07/06/2026"
 *   fmtDate(null)          → ""
 */
export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formatea solo la hora (HH:mm).
 *
 * @param {string} iso - Fecha+hora en formato ISO
 * @returns {string} - Ej: "14:30"
 */
export function fmtTime(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Formatea fecha + hora juntas.
 *
 * @param {string} iso - Fecha+hora en formato ISO
 * @returns {string} - Ej: "07/06/2026 14:30"
 */
export function fmtDateTime(iso) {
  const fecha = fmtDate(iso);
  const hora = fmtTime(iso);
  if (!fecha) return '';
  return hora ? `${fecha} ${hora}` : fecha;
}

/**
 * Calcula la diferencia en DÍAS entre dos fechas ISO.
 *
 * Devuelve número positivo si `b` es posterior a `a`, negativo si es anterior.
 *
 * @param {string} a - Fecha inicial
 * @param {string} b - Fecha final
 * @returns {number}
 *
 * @example
 *   diffDays("2026-06-07", "2026-06-10")  → 3
 *   diffDays("2026-06-10", "2026-06-07")  → -3
 */
export function diffDays(a, b) {
  const dA = parseISO(a);
  const dB = parseISO(b);
  if (!dA || !dB) return 0;
  const ms = dB.getTime() - dA.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Suma N días a una fecha ISO. Devuelve otra fecha ISO.
 *
 * Usá número negativo para restar días.
 *
 * @param {string} iso - Fecha base
 * @param {number} n - Cantidad de días a sumar (puede ser negativo)
 * @returns {string} - Nueva fecha ISO
 *
 * @example
 *   addDays("2026-06-07", 5)   → "2026-06-12"
 *   addDays("2026-06-07", -7)  → "2026-05-31"
 */
export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return '';
  d.setDate(d.getDate() + Number(n));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Devuelve el primer día del mes de la fecha dada.
 *
 * @param {string} [iso] - Fecha base (default: hoy)
 * @returns {string} - Ej: "2026-06-01"
 */
export function startOfMonth(iso = todayISO()) {
  const d = parseISO(iso);
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

/**
 * Devuelve el último día del mes de la fecha dada.
 *
 * @param {string} [iso] - Fecha base (default: hoy)
 * @returns {string} - Ej: "2026-06-30"
 */
export function endOfMonth(iso = todayISO()) {
  const d = parseISO(iso);
  if (!d) return '';
  // Truco: el día 0 del mes siguiente es el último día del mes actual
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const yyyy = last.getFullYear();
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}