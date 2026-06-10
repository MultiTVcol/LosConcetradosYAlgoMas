/**
 * modules/reportes/reportes.view.js — Vista del módulo Reportes
 *
 * Replica de renderReportes del legacy:
 *   - KPIs de utilidad: día / semana / mes / año
 *   - Reporte por rango con presets
 *   - Tarjetas resumen: Ventas / Compras / Gastos / Utilidad neta
 *   - Estado de resultados: utilidad por margen + flujo de caja
 *   - Productos más vendidos (mini barras)
 *   - Clientes frecuentes
 *   - Métodos de pago (proporciones)
 */

import * as VentasRepo from '../ventas/ventas.repo.js';
import * as ComprasRepo from '../compras/compras.repo.js';
import * as GastosRepo from '../gastos/gastos.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import * as ConfigRepo from '../config/config.repo.js';
import { Toast } from '../../components/index.js';
import { imprimirCarta, imprimirPOS } from '../../services/printer.js';
import * as Realtime from '../../services/realtime.js';
import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { refrescarIconos } from '../../app/shell.js';

// ============================================================
//  ESTADO
// ============================================================

let _contenedor = null;
let _ventas = [];
let _compras = [];
let _gastos = [];
let _productos = [];
let _clientes = [];
let _estado = { desde: '', hasta: '', preset: 'mes' };
let _offRealtime = null;

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;
  const hoy = todayISO();
  _estado = { desde: hoy.slice(0, 8) + '01', hasta: hoy, preset: 'mes' };

  contenedor.innerHTML = htmlCargando();

  try { _ventas = await VentasRepo.listar(); } catch (e) { _ventas = []; }
  try { _compras = await ComprasRepo.listar(); } catch (e) { _compras = []; }
  try { _gastos = await GastosRepo.listar(); } catch (e) { _gastos = []; }
  try { _productos = await ProductosRepo.listar(); } catch (e) { _productos = []; }
  try { _clientes = await ClientesRepo.listar(); } catch (e) { _clientes = []; }

  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarReporteRango();
  pintarGraficos();

  // Realtime: refrescar reportes cuando llegan cambios remotos
  _offRealtime = Realtime.escucharVarias(
    ['ventas', 'compras', 'gastos', 'productos', 'clientes'],
    async () => {
      try {
        _ventas = await VentasRepo.listar();
        _compras = await ComprasRepo.listar();
        _gastos = await GastosRepo.listar();
        _productos = await ProductosRepo.listar();
        _clientes = await ClientesRepo.listar();
        pintarReporteRango();
        pintarGraficos();
      } catch (err) { console.warn('Realtime reportes:', err); }
    },
  );
}

// ============================================================
//  CÁLCULOS
// ============================================================

function rangoVentas(desde, hasta) {
  let total = 0, utilidad = 0, n = 0;
  for (const v of _ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      total += num(v.total);
      utilidad += num(v.utilidad);
      n++;
    }
  }
  return { total, utilidad, n };
}

