/**
 * modules/reportes/reportes-modulos.view.js — Reportes por módulos
 *
 * Menú de tarjetas + módulos de reportes:
 *   - Ventas:      por día / mes, por meses (12), por hora, métodos de pago, cajeros
 *   - Utilidades:  bruta y neta, por mes, por categoría, margen bajo o negativo
 *   - Productos:   más vendidos, más utilidad, menos vendidos, sin movimiento, ABC
 *   - Compras:     por proveedor, globalizado, cambios de costo, cuentas por pagar
 *
 * Todos comparten la barra de periodo (con comparación contra el periodo
 * anterior) y exportan a Excel (CSV), POS 80 mm e informe PDF (carta).
 *
 * Los datos los carga reportes.view.js y llegan en ctx.datos.
 */

import * as ConfigRepo from '../config/config.repo.js';
import * as PlantillaRepo from '../factura/plantilla.repo.js';
import { Toast } from '../../components/index.js';
import { imprimirCarta, imprimirPOS } from '../../services/printer.js';
import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { refrescarIconos } from '../../app/shell.js';

// ============================================================
//  ESTADO
// ============================================================

let _ctx = null;   // { contenedor, datos: { ventas, compras, gastos, productos }, navegar(v), abrirPlantilla(tipo) }
let _modulo = 'menu';
let _per = { preset: 'mes', desde: '', hasta: '', comparar: true };
let _tabProd = 'vendidos';
let _ordenProd = 'dinero';

export const MODULOS = ['ventas', 'utilidades', 'productos', 'compras'];

export function render(ctx, modulo) {
  _ctx = ctx;
  _modulo = modulo || 'menu';
  if (!_per.desde) {
    const [d, h] = rangoPreset('mes');
    _per.desde = d; _per.hasta = h;
  }
  pintar();
}

/** Re-pinta la vista actual con datos nuevos (realtime). */
export function refrescar(ctx) {
  _ctx = ctx;
  pintar();
}

// ============================================================
//  FECHAS Y PERIODOS
// ============================================================

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const pad = (n) => String(n).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sumarDias = (s, n) => { const d = deISO(s); d.setDate(d.getDate() + n); return isoDe(d); };
const diasEntre = (a, b) => Math.round((deISO(b) - deISO(a)) / 864e5);
const fechaBonita = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const dia = (x) => (x.fecha || '').slice(0, 10);

const PRESETS = [
  ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'],
  ['mesPasado', 'Mes pasado'], ['anio', 'Este año'], ['custom', 'Personalizado'],
];

