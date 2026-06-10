/**
 * core/dom.js — Helpers de selección del DOM
 *
 * Atajos para document.querySelector / querySelectorAll que usamos en TODA
 * la app. Son funciones puras: les das un selector CSS y te devuelven el
 * o los elementos del DOM.
 *
 * Uso típico:
 *   import { $, $$ } from '../core/dom.js';
 *
 *   const btn   = $('#guardar');        // primer elemento que coincida (o null)
 *   const cards = $$('.card');          // array con TODOS los que coincidan
 *
 * Por qué un atajo: `document.querySelector` es muy largo de escribir cuando
 * lo usás 200 veces. `$()` es lo estándar en jQuery, React, Vue y prácticamente
 * cualquier proyecto JS — por eso lo mantenemos así.
 */

/**
 * Devuelve el primer elemento que coincida con el selector CSS.
 * Si no hay coincidencia, devuelve null (NO tira error).
 *
 * @param {string} selector - Un selector CSS válido (ej: '#id', '.clase', 'div > p')
 * @param {ParentNode} [root=document] - Opcional: limitar la búsqueda a un sub-árbol
 * @returns {Element | null}
 *
 * @example
 *   const titulo = $('#pageTitle');
 *   const dentro = $('.btn', miCard);  // busca solo dentro de miCard
 */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Devuelve un ARRAY con todos los elementos que coincidan con el selector.
 *
 * Importante: devuelve un Array real (no un NodeList), para poder usar
 * .map(), .filter(), .forEach() directamente sin convertirlo.
 *
 * @param {string} selector - Un selector CSS válido
 * @param {ParentNode} [root=document] - Opcional: limitar la búsqueda a un sub-árbol
 * @returns {Element[]} - Array vacío si no hay coincidencias
 *
 * @example
 *   $$('.card').forEach(c => c.classList.add('view'));
 *   const ids = $$('input[name=qty]').map(i => i.value);
 */
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}