function reporteRango(desde, hasta) {
  let ventas = 0, utilidadBruta = 0, costoVenta = 0, nFac = 0;
  for (const v of _ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      const tot = num(v.total);
      const uti = num(v.utilidad);
      ventas += tot;
      utilidadBruta += uti;
      costoVenta += (tot - uti);
      nFac++;
    }
  }

  let compras = 0, nCompras = 0, creditoNuevo = 0, nCreditosNuevos = 0;
  let abonosDelPeriodo = 0, nAbonos = 0;
  for (const c of _compras) {
    const d = (c.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      compras += num(c.total);
      nCompras++;
      if (c.tipoPago === 'credito') {
        creditoNuevo += num(c.total);
        nCreditosNuevos++;
      }
    }
    // Abonos pagados durante el rango (sin importar fecha de la compra)
    for (const a of c.abonos || []) {
      const da = (a.fecha || '').slice(0, 10);
      if (da >= desde && da <= hasta) {
        abonosDelPeriodo += num(a.monto);
        nAbonos++;
      }
    }
  }

  let gastos = 0, nGastos = 0;
  const gastosPorCat = {};
  for (const g of _gastos) {
    const d = (g.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      const m = num(g.monto);
      gastos += m;
      nGastos++;
      const cat = g.categoria || 'Otros';
      gastosPorCat[cat] = (gastosPorCat[cat] || 0) + m;
    }
  }

  // Cuentas por pagar (snapshot actual)
  let cxpTotal = 0, cxpVencido = 0, cxpPorVencer = 0, cxpSinFecha = 0, nFacturasPorPagar = 0;
  const hoyISO = todayISO();
  for (const c of _compras) {
    if (c.tipoPago === 'credito' && num(c.saldo) > 0.5) {
      const s = num(c.saldo);
      cxpTotal += s;
      nFacturasPorPagar++;
      if (c.vence) {
        if (c.vence < hoyISO) cxpVencido += s;
        else cxpPorVencer += s;
      } else cxpSinFecha += s;
    }
  }

  // Inventario al día
  let invSKUs = 0, invUnidades = 0, invValorCosto = 0, invValorVenta = 0;
  for (const p of _productos) {
    const st = num(p.stock);
    invSKUs++;
    if (st > 0) {
      invUnidades += st;
      invValorCosto += st * num(p.costo);
      invValorVenta += st * num(p.precio);
    }
  }

  const utilidadNeta = utilidadBruta - gastos;
  const flujoCaja = ventas - compras - gastos;
  const flujoCajaProyectado = flujoCaja - cxpTotal;

  return {
    desde, hasta,
    ventas, utilidadBruta, costoVenta, nFac,
    compras, nCompras, creditoNuevo, nCreditosNuevos, abonosDelPeriodo, nAbonos,
    gastos, nGastos, gastosPorCat,
    cxpTotal, cxpVencido, cxpPorVencer, cxpSinFecha, nFacturasPorPagar,
    invSKUs, invUnidades, invValorCosto, invValorVenta,
    utilidadNeta, flujoCaja, flujoCajaProyectado,
  };
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando reportes…</div>`;
}

function htmlLayout() {
  const hoy = todayISO();
  const d = new Date();
  const semIni = new Date(d); semIni.setDate(d.getDate() - d.getDay());

  const dia = rangoVentas(hoy, hoy);
  const sem = rangoVentas(semIni.toISOString().slice(0, 10), hoy);
  const mes = rangoVentas(hoy.slice(0, 8) + '01', hoy);
  const anio = rangoVentas(hoy.slice(0, 4) + '-01-01', hoy);

  const presets = [
    ['hoy', 'Hoy'],
    ['ayer', 'Ayer'],
    ['semana', 'Esta semana'],
    ['mes', 'Este mes'],
    ['mesPasado', 'Mes pasado'],
    ['anio', 'Este año'],
    ['custom', 'Personalizado'],
  ];

  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="bar-chart-3" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Reportes</h1>
      </div>

      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:18px">
        ${kpiUtilidad('Día', dia, '#4f46e5')}
        ${kpiUtilidad('Semana', sem, '#0284c7')}
        ${kpiUtilidad('Mes', mes, '#a16207')}
        ${kpiUtilidad('Año', anio, '#15803d')}
      </div>

      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">📅 Reporte por fechas</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="rep-btn-csv"
              style="padding:9px 14px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;color:#475569;display:flex;align-items:center;gap:6px">
              📊 Exportar CSV
            </button>
            <button id="rep-btn-pos"
              style="padding:9px 14px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;display:flex;align-items:center;gap:6px">
              🧾 Imprimir POS 80mm
            </button>
            <button id="rep-btn-pdf"
              style="padding:9px 14px;background:#4f46e5;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
              📄 Generar informe PDF
            </button>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${presets.map((p) => `
            <button class="rep-preset" data-preset="${p[0]}"
              style="padding:8px 14px;border:1px solid ${_estado.preset === p[0] ? '#4f46e5' : '#e2e8f0'};background:${_estado.preset === p[0] ? '#4f46e5' : 'white'};color:${_estado.preset === p[0] ? 'white' : '#475569'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">
              ${p[1]}
            </button>
          `).join('')}
        </div>

        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;margin-bottom:14px">
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Desde</div>
            <input id="rep-desde" type="date" value="${esc(_estado.desde)}"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Hasta</div>
            <input id="rep-hasta" type="date" value="${esc(_estado.hasta)}"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
        </div>

        <div id="rep-resumen"></div>
      </div>

      <div style="display:grid;gap:16px;grid-template-columns:1.5fr 1fr;margin-bottom:18px">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 14px;color:#0f172a">📈 Ventas últimos 14 días</h3>
          <div id="rep-ventas-bars" style="display:flex;align-items:flex-end;gap:6px;height:160px"></div>
        </div>
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 14px;color:#0f172a">💳 Métodos de pago</h3>
          <div id="rep-metodos"></div>
        </div>
      </div>

      <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 14px;color:#0f172a">🏆 Productos más vendidos</h3>
          <div id="rep-top-prod"></div>
        </div>
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="font-size:16px;font-weight:700;margin:0 0 14px;color:#0f172a">⭐ Clientes frecuentes</h3>
          <div id="rep-top-cli"></div>
        </div>
      </div>
    </div>
  `;
}