function rangoPreset(p) {
  const hoy = todayISO();
  const d = deISO(hoy);
  switch (p) {
    case 'hoy': return [hoy, hoy];
    case 'ayer': { const a = sumarDias(hoy, -1); return [a, a]; }
    case 'semana': return [sumarDias(hoy, -((d.getDay() + 6) % 7)), hoy]; // semana de lunes a domingo
    case 'mesPasado': return [isoDe(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoDe(new Date(d.getFullYear(), d.getMonth(), 0))];
    case 'anio': return [hoy.slice(0, 4) + '-01-01', hoy];
    default: return [hoy.slice(0, 8) + '01', hoy];
  }
}

/**
 * Periodo anterior equivalente:
 *   - Esta semana → los mismos días de la semana pasada
 *   - Mes completo → el mes anterior completo
 *   - Rango dentro de un mes que arranca el día 1 → mismos días del mes anterior
 *   - Rango del año que arranca el 1 de enero → mismos días del año anterior
 *   - Cualquier otro → el mismo número de días justo antes
 */
function rangoAnterior(desde, hasta, preset = '') {
  if (preset === 'semana') return [sumarDias(desde, -7), sumarDias(hasta, -7)];
  if (desde.slice(8) === '01' && desde.slice(0, 7) === hasta.slice(0, 7)) {
    const i = deISO(desde);
    const ini = new Date(i.getFullYear(), i.getMonth() - 1, 1);
    const ultimo = new Date(i.getFullYear(), i.getMonth(), 0).getDate();
    const mesCompleto = sumarDias(hasta, 1).slice(8) === '01';
    return [isoDe(ini), isoDe(new Date(ini.getFullYear(), ini.getMonth(), mesCompleto ? ultimo : Math.min(Number(hasta.slice(8)), ultimo)))];
  }
  if (desde.slice(5) === '01-01' && desde.slice(0, 4) === hasta.slice(0, 4)) {
    const y = Number(desde.slice(0, 4)) - 1;
    return [`${y}-01-01`, `${y}${hasta.slice(4)}`];
  }
  const n = diasEntre(desde, hasta) + 1;
  return [sumarDias(desde, -n), sumarDias(hasta, -n)];
}

function textoRango(d, h) {
  return d === h ? fechaBonita(d) : `${fechaBonita(d)} – ${fechaBonita(h)}`;
}

// ============================================================
//  DATOS
// ============================================================

const vigentes = (arr) => (arr || []).filter((x) => x.estado !== 'anulada');
const enRango = (arr, a, b) => vigentes(arr).filter((x) => { const d = dia(x); return d >= a && d <= b; });
const ventasEn = (a, b) => enRango(_ctx.datos.ventas, a, b);
const comprasEn = (a, b) => enRango(_ctx.datos.compras, a, b);
const gastosEn = (a, b) => enRango(_ctx.datos.gastos, a, b);

function periodo() {
  const { desde, hasta, comparar, preset } = _per;
  const [pd, ph] = rangoAnterior(desde, hasta, preset);
  return { desde, hasta, pd, ph, comparar, valido: desde && hasta && desde <= hasta };
}

function resumenVentas(vs) {
  let total = 0, utilidad = 0, desc = 0, credito = 0;
  for (const v of vs) {
    total += num(v.total);
    utilidad += num(v.utilidad);
    desc += num(v.descuento);
    for (const it of v.items || []) desc += num(it.descuento) * num(it.cantidad);
    if (v.tipoPago === 'credito') credito += num(v.total);
  }
  const n = vs.length;
  return { total, utilidad, costo: total - utilidad, desc, credito, n, prom: n ? total / n : 0 };
}

const sumar = (arr, campo) => arr.reduce((s, x) => s + num(x[campo]), 0);

function mapaProductos() {
  const m = new Map();
  for (const p of _ctx.datos.productos || []) m.set(p.id, p);
  return m;
}

/**
 * Agrega las ventas por producto. El descuento global de cada venta se
 * reparte proporcionalmente entre sus ítems para que la suma cuadre con
 * el total de ventas y la utilidad del periodo.
 */
function porProducto(vs) {
  const prods = mapaProductos();
  const m = new Map();
  for (const v of vs) {
    const items = v.items || [];
    const bruto = (it) => num(it.total) || num(it.precio) * num(it.cantidad);
    const suma = items.reduce((s, it) => s + bruto(it), 0);
    const factor = suma > 0 ? num(v.total) / suma : 1;
    for (const it of items) {
      const id = it.producto_id || it.nombre;
      const p = prods.get(it.producto_id);
      const a = m.get(id) || { id, nombre: it.nombre || (p && p.nombre) || '—', categoria: (p && p.categoria) || 'Sin categoría', und: 0, venta: 0, costo: 0 };
      a.und += num(it.cantidad);
      a.venta += bruto(it) * factor;
      a.costo += num(it.costo) * num(it.cantidad);
      m.set(id, a);
    }
  }
  return [...m.values()].map((a) => ({ ...a, util: a.venta - a.costo, margen: a.venta > 0 ? (a.venta - a.costo) / a.venta * 100 : 0 }));
}

/** Agrupa por día (rangos ≤ 62 días) o por mes. Devuelve { claves, etiquetas, porDia }. */
function cubetas(desde, hasta) {
  const n = diasEntre(desde, hasta) + 1;
  if (n <= 62) {
    const claves = Array.from({ length: n }, (_, i) => sumarDias(desde, i));
    return { claves, etiquetas: claves.map((c) => String(Number(c.slice(8)))), porDia: true };
  }
  const claves = [];
  let d = deISO(desde.slice(0, 8) + '01');
  while (isoDe(d) <= hasta) { claves.push(isoDe(d).slice(0, 7)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return { claves, etiquetas: claves.map((c) => MESES[Number(c.slice(5)) - 1] + (claves.length > 12 ? ' ' + c.slice(2, 4) : '')), porDia: false };
}

function serie(lista, cub, desde, valor) {
  const pos = new Map(cub.claves.map((c, i) => [c, i]));
  const out = cub.claves.map(() => 0);
  for (const x of lista) {
    const d = dia(x);
    if (d < desde) continue;
    const i = pos.get(cub.porDia ? d : d.slice(0, 7));
    if (i != null) out[i] += valor(x);
  }
  return out;
}

const horaDe = (v) => {
  const d = new Date((v.data && v.data.timestamp) || '');
  return isNaN(d) ? null : d.getHours();
};

/** Horas de 7 a 19 ampliadas a las que tengan ventas (para rangos de un solo día). */
function cubetasHora(vs) {
  let ini = 7, fin = 19;
  for (const v of vs) { const h = horaDe(v); if (h != null) { ini = Math.min(ini, h); fin = Math.max(fin, h); } }
  const claves = [];
  for (let h = ini; h <= fin; h++) claves.push(h);
  return { claves, etiquetas: claves.map((h) => `${h}h`), porDia: true };
}

function seriePorHora(vs, cub) {
  const out = cub.claves.map(() => 0);
  for (const v of vs) { const i = cub.claves.indexOf(horaDe(v)); if (i >= 0) out[i] += num(v.total); }
  return out;
}

/** Últimos 12 meses terminando en el mes de `hasta`. */
function ultimos12(hasta) {
  const f = deISO(hasta);
  const claves = Array.from({ length: 12 }, (_, i) => isoDe(new Date(f.getFullYear(), f.getMonth() - 11 + i, 1)).slice(0, 7));
  return { claves, etiquetas: claves.map((c) => MESES[Number(c.slice(5)) - 1]), porDia: false };
}

function porMes12(arr, hasta, valor) {
  const cub = ultimos12(hasta);
  return { cub, datos: serie(vigentes(arr), cub, cub.claves[0] + '-01', valor) };
}

// ============================================================
//  FORMATO Y COMPONENTES
// ============================================================

const C = { azul: '#4A2E1A', verde: '#15803d', rojo: '#dc2626', ambar: '#a16207', morado: '#EE7623', gris: '#7D6858', tinta: '#2A1A10' };
const PALETA = ['#4A2E1A', '#EE7623', '#0891b2', '#db2777', '#a16207', '#15803d', '#A8957F'];

function corto(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 1e3) return Math.round(n / 1e3).toLocaleString('es-CO') + 'K';
  return String(Math.round(n));
}
const pctTxt = (n, dec = 1) => `${n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;

function delta(actual, anterior, invertir = false) {
  if (!anterior) return '';
  const d = (actual / anterior - 1) * 100;
  if (!isFinite(d)) return '';
  const bueno = invertir ? d <= 0 : d >= 0;
  return `<span style="color:${bueno ? C.verde : C.rojo};font-weight:700">${d >= 0 ? '▲' : '▼'} ${pctTxt(Math.abs(d))}</span>`;
}

function kpi(label, valor, color, nota, d = '') {
  return `
    <div style="background:white;border:1px solid #EADFD0;border-radius:12px;padding:16px 18px;min-width:0">
      <div style="font-size:11.5px;color:#7D6858;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color || C.tinta};letter-spacing:-0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${valor}</div>
      <div style="font-size:12.5px;margin-top:6px;color:#7D6858">${d ? d + ' ' : ''}${nota || ''}</div>
    </div>`;
}

function card(titulo, sub, cuerpo, extra = '') {
  return `
    <div style="background:white;border:1px solid #EADFD0;border-radius:12px;padding:20px;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><h3 style="font-size:15.5px;font-weight:700;margin:0;color:${C.tinta}">${titulo}</h3>
        ${sub ? `<div style="font-size:12.5px;color:#7D6858;margin-top:3px">${sub}</div>` : ''}</div>
        ${extra}
      </div>
      ${cuerpo}
    </div>`;
}

const grid = (cols, html, mb = 16) => `<div style="display:grid;gap:16px;grid-template-columns:${cols};margin-bottom:${mb}px">${html}</div>`;
const kpis = (html) => grid('repeat(auto-fit,minmax(170px,1fr))', html);
const dos = (html) => grid('repeat(auto-fit,minmax(min(380px,100%),1fr))', html);
const vacio = (msg) => `<div style="text-align:center;padding:28px;color:#A8957F;font-size:13.5px">${msg}</div>`;

function tabla(cab, filas, nums = [], pie = null) {
  if (!filas.length) return vacio('Sin datos en este periodo');
  const th = (c, i) => `<th style="text-align:${nums.includes(i) ? 'right' : 'left'};font-size:11px;color:#7D6858;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 10px;border-bottom:1px solid #EADFD0;background:#FBF7F1;white-space:nowrap">${c}</th>`;
  const td = (c, i, extra = '') => `<td style="padding:9px 10px;border-bottom:1px solid #F2EBE0;text-align:${nums.includes(i) ? 'right' : 'left'};font-variant-numeric:tabular-nums;${nums.includes(i) ? 'white-space:nowrap;' : ''}${extra}">${c}</td>`;
  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>${cab.map(th).join('')}</tr></thead>
        <tbody>${filas.map((f) => `<tr>${f.map((c, i) => td(c, i)).join('')}</tr>`).join('')}</tbody>
        ${pie ? `<tfoot><tr>${pie.map((c, i) => td(c, i, 'font-weight:800;background:#FBF7F1')).join('')}</tr></tfoot>` : ''}
      </table>
    </div>`;
}

const barrita = (v, max, color) => `<div style="width:90px;height:8px;border-radius:99px;background:#EADFD0;overflow:hidden;display:inline-block;vertical-align:middle"><div style="width:${max > 0 ? Math.max(0, v / max * 100) : 0}%;height:100%;background:${color};border-radius:99px"></div></div>`;
const etiqueta = (txt, bg, fg) => `<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${bg};color:${fg};white-space:nowrap">${txt}</span>`;

function leyenda(items) {
  return `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#7D6858;margin-top:8px">${items.map(([c, t]) => `<span style="display:inline-flex;gap:6px;align-items:center"><span style="width:10px;height:10px;border-radius:3px;background:${c}"></span>${t}</span>`).join('')}</div>`;
}

/** Barras SVG. `comp` (opcional) se dibuja detrás en gris. */
function barras(datos, etiquetas, { comp = null, color = C.azul, W = 760, H = 190, fmtTip = money } = {}) {
  if (!datos.some((v) => v) && !(comp && comp.some((v) => v))) return vacio('Sin movimientos en este periodo');
  const pad = 34;
  const max = Math.max(1, ...datos, ...(comp || [])) * 1.1;
  const n = datos.length, bw = (W - pad) / n;
  const cada = Math.ceil(n / 16);
  let s = `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" style="display:block" font-family="inherit">`;
  for (let k = 0; k <= 3; k++) {
    const y = H - (H - 10) * k / 3;
    s += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="#F2EBE0"/><text x="0" y="${y + 4}" font-size="10" fill="#A8957F">${corto(max * k / 3)}</text>`;
  }
  datos.forEach((v, i) => {
    const x = pad + i * bw;
    if (comp && comp[i]) {
      const hc = (H - 10) * Math.max(0, comp[i]) / max;
      s += `<rect x="${x + bw * 0.12}" y="${H - hc}" width="${bw * 0.76}" height="${hc}" rx="3" fill="#DCCFBE" opacity=".6"><title>Anterior: ${fmtTip(comp[i])}</title></rect>`;
    }
    const h = (H - 10) * Math.max(0, v) / max;
    s += `<rect x="${x + bw * 0.24}" y="${H - h}" width="${bw * 0.52}" height="${h}" rx="3" fill="${v < 0 ? C.rojo : color}"><title>${esc(etiquetas[i])}: ${fmtTip(v)}</title></rect>`;
    if (i % cada === 0) s += `<text x="${x + bw / 2}" y="${H + 16}" font-size="10.5" fill="#7D6858" text-anchor="middle">${esc(etiquetas[i])}</text>`;
  });
  return s + '</svg>';
}

function dona(partes) {
  const tot = partes.reduce((a, p) => a + p[1], 0);
  if (tot <= 0) return '';
  const r = 54, Cc = 2 * Math.PI * r;
  let ac = 0;
  let s = '<svg viewBox="0 0 140 140" width="140" height="140" style="flex-shrink:0"><g transform="rotate(-90 70 70)">';
  partes.forEach(([, v, c]) => {
    const l = Cc * v / tot;
    s += `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${c}" stroke-width="20" stroke-dasharray="${l} ${Cc - l}" stroke-dashoffset="${-ac}"/>`;
    ac += l;
  });
  return s + '</g></svg>';
}

function consejo(txt, tono = 'info') {
  const t = { info: ['#F8F1E8', '#1e40af', 'lightbulb'], bien: ['#f0fdf4', '#166534', 'trending-up'], mal: ['#fef2f2', '#991b1b', 'alert-circle'], ojo: ['#fffbeb', '#92400e', 'alert-triangle'] }[tono];
  return `<div style="margin-top:12px;padding:10px 12px;background:${t[0]};border-radius:9px;font-size:12.5px;color:${t[1]};font-weight:600;display:flex;gap:8px;align-items:flex-start"><i data-lucide="${t[2]}" style="width:15px;height:15px;flex-shrink:0;margin-top:1px"></i><span>${txt}</span></div>`;
}

// ============================================================
//  PINTAR
// ============================================================

const INFO = {
  ventas: { titulo: 'Ventas', icono: 'trending-up', color: C.azul, sub: 'Cuánto, cuándo, cómo y quién vende' },
  utilidades: { titulo: 'Utilidades', icono: 'piggy-bank', color: C.verde, sub: 'Lo que de verdad le queda al negocio' },
  productos: { titulo: 'Productos', icono: 'package', color: C.morado, sub: 'Qué se vende, qué deja plata y qué está quieto' },
  compras: { titulo: 'Compras', icono: 'truck', color: C.ambar, sub: 'Totales por proveedor, globalizado y costos' },
};

function construir() {
  const p = periodo();
  if (_modulo === 'ventas') return modVentas(p);
  if (_modulo === 'utilidades') return modUtilidades(p);
  if (_modulo === 'productos') return modProductos(p);
  if (_modulo === 'compras') return modCompras(p);
  return null;
}

