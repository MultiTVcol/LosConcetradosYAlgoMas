/**
 * app/ui-kit.js — Componentes visuales reutilizables (Design System)
 *
 * Helpers que devuelven HTML como string para mantener un lenguaje
 * visual consistente en todos los módulos: encabezados de página y
 * tarjetas KPI estilo ERP empresarial (Stripe/Linear).
 *
 * No tienen lógica de negocio: reciben datos ya calculados y los pintan.
 */

import { esc } from '../core/strings.js';
import * as Dropdown from '../components/dropdown.js';

/**
 * Encabezado premium de un módulo: título + descripción + acciones.
 *
 * @param {Object} o
 * @param {string} [o.icono]       - Nombre del ícono Lucide
 * @param {string} o.titulo        - Título grande (H1)
 * @param {string} [o.descripcion] - Texto secundario corto
 * @param {string} [o.acciones]    - HTML de los botones de acción (derecha)
 */
export function pageHeader({ icono = '', titulo = '', descripcion = '', acciones = '' } = {}) {
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px">
      <div style="min-width:0">
        <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0;color:#111827;display:flex;align-items:center;gap:10px">
          ${icono ? `<i data-lucide="${esc(icono)}" style="width:24px;height:24px;color:#2563eb;stroke-width:2"></i>` : ''}
          ${esc(titulo)}
        </h1>
        ${descripcion ? `<p style="margin:6px 0 0;color:#6b7280;font-size:14px;line-height:1.5">${esc(descripcion)}</p>` : ''}
      </div>
      ${acciones ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${acciones}</div>` : ''}
    </div>
  `;
}

/**
 * Tarjeta KPI: número destacado + etiqueta + texto secundario + ícono.
 *
 * @param {Object} o
 * @param {string} o.label    - Etiqueta superior
 * @param {string} o.valor    - Valor destacado (puede traer formato/markup)
 * @param {string} [o.sub]    - Texto secundario pequeño (puede traer markup)
 * @param {string} [o.icono]  - Ícono Lucide discreto
 * @param {string} [o.color]  - Color hex de 6 dígitos para el acento del ícono
 */
export function kpiCard({ label = '', valor = '', sub = '', icono = '', color = '#2563eb' } = {}) {
  return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px 20px;box-shadow:0 1px 2px rgba(15,23,42,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
        <span style="font-size:12.5px;color:#6b7280;font-weight:600">${esc(label)}</span>
        ${icono ? `<span style="width:30px;height:30px;border-radius:9px;background:${color}14;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i data-lucide="${esc(icono)}" style="width:16px;height:16px;color:${color};stroke-width:2"></i></span>` : ''}
      </div>
      <div style="font-size:27px;font-weight:700;color:#111827;letter-spacing:-0.02em;line-height:1.1">${valor}</div>
      ${sub ? `<div style="font-size:12px;color:#9ca3af;margin-top:6px">${sub}</div>` : ''}
    </div>
  `;
}

/**
 * Grilla responsive de tarjetas KPI.
 *
 * @param {Array<Object>} items - Lista de configs para kpiCard()
 */
export function kpiGrid(items = []) {
  if (!items || items.length === 0) return '';
  return `
    <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-bottom:24px">
      ${items.map(kpiCard).join('')}
    </div>
  `;
}

/**
 * Badge de estado con color suave.
 *
 * @param {string} label - Texto del badge
 * @param {string} [tipo] - success | warn | danger | info | neutral
 */
export function badge(label, tipo = 'neutral') {
  const t = ['success', 'warn', 'danger', 'info', 'neutral'].includes(tipo) ? tipo : 'neutral';
  return `<span class="ui-badge ui-badge--${t}">${esc(label)}</span>`;
}

/* Paleta de avatares (bg suave + texto fuerte) — asignada por nombre */
const AVATAR_COLORS = [
  ['#dbeafe', '#1d4ed8'], // azul
  ['#dcfce7', '#166534'], // verde
  ['#ede9fe', '#6d28d9'], // violeta
  ['#fef3c7', '#92400e'], // ámbar
  ['#fce7f3', '#9d174d'], // rosa
  ['#cffafe', '#0e7490'], // cian
  ['#ffedd5', '#9a3412'], // naranja
];

/**
 * Botón de menú contextual (⋮) para una fila de tabla.
 * Marcar con la clase `.ui-menu-btn` y `data-id` para luego cablearlo
 * con `wireMenus()`.
 *
 * @param {string} id - Identificador de la fila (queda en data-id)
 */
export function menuButton(id) {
  return `
    <button class="ui-menu-btn" data-id="${esc(id)}" type="button" title="Acciones" aria-label="Acciones">
      <i data-lucide="more-vertical" style="width:18px;height:18px;stroke-width:2"></i>
    </button>
  `;
}

/**
 * Cablea todos los botones `.ui-menu-btn` de un contenedor con un menú
 * desplegable. Para cada uno construye las opciones según su id y
 * delega la selección.
 *
 * @param {HTMLElement} contenedor
 * @param {(id:string)=>Array<Object>} buildOpciones - opciones por fila
 *        (cada una: { label, value, icono?, color?, separador?, disabled? })
 * @param {(value:string, id:string)=>void} onSelect
 */
export function wireMenus(contenedor, buildOpciones, onSelect) {
  if (!contenedor) return;
  contenedor.querySelectorAll('.ui-menu-btn').forEach((btn) => {
    const id = btn.dataset.id;
    Dropdown.crear({
      trigger: btn,
      alineacion: 'right',
      anchoMinimo: 184,
      opciones: buildOpciones(id) || [],
      onSelect: (op) => { try { onSelect(op.value, id); } catch (e) { console.error('wireMenus onSelect:', e); } },
    });
  });
}

/** Iniciales (1-2 letras) a partir de un nombre. */
export function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
  return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
}

/**
 * Avatar circular con iniciales. Color estable derivado del nombre.
 *
 * @param {string} nombre
 */
export function avatar(nombre) {
  const s = String(nombre || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [bg, fg] = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `<span class="ui-avatar" style="background:${bg};color:${fg}">${esc(iniciales(nombre))}</span>`;
}