function kpiUtilidad(label, r, color) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px">
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Utilidad ${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color};font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(r.utilidad)}</div>
      <div style="color:#64748b;font-weight:500;margin-top:6px;font-size:12.5px">Ventas: ${money(r.total)} · ${r.n} fac.</div>
    </div>
  `;
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  contenedor.querySelectorAll('.rep-preset').forEach((btn) => {
    btn.addEventListener('click', () => aplicarPreset(btn.dataset.preset));
  });
  contenedor.querySelector('#rep-desde')?.addEventListener('change', (e) => {
    _estado.desde = e.target.value;
    _estado.preset = 'custom';
    marcarPreset();
    pintarReporteRango();
  });
  contenedor.querySelector('#rep-hasta')?.addEventListener('change', (e) => {
    _estado.hasta = e.target.value;
    _estado.preset = 'custom';
    marcarPreset();
    pintarReporteRango();
  });
  contenedor.querySelector('#rep-btn-pdf')?.addEventListener('click', generarInformePDF);
  contenedor.querySelector('#rep-btn-pos')?.addEventListener('click', generarInformePOS);
  contenedor.querySelector('#rep-btn-csv')?.addEventListener('click', exportarCSV);
}

function aplicarPreset(p) {
  const hoy = todayISO();
  const d = new Date();
  let desde = hoy, hasta = hoy;
  if (p === 'hoy') { desde = hoy; hasta = hoy; }
  else if (p === 'ayer') {
    const a = new Date(d); a.setDate(d.getDate() - 1);
    desde = hasta = a.toISOString().slice(0, 10);
  } else if (p === 'semana') {
    const i = new Date(d); i.setDate(d.getDate() - d.getDay());
    desde = i.toISOString().slice(0, 10); hasta = hoy;
  } else if (p === 'mes') {
    desde = hoy.slice(0, 8) + '01'; hasta = hoy;
  } else if (p === 'mesPasado') {
    const i = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const f = new Date(d.getFullYear(), d.getMonth(), 0);
    desde = `${i.getFullYear()}-${String(i.getMonth() + 1).padStart(2, '0')}-01`;
    hasta = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  } else if (p === 'anio') {
    desde = hoy.slice(0, 4) + '-01-01'; hasta = hoy;
  } else if (p === 'custom') {
    _estado.preset = 'custom';
    marcarPreset();
    return;
  }
  _estado = { desde, hasta, preset: p };
  const inpD = _contenedor.querySelector('#rep-desde');
  const inpH = _contenedor.querySelector('#rep-hasta');
  if (inpD) inpD.value = desde;
  if (inpH) inpH.value = hasta;
  marcarPreset();
  pintarReporteRango();
}

function marcarPreset() {
  _contenedor?.querySelectorAll('.rep-preset').forEach((btn) => {
    const activo = btn.dataset.preset === _estado.preset;
    btn.style.background = activo ? '#4f46e5' : 'white';
    btn.style.color = activo ? 'white' : '#475569';
    btn.style.borderColor = activo ? '#4f46e5' : '#e2e8f0';
  });
}

// ============================================================
//  REPORTE POR RANGO
// ============================================================

function pintarReporteRango() {
  const box = _contenedor?.querySelector('#rep-resumen');
  if (!box) return;

  if (_estado.desde > _estado.hasta) {
    box.innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;color:#991b1b;font-weight:600">
        ⚠️ La fecha "Desde" es posterior a "Hasta". Corrige el rango.
      </div>
    `;
    return;
  }

  const r = reporteRango(_estado.desde, _estado.hasta);
  const margenPct = r.ventas > 0 ? (r.utilidadBruta / r.ventas * 100) : 0;
  const netaPct = r.ventas > 0 ? (r.utilidadNeta / r.ventas * 100) : 0;
  const colNeta = r.utilidadNeta >= 0 ? '#15803d' : '#dc2626';
  const colCaja = r.flujoCaja >= 0 ? '#15803d' : '#dc2626';
  const colProy = r.flujoCajaProyectado >= 0 ? '#15803d' : '#dc2626';

  box.innerHTML = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px;text-align:center;font-weight:700;color:#475569;margin-bottom:14px">
      Periodo: ${fechaBonita(r.desde)} → ${fechaBonita(r.hasta)} · ${r.nFac} venta(s) · ${r.nCompras} compra(s) · ${r.nGastos} gasto(s)
    </div>

    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:14px">
      ${tarjeta('🟢 Ventas', money(r.ventas), '#eef2ff', '#4338ca')}
      ${tarjeta('🚚 Compras', money(r.compras), '#dbeafe', '#0369a1')}
      ${tarjeta('💸 Gastos', money(r.gastos), '#fef2f2', '#dc2626')}
      ${tarjeta('⭐ Utilidad neta', money(r.utilidadNeta), r.utilidadNeta >= 0 ? '#dcfce7' : '#fef2f2', colNeta)}
    </div>

    <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr;align-items:start">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
        <h4 style="font-size:15px;font-weight:700;margin:0 0 10px;color:#0f172a">📈 Utilidad por margen (rentabilidad)</h4>
        ${repFila('Ventas del periodo', r.ventas, '#0f172a')}
        ${repFila('− Costo de lo vendido', -r.costoVenta, '#64748b')}
        <div style="border-top:2px solid #e2e8f0;margin:6px 0"></div>
        ${repFila('= Utilidad bruta', r.utilidadBruta, '#4338ca', true)}
        <div style="font-size:12.5px;color:#64748b;margin:2px 0 8px">Margen sobre ventas: <b>${margenPct.toFixed(1)}%</b></div>
        ${repFila('− Gastos operativos', -r.gastos, '#dc2626')}
        <div style="border-top:3px double #cbd5e1;margin:8px 0"></div>
        ${repFila('= UTILIDAD NETA', r.utilidadNeta, colNeta, true, true)}
        <div style="font-size:12.5px;color:#64748b;margin-top:4px">Margen neto: <b>${netaPct.toFixed(1)}%</b></div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">
        <h4 style="font-size:15px;font-weight:700;margin:0 0 10px;color:#0f172a">💧 Flujo de caja (dinero del periodo)</h4>
        ${repFila('Ventas (dinero que entró)', r.ventas, '#0f172a')}
        ${repFila('− Compras', -r.compras, '#0369a1')}
        ${repFila('− Gastos', -r.gastos, '#dc2626')}
        ${r.abonosDelPeriodo > 0 ? repFila('− Abonos a proveedores', -r.abonosDelPeriodo, '#a16207') : ''}
        <div style="border-top:3px double #cbd5e1;margin:8px 0"></div>
        ${repFila('= FLUJO DE CAJA', r.flujoCaja, colCaja, true, true)}
        ${r.cxpTotal > 0 ? `
          <div style="border-top:1px solid #e2e8f0;margin-top:10px;padding-top:8px">
            ${repFila('− Deuda pendiente', -r.cxpTotal, '#a16207')}
            <div style="border-top:2px dashed #cbd5e1;margin:6px 0"></div>
            ${repFila('= Flujo proyectado', r.flujoCajaProyectado, colProy, true)}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function tarjeta(label, valor, bgColor, fgColor) {
  return `
    <div style="background:${bgColor};border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${fgColor};font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${valor}</div>
    </div>
  `;
}

function repFila(label, valor, color, bold = false, big = false) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;${bold ? 'font-weight:700;' : ''}">
      <span style="color:#475569;font-size:${big ? '14.5px' : '13.5px'}">${label}</span>
      <span style="color:${color};${bold ? 'font-weight:800;' : ''}font-family:'JetBrains Mono',ui-monospace,monospace;font-size:${big ? '16px' : '13.5px'}">${money(valor)}</span>
    </div>
  `;
}