function pintar() {
  const cont = _ctx.contenedor;
  let html;
  if (_modulo === 'menu' || !INFO[_modulo]) {
    _modulo = 'menu';
    html = htmlMenu();
  } else {
    const p = periodo();
    const cuerpo = p.valido
      ? construir().pantalla
      : `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;color:#991b1b;font-weight:600">La fecha "Desde" es posterior a "Hasta". Corrige el rango.</div>`;
    html = htmlEncabezado(INFO[_modulo]) + htmlPeriodo() + cuerpo;
  }
  cont.innerHTML = `<div id="rm-root" data-reportes style="padding:32px 40px;max-width:1280px">${html}</div>`;
  const root = cont.querySelector('#rm-root');
  refrescarIconos(root);
  adjuntarEventos(root);
}

function htmlEncabezado(info) {
  return `
    <button data-nav="menu" style="background:none;border:0;padding:0;margin-bottom:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:${C.azul};display:inline-flex;gap:4px;align-items:center">
      <i data-lucide="arrow-left" style="width:14px;height:14px"></i> Módulos de reportes
    </button>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:44px;height:44px;border-radius:12px;background:${info.color}1a;display:flex;align-items:center;justify-content:center">
          <i data-lucide="${info.icono}" style="width:24px;height:24px;color:${info.color}"></i>
        </div>
        <div>
          <h1 style="font-size:25px;font-weight:700;margin:0;color:${C.tinta};letter-spacing:-0.02em">${info.titulo}</h1>
          <div style="color:#7D6858;font-size:13.5px;margin-top:2px">${info.sub}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-acc="csv" style="${estiloBtn('#EADFD0', 'white', '#5C4636')}"><i data-lucide="file-spreadsheet" style="width:15px;height:15px"></i> Excel</button>
        <button data-acc="pos" style="${estiloBtn('#E3CDB4', '#F8F1E8', '#33200F')}"><i data-lucide="printer" style="width:15px;height:15px"></i> POS 80 mm</button>
        <button data-acc="pdf" style="${estiloBtn(C.azul, C.azul, 'white')};box-shadow:0 4px 12px -2px rgba(74, 46, 26,.35)"><i data-lucide="file-text" style="width:15px;height:15px"></i> Informe PDF</button>
      </div>
    </div>`;
}

const estiloBtn = (borde, fondo, texto) => `padding:9px 14px;border:1px solid ${borde};background:${fondo};color:${texto};border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;display:inline-flex;align-items:center;gap:6px`;

