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