function fechaBonita(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
//  GRÁFICOS LIGEROS (sin libs)
// ============================================================

function pintarGraficos() {
  pintarVentas14Dias();
  pintarMetodosPago();
  pintarTopProductos();
  pintarTopClientes();
}

function pintarVentas14Dias() {
  const box = _contenedor?.querySelector('#rep-ventas-bars');
  if (!box) return;

  const hoy = new Date();
  const dias = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - i);
    dias.push(d.toISOString().slice(0, 10));
  }

  const datos = dias.map((fecha) => {
    let total = 0;
    for (const v of _ventas) {
      if ((v.fecha || '').slice(0, 10) === fecha) total += num(v.total);
    }
    return { fecha, total };
  });

  const max = Math.max(...datos.map((x) => x.total), 1);

  box.innerHTML = datos.map(({ fecha, total }) => {
    const h = Math.round((total / max) * 100);
    const dia = fecha.slice(8, 10);
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px">
        <div title="${money(total)}" style="width:100%;background:linear-gradient(180deg,#4f46e5,#7c3aed);border-radius:6px 6px 0 0;min-height:${total > 0 ? '6px' : '2px'};height:${h}%"></div>
        <div style="font-size:10.5px;color:#94a3b8;font-family:'JetBrains Mono',ui-monospace,monospace">${dia}</div>
      </div>
    `;
  }).join('');
}

function pintarMetodosPago() {
  const box = _contenedor?.querySelector('#rep-metodos');
  if (!box) return;

  const dist = {};
  for (const v of _ventas) {
    const m = (v.metodo_pago || '').split(' ')[0] || '—';
    dist[m] = (dist[m] || 0) + num(v.total);
  }
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13.5px">Sin ventas aún</div>`;
    return;
  }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colores = ['#4f46e5', '#0284c7', '#15803d', '#a16207', '#dc2626', '#9333ea'];

  box.innerHTML = entries.map(([met, val], i) => {
    const pct = (val / total) * 100;
    const c = colores[i % colores.length];
    return `
      <div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
          <span style="color:#0f172a;font-weight:600">${esc(met)}</span>
          <span style="color:#64748b;font-family:'JetBrains Mono',ui-monospace,monospace">${money(val)} · ${pct.toFixed(1)}%</span>
        </div>
        <div style="height:9px;background:#f1f5f9;border-radius:5px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${c};border-radius:5px"></div>
        </div>
      </div>
    `;
  }).join('');
}