function htmlPeriodo() {
  const inp = 'padding:8px 10px;border:1px solid #DCCFBE;border-radius:8px;font-size:13px;font-family:inherit;outline:none';
  return `
    <div style="background:white;border:1px solid #EADFD0;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:space-between">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${PRESETS.map(([k, t]) => {
          const on = _per.preset === k;
          return `<button data-preset="${k}" style="padding:8px 13px;border:1px solid ${on ? C.azul : '#EADFD0'};background:${on ? C.azul : 'white'};color:${on ? 'white' : '#5C4636'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${t}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;color:#5C4636">
        <input type="date" data-fecha="desde" value="${esc(_per.desde)}" style="${inp}">
        <span>a</span>
        <input type="date" data-fecha="hasta" value="${esc(_per.hasta)}" style="${inp}">
        <label style="display:inline-flex;gap:8px;align-items:center;font-weight:600;cursor:pointer;margin-left:6px">
          <input type="checkbox" data-comparar ${_per.comparar ? 'checked' : ''} style="width:16px;height:16px;accent-color:${C.azul}">
          Comparar con periodo anterior
        </label>
      </div>
    </div>`;
}

// ============================================================
//  MENÚ
// ============================================================

function htmlMenu() {
  const hoy = todayISO();
  const ayer = sumarDias(hoy, -1);
  const [md, mh] = rangoPreset('mes');
  const [pd, ph] = rangoAnterior(md, mh);
  const vh = resumenVentas(ventasEn(hoy, hoy));
  const va = resumenVentas(ventasEn(ayer, ayer));
  const vm = resumenVentas(ventasEn(md, mh));
  const vp = resumenVentas(ventasEn(pd, ph));
  const gm = sumar(gastosEn(md, mh), 'monto');
  const gp = sumar(gastosEn(pd, ph), 'monto');

  const conPerdida = porProducto(ventasEn(md, mh)).filter((x) => x.util < -0.5).length;
  const subieron = cambiosCosto(comprasEn(md, mh)).filter((x) => x.cambio > 0).length;

  const mods = [
    ['ventas', 'trending-up', C.azul, 'Ventas', 'Diarias, semanales, mensuales, por meses y personalizado.', ['Por día y mes', 'Por hora', 'Por cajero', 'Métodos de pago'], null],
    ['utilidades', 'piggy-bank', C.verde, 'Utilidades', 'Lo que de verdad le queda al negocio.', ['Bruta y neta', 'Por mes', 'Por categoría', 'Margen bajo'],
      conPerdida ? [`${conPerdida} con pérdida este mes`, '#fee2e2', '#b91c1c'] : null],
    ['productos', 'package', C.morado, 'Productos', 'Qué se vende, qué deja plata y qué está quieto.', ['Más vendidos', 'Más utilidad', 'Sin movimiento', 'ABC'], null],
    ['compras', 'truck', C.ambar, 'Compras', 'Totales por proveedor y globalizado.', ['Por proveedor', 'Globalizado', 'Cambios de costo', 'Por pagar'],
      subieron ? [`${subieron} subieron de costo`, '#fef3c7', '#92400e'] : null],
  ];
  const proximos = [
    ['gauge', 'Tablero gerencial', 'Cómo va el negocio hoy, en una sola pantalla.'],
    ['boxes', 'Inventario', 'Valor, rotación y lo que hay que pedir.'],
    ['hand-coins', 'Clientes y cartera', 'Quién debe, desde cuándo y quién dejó de venir.'],
    ['wallet', 'Caja y gastos', 'Cierres, faltantes por cajero y gastos.'],
  ];

  const chip = (x) => `<span style="font-size:11px;padding:3px 8px;border-radius:6px;background:#F2EBE0;color:#5C4636;font-weight:600">${x}</span>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:12px">
        <i data-lucide="bar-chart-3" style="width:30px;height:30px;color:${C.azul};stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:${C.tinta};margin:0;letter-spacing:-0.02em">Reportes</h1>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-plantilla="reporte" title="Personaliza tu ticket de reporte POS 80mm" style="${estiloBtn('#E3CDB4', '#F8F1E8', '#33200F')}">Ticket de reporte</button>
        <button data-plantilla="cierre" title="Personaliza tu ticket de cierre de caja POS 80mm" style="${estiloBtn('#fde68a', '#fffbeb', '#92400e')}">Ticket de cierre</button>
      </div>
    </div>
    <div style="color:#7D6858;font-size:14px;margin:0 0 18px 42px">Elige un módulo para ver sus reportes.</div>

    ${kpis(`
      ${kpi('Ventas hoy', money(vh.total), C.azul, `vs ayer · ${vh.n} venta(s)`, delta(vh.total, va.total))}
      ${kpi('Utilidad hoy', money(vh.utilidad), C.verde, vh.total ? `margen ${pctTxt(vh.utilidad / vh.total * 100)}` : 'vs ayer', delta(vh.utilidad, va.utilidad))}
      ${kpi('Ventas del mes', money(vm.total), C.ambar, 'vs mismos días del mes pasado', delta(vm.total, vp.total))}
      ${kpi('Utilidad neta del mes', money(vm.utilidad - gm), vm.utilidad - gm >= 0 ? C.tinta : C.rojo, 'después de gastos', delta(vm.utilidad - gm, vp.utilidad - gp))}
    `)}

    ${grid('repeat(auto-fit,minmax(250px,1fr))', mods.map(([k, ic, col, t, d, chips, alerta]) => `
      <button data-nav="${k}" style="text-align:left;font-family:inherit;cursor:pointer;background:white;border:1px solid #EADFD0;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:box-shadow .15s,border-color .15s"
        onmouseover="this.style.borderColor='${col}';this.style.boxShadow='0 6px 18px -8px ${col}66'" onmouseout="this.style.borderColor='#EADFD0';this.style.boxShadow='none'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;gap:8px">
          <div style="width:42px;height:42px;border-radius:11px;background:${col}1a;display:flex;align-items:center;justify-content:center"><i data-lucide="${ic}" style="width:22px;height:22px;color:${col}"></i></div>
          ${alerta ? etiqueta(alerta[0], alerta[1], alerta[2]) : ''}
        </div>
        <div><div style="font-weight:700;font-size:16px;color:${C.tinta}">${t}</div><div style="font-size:12.5px;color:#7D6858;margin-top:3px;line-height:1.4">${d}</div></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${chips.map(chip).join('')}</div>
        <div style="margin-top:auto;font-size:13px;font-weight:700;color:${col};display:flex;gap:4px;align-items:center">Ver reportes <i data-lucide="arrow-right" style="width:14px;height:14px"></i></div>
      </button>`).join(''))}

    ${grid('repeat(auto-fit,minmax(250px,1fr))', `
      <button data-nav="general" style="text-align:left;font-family:inherit;cursor:pointer;background:#2A1A10;border:1px solid #2A1A10;border-radius:12px;padding:18px;display:flex;gap:14px;align-items:center;color:white;grid-column:1/-1">
        <div style="width:42px;height:42px;border-radius:11px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i data-lucide="clipboard-list" style="width:22px;height:22px;color:white"></i></div>
        <div style="flex:1"><div style="font-weight:700;font-size:15px">Informe financiero general</div><div style="font-size:12.5px;color:#A8957F;margin-top:2px">El reporte de siempre: estado de resultados, flujo de caja, por pagar, inventario y gastos, con su PDF y ticket.</div></div>
        <i data-lucide="arrow-right" style="width:18px;height:18px;color:#E3CDB4"></i>
      </button>
      ${proximos.map(([ic, t, d]) => `
        <div style="background:#FBF7F1;border:1px dashed #DCCFBE;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;opacity:.85">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="width:36px;height:36px;border-radius:10px;background:#EADFD0;display:flex;align-items:center;justify-content:center"><i data-lucide="${ic}" style="width:18px;height:18px;color:#7D6858"></i></div>
            ${etiqueta('Próximamente', '#EADFD0', '#5C4636')}
          </div>
          <div><div style="font-weight:700;font-size:14px;color:#5C4636">${t}</div><div style="font-size:12px;color:#A8957F;margin-top:2px">${d}</div></div>
        </div>`).join('')}
    `, 0)}
  `;
}

// ============================================================
//  MÓDULO: VENTAS
// ============================================================

function metodoDe(v) {
  return (String(v.metodo_pago || '').split(' ')[0] || (v.tipoPago === 'credito' ? 'Crédito' : '—')).replace(/[:,]$/, '');
}

function modVentas(p) {
  const vs = ventasEn(p.desde, p.hasta);
  const ant = p.comparar ? ventasEn(p.pd, p.ph) : [];
  const r = resumenVentas(vs);
  const ra = resumenVentas(ant);
  const dd = (a, b, inv) => (p.comparar ? delta(a, b, inv) : '');
  const vsTxt = p.comparar ? `vs ${textoRango(p.pd, p.ph)}` : '';

  // Serie del periodo (hora si es un solo día; si no, día o mes) + la del periodo anterior alineada
  const unDia = p.desde === p.hasta;
  const cub = unDia ? cubetasHora(vs.concat(ant)) : cubetas(p.desde, p.hasta);
  const datos = unDia ? seriePorHora(vs, cub) : serie(vs, cub, p.desde, (v) => num(v.total));
  let comp = null;
  if (p.comparar) {
    const sA = unDia ? seriePorHora(ant, cub) : serie(ant, cubetas(p.pd, p.ph), p.pd, (v) => num(v.total));
    comp = datos.map((_, i) => sA[i] || 0);
  }

  // Por meses (últimos 12)
  const m12 = porMes12(_ctx.datos.ventas, p.hasta, (v) => num(v.total));

  // Mapa de calor día × hora
  const calor = mapaCalor(vs);

  // Métodos de pago
  const met = new Map();
  for (const v of vs) met.set(metodoDe(v), (met.get(metodoDe(v)) || 0) + num(v.total));
  const metodos = [...met.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => [k, v, PALETA[i % PALETA.length]]);

  // Por cajero
  const caj = new Map();
  for (const v of vs) {
    const k = v.cajero || 'Sin cajero';
    const a = caj.get(k) || { total: 0, n: 0, desc: 0, util: 0 };
    a.total += num(v.total); a.n++; a.util += num(v.utilidad);
    a.desc += num(v.descuento) + (v.items || []).reduce((s, it) => s + num(it.descuento) * num(it.cantidad), 0);
    caj.set(k, a);
  }
  const cajeros = [...caj.entries()].sort((a, b) => b[1].total - a[1].total);

  const filasCaj = cajeros.map(([k, a]) => [esc(k), money(a.total), fmt(a.n), money(a.n ? a.total / a.n : 0), money(a.desc), r.total ? pctTxt(a.total / r.total * 100, 0) : '—']);
  const listaMet = metodos.map(([k, v, c]) => `
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:7px 0;border-bottom:1px solid #F2EBE0">
      <span style="display:inline-flex;gap:8px;align-items:center"><span style="width:10px;height:10px;border-radius:3px;background:${c}"></span>${esc(k)}</span>
      <span><b>${money(v)}</b> <span style="color:#A8957F">· ${r.total ? pctTxt(v / r.total * 100, 0) : ''}</span></span>
    </div>`).join('');

  const kpiHtml = kpis(`
    ${kpi('Ventas', money(r.total), C.azul, vsTxt, dd(r.total, ra.total))}
    ${kpi('N.º de ventas', fmt(r.n), null, p.comparar ? `vs ${fmt(ra.n)}` : '', dd(r.n, ra.n))}
    ${kpi('Valor promedio', money(r.prom), null, 'por venta', dd(r.prom, ra.prom))}
    ${kpi('Descuentos', money(r.desc), C.ambar, r.total ? `${pctTxt(r.desc / (r.total + r.desc) * 100)} de lo vendido` : '', dd(r.desc, ra.desc, true))}
    ${kpi('A crédito (fiado)', money(r.credito), '#db2777', r.total ? `${pctTxt(r.credito / r.total * 100)} de las ventas` : '', dd(r.credito, ra.credito, true))}
  `);

  const graf = card(unDia ? 'Ventas por hora' : cub.porDia ? 'Ventas por día' : 'Ventas por mes', p.comparar ? `Comparado con ${textoRango(p.pd, p.ph)} (gris)` : textoRango(p.desde, p.hasta),
    barras(datos, cub.etiquetas, { comp }) + (p.comparar ? leyenda([[C.azul, 'Periodo actual'], ['#DCCFBE', 'Periodo anterior']]) : ''));
  const meses = card('Por meses', `Últimos 12 meses hasta ${MESES[Number(p.hasta.slice(5, 7)) - 1]} ${p.hasta.slice(0, 4)}`,
    barras(m12.datos, m12.cub.etiquetas, { color: '#33200F', W: 470, H: 200 }));
  const calorCard = card('¿A qué hora se vende más?', 'Más oscuro = más ventas en ese día y hora', calor.html + (calor.pico ? consejo(calor.pico) : ''));
  const metCard = card('Métodos de pago', textoRango(p.desde, p.hasta),
    metodos.length ? `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">${dona(metodos)}<div style="flex:1;min-width:200px">${listaMet}</div></div>` : vacio('Sin ventas en este periodo'));
  const cajCard = card('Ventas por cajero', textoRango(p.desde, p.hasta), tabla(['Cajero', 'Ventas', 'N.º', 'Promedio', 'Descuentos', 'Part.'], filasCaj, [1, 2, 3, 4, 5]));

  const pantalla = kpiHtml + grid('1fr', graf) + dos(meses + calorCard) + dos(metCard + cajCard);
  const impresion = kpiHtml + grid('1fr', graf) + grid('1fr', cajCard) + grid('1fr', metCard) + grid('1fr', meses);

  const csv = [
    ['VENTAS', textoRango(p.desde, p.hasta)], [],
    ['Concepto', 'Periodo', p.comparar ? 'Periodo anterior' : ''],
    ['Ventas', r.total, p.comparar ? ra.total : ''], ['N. ventas', r.n, p.comparar ? ra.n : ''],
    ['Valor promedio', Math.round(r.prom), p.comparar ? Math.round(ra.prom) : ''], ['Descuentos', r.desc, p.comparar ? ra.desc : ''],
    ['A credito', r.credito, p.comparar ? ra.credito : ''], [],
    [unDia ? 'Hora' : cub.porDia ? 'Dia' : 'Mes', 'Ventas', p.comparar ? 'Periodo anterior' : ''],
    ...cub.claves.map((c, i) => [c, datos[i], comp ? comp[i] : '']), [],
    ['Metodo de pago', 'Total'], ...metodos.map(([k, v]) => [k, v]), [],
    ['Cajero', 'Ventas', 'N. ventas', 'Descuentos'], ...cajeros.map(([k, a]) => [k, a.total, a.n, a.desc]), [],
    ['DETALLE', ''], ['Numero', 'Fecha', 'Cliente', 'Cajero', 'Metodo', 'Tipo', 'Total', 'Utilidad'],
    ...vs.map((v) => [v.numero || '', dia(v), v.cliente_nombre || 'Ocasional', v.cajero || '', v.metodo_pago || '', v.tipoPago || 'contado', num(v.total), num(v.utilidad)]),
  ];

  const pos = [
    ['Ventas', money(r.total), true],
    ...(p.comparar && ra.total ? [['Vs anterior', pctTxt((r.total / ra.total - 1) * 100)]] : []),
    ['N. ventas', fmt(r.n)], ['Promedio', money(r.prom)], ['Descuentos', money(r.desc)], ['A credito', money(r.credito)],
    ['-'], ['METODOS DE PAGO', '', true], ...metodos.map(([k, v]) => [k, money(v)]),
    ['-'], ['POR CAJERO', '', true], ...cajeros.map(([k, a]) => [k, money(a.total)]),
  ];

  return { pantalla, impresion, csv, pos };
}

