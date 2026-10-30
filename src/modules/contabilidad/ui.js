/**
 * modules/contabilidad/ui.js — Piezas visuales compartidas por las
 * pestañas de Contabilidad (tarjetas, tablas, selector de cuentas,
 * exportar e imprimir).
 */

import * as PUC from './puc.repo.js';
import { esc } from '../../core/strings.js';
import { money } from '../../core/format.js';
import { fmtDate } from '../../core/dates.js';
import { exportarExcel } from '../../core/excel.js';
import { imprimirCarta } from '../../services/printer.js';
import { config as appConfig } from '../../services/config.js';

export const tarjeta = (titulo, cuerpo, extra = '') => `
  <div style="background:#fff;border:1px solid #EADFD0;border-radius:16px;padding:20px 22px;margin-bottom:18px">
    ${titulo || extra ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <h2 style="margin:0;font-size:16px;font-weight:700;color:#2A1A10">${titulo}</h2>${extra}
    </div>` : ''}
    ${cuerpo}
  </div>`;

export const th = (t, der = false) => `<th style="text-align:${der ? 'right' : 'left'};padding:8px 10px;font-size:12px;color:#7D6858;font-weight:600;border-bottom:1px solid #EADFD0;white-space:nowrap">${t}</th>`;

export const td = (t, der = false, estilo = '') => `<td style="text-align:${der ? 'right' : 'left'};padding:8px 10px;font-size:13px;color:#2A1A10;border-bottom:1px solid #F3ECE3;${der ? 'font-variant-numeric:tabular-nums;white-space:nowrap;' : ''}${estilo}">${t}</td>`;

export const tabla = (cabeza, filas) => `
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr>${cabeza}</tr></thead><tbody>${filas}</tbody>
  </table></div>`;

export const vacio = (texto) => `<div style="color:#7D6858;font-size:14px">${texto}</div>`;

export const aviso = (html, tipo = 'info') => {
  const c = {
    info: ['#FBF7F1', '#EADFD0', '#5C4636'],
    ok: ['#ECFDF3', '#B7EBC9', '#14532D'],
    warn: ['#FEF3C7', '#F5D78A', '#7A4B00'],
    error: ['#FDECEC', '#F5C2C2', '#8A1C1C'],
  }[tipo];
  return `<div style="background:${c[0]};border:1px solid ${c[1]};color:${c[2]};border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px;line-height:1.5">${html}</div>`;
};

export const campo = (label, control, ayuda = '') => `
  <div>
    <label class="lbl">${label}</label>${control}
    ${ayuda ? `<div style="font-size:12px;color:#A8957F;margin-top:6px">${ayuda}</div>` : ''}
  </div>`;

/** Saldo con signo legible: los negativos en gris entre paréntesis. */
export const saldo = (v) => (v < 0 ? `<span style="color:#7D6858">(${money(-v)})</span>` : money(v));

/**
 * <datalist> con las cuentas de movimiento, para usar en
 * <input list="puc-lista">. Se escribe el código o el nombre.
 */
export async function datalistCuentas(id = 'puc-lista', soloMovimiento = true) {
  const cuentas = soloMovimiento ? await PUC.cuentasMovimiento() : await PUC.listar();
  return `<datalist id="${id}">${cuentas.map((c) => `<option value="${c.codigo} — ${esc(c.nombre)}"></option>`).join('')}</datalist>`;
}

/** "110505 — Caja general" → "110505" (o el texto tal cual si ya es código). */
export const codigoDe = (texto) => (String(texto || '').match(/^\s*(\d{1,8})/) || [])[1] || '';

/** Encabezado de un reporte impreso (nombre del negocio, título, rango). */
export function encabezadoImpresion(titulo, subtitulo = '') {
  const n = appConfig.negocio || {};
  return `
    <div style="text-align:center;margin-bottom:18px;font-family:Figtree,system-ui,sans-serif">
      <div style="font-size:18px;font-weight:800">${esc(n.nombre || '')}</div>
      ${n.nit ? `<div style="font-size:12px">NIT ${esc(n.nit)}</div>` : ''}
      <div style="font-size:16px;font-weight:700;margin-top:8px">${esc(titulo)}</div>
      ${subtitulo ? `<div style="font-size:12px;color:#555">${esc(subtitulo)}</div>` : ''}
    </div>`;
}

export function imprimir(titulo, subtitulo, cuerpoHtml) {
  imprimirCarta(`
    <div style="font-family:Figtree,system-ui,sans-serif;color:#000;font-size:12px">
      ${encabezadoImpresion(titulo, subtitulo)}${cuerpoHtml}
      <div style="margin-top:28px;font-size:10px;color:#666;text-align:right">Generado el ${fmtDate(new Date().toISOString().slice(0, 10))}</div>
    </div>`, { titulo });
}

export function exportar(filas, columnas, nombre) {
  exportarExcel(filas, columnas, nombre, 'Contabilidad');
}

/** Tabla jerárquica (clase → grupo → cuenta → subcuenta) para estados. */
export function filasArbol(nodos, { nivelMax = 6 } = {}) {
  return nodos.filter((n) => n.nivel <= nivelMax).map((n) => {
    const peso = n.nivel <= 2 ? 'font-weight:700;' : n.nivel === 4 ? 'font-weight:600;' : '';
    const sangria = { 1: 0, 2: 12, 4: 24, 6: 36, 8: 48 }[n.nivel] || 0;
    return `<tr>${td(`<span style="padding-left:${sangria}px;${peso}">${esc(n.codigo)} ${esc(n.nombre)}</span>`)}${td(saldo(n.valor), true, peso)}</tr>`;
  }).join('');
}