function pintarTopProductos() {
  const box = _contenedor?.querySelector('#rep-top-prod');
  if (!box) return;

  const acum = new Map();
  for (const v of _ventas) {
    for (const it of v.items || []) {
      const id = it.producto_id || it.nombre;
      const prev = acum.get(id) || { nombre: it.nombre, cantidad: 0, total: 0 };
      prev.cantidad += num(it.cantidad);
      prev.total += num(it.total) || num(it.precio) * num(it.cantidad);
      acum.set(id, prev);
    }
  }
  const top = [...acum.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);

  if (top.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13.5px">Sin ventas aún</div>`;
    return;
  }

  const max = top[0].cantidad || 1;
  box.innerHTML = top.map((it) => {
    const pct = (it.cantidad / max) * 100;
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
          <span style="color:#0f172a;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px">${esc(it.nombre)}</span>
          <span style="color:#64748b;font-family:'JetBrains Mono',ui-monospace,monospace;flex-shrink:0">${fmt(it.cantidad)} uds · ${money(it.total)}</span>
        </div>
        <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#4f46e5,#7c3aed);border-radius:4px"></div>
        </div>
      </div>
    `;
  }).join('');
}

function pintarTopClientes() {
  const box = _contenedor?.querySelector('#rep-top-cli');
  if (!box) return;

  const acum = new Map();
  for (const v of _ventas) {
    const id = v.cliente_id || 'ocasional';
    const nombre = v.cliente_nombre || 'Cliente ocasional';
    const prev = acum.get(id) || { nombre, total: 0, n: 0 };
    prev.total += num(v.total);
    prev.n += 1;
    acum.set(id, prev);
  }
  const top = [...acum.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  if (top.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:13.5px">Sin clientes aún</div>`;
    return;
  }

  box.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${top.map((c, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
            <span style="width:24px;height:24px;border-radius:50%;background:#eef2ff;color:#4f46e5;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${i + 1}</span>
            <b style="font-size:13.5px;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nombre)}</b>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <b style="font-size:13.5px;color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</b>
            <div style="font-size:11.5px;color:#64748b">${c.n} compra(s)</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================
//  INFORME PDF — reporte formal estilo legacy (carta/A4)
// ============================================================

async function generarInformePDF() {
  if (_estado.desde > _estado.hasta) {
    Toast.warn('La fecha "Desde" no puede ser mayor a "Hasta"');
    return;
  }

  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {}, mensajes: {} }; }

  const r = reporteRango(_estado.desde, _estado.hasta);
  const html = htmlInformeFormal(r, cfg);
  const titulo = `Informe ${r.desde}_a_${r.hasta}`;

  try {
    imprimirCarta(html, { titulo });
    Toast.info('Selecciona "Guardar como PDF" en el diálogo de impresión para exportarlo');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo generar el informe');
  }
}

function htmlInformeFormal(r, cfg) {
  const margenPct = r.ventas > 0 ? (r.utilidadBruta / r.ventas * 100) : 0;
  const netaPct = r.ventas > 0 ? (r.utilidadNeta / r.ventas * 100) : 0;
  const cats = Object.entries(r.gastosPorCat).sort((a, b) => b[1] - a[1]);
  const colNeta = r.utilidadNeta >= 0 ? '#15803d' : '#dc2626';
  const colCaja = r.flujoCaja >= 0 ? '#15803d' : '#dc2626';

  const neg = cfg.negocio || {};
  const fechaGen = new Date().toLocaleString('es-CO');

  const filaTabla = (label, valor, opts = {}) => `
    <tr ${opts.bold ? 'style="font-weight:700"' : ''}>
      <td style="padding:6px 0;color:${opts.color || '#0f172a'}">${label}</td>
      <td style="padding:6px 0;text-align:right;color:${opts.color || '#0f172a'};font-family:'Courier New',monospace;white-space:nowrap;${opts.big ? 'font-size:15px;' : ''}">${typeof valor === 'string' ? valor : money(valor)}</td>
    </tr>
  `;

  const titulo = (txt, color = '#0f172a') => `
    <h2 style="font-size:14px;font-weight:800;color:${color};margin:14px 0 6px;border-bottom:2px solid ${color};padding-bottom:4px;letter-spacing:.02em">${esc(txt)}</h2>
  `;

  // CXP por proveedor (snapshot actual)
  const cxpPorProveedor = {};
  const hoyISO = todayISO();
  for (const c of _compras) {
    if (c.tipoPago === 'credito' && num(c.saldo) > 0.5) {
      const prov = c.proveedor || 'Sin proveedor';
      if (!cxpPorProveedor[prov]) cxpPorProveedor[prov] = { saldo: 0, nFacturas: 0, vencidas: 0 };
      cxpPorProveedor[prov].saldo += num(c.saldo);
      cxpPorProveedor[prov].nFacturas++;
      if (c.vence && c.vence < hoyISO) cxpPorProveedor[prov].vencidas++;
    }
  }
  const provs = Object.entries(cxpPorProveedor).sort((a, b) => b[1].saldo - a[1].saldo);

  // Inventario por categoría
  const invPorCategoria = {};
  for (const p of _productos) {
    const st = num(p.stock);
    if (st <= 0) continue;
    const cat = p.categoria || 'Sin categoría';
    if (!invPorCategoria[cat]) invPorCategoria[cat] = { valorCosto: 0, valorVenta: 0, unidades: 0, nSKUs: 0 };
    invPorCategoria[cat].valorCosto += st * num(p.costo);
    invPorCategoria[cat].valorVenta += st * num(p.precio);
    invPorCategoria[cat].unidades += st;
    invPorCategoria[cat].nSKUs++;
  }
  const invCats = Object.entries(invPorCategoria).sort((a, b) => b[1].valorCosto - a[1].valorCosto);
  const invUtilPotencial = r.invValorVenta - r.invValorCosto;
  const invMargenPct = r.invValorCosto > 0 ? (invUtilPotencial / r.invValorCosto * 100) : 0;

  // Top 5 productos vendidos en el periodo
  const acumProd = new Map();
  for (const v of _ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d < r.desde || d > r.hasta) continue;
    for (const it of v.items || []) {
      const id = it.producto_id || it.nombre;
      const prev = acumProd.get(id) || { nombre: it.nombre, cantidad: 0, total: 0 };
      prev.cantidad += num(it.cantidad);
      prev.total += num(it.total) || num(it.precio) * num(it.cantidad);
      acumProd.set(id, prev);
    }
  }
  const topProductos = [...acumProd.values()].sort((a, b) => b.total - a.total).slice(0, 5);

  return `
    <div style="font-family:'Helvetica','Arial',sans-serif;color:#0f172a;font-size:11.5px;line-height:1.45">
      <!-- ENCABEZADO -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #0f172a;padding-bottom:10px;margin-bottom:14px">
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">${esc(neg.nombre || 'PosPunto')}</div>
          ${neg.nit ? `<div style="font-size:11px;color:#475569;margin-top:1px">NIT/CC: ${esc(neg.nit)}</div>` : ''}
          ${neg.direccion ? `<div style="font-size:11px;color:#475569">${esc(neg.direccion)}${neg.ciudad ? ' · ' + esc(neg.ciudad) : ''}</div>` : ''}
          ${neg.telefono ? `<div style="font-size:11px;color:#475569">Tel: ${esc(neg.telefono)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Informe Financiero</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Generado: ${esc(fechaGen)}</div>
        </div>
      </div>

      <!-- PERIODO -->
      <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;color:#4338ca">📅 Periodo: ${fechaBonita(r.desde)} al ${fechaBonita(r.hasta)}</div>
        <div style="font-size:11px;color:#475569">${r.nFac} venta(s) · ${r.nCompras} compra(s) · ${r.nGastos} gasto(s)</div>
      </div>

      <!-- RESUMEN EJECUTIVO -->
      <div style="display:grid;gap:8px;grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Ventas</div>
          <div style="font-size:14px;font-weight:800;color:#4338ca;font-family:'Courier New',monospace">${money(r.ventas)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Compras</div>
          <div style="font-size:14px;font-weight:800;color:#0369a1;font-family:'Courier New',monospace">${money(r.compras)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Gastos</div>
          <div style="font-size:14px;font-weight:800;color:#dc2626;font-family:'Courier New',monospace">${money(r.gastos)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Utilidad Neta</div>
          <div style="font-size:14px;font-weight:800;color:${colNeta};font-family:'Courier New',monospace">${money(r.utilidadNeta)}</div>
        </div>
      </div>

      <!-- ESTADO DE RESULTADOS -->
      ${titulo('Utilidad por margen (rentabilidad)', '#4338ca')}
      <table style="width:100%;border-collapse:collapse">
        ${filaTabla('Ventas del periodo', r.ventas)}
        ${filaTabla('(−) Costo de lo vendido', -r.costoVenta, { color: '#475569' })}
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding:0"></td></tr>
        ${filaTabla('= Utilidad bruta', r.utilidadBruta, { bold: true, color: '#4338ca' })}
        ${filaTabla('(−) Gastos operativos', -r.gastos, { color: '#dc2626' })}
        <tr><td colspan="2" style="border-top:2px solid #0f172a;padding:0"></td></tr>
        ${filaTabla('= UTILIDAD NETA', r.utilidadNeta, { bold: true, color: colNeta, big: true })}
      </table>
      <div style="font-size:10.5px;color:#64748b;margin-top:4px;font-style:italic">
        Margen bruto: <b>${margenPct.toFixed(1)}%</b> · Margen neto: <b>${netaPct.toFixed(1)}%</b>
      </div>

      <!-- FLUJO DE CAJA -->
      ${titulo('Flujo de caja (dinero del periodo)', '#0369a1')}
      <table style="width:100%;border-collapse:collapse">
        ${filaTabla('Ventas (entró)', r.ventas, { color: '#15803d' })}
        ${filaTabla('(−) Compras de mercancía', -r.compras, { color: '#0369a1' })}
        ${filaTabla('(−) Gastos pagados', -r.gastos, { color: '#dc2626' })}
        ${r.abonosDelPeriodo > 0 ? filaTabla(`(−) Abonos a proveedores (${r.nAbonos})`, -r.abonosDelPeriodo, { color: '#a16207' }) : ''}
        <tr><td colspan="2" style="border-top:2px solid #0f172a;padding:0"></td></tr>
        ${filaTabla('= FLUJO DE CAJA', r.flujoCaja, { bold: true, color: colCaja, big: true })}
      </table>

      <!-- CUENTAS POR PAGAR -->
      ${r.cxpTotal > 0 ? `
        ${titulo('Cuentas por pagar a proveedores', '#a16207')}
        <div style="font-size:10.5px;color:#64748b;margin-bottom:6px;font-style:italic">
          Foto actual de la deuda · ${r.nFacturasPorPagar} factura(s) pendiente(s)
        </div>
        <table style="width:100%;border-collapse:collapse">
          ${filaTabla('Deuda total', r.cxpTotal, { bold: true })}
          ${r.cxpVencido > 0 ? filaTabla('  ⚠ Vencido', r.cxpVencido, { color: '#dc2626' }) : ''}
          ${r.cxpPorVencer > 0 ? filaTabla('  Por vencer', r.cxpPorVencer) : ''}
          ${r.cxpSinFecha > 0 ? filaTabla('  Sin fecha', r.cxpSinFecha) : ''}
        </table>
        ${r.creditoNuevo > 0 || r.abonosDelPeriodo > 0 ? `
          <div style="margin-top:8px;font-size:11px"><b>Movimientos del periodo:</b></div>
          <table style="width:100%;border-collapse:collapse">
            ${r.creditoNuevo > 0 ? filaTabla(`  Nuevos créditos (${r.nCreditosNuevos})`, r.creditoNuevo) : ''}
            ${r.abonosDelPeriodo > 0 ? filaTabla(`  Abonos realizados (${r.nAbonos})`, -r.abonosDelPeriodo) : ''}
          </table>
        ` : ''}
        ${provs.length > 0 ? `
          <div style="margin-top:8px;font-size:11px"><b>Detalle por proveedor:</b></div>
          <table style="width:100%;border-collapse:collapse">
            ${provs.map(([prov, d]) => filaTabla(
              `  ${esc(prov)}${d.vencidas > 0 ? ' ⚠' + d.vencidas + ' venc.' : ''} · ${d.nFacturas} fact.`,
              d.saldo,
            )).join('')}
          </table>
        ` : ''}
      ` : ''}

      <!-- INVENTARIO -->
      ${r.invValorCosto > 0 ? `
        ${titulo('Valor del inventario actual', '#8b5cf6')}
        <div style="font-size:10.5px;color:#64748b;margin-bottom:6px;font-style:italic">
          Foto actual de tu mercancía en bodega
        </div>
        <table style="width:100%;border-collapse:collapse">
          ${filaTabla('Valor a costo (lo que pagaste)', r.invValorCosto, { bold: true })}
          ${filaTabla('Valor a precio de venta', r.invValorVenta)}
          ${filaTabla('Utilidad potencial', invUtilPotencial, { color: '#15803d', bold: true })}
        </table>
        <div style="font-size:10.5px;color:#64748b;margin-top:4px;font-style:italic">
          Margen: <b>${invMargenPct.toFixed(1)}%</b> sobre costo · ${fmt(r.invUnidades)} unidades en ${r.invSKUs} producto(s)
          ${r.invBajoStock > 0 ? ` · ⚠ ${r.invBajoStock} con stock bajo` : ''}
          ${r.invSinStock > 0 ? ` · 🚫 ${r.invSinStock} agotados` : ''}
        </div>
        ${invCats.length > 0 ? `
          <div style="margin-top:8px;font-size:11px"><b>Por categoría:</b></div>
          <table style="width:100%;border-collapse:collapse">
            ${invCats.map(([cat, d]) => filaTabla(
              `  ${esc(cat)} · ${d.nSKUs} prod · ${fmt(d.unidades)} uds`,
              d.valorCosto,
            )).join('')}
          </table>
        ` : ''}
      ` : ''}

      <!-- GASTOS POR CATEGORÍA -->
      ${cats.length > 0 ? `
        ${titulo('Gastos por categoría', '#dc2626')}
        <table style="width:100%;border-collapse:collapse">
          ${cats.map(([k, v]) => filaTabla(esc(k), v)).join('')}
          <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding:0"></td></tr>
          ${filaTabla('Total gastos', r.gastos, { bold: true })}
        </table>
      ` : ''}

      <!-- TOP PRODUCTOS DEL PERIODO -->
      ${topProductos.length > 0 ? `
        ${titulo('Top 5 productos más vendidos del periodo', '#15803d')}
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="border-bottom:1px solid #cbd5e1;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;text-align:left">
              <th style="padding:5px 0">#</th>
              <th style="padding:5px 0">Producto</th>
              <th style="padding:5px 0;text-align:right">Unidades</th>
              <th style="padding:5px 0;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${topProductos.map((it, i) => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:5px 0;color:#94a3b8">${i + 1}</td>
                <td style="padding:5px 0">${esc(it.nombre)}</td>
                <td style="padding:5px 0;text-align:right;font-family:'Courier New',monospace">${fmt(it.cantidad)}</td>
                <td style="padding:5px 0;text-align:right;font-family:'Courier New',monospace;font-weight:700">${money(it.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      <!-- PIE -->
      <div style="border-top:1px solid #cbd5e1;margin-top:20px;padding-top:8px;font-size:9.5px;color:#94a3b8;font-style:italic;text-align:center">
        Reporte generado automáticamente por PosPunto · ${esc(fechaGen)}
      </div>
    </div>
  `;
}

// ============================================================
//  EXPORTAR CSV
// ============================================================

function exportarCSV() {
  if (_estado.desde > _estado.hasta) {
    Toast.warn('La fecha "Desde" no puede ser mayor a "Hasta"');
    return;
  }

  const r = reporteRango(_estado.desde, _estado.hasta);
  const filas = [];

  // Helper para escapar valores CSV
  const csv = (v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  };
  const linea = (...vals) => filas.push(vals.map(csv).join(','));

  // Encabezado
  linea('REPORTE FINANCIERO');
  linea('Periodo desde', r.desde);
  linea('Periodo hasta', r.hasta);
  linea('Generado', new Date().toLocaleString('es-CO'));
  linea('');

  // Resumen
  linea('RESUMEN EJECUTIVO');
  linea('Concepto', 'Valor');
  linea('Ventas', r.ventas);
  linea('Costo de lo vendido', r.costoVenta);
  linea('Utilidad bruta', r.utilidadBruta);
  linea('Compras', r.compras);
  linea('Gastos', r.gastos);
  linea('Abonos a proveedores', r.abonosDelPeriodo);
  linea('Utilidad neta', r.utilidadNeta);
  linea('Flujo de caja', r.flujoCaja);
  linea('Deuda pendiente (snapshot)', r.cxpTotal);
  linea('Valor inventario costo (snapshot)', r.invValorCosto);
  linea('');

  // Ventas del periodo
  linea('VENTAS DEL PERIODO');
  linea('Numero', 'Fecha', 'Cliente', 'Metodo de pago', 'Subtotal', 'Descuento', 'Total', 'Utilidad');
  const ventasPeriodo = _ventas.filter((v) => {
    const d = (v.fecha || '').slice(0, 10);
    return d >= r.desde && d <= r.hasta;
  });
  ventasPeriodo.forEach((v) => {
    linea(v.numero || '', (v.fecha || '').slice(0, 10), v.cliente_nombre || 'Ocasional', v.metodo_pago || '', v.subtotal || 0, v.descuento || 0, v.total || 0, v.utilidad || 0);
  });
  linea('');

  // Compras del periodo
  linea('COMPRAS DEL PERIODO');
  linea('Fecha', 'Proveedor', 'Factura', 'Tipo', 'Total', 'Saldo pendiente');
  const comprasPeriodo = _compras.filter((c) => {
    const d = (c.fecha || '').slice(0, 10);
    return d >= r.desde && d <= r.hasta;
  });
  comprasPeriodo.forEach((c) => {
    linea((c.fecha || '').slice(0, 10), c.proveedor || '', c.ref || '', c.tipoPago || 'contado', c.total || 0, c.saldo || 0);
  });
  linea('');

  // Gastos del periodo
  linea('GASTOS DEL PERIODO');
  linea('Fecha', 'Categoria', 'Concepto', 'Monto');
  const gastosPeriodo = _gastos.filter((g) => {
    const d = (g.fecha || '').slice(0, 10);
    return d >= r.desde && d <= r.hasta;
  });
  gastosPeriodo.forEach((g) => {
    linea((g.fecha || '').slice(0, 10), g.categoria || 'Otros', g.concepto || '', g.monto || 0);
  });

  // Descargar
  const csvContent = '﻿' + filas.join('\n');  // BOM para Excel UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${r.desde}_a_${r.hasta}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  Toast.ok('CSV descargado');
}

// ============================================================
//  INFORME POS 80mm — versión térmica del reporte financiero
// ============================================================

async function generarInformePOS() {
  if (_estado.desde > _estado.hasta) {
    Toast.warn('La fecha "Desde" no puede ser mayor a "Hasta"');
    return;
  }

  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {}, mensajes: {} }; }

  const r = reporteRango(_estado.desde, _estado.hasta);
  const html = htmlInformePOS80mm(r, cfg);
  const titulo = `Informe POS ${r.desde}_a_${r.hasta}`;

  try {
    imprimirPOS(html, { anchoMm: 80, titulo });
    Toast.ok('Enviando informe a la impresora térmica…');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo imprimir el informe');
  }
}

function htmlInformePOS80mm(r, cfg) {
  const neg = cfg.negocio || {};
  const fechaGen = new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  const cats = Object.entries(r.gastosPorCat).sort((a, b) => b[1] - a[1]);
  const margenPct = r.ventas > 0 ? (r.utilidadBruta / r.ventas * 100) : 0;
  const netaPct = r.ventas > 0 ? (r.utilidadNeta / r.ventas * 100) : 0;

  // Top 5 productos del periodo
  const acumProd = new Map();
  for (const v of _ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d < r.desde || d > r.hasta) continue;
    for (const it of v.items || []) {
      const id = it.producto_id || it.nombre;
      const prev = acumProd.get(id) || { nombre: it.nombre, cantidad: 0, total: 0 };
      prev.cantidad += num(it.cantidad);
      prev.total += num(it.total) || num(it.precio) * num(it.cantidad);
      acumProd.set(id, prev);
    }
  }
  const topProductos = [...acumProd.values()].sort((a, b) => b.total - a.total).slice(0, 5);

  // CXP por proveedor
  const cxpPorProveedor = {};
  for (const c of _compras) {
    if (c.tipoPago === 'credito' && num(c.saldo) > 0.5) {
      const prov = c.proveedor || 'Sin proveedor';
      cxpPorProveedor[prov] = (cxpPorProveedor[prov] || 0) + num(c.saldo);
    }
  }
  const provs = Object.entries(cxpPorProveedor).sort((a, b) => b[1] - a[1]);

  // Helpers
  const sep = '<div style="border-top:1px dashed #000;margin:5px 0"></div>';
  const sepDoble = '<div style="border-top:3px double #000;margin:6px 0"></div>';
  const titulo = (t) => `
    <div style="text-align:center;font-weight:bold;font-size:14px;margin:6px 0 3px;letter-spacing:.05em">${esc(t)}</div>
  `;
  const kv = (k, v, bold = false) => `
    <tr ${bold ? 'style="font-weight:bold"' : ''}>
      <td style="text-align:left;padding:1px 0;vertical-align:baseline">${esc(k)}</td>
      <td style="text-align:right;padding:1px 0;white-space:nowrap;vertical-align:baseline">${typeof v === 'string' ? v : money(v)}</td>
    </tr>
  `;
  const wrap = (rows) => `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rows}</tbody></table>`;
  const truncar = (s, n) => {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  return `
    <div style="font-family:'Courier New','Roboto Mono',monospace;color:#000;font-size:12.5px;line-height:1.4;padding:4px;width:100%;box-sizing:border-box">

      <!-- ENCABEZADO -->
      <div style="text-align:center;font-weight:bold;font-size:15px;margin-bottom:2px">${esc(neg.nombre || 'PosPunto')}</div>
      ${neg.nit ? `<div style="text-align:center;font-size:11px">NIT/CC: ${esc(neg.nit)}</div>` : ''}
      ${neg.direccion ? `<div style="text-align:center;font-size:11px">${esc(neg.direccion)}</div>` : ''}
      ${neg.ciudad ? `<div style="text-align:center;font-size:11px">${esc(neg.ciudad)}</div>` : ''}
      ${neg.telefono ? `<div style="text-align:center;font-size:11px">Tel: ${esc(neg.telefono)}</div>` : ''}

      ${sepDoble}
      <div style="text-align:center;font-weight:bold;font-size:13.5px;letter-spacing:.05em">INFORME FINANCIERO</div>
      ${sepDoble}

      <!-- PERIODO -->
      <div style="text-align:center;font-size:12px;margin-bottom:3px">
        Periodo: ${fechaBonita(r.desde)}<br>
        ${r.desde !== r.hasta ? `al ${fechaBonita(r.hasta)}` : ''}
      </div>
      <div style="text-align:center;font-size:11px;color:#333;margin-bottom:4px">
        ${r.nFac} venta(s) · ${r.nCompras} compra(s) · ${r.nGastos} gasto(s)
      </div>
      <div style="text-align:center;font-size:10.5px;color:#555;margin-bottom:4px">
        Generado: ${esc(fechaGen)}
      </div>

      ${sep}

      <!-- RENTABILIDAD -->
      ${titulo('RENTABILIDAD')}
      ${wrap(
        kv('Ventas', r.ventas) +
        kv('(-) Costo vendido', -r.costoVenta) +
        kv('= Utilidad bruta', r.utilidadBruta, true) +
        kv('(-) Gastos operativos', -r.gastos)
      )}
      ${sep}
      ${wrap(
        kv('= UTILIDAD NETA', r.utilidadNeta, true)
      )}
      <div style="font-size:10.5px;color:#333;margin-top:2px;text-align:center">
        Margen bruto ${margenPct.toFixed(1)}% · Neto ${netaPct.toFixed(1)}%
      </div>

      ${sep}

      <!-- FLUJO DE CAJA -->
      ${titulo('FLUJO DE CAJA')}
      ${wrap(
        kv('Ventas (entró)', r.ventas) +
        kv('(-) Compras', -r.compras) +
        kv('(-) Gastos', -r.gastos) +
        (r.abonosDelPeriodo > 0 ? kv(`(-) Abonos prov (${r.nAbonos})`, -r.abonosDelPeriodo) : '')
      )}
      ${sep}
      ${wrap(
        kv('= FLUJO DE CAJA', r.flujoCaja, true)
      )}

      <!-- CUENTAS POR PAGAR -->
      ${r.cxpTotal > 0 ? `
        ${sep}
        ${titulo('POR PAGAR (snapshot)')}
        ${wrap(
          kv('Deuda total', r.cxpTotal, true) +
          (r.cxpVencido > 0 ? kv('  Vencido', r.cxpVencido) : '') +
          (r.cxpPorVencer > 0 ? kv('  Por vencer', r.cxpPorVencer) : '') +
          (r.cxpSinFecha > 0 ? kv('  Sin fecha', r.cxpSinFecha) : '')
        )}
        <div style="font-size:10.5px;color:#333;margin-top:2px;text-align:center">
          ${r.nFacturasPorPagar} factura(s) pendiente(s)
        </div>
        ${provs.length > 0 ? `
          <div style="font-size:10.5px;font-weight:bold;margin:4px 0 2px">Por proveedor:</div>
          ${wrap(provs.map(([p, s]) => kv(truncar(p, 22), s)).join(''))}
        ` : ''}
      ` : ''}

      <!-- INVENTARIO -->
      ${r.invValorCosto > 0 ? `
        ${sep}
        ${titulo('INVENTARIO ACTUAL')}
        ${wrap(
          kv('Valor a costo', r.invValorCosto, true) +
          kv('Valor a venta', r.invValorVenta) +
          kv('Utilidad potencial', r.invValorVenta - r.invValorCosto, true)
        )}
        <div style="font-size:10.5px;color:#333;margin-top:2px;text-align:center">
          ${fmt(r.invUnidades)} uds · ${r.invSKUs} productos
        </div>
        ${r.invBajoStock > 0 ? `<div style="font-size:10.5px;color:#333;text-align:center">⚠ ${r.invBajoStock} con stock bajo</div>` : ''}
        ${r.invSinStock > 0 ? `<div style="font-size:10.5px;color:#333;text-align:center">✗ ${r.invSinStock} agotados</div>` : ''}
      ` : ''}

      <!-- GASTOS POR CATEGORÍA -->
      ${cats.length > 0 ? `
        ${sep}
        ${titulo('GASTOS POR CATEGORIA')}
        ${wrap(cats.map(([k, v]) => kv(truncar(k, 22), v)).join('') + kv('TOTAL', r.gastos, true))}
      ` : ''}

      <!-- TOP PRODUCTOS -->
      ${topProductos.length > 0 ? `
        ${sep}
        ${titulo('TOP 5 PRODUCTOS')}
        ${wrap(topProductos.map((it, i) => `
          <tr>
            <td colspan="2" style="padding:2px 0">
              <b>${i + 1}. ${esc(truncar(it.nombre, 24))}</b>
            </td>
          </tr>
          <tr>
            <td style="text-align:left;padding:0 0 3px 12px;font-size:11px">${fmt(it.cantidad)} uds</td>
            <td style="text-align:right;padding:0 0 3px 0;font-size:11px">${money(it.total)}</td>
          </tr>
        `).join(''))}
      ` : ''}

      ${sepDoble}
      <div style="text-align:center;font-size:10.5px;color:#555;margin-top:4px">
        — Fin del informe —
      </div>
      <div style="text-align:center;font-size:10px;color:#777;margin-top:2px">
        PosPunto
      </div>

      <div style="height:14px"></div>
    </div>
  `;
}