function mapaCalor(vs) {
  const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const m = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let hayDatos = false;
  for (const v of vs) {
    const ts = v.data && v.data.timestamp;
    if (!ts) continue;
    const d = new Date(ts);
    if (isNaN(d)) continue;
    m[(d.getDay() + 6) % 7][d.getHours()] += num(v.total);
    hayDatos = true;
  }
  if (!hayDatos) return { html: vacio('Aún no hay ventas con hora registrada en este periodo'), pico: '' };

  let hMin = 23, hMax = 0, max = 0, pico = null;
  m.forEach((fila, j) => fila.forEach((v, h) => {
    if (v > 0) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
    if (v > max) { max = v; pico = [j, h]; }
  }));
  const horas = [];
  for (let h = hMin; h <= hMax; h++) horas.push(h);

  let html = `<div style="overflow-x:auto"><div style="display:grid;grid-template-columns:34px repeat(${horas.length},minmax(22px,1fr));gap:3px;font-size:10.5px;color:#7D6858;min-width:${34 + horas.length * 25}px">`;
  html += '<div></div>' + horas.map((h) => `<div style="text-align:center">${h}h</div>`).join('');
  dias.forEach((d, j) => {
    html += `<div style="display:flex;align-items:center">${d}</div>`;
    html += horas.map((h) => {
      const v = m[j][h];
      const a = v > 0 ? (0.12 + v / max * 0.88).toFixed(2) : 0;
      return `<div title="${d} ${h}:00 · ${money(v)}" style="height:24px;border-radius:4px;background:${v > 0 ? `rgba(74, 46, 26,${a})` : '#F2EBE0'}"></div>`;
    }).join('');
  });
  html += '</div></div>';
  const txtPico = pico ? `La hora más fuerte es el ${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][pico[0]]} de ${pico[1]}:00 a ${pico[1] + 1}:00.` : '';
  return { html, pico: txtPico };
}

// ============================================================
//  MÓDULO: UTILIDADES
// ============================================================

function modUtilidades(p) {
  const vs = ventasEn(p.desde, p.hasta);
  const r = resumenVentas(vs);
  const gastos = gastosEn(p.desde, p.hasta);
  const g = sumar(gastos, 'monto');
  const neta = r.utilidad - g;
  const ra = p.comparar ? resumenVentas(ventasEn(p.pd, p.ph)) : null;
  const ga = p.comparar ? sumar(gastosEn(p.pd, p.ph), 'monto') : 0;
  const dd = (a, b, inv) => (p.comparar ? delta(a, b, inv) : '');
  const margen = r.total ? r.utilidad / r.total * 100 : 0;

  const prods = porProducto(vs);

  // Por categoría
  const cats = new Map();
  for (const x of prods) {
    const a = cats.get(x.categoria) || { venta: 0, util: 0 };
    a.venta += x.venta; a.util += x.util;
    cats.set(x.categoria, a);
  }
  const listaCats = [...cats.entries()].sort((a, b) => b[1].util - a[1].util);
  const maxMargen = Math.max(1, ...listaCats.map(([, a]) => (a.venta ? a.util / a.venta * 100 : 0)));

  // Margen bajo o negativo (< 8 %)
  const bajos = prods.filter((x) => x.venta > 0 && x.margen < 8).sort((a, b) => a.margen - b.margen);
  const perdidas = bajos.filter((x) => x.util < -0.5);

  // Utilidad por mes (12)
  const ub = porMes12(_ctx.datos.ventas, p.hasta, (v) => num(v.utilidad));
  const gm = porMes12(_ctx.datos.gastos, p.hasta, (x) => num(x.monto));
  const netaMes = ub.datos.map((v, i) => v - gm.datos[i]);

  // Gastos por categoría
  const gcat = new Map();
  for (const x of gastos) gcat.set(x.categoria || 'Otros', (gcat.get(x.categoria || 'Otros') || 0) + num(x.monto));
  const listaG = [...gcat.entries()].sort((a, b) => b[1] - a[1]);

  const kpiHtml = kpis(`
    ${kpi('Ventas', money(r.total), C.azul, p.comparar ? 'vs anterior' : '', dd(r.total, ra && ra.total))}
    ${kpi('Costo de lo vendido', money(r.costo), C.gris, r.total ? `${pctTxt(r.costo / r.total * 100)} de las ventas` : '', dd(r.costo, ra && ra.costo, true))}
    ${kpi('Utilidad bruta', money(r.utilidad), C.verde, `margen ${pctTxt(margen)}`, dd(r.utilidad, ra && ra.utilidad))}
    ${kpi('Gastos', money(g), C.rojo, `${gastos.length} gasto(s)`, dd(g, ga, true))}
    ${kpi('Utilidad neta', money(neta), neta >= 0 ? C.tinta : C.rojo, 'lo que queda', dd(neta, ra ? ra.utilidad - ga : 0))}
  `);

  const cascada = card('De las ventas a la utilidad neta', 'Cómo se va el dinero en el periodo', htmlCascada(r.total, r.costo, r.utilidad, g, neta));
  const porMes = card('Utilidad por mes', 'Utilidad neta (verde) sobre la utilidad bruta (gris) · últimos 12 meses',
    barras(netaMes, ub.cub.etiquetas, { comp: ub.datos, color: C.verde, W: 470, H: 200 }) + leyenda([[C.verde, 'Neta'], ['#DCCFBE', 'Bruta']]));

  const catCard = card('Por categoría', 'Ventas, utilidad y margen', tabla(['Categoría', 'Ventas', 'Utilidad', 'Margen'],
    listaCats.map(([c, a]) => {
      const m = a.venta ? a.util / a.venta * 100 : 0;
      return [esc(c), money(a.venta), money(a.util), `${barrita(m, maxMargen, m < 8 ? C.rojo : m < 15 ? C.ambar : C.verde)} <b style="margin-left:6px">${pctTxt(m)}</b>`];
    }), [1, 2, 3]));

  const bajosCard = card(`<span style="display:inline-flex;gap:8px;align-items:center"><i data-lucide="alert-triangle" style="width:17px;height:17px;color:${C.rojo}"></i> Productos con margen bajo o negativo</span>`,
    'Vendidos en el periodo con margen menor al 8 %',
    tabla(['Producto', 'Und', 'Ventas', 'Costo', 'Margen', 'Utilidad'], bajos.slice(0, 15).map((x) => [
      esc(x.nombre), fmt(x.und), money(x.venta), money(x.costo),
      `<span style="color:${x.margen < 0 ? C.rojo : C.ambar};font-weight:700">${pctTxt(x.margen)}</span>`,
      `<span style="color:${x.util < 0 ? C.rojo : C.tinta};font-weight:${x.util < 0 ? 700 : 400}">${money(x.util)}</span>`,
    ]), [1, 2, 3, 4, 5])
    + (perdidas.length ? consejo(`${perdidas.length} producto(s) se vendieron por debajo del costo: revisa su precio de venta o el costo registrado en Compras.`, 'mal')
      : bajos.length ? '' : consejo('Ningún producto se vendió con margen menor al 8 % en este periodo.', 'bien')));

  const gCard = card('Gastos por categoría', textoRango(p.desde, p.hasta), tabla(['Categoría', 'Monto', '%'],
    listaG.map(([c, v]) => [esc(c), money(v), g ? pctTxt(v / g * 100, 0) : '—']), [1, 2], listaG.length ? ['Total', money(g), ''] : null));

  const pantalla = kpiHtml + dos(cascada + porMes) + dos(catCard + bajosCard) + dos(gCard);
  const impresion = kpiHtml + grid('1fr 1fr', cascada + gCard) + grid('1fr', catCard) + grid('1fr', bajosCard) + grid('1fr', porMes);

  const csv = [
    ['UTILIDADES', textoRango(p.desde, p.hasta)], [],
    ['Ventas', r.total], ['Costo de lo vendido', r.costo], ['Utilidad bruta', r.utilidad], ['Margen bruto %', margen.toFixed(1)],
    ['Gastos', g], ['Utilidad neta', neta], [],
    ['Categoria', 'Ventas', 'Utilidad', 'Margen %'], ...listaCats.map(([c, a]) => [c, Math.round(a.venta), Math.round(a.util), a.venta ? (a.util / a.venta * 100).toFixed(1) : '']), [],
    ['Producto', 'Categoria', 'Unidades', 'Ventas', 'Costo', 'Utilidad', 'Margen %'],
    ...prods.sort((a, b) => b.util - a.util).map((x) => [x.nombre, x.categoria, x.und, Math.round(x.venta), Math.round(x.costo), Math.round(x.util), x.margen.toFixed(1)]), [],
    ['Mes', 'Utilidad bruta', 'Gastos', 'Utilidad neta'], ...ub.cub.claves.map((c, i) => [c, ub.datos[i], gm.datos[i], netaMes[i]]),
  ];

  const pos = [
    ['Ventas', money(r.total)], ['Costo', money(r.costo)], ['Utilidad bruta', money(r.utilidad), true], ['Margen', pctTxt(margen)],
    ['Gastos', money(g)], ['UTILIDAD NETA', money(neta), true],
    ['-'], ['POR CATEGORIA', '', true], ...listaCats.slice(0, 10).map(([c, a]) => [c, money(a.util)]),
    ...(bajos.length ? [['-'], ['MARGEN BAJO / NEGATIVO', '', true], ...bajos.slice(0, 8).map((x) => [x.nombre, pctTxt(x.margen)])] : []),
  ];

  return { pantalla, impresion, csv, pos };
}

