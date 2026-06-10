/**
 * core/strings.js — Helpers de manipulación de strings
 *
 * Funciones puras para manejar texto de forma segura.
 *
 * La más importante es esc(): la usamos SIEMPRE que mostramos texto del
 * usuario en pantalla (nombres de productos, clientes, comentarios) para
 * evitar ataques XSS.
 *
 * Uso típico:
 *   import { esc, uid, slug, truncate } from '../core/strings.js';
 *
 *   $('#nombre').innerHTML = esc(producto.nombre);
 *   const id = uid();
 */

/**
 * Escapa HTML para evitar inyecciones (XSS).
 *
 * Convierte caracteres peligrosos a su equivalente seguro:
 *   <  →  &lt;
 *   >  →  &gt;
 *   &  →  &amp;
 *   "  →  &quot;
 *   '  →  &#39;
 *
 * SIEMPRE usá esta función al mostrar texto que viene del usuario
 * dentro de innerHTML o templates `${...}` que renderizan HTML.
 *
 * Si NO escapás, alguien podría guardar un producto con nombre
 *   <script>alert('hack')</script>
 * y al renderizarlo el navegador ejecutaría el código.
 *
 * @param {string} s - El texto a escapar
 * @returns {string} - Texto seguro para insertar en HTML
 *
 * @example
 *   esc("<script>alert('hi')</script>")
 *   → "&lt;script&gt;alert(&#39;hi&#39;)&lt;/script&gt;"
 *
 *   esc("Juan & María")
 *   → "Juan &amp; María"
 *
 *   esc(null)
 *   → ""
 */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Genera un identificador único corto.
 *
 * Combina el timestamp actual + random para que sea:
 *   - Único: prácticamente imposible que se repita
 *   - Ordenable: los más nuevos siempre vienen después alfabéticamente
 *   - Corto: ~13 caracteres, fácil de leer/copiar
 *
 * Lo usamos para IDs de productos, facturas, clientes, compras, etc.
 *
 * @returns {string} - Algo como "lq8m3kab_p2xy7"
 *
 * @example
 *   uid()  → "lq8m3kab_p2xy7"
 *   uid()  → "lq8m3kac_d4r91"   (siguiente milisegundo)
 */
export function uid() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Convierte un texto a "slug" (URL-friendly).
 *
 * Útil para nombres de archivo, IDs legibles, rutas de URL, etc.
 *   - Pasa todo a minúscula
 *   - Quita acentos (á → a)
 *   - Reemplaza espacios y símbolos por guion
 *   - Quita guiones duplicados o al inicio/final
 *
 * @param {string} s - El texto a convertir
 * @returns {string} - Slug limpio
 *
 * @example
 *   slug("Pollos Asados")          → "pollos-asados"
 *   slug("Cliente #1: Juan")       → "cliente-1-juan"
 *   slug("Niño   Bonito")          → "nino-bonito"
 *   slug("¡Oferta especial!")      → "oferta-especial"
 */
export function slug(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')                   // separa la letra del acento
    .replace(/[\u0300-\u036f]/g, '')    // quita los acentos
    .replace(/[^a-z0-9]+/g, '-')        // todo lo que no sea letra/número → guion
    .replace(/^-+|-+$/g, '');           // quita guiones del inicio/final
}

/**
 * Trunca un texto a N caracteres, agregando "…" si se cortó.
 *
 * Útil para mostrar nombres largos en celdas de tablas, tarjetas, etc.
 *
 * @param {string} s - El texto a truncar
 * @param {number} max - Largo máximo (incluyendo el "…")
 * @returns {string}
 *
 * @example
 *   truncate("Hola mundo cómo estás", 10)   → "Hola mund…"
 *   truncate("Corto", 10)                    → "Corto"
 *   truncate(null, 10)                       → ""
 */
export function truncate(s, max) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Capitaliza la primera letra de un texto.
 *
 * @param {string} s
 * @returns {string}
 *
 * @example
 *   cap("hola mundo")  → "Hola mundo"
 *   cap("CAPS")        → "CAPS"
 *   cap("")            → ""
 */
export function cap(s) {
  if (s == null || s === '') return '';
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}