function htmlCascada(ventas, costo, bruta, gastos, neta) {
  if (!ventas && !gastos) return vacio('Sin movimientos en este periodo');
  const W = 520, H = 200;
  const max = Math.max(ventas, gastos, 1) * 1.08;
  const min = Math.min(0, neta);
  const y = (v) => 10 + (H - 10) * (max - v) / (max - min);
  const pasos = [['Ventas', 0, ventas, C.azul], ['Costo', bruta, ventas, '#A8957F'], ['Utilidad bruta', 0, bruta, C.verde], ['Gastos', neta, bruta, C.rojo], ['Utilidad neta', 0, neta, neta >= 0 ? C.tinta : C.rojo]];
  let s = `<svg viewBox="0 0 ${W} ${H + 40}" width="100%" style="display:block" font-family="inherit">`;
  s += `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#EADFD0"/>`;
  pasos.forEach(([t, a, b, c], i) => {
    const x = 18 + i * 100;
    const top = Math.min(y(a), y(b)), alto = Math.max(2, Math.abs(y(a) - y(b)));
    s += `<rect x="${x}" y="${top}" width="70" height="${alto}" rx="4" fill="${c}"><title>${t}: ${money(b - a)}</title></rect>`;
    s += `<text x="${x + 35}" y="${top - 6}" font-size="11" font-weight="700" fill="${C.tinta}" text-anchor="middle">${corto(b - a)}</text>`;
    s += `<text x="${x + 35}" y="${H + 26}" font-size="11" fill="#7D6858" text-anchor="middle">${t}</text>`;
  });
  return s + '</svg>';
}

// ============================================================
//  MÓDULO: PRODUCTOS
// ============================================================

function ultimaVentaPorProducto() {
  const m = new Map();
  for (const v of vigentes(_ctx.datos.ventas)) {
    const d = dia(v);
    for (const it of v.items || []) {
      if (!it.producto_id) continue;
      if (!m.has(it.producto_id) || m.get(it.producto_id) < d) m.set(it.producto_id, d);
    }
  }
  return m;
}

function modProductos(p) {
  const prods = porProducto(ventasEn(p.desde, p.hasta));
  const prodsAnt = p.comparar ? porProducto(ventasEn(p.pd, p.ph)) : [];
  const antPorId = new Map(prodsAnt.map((x) => [x.id, x]));
  const totalVenta = prods.reduce((s, x) => s + x.venta, 0);
  const totalUnd = prods.reduce((s, x) => s + x.und, 0);
  const catalogo = _ctx.datos.productos || [];
  const hoy = todayISO();

  // Sin movimiento: con existencias y sin ventas hace más de 45 días (o nunca)
  const ultima = ultimaVentaPorProducto();
  const quietos = catalogo
    .filter((x) => num(x.stock) > 0)
    .map((x) => {
      const u = ultima.get(x.id) || '';
      return { nombre: x.nombre, categoria: x.categoria || 'Sin categoría', ultima: u, dias: u ? diasEntre(u, hoy) : null, stock: num(x.stock), valor: num(x.stock) * num(x.costo) };
    })
    .filter((x) => x.dias == null || x.dias > 45)
    .sort((a, b) => b.valor - a.valor);
  const valorQuieto = quietos.reduce((s, x) => s + x.valor, 0);

  // ABC por ventas del periodo
  const orden = [...prods].sort((a, b) => b.venta - a.venta);
  let acum = 0;
  const abc = orden.map((x) => {
    acum += x.venta;
    const pctAcum = totalVenta ? acum / totalVenta * 100 : 100;
    return { ...x, clase: pctAcum <= 80 || acum === x.venta ? 'A' : pctAcum <= 95 ? 'B' : 'C' };
  });
  const grupos = ['A', 'B', 'C'].map((k) => {
    const g = abc.filter((x) => x.clase === k);
    return { k, n: g.length, venta: g.reduce((s, x) => s + x.venta, 0) };
  });

  const estrella = orden[0];
  const kpiHtml = kpis(`
    ${kpi('Productos vendidos', fmt(prods.length), C.morado, 'referencias distintas')}
    ${kpi('Unidades vendidas', fmt(totalUnd), null, p.comparar ? 'vs anterior' : '', p.comparar ? delta(totalUnd, prodsAnt.reduce((s, x) => s + x.und, 0)) : '')}
    ${kpi('Producto estrella', estrella ? esc(estrella.nombre) : '—', null, estrella ? `${money(estrella.venta)} · ${fmt(estrella.und)} und` : '')}
    ${kpi('Plata quieta', money(valorQuieto), valorQuieto ? C.ambar : null, `${quietos.length} producto(s) sin venderse +45 días`)}
  `);

  const maxV = Math.max(1, ...prods.map((x) => x.venta));
  const tendencia = (x) => {
    if (!p.comparar) return '';
    const a = antPorId.get(x.id);
    return a ? delta(x.venta, a.venta) : `<span style="color:${C.azul};font-weight:700">Nuevo</span>`;
  };
  const filaProd = (x, i, col) => [i + 1, `<b>${esc(x.nombre)}</b>`, esc(x.categoria), fmt(x.und), money(x.venta), barrita(x.venta, maxV, col), money(x.util), pctTxt(x.margen), tendencia(x)];
  const cabProd = ['#', 'Producto', 'Categoría', 'Und', 'Ventas', '', 'Utilidad', 'Margen', p.comparar ? 'Vs ant.' : ''];

  const tabs = [['vendidos', 'Más vendidos'], ['utilidad', 'Más utilidad'], ['menos', 'Menos vendidos'], ['quietos', 'Sin movimiento'], ['abc', 'Clasificación ABC']];
  const htmlTabs = `<div style="display:flex;gap:4px;background:#EADFD0;padding:4px;border-radius:10px;width:fit-content;max-width:100%;overflow-x:auto;margin-bottom:14px">
    ${tabs.map(([k, t]) => `<button data-tab="${k}" style="padding:7px 14px;border:0;border-radius:7px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;background:${_tabProd === k ? 'white' : 'transparent'};color:${_tabProd === k ? C.tinta : '#7D6858'};${_tabProd === k ? 'box-shadow:0 1px 3px rgba(0,0,0,.08)' : ''}">${t}</button>`).join('')}
  </div>`;

  const secciones = {};

  const porUnd = _ordenProd === 'unidades';
  const topV = [...prods].sort((a, b) => (porUnd ? b.und - a.und : b.venta - a.venta)).slice(0, 20);
  const toggle = `<div style="display:flex;gap:4px">${[['dinero', 'Por dinero'], ['unidades', 'Por unidades']].map(([k, t]) => `<button data-orden="${k}" style="padding:6px 11px;border:1px solid ${_ordenProd === k ? C.morado : '#EADFD0'};background:${_ordenProd === k ? '#f5f3ff' : 'white'};color:${_ordenProd === k ? C.morado : '#7D6858'};border-radius:7px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer">${t}</button>`).join('')}</div>`;
  secciones.vendidos = card('Top 20 más vendidos', `Ordenado ${porUnd ? 'por unidades' : 'por dinero'} · ${textoRango(p.desde, p.hasta)}`,
    tabla(cabProd, topV.map((x, i) => filaProd(x, i, C.morado)), [3, 4, 6, 7, 8]), toggle);

  const topU = [...prods].sort((a, b) => b.util - a.util).slice(0, 20);
  secciones.utilidad = card('Top 20 que más utilidad dejan', 'No siempre son los más vendidos',
    tabla(cabProd, topU.map((x, i) => filaProd(x, i, C.verde)), [3, 4, 6, 7, 8]));

  const vendidosId = new Map(prods.map((x) => [x.id, x]));
  const menos = catalogo.filter((x) => num(x.stock) > 0)
    .map((x) => ({ nombre: x.nombre, categoria: x.categoria || 'Sin categoría', stock: num(x.stock), und: (vendidosId.get(x.id) || {}).und || 0, venta: (vendidosId.get(x.id) || {}).venta || 0 }))
    .sort((a, b) => a.und - b.und || b.stock - a.stock).slice(0, 20);
  secciones.menos = card('Menos vendidos', 'Productos con existencias que menos salieron en el periodo',
    tabla(['Producto', 'Categoría', 'Existencias', 'Und vendidas', 'Ventas'], menos.map((x) => [esc(x.nombre), esc(x.categoria), fmt(x.stock), x.und ? fmt(x.und) : `<span style="color:${C.rojo};font-weight:700">0</span>`, money(x.venta)]), [2, 3, 4]));

  secciones.quietos = card(`<span style="display:inline-flex;gap:8px;align-items:center"><i data-lucide="moon" style="width:17px;height:17px;color:#7D6858"></i> Sin movimiento · plata quieta</span>`,
    `Con existencias y sin venderse hace más de 45 días · <b style="color:${C.tinta}">${money(valorQuieto)} inmovilizados a costo</b>`,
    tabla(['Producto', 'Categoría', 'Última venta', 'Días', 'Existencias', 'Valor a costo'],
      quietos.slice(0, 40).map((x) => [esc(x.nombre), esc(x.categoria), x.ultima ? fechaBonita(x.ultima) : 'Nunca', x.dias == null ? '—' : fmt(x.dias), fmt(x.stock), money(x.valor)]), [3, 4, 5])
    + (quietos.length ? consejo('Ideas: promoción o combo, exhibirlos en la entrada, o no volver a pedirlos.', 'ojo') : ''));

  const coloresABC = { A: [C.morado, 'white', 'Nunca pueden faltar'], B: ['#a78bfa', 'white', 'Vigilar existencias'], C: ['#ddd6fe', '#5b21b6', 'Revisar si vale la pena tenerlos'] };
  secciones.abc = dos(
    card('Clasificación ABC', 'Pocos productos hacen casi toda la venta', grupos.map((g) => {
      const [bg, fg, txt] = coloresABC[g.k];
      const pv = totalVenta ? g.venta / totalVenta * 100 : 0;
      return `<div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #F2EBE0">
        <div style="width:40px;height:40px;border-radius:10px;background:${bg};color:${fg};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${g.k}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:700">${fmt(g.n)} producto(s) → ${pctTxt(pv, 0)} de las ventas</div><div style="font-size:12px;color:#7D6858">${txt}</div>
        <div style="height:8px;border-radius:99px;background:#EADFD0;margin-top:6px;overflow:hidden"><div style="width:${pv}%;height:100%;background:${bg}"></div></div></div></div>`;
    }).join(''))
    + card('Productos clase A', 'Los que sostienen el negocio', tabla(['Producto', 'Ventas', '% acum.'],
      (() => { let ac = 0; return abc.filter((x) => x.clase === 'A').map((x) => { ac += x.venta; return [esc(x.nombre), money(x.venta), pctTxt(totalVenta ? ac / totalVenta * 100 : 0, 0)]; }); })(), [1, 2])),
    0);

  const pantalla = kpiHtml + htmlTabs + secciones[_tabProd];
  const impresion = kpiHtml + grid('1fr', secciones.vendidos) + grid('1fr', secciones.utilidad) + grid('1fr', secciones.quietos);

  const csv = [
    ['PRODUCTOS', textoRango(p.desde, p.hasta)], [],
    ['Producto', 'Categoria', 'Unidades', 'Ventas', 'Costo', 'Utilidad', 'Margen %', 'Clase ABC'],
    ...abc.map((x) => [x.nombre, x.categoria, x.und, Math.round(x.venta), Math.round(x.costo), Math.round(x.util), x.margen.toFixed(1), x.clase]), [],
    ['SIN MOVIMIENTO (+45 dias)'], ['Producto', 'Categoria', 'Ultima venta', 'Dias', 'Existencias', 'Valor a costo'],
    ...quietos.map((x) => [x.nombre, x.categoria, x.ultima || 'Nunca', x.dias == null ? '' : x.dias, x.stock, Math.round(x.valor)]),
  ];

  const pos = [
    ['Referencias', fmt(prods.length)], ['Unidades', fmt(totalUnd)], ['Ventas', money(totalVenta), true],
    ['-'], ['TOP 10 MAS VENDIDOS', '', true], ...orden.slice(0, 10).map((x) => [`${x.nombre} (${fmt(x.und)})`, money(x.venta)]),
    ['-'], ['TOP 5 MAS UTILIDAD', '', true], ...topU.slice(0, 5).map((x) => [x.nombre, money(x.util)]),
    ['-'], ['PLATA QUIETA', money(valorQuieto), true], ...quietos.slice(0, 5).map((x) => [x.nombre, money(x.valor)]),
  ];

  return { pantalla, impresion, csv, pos };
}

// ============================================================
//  MÓDULO: COMPRAS
// ============================================================

/** Ítems de compra cuyo costo cambió respecto al anterior (lo guarda Compras al registrar). */
function cambiosCosto(cs) {
  const prods = mapaProductos();
  const out = [];
  for (const c of cs) {
    for (const it of c.items || []) {
      const antes = num(it.costo_anterior), ahora = num(it.costo);
      if (!(antes > 0) || !(ahora > 0)) continue;
      const cambio = (ahora / antes - 1) * 100;
      if (Math.abs(cambio) < 0.5) continue;
      const p = prods.get(it.producto_id);
      const precio = p ? num(p.precio) : 0;
      out.push({ nombre: it.nombre || (p && p.nombre) || '—', proveedor: c.proveedor || 'Sin proveedor', fecha: dia(c), antes, ahora, cambio, precio, margen: precio ? (precio - ahora) / precio * 100 : null });
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || Math.abs(b.cambio) - Math.abs(a.cambio));
}

function modCompras(p) {
  const cs = comprasEn(p.desde, p.hasta);
  const total = sumar(cs, 'total');
  const totalAnt = p.comparar ? sumar(comprasEn(p.pd, p.ph), 'total') : 0;
  const ventas = sumar(ventasEn(p.desde, p.hasta), 'total');
  const hoy = todayISO();

  // Por proveedor
  const pm = new Map();
  for (const c of cs) {
    const k = c.proveedor || 'Sin proveedor';
    const a = pm.get(k) || { n: 0, contado: 0, credito: 0, saldo: 0 };
    a.n++;
    if (c.tipoPago === 'credito') { a.credito += num(c.total); a.saldo += num(c.saldo); } else a.contado += num(c.total);
    pm.set(k, a);
  }
  const provs = [...pm.entries()].map(([k, a]) => [k, { ...a, total: a.contado + a.credito }]).sort((a, b) => b[1].total - a[1].total);
  const coloresProv = ['#a16207', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a'];
  const partes = provs.slice(0, 5).map(([k, a], i) => [k, a.total, coloresProv[i]]);
  if (provs.length > 5) partes.push(['Otros', provs.slice(5).reduce((s, [, a]) => s + a.total, 0), coloresProv[5]]);

  // Cuentas por pagar (todas, a hoy)
  const cxp = vigentes(_ctx.datos.compras).filter((c) => c.tipoPago === 'credito' && num(c.saldo) > 0.5)
    .sort((a, b) => (a.vence || '9999').localeCompare(b.vence || '9999'));
  const cxpTotal = sumar(cxp, 'saldo');
  const cxpVencido = cxp.filter((c) => c.vence && c.vence < hoy).reduce((s, c) => s + num(c.saldo), 0);

  // Productos más comprados
  const pc = new Map();
  for (const c of cs) for (const it of c.items || []) {
    const k = it.producto_id || it.nombre;
    const a = pc.get(k) || { nombre: it.nombre || '—', und: 0, total: 0 };
    a.und += num(it.cantidad); a.total += num(it.subtotal) || num(it.cantidad) * num(it.costo);
    pc.set(k, a);
  }
  const masComprados = [...pc.values()].sort((a, b) => b.total - a.total);

  const cambios = cambiosCosto(cs);
  const globalC = porMes12(_ctx.datos.compras, p.hasta, (c) => num(c.total));
  const globalV = porMes12(_ctx.datos.ventas, p.hasta, (v) => num(v.total));

  const kpiHtml = kpis(`
    ${kpi('Total comprado', money(total), C.ambar, p.comparar ? 'vs anterior' : '', p.comparar ? delta(total, totalAnt, true) : '')}
    ${kpi('Facturas de compra', fmt(cs.length), null, `de ${fmt(provs.length)} proveedor(es)`)}
    ${kpi('Por pagar hoy', money(cxpTotal), cxpTotal ? C.rojo : null, cxpVencido ? `${money(cxpVencido)} vencido` : `${fmt(cxp.length)} factura(s)`)}
    ${kpi('Compras / ventas', ventas ? pctTxt(total / ventas * 100) : '—', null, 'cuánto de lo vendido se repuso')}
  `);

  const maxP = Math.max(1, ...provs.map(([, a]) => a.total));
  const provCard = card('Por proveedor', textoRango(p.desde, p.hasta),
    (partes.length ? `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:12px">${dona(partes)}
      <div style="flex:1;min-width:180px">${leyenda(partes.map(([k, v, c]) => [c, `${esc(k)} · ${total ? pctTxt(v / total * 100, 0) : ''}`]))}</div></div>` : '')
    + tabla(['Proveedor', 'Fact.', 'Contado', 'Crédito', 'Total', '', 'Saldo'],
      provs.map(([k, a]) => [esc(k), fmt(a.n), money(a.contado), money(a.credito), `<b>${money(a.total)}</b>`, barrita(a.total, maxP, C.ambar), a.saldo > 0.5 ? `<span style="color:${C.rojo}">${money(a.saldo)}</span>` : '—']),
      [1, 2, 3, 4, 6], provs.length ? ['Total', fmt(cs.length), money(provs.reduce((s, [, a]) => s + a.contado, 0)), money(provs.reduce((s, [, a]) => s + a.credito, 0)), money(total), '', money(provs.reduce((s, [, a]) => s + a.saldo, 0))] : null));

  const globalCard = card('Globalizado · compras vs ventas', 'Compras (dorado) sobre ventas (gris) · últimos 12 meses',
    barras(globalC.datos, globalC.cub.etiquetas, { comp: globalV.datos, color: C.ambar, W: 470, H: 200 }) + leyenda([[C.ambar, 'Compras'], ['#DCCFBE', 'Ventas']]));

  const cambiosCard = card(`<span style="display:inline-flex;gap:8px;align-items:center"><i data-lucide="trending-up" style="width:17px;height:17px;color:${C.rojo}"></i> Cambios de costo</span>`,
    'Productos cuyo costo cambió en las compras del periodo',
    tabla(['Producto', 'Proveedor', 'Fecha', 'Antes', 'Ahora', 'Cambio', 'Precio venta', 'Margen hoy'], cambios.slice(0, 25).map((x) => [
      esc(x.nombre), esc(x.proveedor), fechaBonita(x.fecha), money(x.antes), money(x.ahora),
      `<span style="color:${x.cambio > 0 ? C.rojo : C.verde};font-weight:700">${x.cambio > 0 ? '▲' : '▼'} ${pctTxt(Math.abs(x.cambio))}</span>`,
      x.precio ? money(x.precio) : '—',
      x.margen == null ? '—' : x.margen < 8 ? etiqueta(`${pctTxt(x.margen)} · revisar`, '#fef3c7', '#92400e') : etiqueta(pctTxt(x.margen), '#dcfce7', '#166534'),
    ]), [3, 4, 5, 6, 7])
    + (cambios.some((x) => x.margen != null && x.margen < 8) ? consejo('Hay productos que subieron de costo y quedaron con margen menor al 8 %: ajusta su precio de venta en Productos.', 'ojo') : ''));

  const masCard = card('Productos más comprados', textoRango(p.desde, p.hasta), tabla(['Producto', 'Und', 'Costo prom.', 'Total'],
    masComprados.slice(0, 15).map((x) => [esc(x.nombre), fmt(x.und), money(x.und ? x.total / x.und : 0), money(x.total)]), [1, 2, 3]));

  const cxpCard = card('Cuentas por pagar', `Todas las facturas a crédito con saldo, a hoy · ${money(cxpTotal)}`, tabla(['Proveedor', 'Factura', 'Fecha', 'Vence', 'Saldo'],
    cxp.slice(0, 25).map((c) => {
      const venc = c.vence && c.vence < hoy;
      const estado = !c.vence ? '<span style="color:#A8957F">Sin fecha</span>'
        : venc ? `<span style="color:${C.rojo};font-weight:700">Vencida (${diasEntre(c.vence, hoy)} d)</span>`
          : c.vence === hoy ? `<span style="color:${C.ambar};font-weight:700">Hoy</span>` : fechaBonita(c.vence);
      return [esc(c.proveedor || 'Sin proveedor'), esc(c.ref || '—'), fechaBonita(dia(c)), estado, money(c.saldo)];
    }), [4]));

  const pantalla = kpiHtml + dos(provCard + globalCard) + dos(cambiosCard + cxpCard) + dos(masCard);
  const impresion = kpiHtml + grid('1fr', provCard) + grid('1fr', masCard) + grid('1fr', cxpCard) + grid('1fr', cambiosCard) + grid('1fr', globalCard);

  const csv = [
    ['COMPRAS', textoRango(p.desde, p.hasta)], [],
    ['Total comprado', total], ['Facturas', cs.length], ['Por pagar (hoy)', cxpTotal], ['Vencido', cxpVencido], [],
    ['Proveedor', 'Facturas', 'Contado', 'Credito', 'Total', 'Saldo'], ...provs.map(([k, a]) => [k, a.n, a.contado, a.credito, a.total, a.saldo]), [],
    ['Mes', 'Compras', 'Ventas'], ...globalC.cub.claves.map((c, i) => [c, globalC.datos[i], globalV.datos[i]]), [],
    ['Producto', 'Unidades', 'Total comprado'], ...masComprados.map((x) => [x.nombre, x.und, Math.round(x.total)]), [],
    ['CAMBIOS DE COSTO'], ['Producto', 'Proveedor', 'Fecha', 'Antes', 'Ahora', 'Cambio %', 'Precio venta'],
    ...cambios.map((x) => [x.nombre, x.proveedor, x.fecha, x.antes, x.ahora, x.cambio.toFixed(1), x.precio]), [],
    ['DETALLE'], ['Fecha', 'Proveedor', 'Factura', 'Tipo', 'Total', 'Saldo'],
    ...cs.map((c) => [dia(c), c.proveedor || '', c.ref || '', c.tipoPago || 'contado', num(c.total), num(c.saldo)]),
  ];

  const pos = [
    ['Total comprado', money(total), true], ['Facturas', fmt(cs.length)], ['Por pagar hoy', money(cxpTotal)], ['Vencido', money(cxpVencido)],
    ['-'], ['POR PROVEEDOR', '', true], ...provs.map(([k, a]) => [k, money(a.total)]),
    ...(cambios.length ? [['-'], ['CAMBIOS DE COSTO', '', true], ...cambios.slice(0, 8).map((x) => [x.nombre, `${x.cambio > 0 ? '+' : ''}${x.cambio.toFixed(1)}%`])] : []),
  ];

  return { pantalla, impresion, csv, pos };
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(root) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-nav],[data-preset],[data-acc],[data-tab],[data-orden],[data-plantilla]');
    if (!el || !root.contains(el)) return;
    const ds = el.dataset;
    if (ds.nav) { _ctx.navegar(ds.nav); return; }
    if (ds.plantilla) { _ctx.abrirPlantilla(ds.plantilla); return; }
    if (ds.tab) { _tabProd = ds.tab; pintar(); return; }
    if (ds.orden) { _ordenProd = ds.orden; pintar(); return; }
    if (ds.acc) { exportar(ds.acc); return; }
    if (ds.preset) {
      _per.preset = ds.preset;
      if (ds.preset !== 'custom') {
        const [d, h] = rangoPreset(ds.preset);
        _per.desde = d; _per.hasta = h;
      }
      pintar();
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.fecha && el.value) {
      _per[el.dataset.fecha] = el.value;
      _per.preset = 'custom';
      pintar();
    } else if (el.hasAttribute('data-comparar')) {
      _per.comparar = el.checked;
      pintar();
    }
  });
}

// ============================================================
//  EXPORTAR: EXCEL (CSV) · PDF CARTA · POS 80 mm
// ============================================================

async function exportar(tipo) {
  const p = periodo();
  if (!p.valido) { Toast.warn('La fecha "Desde" no puede ser mayor a "Hasta"'); return; }
  const info = INFO[_modulo];
  const datos = construir();
  const nombre = `${info.titulo} ${p.desde}_a_${p.hasta}`;

  if (tipo === 'csv') {
    descargarCSV(datos.csv, `reporte-${_modulo}-${p.desde}_a_${p.hasta}.csv`);
    return;
  }

  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {} }; }
  const neg = (cfg && cfg.negocio) || {};

  try {
    if (tipo === 'pdf') {
      imprimirCarta(htmlInformeCarta(info, p, neg, datos.impresion), { titulo: `Informe ${nombre}` });
      Toast.info('Selecciona "Guardar como PDF" en el diálogo de impresión para exportarlo');
    } else {
      let plantilla;
      try { plantilla = await PlantillaRepo.leer('reporte'); } catch (e) { plantilla = PlantillaRepo.defaultPara('reporte'); }
      imprimirPOS(htmlTicket(info, p, neg, datos.pos), { anchoMm: (plantilla && plantilla.anchoMm) || 80, titulo: `Informe POS ${nombre}` });
      Toast.ok('Enviando informe a la impresora térmica…');
    }
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo generar el informe');
  }
}

function descargarCSV(filas, archivo) {
  const csv = (v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  };
  const contenido = '﻿' + filas.map((f) => f.map(csv).join(',')).join('\n'); // BOM para Excel UTF-8
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  Toast.ok('Archivo para Excel descargado');
}

function htmlInformeCarta(info, p, neg, cuerpo) {
  const generado = new Date().toLocaleString('es-CO');
  return `
    <div style="font-family:'Inter','Helvetica','Arial',sans-serif;color:${C.tinta};font-size:11.5px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${info.color};padding-bottom:12px;margin-bottom:14px">
        <div>
          <div style="font-size:19px;font-weight:800;letter-spacing:-0.02em">${esc(neg.nombre || 'PosPunto')}</div>
          ${neg.nit ? `<div style="font-size:11px;color:#5C4636">NIT/CC: ${esc(neg.nit)}</div>` : ''}
          ${neg.direccion ? `<div style="font-size:11px;color:#5C4636">${esc(neg.direccion)}${neg.ciudad ? ' · ' + esc(neg.ciudad) : ''}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:800;color:${info.color};text-transform:uppercase">Informe de ${esc(info.titulo)}</div>
          <div style="font-size:11px;color:#5C4636">Periodo: ${textoRango(p.desde, p.hasta)}</div>
          ${p.comparar ? `<div style="font-size:11px;color:#5C4636">Comparado con: ${textoRango(p.pd, p.ph)}</div>` : ''}
          <div style="font-size:11px;color:#A8957F">Generado: ${esc(generado)}</div>
        </div>
      </div>
      ${cuerpo}
      <div style="border-top:1px solid #DCCFBE;margin-top:16px;padding-top:8px;font-size:9.5px;color:#A8957F;text-align:center">
        Reporte generado automáticamente por PosPunto · ${esc(generado)}
      </div>
    </div>`;
}

function htmlTicket(info, p, neg, lineas) {
  const fila = ([a, b, neg_]) => {
    if (a === '-') return '<div style="border-top:1px dashed #000;margin:5px 0"></div>';
    return `<div style="display:flex;justify-content:space-between;gap:6px;${neg_ ? 'font-weight:bold' : ''}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a)}</span><span style="white-space:nowrap">${esc(b || '')}</span></div>`;
  };
  return `
    <div style="font-family:'Courier New',monospace;font-size:12px;color:#000;line-height:1.4;padding:2mm">
      <div style="text-align:center;font-weight:bold">${esc((neg.nombre || 'PosPunto').toUpperCase())}</div>
      <div style="text-align:center">INFORME DE ${esc(info.titulo.toUpperCase())}</div>
      <div style="text-align:center">${textoRango(p.desde, p.hasta)}</div>
      <div style="border-top:1px dashed #000;margin:5px 0"></div>
      ${lineas.map(fila).join('')}
      <div style="border-top:1px dashed #000;margin:5px 0"></div>
      <div style="text-align:center;font-size:11px">${esc(new Date().toLocaleString('es-CO'))}</div>
    </div>`;
}
