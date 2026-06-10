/**
 * modules/cierre/cierre.view.js — Vista del Cierre de Caja
 *
 * Replica de renderCierre del legacy:
 *   - Filtros con presets (hoy/ayer/semana/mes/custom)
 *   - Banner del periodo
 *   - Paneles: Ventas / Gastos / Caja / Inventario
 *   - (Compras y CXP quedan pendientes hasta tener el módulo Compras)
 *   - Botón "Imprimir Informe POS" usando el servicio de impresión
 */

import * as VentasRepo from '../ventas/ventas.repo.js';
import * as GastosRepo from '../gastos/gastos.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ComprasRepo from '../compras/compras.repo.js';
import * as ConfigRepo from '../config/config.repo.js';
import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { Toast } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { imprimirPOS, imprimirCarta } from '../../services/printer.js';
import * as Realtime from '../../services/realtime.js';

let _offRealtime = null;

let _contenedor = null;
let _estado = { desde: '', hasta: '', preset: 'hoy' };
let _ventas = [];
let _gastos = [];
let _compras = [];
let _productos = [];

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;

  // Estado inicial: hoy
  const hoy = todayISO();
  _estado = { desde: hoy, hasta: hoy, preset: 'hoy' };

  contenedor.innerHTML = htmlCargando();

  try { _ventas = await VentasRepo.listar(); } catch (e) { console.warn(e); _ventas = []; }
  try { _gastos = await GastosRepo.listar(); } catch (e) { console.warn(e); _gastos = []; }
  try { _compras = await ComprasRepo.listar(); } catch (e) { console.warn(e); _compras = []; }
  try { _productos = await ProductosRepo.listar(); } catch (e) { console.warn(e); _productos = []; }

  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarContenido();

  // Realtime: cualquier cambio en datos relevantes refresca el cierre
  _offRealtime = Realtime.escucharVarias(
    ['ventas', 'compras', 'gastos', 'productos'],
    async () => {
      try {
        _ventas = await VentasRepo.listar();
        _gastos = await GastosRepo.listar();
        _compras = await ComprasRepo.listar();
        _productos = await ProductosRepo.listar();
        pintarContenido();
      } catch (err) { console.warn('Realtime cierre:', err); }
    },
  );
}

function pintarContenido() {
  const box = _contenedor?.querySelector('#cierre-contenido');
  if (!box) return;

  if (_estado.desde && _estado.hasta && _estado.desde > _estado.hasta) {
    box.innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;color:#991b1b;font-weight:600">
        ⚠️ La fecha "Desde" es posterior a "Hasta". Corrige el rango.
      </div>
    `;
    return;
  }

  const r = calcularReporte(_estado.desde, _estado.hasta);
  const tkt = r.nFac > 0 ? r.ventas / r.nFac : 0;
  const cats = Object.entries(r.gastosPorCat).sort((a, b) => b[1] - a[1]);
  const colCaja = r.flujoCaja >= 0 ? '#15803d' : '#dc2626';
  const colNeta = r.utilidadNeta >= 0 ? '#15803d' : '#dc2626';

  box.innerHTML = `
    <div style="background:#eef2ff;border:2px solid #4f46e5;border-radius:12px;padding:12px 14px;margin-bottom:18px;text-align:center;font-weight:700;color:#4338ca">
      📅 Periodo: <b>${fechaBonita(_estado.desde)}</b> → <b>${fechaBonita(_estado.hasta)}</b>
      &nbsp;·&nbsp; ${fmt(r.nFac)} venta(s) &nbsp;·&nbsp; ${fmt(r.nGastos)} gasto(s)
    </div>

    <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      ${htmlPanelVentas(r, tkt)}
      ${htmlPanelGastos(r, cats)}
      ${htmlPanelCaja(r, colCaja, colNeta)}
      ${htmlPanelInventario(r)}
    </div>

    <div style="background:#f8fafc;border:2px dashed #4f46e5;border-radius:12px;padding:18px;margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
        <div>
          <div style="font-size:17px;font-weight:800;color:#0f172a">¿Listo para cerrar?</div>
          <div style="color:#64748b;font-size:13.5px;margin-top:2px">Imprime el resumen del periodo en tu impresora POS térmica.</div>
        </div>
        <button id="cierre-btn-imprimir"
          style="padding:14px 26px;background:#4f46e5;color:white;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35);min-width:240px">
          🧾 Imprimir Informe POS
        </button>
      </div>
    </div>
  `;

  refrescarIconos(_contenedor);
  _contenedor.querySelector('#cierre-btn-imprimir').onclick = () => imprimirInforme(r);
}

// ============================================================
//  CÁLCULO DEL REPORTE
// ============================================================

function calcularReporte(desde, hasta) {
  let ventas = 0, utilidadBruta = 0, costoVenta = 0, nFac = 0;
  const metodosPago = {};         // { 'Efectivo': monto, 'Tarjeta': monto, ... }
  const topProductos = new Map(); // ranking de productos vendidos
  for (const v of _ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      const tot = num(v.total);
      const uti = num(v.utilidad);
      ventas += tot;
      utilidadBruta += uti;
      costoVenta += (tot - uti);
      nFac++;
      // Métodos de pago — primer token (ej: "Mixto (Efectivo: ...)" → "Mixto")
      const met = (v.metodo_pago || '').split(' ')[0] || '—';
      metodosPago[met] = (metodosPago[met] || 0) + tot;
      // Top productos
      for (const it of v.items || []) {
        const id = it.producto_id || it.nombre;
        const prev = topProductos.get(id) || { nombre: it.nombre, cantidad: 0, total: 0 };
        prev.cantidad += num(it.cantidad);
        prev.total += num(it.total) || num(it.precio) * num(it.cantidad);
        topProductos.set(id, prev);
      }
    }
  }
  const topProductosArr = [...topProductos.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);

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

  // Compras del periodo + abonos pagados en el periodo
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
    // Los abonos pueden caer en el periodo aunque la compra sea de otra fecha
    for (const a of c.abonos || []) {
      const da = (a.fecha || '').slice(0, 10);
      if (da >= desde && da <= hasta) {
        abonosDelPeriodo += num(a.monto);
        nAbonos++;
      }
    }
  }

  // Inventario al día
  let invSKUs = 0, invUnidades = 0, invValorCosto = 0, invValorVenta = 0;
  let invBajoStock = 0, invSinStock = 0;
  for (const p of _productos) {
    const st = num(p.stock);
    invSKUs++;
    if (st <= 0) invSinStock++;
    else {
      invUnidades += st;
      invValorCosto += st * num(p.costo);
      invValorVenta += st * num(p.precio);
    }
    if (st > 0 && st <= num(p.stock_min || 0)) invBajoStock++;
  }

  // Flujo de caja completo: ingresos - egresos del periodo
  // Solo cuenta lo que efectivamente entró/salió de caja durante el periodo.
  // Compras a contado y abonos sí cuentan; compras a crédito NO (no salió plata).
  const comprasContado = compras - creditoNuevo;
  const egresosCaja = comprasContado + abonosDelPeriodo + gastos;
  const flujoCaja = ventas - egresosCaja;
  const utilidadNeta = utilidadBruta - gastos;

  return {
    desde, hasta,
    ventas, utilidadBruta, costoVenta, nFac,
    metodosPago, topProductos: topProductosArr,
    gastos, nGastos, gastosPorCat,
    compras, nCompras, creditoNuevo, nCreditosNuevos, comprasContado,
    abonosDelPeriodo, nAbonos,
    invSKUs, invUnidades, invValorCosto, invValorVenta, invBajoStock, invSinStock,
    flujoCaja, egresosCaja, utilidadNeta,
  };
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  contenedor.querySelectorAll('.cierre-preset').forEach((btn) => {
    btn.addEventListener('click', () => aplicarPreset(btn.dataset.preset));
  });

  contenedor.querySelector('#cierre-desde')?.addEventListener('change', (e) => {
    _estado.desde = e.target.value;
    _estado.preset = 'custom';
    marcarPreset();
    pintarContenido();
  });
  contenedor.querySelector('#cierre-hasta')?.addEventListener('change', (e) => {
    _estado.hasta = e.target.value;
    _estado.preset = 'custom';
    marcarPreset();
    pintarContenido();
  });

  contenedor.querySelector('#cierre-btn-actualizar')?.addEventListener('click', async () => {
    try { _ventas = await VentasRepo.listar(); } catch (e) { /**/ }
    try { _gastos = await GastosRepo.listar(); } catch (e) { /**/ }
    try { _compras = await ComprasRepo.listar(); } catch (e) { /**/ }
    try { _productos = await ProductosRepo.listar(); } catch (e) { /**/ }
    pintarContenido();
    Toast.ok('Datos actualizados');
  });

  // Botones de cierre arriba (POS y PDF)
  contenedor.querySelector('#cierre-btn-pos-top')?.addEventListener('click', () => {
    const r = calcularReporte(_estado.desde, _estado.hasta);
    imprimirInforme(r);
  });
  contenedor.querySelector('#cierre-btn-pdf')?.addEventListener('click', async () => {
    const r = calcularReporte(_estado.desde, _estado.hasta);
    await imprimirCierrePDF(r);
  });
}

function aplicarPreset(preset) {
  const hoy = todayISO();
  const d = new Date();
  let desde = hoy, hasta = hoy;
  if (preset === 'hoy') { desde = hoy; hasta = hoy; }
  else if (preset === 'ayer') {
    const a = new Date(d); a.setDate(d.getDate() - 1);
    desde = hasta = a.toISOString().slice(0, 10);
  } else if (preset === 'semana') {
    const i = new Date(d); i.setDate(d.getDate() - d.getDay());
    desde = i.toISOString().slice(0, 10); hasta = hoy;
  } else if (preset === 'mes') {
    desde = hoy.slice(0, 8) + '01'; hasta = hoy;
  } else if (preset === 'custom') {
    _estado.preset = 'custom';
    marcarPreset();
    return;
  }
  _estado = { desde, hasta, preset };
  const inpD = _contenedor.querySelector('#cierre-desde');
  const inpH = _contenedor.querySelector('#cierre-hasta');
  if (inpD) inpD.value = desde;
  if (inpH) inpH.value = hasta;
  marcarPreset();
  pintarContenido();
}

function marcarPreset() {
  _contenedor?.querySelectorAll('.cierre-preset').forEach((btn) => {
    const activo = btn.dataset.preset === _estado.preset;
    btn.style.background = activo ? '#4f46e5' : 'white';
    btn.style.color = activo ? 'white' : '#475569';
    btn.style.borderColor = activo ? '#4f46e5' : '#e2e8f0';
  });
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando cierre de caja…</div>`;
}

function htmlLayout() {
  const presets = [
    ['hoy', 'Hoy'],
    ['ayer', 'Ayer'],
    ['semana', 'Esta semana'],
    ['mes', 'Este mes'],
    ['custom', 'Personalizado'],
  ];

  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <div>
            <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">📑 Cierre de Caja</h1>
            <div style="color:#64748b;font-weight:500;margin-top:4px;font-size:13.5px">Informe financiero del periodo, listo para imprimir en POS térmica.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="cierre-btn-actualizar"
              style="padding:10px 14px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569">📊 Actualizar</button>
            <button id="cierre-btn-pdf"
              style="padding:10px 14px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">📄 Cierre PDF</button>
            <button id="cierre-btn-pos-top"
              style="padding:10px 18px;background:#15803d;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35);display:flex;align-items:center;gap:6px">
              🧾 Hacer cierre POS
            </button>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${presets.map((p) => `
            <button class="cierre-preset" data-preset="${p[0]}"
              style="padding:8px 14px;border:1px solid ${_estado.preset === p[0] ? '#4f46e5' : '#e2e8f0'};background:${_estado.preset === p[0] ? '#4f46e5' : 'white'};color:${_estado.preset === p[0] ? 'white' : '#475569'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">
              ${p[1]}
            </button>
          `).join('')}
        </div>

        <div style="display:grid;gap:14px;grid-template-columns:1fr 1fr">
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">📅 Desde</div>
            <input id="cierre-desde" type="date" value="${esc(_estado.desde)}"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">📅 Hasta</div>
            <input id="cierre-hasta" type="date" value="${esc(_estado.hasta)}"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
        </div>
      </div>

      <div id="cierre-contenido"></div>
    </div>
  `;
}

function htmlPanelVentas(r, tkt) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🟢 Ventas</h3>
        <span style="background:#e0e7ff;color:#4338ca;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px">${fmt(r.nFac)} fac.</span>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total vendido</div>
        <div style="font-size:24px;font-weight:800;color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(r.ventas)}</div>
      </div>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0">
      ${kvLinea('Ticket promedio', money(tkt))}
      ${kvLinea('Costo de venta', money(r.costoVenta))}
      ${kvLinea('Utilidad bruta', `<b style="color:#15803d">${money(r.utilidadBruta)}</b>`)}
    </div>
  `;
}

function htmlPanelGastos(r, cats) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">💸 Gastos</h3>
        <span style="background:#fef2f2;color:#dc2626;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px">${fmt(r.nGastos)}</span>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total gastos</div>
        <div style="font-size:24px;font-weight:800;color:#dc2626;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(r.gastos)}</div>
      </div>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0">
      ${cats.length
        ? cats.slice(0, 6).map(([cat, v]) => kvLinea(esc(cat), money(v))).join('')
          + (cats.length > 6 ? `<div style="color:#94a3b8;font-size:12.5px;text-align:center;padding:4px">+ ${cats.length - 6} categorías más</div>` : '')
        : `<div style="color:#94a3b8;text-align:center;padding:8px;font-size:13.5px">Sin gastos en este periodo</div>`
      }
    </div>
  `;
}

function htmlPanelCaja(r, colCaja, colNeta) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">💰 Caja</h3>
        <span style="background:${r.flujoCaja >= 0 ? '#dcfce7' : '#fef2f2'};color:${r.flujoCaja >= 0 ? '#166534' : '#dc2626'};font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px">${r.flujoCaja >= 0 ? 'POSITIVA' : 'NEGATIVA'}</span>
      </div>
      ${kvLinea('Ingresos (ventas)', `<b style="color:#15803d">${money(r.ventas)}</b>`)}
      ${kvLinea('Egresos (gastos)', `<b style="color:#dc2626">- ${money(r.gastos)}</b>`)}
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0">
      <div style="margin-bottom:10px">
        <div style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Caja del periodo</div>
        <div style="font-size:28px;font-weight:800;color:${colCaja};font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(r.flujoCaja)}</div>
      </div>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0">
      ${kvLinea('Utilidad neta', `<b style="color:${colNeta}">${money(r.utilidadNeta)}</b>`)}
    </div>
  `;
}

function htmlPanelInventario(r) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">📦 Inventario (al día)</h3>
        <span style="background:#e0e7ff;color:#4338ca;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px">${fmt(r.invSKUs)} SKUs</span>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Valor inventario (costo)</div>
        <div style="font-size:24px;font-weight:800;color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(r.invValorCosto)}</div>
      </div>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0">
      ${kvLinea('Valor a precio venta', money(r.invValorVenta))}
      ${kvLinea('Unidades totales', fmt(r.invUnidades))}
      ${kvLinea('⚠️ Stock bajo', `<b style="color:#a16207">${fmt(r.invBajoStock)} productos</b>`)}
      ${kvLinea('❌ Agotados', `<b style="color:#dc2626">${fmt(r.invSinStock)} productos</b>`)}
    </div>
  `;
}

function kvLinea(k, v) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
      <span style="color:#64748b;font-weight:600;font-size:13.5px">${k}</span>
      <span style="font-weight:600;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13.5px">${v}</span>
    </div>
  `;
}

function fechaBonita(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
//  IMPRESIÓN POS
// ============================================================

async function imprimirInforme(r) {
  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {} }; }
  const neg = cfg.negocio || {};

  const tkt = r.nFac > 0 ? r.ventas / r.nFac : 0;
  const margenPct = r.ventas > 0 ? (r.utilidadBruta / r.ventas * 100) : 0;
  const cats = Object.entries(r.gastosPorCat).sort((a, b) => b[1] - a[1]);
  const metodos = Object.entries(r.metodosPago || {}).sort((a, b) => b[1] - a[1]);
  const ahora = new Date();
  const fechaImp = ahora.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = ahora.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

  const sep = `<div style="border-top:1px dashed #000;margin:4px 0"></div>`;
  const dblSep = `<div style="border-top:3px double #000;margin:5px 0"></div>`;
  const kv = (k, v, bold = false) => `<tr style="${bold ? 'font-weight:bold;' : ''}"><td style="text-align:left;padding:1px 0">${k}</td><td style="text-align:right;padding:1px 0;white-space:nowrap">${v}</td></tr>`;
  const titulo = (t) => `<div style="text-align:center;font-weight:bold;font-size:13.5px;margin:5px 0 2px 0;letter-spacing:.04em;background:#000;color:#fff;padding:2px 0">${esc(t)}</div>`;
  const wrap = (rows) => `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rows}</tbody></table>`;
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const html = `
    <div style="font-family:'Courier New', monospace;color:#000;font-size:12px;line-height:1.4;padding:4px">

      <!-- Encabezado del negocio -->
      ${neg.nombre ? `<div style="text-align:center;font-weight:bold;font-size:14px">${esc(neg.nombre)}</div>` : ''}
      ${neg.direccion ? `<div style="text-align:center;font-size:11px">${esc(neg.direccion)}</div>` : ''}
      ${neg.ciudad ? `<div style="text-align:center;font-size:11px">${esc(neg.ciudad)}</div>` : ''}
      ${neg.telefono ? `<div style="text-align:center;font-size:11px">Tel: ${esc(neg.telefono)}</div>` : ''}

      ${dblSep}
      <div style="text-align:center;font-weight:bold;font-size:14px;letter-spacing:.05em">CIERRE DE CAJA</div>
      ${dblSep}

      <div style="text-align:center;font-size:11.5px;margin-bottom:2px">
        Periodo: ${fechaBonita(r.desde)}${r.desde !== r.hasta ? '<br>al ' + fechaBonita(r.hasta) : ''}
      </div>
      <div style="text-align:center;font-size:10.5px;color:#555">
        Generado: ${fechaImp} · ${hora}
      </div>

      <!-- VENTAS -->
      ${titulo('VENTAS')}
      ${wrap(
        kv('Facturas', fmt(r.nFac)) +
        kv('Total vendido', money(r.ventas), true) +
        kv('Ticket promedio', money(tkt)) +
        kv('Costo de venta', money(r.costoVenta)) +
        kv('Utilidad bruta', money(r.utilidadBruta), true)
      )}
      <div style="font-size:10.5px;color:#333;text-align:center;margin-top:2px">
        Margen sobre ventas: ${margenPct.toFixed(1)}%
      </div>

      <!-- MÉTODOS DE PAGO -->
      ${metodos.length > 0 ? `
        ${titulo('MÉTODOS DE PAGO')}
        ${wrap(metodos.map(([m, v]) => kv(m, money(v))).join(''))}
      ` : ''}

      <!-- COMPRAS -->
      ${r.nCompras > 0 ? `
        ${titulo('COMPRAS')}
        ${wrap(
          kv('Registradas', fmt(r.nCompras)) +
          kv('Total compras', money(r.compras), true) +
          (r.comprasContado > 0 ? kv('  De contado', money(r.comprasContado)) : '') +
          (r.creditoNuevo > 0 ? kv(`  A crédito (${r.nCreditosNuevos})`, money(r.creditoNuevo)) : '') +
          (r.abonosDelPeriodo > 0 ? kv(`Abonos pagados (${r.nAbonos})`, money(r.abonosDelPeriodo)) : '')
        )}
      ` : ''}

      <!-- GASTOS -->
      ${titulo('GASTOS')}
      ${wrap(
        kv('Registros', fmt(r.nGastos)) +
        kv('Total gastos', money(r.gastos), true) +
        (cats.length > 0 ? cats.map(([cat, v]) => kv('  ' + trunc(cat, 18), money(v))).join('') : '')
      )}

      <!-- CAJA -->
      ${titulo('CAJA DEL DÍA')}
      ${wrap(
        kv('Ingresos (ventas)', money(r.ventas)) +
        (r.comprasContado > 0 ? kv('(-) Compras contado', money(r.comprasContado)) : '') +
        (r.abonosDelPeriodo > 0 ? kv('(-) Abonos proveedores', money(r.abonosDelPeriodo)) : '') +
        kv('(-) Gastos', money(r.gastos))
      )}
      ${sep}
      ${wrap(
        kv('FLUJO DE CAJA', money(r.flujoCaja), true) +
        kv('UTILIDAD NETA', money(r.utilidadNeta), true)
      )}

      <!-- TOP PRODUCTOS -->
      ${r.topProductos && r.topProductos.length > 0 ? `
        ${titulo('TOP 5 PRODUCTOS')}
        ${wrap(r.topProductos.slice(0, 5).map((it, i) => `
          <tr>
            <td colspan="2" style="padding:2px 0">
              <b>${i + 1}. ${esc(trunc(it.nombre, 24))}</b>
            </td>
          </tr>
          <tr>
            <td style="text-align:left;padding:0 0 3px 12px;font-size:10.5px">${fmt(it.cantidad)} uds</td>
            <td style="text-align:right;padding:0 0 3px 0;font-size:10.5px">${money(it.total)}</td>
          </tr>
        `).join(''))}
      ` : ''}

      <!-- INVENTARIO (al cierre) -->
      ${titulo('INVENTARIO (al cierre)')}
      ${wrap(
        kv('SKUs', fmt(r.invSKUs)) +
        kv('Unidades', fmt(r.invUnidades)) +
        kv('Valor a costo', money(r.invValorCosto), true) +
        kv('Valor a venta', money(r.invValorVenta)) +
        (r.invBajoStock > 0 ? kv('⚠ Stock bajo', fmt(r.invBajoStock)) : '') +
        (r.invSinStock > 0 ? kv('✗ Agotados', fmt(r.invSinStock)) : '')
      )}

      ${dblSep}
      <div style="text-align:center;font-size:10.5px;color:#555;margin-top:4px">
        — Cierre realizado —
      </div>
      <div style="margin-top:18px;padding-top:6px;border-top:1px dashed #999;text-align:center;font-size:10px;color:#777">
        Firma del responsable
      </div>
      <div style="height:16px"></div>
    </div>
  `;

  try {
    imprimirPOS(html, { titulo: `Cierre ${r.desde}` });
    Toast.ok('Enviando cierre a impresora…');
  } catch (err) {
    console.error('Error imprimiendo:', err);
    Toast.error('No se pudo imprimir el informe');
  }
}

// ============================================================
//  CIERRE EN PDF CARTA
// ============================================================

async function imprimirCierrePDF(r) {
  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {} }; }
  const neg = cfg.negocio || {};

  const tkt = r.nFac > 0 ? r.ventas / r.nFac : 0;
  const margenPct = r.ventas > 0 ? (r.utilidadBruta / r.ventas * 100) : 0;
  const netaPct = r.ventas > 0 ? (r.utilidadNeta / r.ventas * 100) : 0;
  const cats = Object.entries(r.gastosPorCat).sort((a, b) => b[1] - a[1]);
  const metodos = Object.entries(r.metodosPago || {}).sort((a, b) => b[1] - a[1]);
  const totalMetodos = metodos.reduce((s, [, v]) => s + v, 0);
  const fechaGen = new Date().toLocaleString('es-CO');
  const colNeta = r.utilidadNeta >= 0 ? '#15803d' : '#dc2626';
  const colCaja = r.flujoCaja >= 0 ? '#15803d' : '#dc2626';

  const kpi = (label, valor, color) => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">
      <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">${esc(label)}</div>
      <div style="font-size:15px;font-weight:800;color:${color};font-family:'Courier New',monospace;margin-top:2px">${typeof valor === 'string' ? valor : money(valor)}</div>
    </div>
  `;

  const fila = (l, v, opts = {}) => `
    <tr ${opts.bold ? 'style="font-weight:700"' : ''}>
      <td style="padding:5px 0;color:${opts.color || '#0f172a'}">${l}</td>
      <td style="padding:5px 0;text-align:right;color:${opts.color || '#0f172a'};font-family:'Courier New',monospace;white-space:nowrap;${opts.big ? 'font-size:14px;' : ''}">${typeof v === 'string' ? v : money(v)}</td>
    </tr>
  `;

  const tituloSec = (txt, color = '#0f172a') => `
    <h2 style="font-size:13px;font-weight:800;color:${color};margin:14px 0 6px;border-bottom:2px solid ${color};padding-bottom:4px;letter-spacing:.02em">${esc(txt)}</h2>
  `;

  const html = `
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
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Cierre de Caja</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(fechaGen)}</div>
        </div>
      </div>

      <!-- PERIODO -->
      <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="font-weight:700;color:#4338ca">📅 Periodo: ${fechaBonita(r.desde)} al ${fechaBonita(r.hasta)}</div>
        <div style="font-size:11px;color:#475569">${r.nFac} venta(s) · ${r.nCompras} compra(s) · ${r.nGastos} gasto(s)</div>
      </div>

      <!-- KPIs PRINCIPALES -->
      <div style="display:grid;gap:8px;grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        ${kpi('Ventas', r.ventas, '#4338ca')}
        ${kpi('Utilidad bruta', r.utilidadBruta, '#15803d')}
        ${kpi('Gastos', r.gastos, '#dc2626')}
        ${kpi('Utilidad neta', r.utilidadNeta, colNeta)}
      </div>

      <!-- SECCIÓN VENTAS -->
      ${tituloSec('🟢 Ventas del periodo', '#15803d')}
      <table style="width:100%;border-collapse:collapse">
        ${fila('Facturas emitidas', fmt(r.nFac))}
        ${fila('Total vendido', r.ventas, { bold: true })}
        ${fila('Ticket promedio', tkt)}
        ${fila('Costo de lo vendido', r.costoVenta)}
        ${fila('Utilidad bruta', r.utilidadBruta, { bold: true, color: '#15803d' })}
        ${fila('Margen sobre ventas', `${margenPct.toFixed(1)}%`)}
      </table>

      ${metodos.length > 0 ? `
        ${tituloSec('💳 Métodos de pago', '#4338ca')}
        <table style="width:100%;border-collapse:collapse">
          ${metodos.map(([m, v]) => `
            <tr>
              <td style="padding:5px 0">${esc(m)} <span style="color:#64748b">(${totalMetodos > 0 ? ((v / totalMetodos) * 100).toFixed(1) : 0}%)</span></td>
              <td style="padding:5px 0;text-align:right;font-family:'Courier New',monospace">${money(v)}</td>
            </tr>
          `).join('')}
        </table>
      ` : ''}

      ${r.nCompras > 0 ? `
        ${tituloSec('🚚 Compras del periodo', '#0369a1')}
        <table style="width:100%;border-collapse:collapse">
          ${fila('Compras registradas', fmt(r.nCompras))}
          ${fila('Total comprado', r.compras, { bold: true })}
          ${r.comprasContado > 0 ? fila('  De contado', r.comprasContado) : ''}
          ${r.creditoNuevo > 0 ? fila(`  A crédito (${r.nCreditosNuevos})`, r.creditoNuevo, { color: '#a16207' }) : ''}
          ${r.abonosDelPeriodo > 0 ? fila(`Abonos a proveedores (${r.nAbonos})`, r.abonosDelPeriodo) : ''}
        </table>
      ` : ''}

      ${tituloSec('💸 Gastos del periodo', '#dc2626')}
      <table style="width:100%;border-collapse:collapse">
        ${fila('Registros', fmt(r.nGastos))}
        ${fila('Total gastos', r.gastos, { bold: true, color: '#dc2626' })}
        ${cats.length > 0 ? cats.map(([cat, v]) => fila('  ' + esc(cat), v)).join('') : ''}
      </table>

      <!-- CAJA / FLUJO -->
      ${tituloSec('💧 Flujo de caja del periodo', colCaja)}
      <table style="width:100%;border-collapse:collapse">
        ${fila('Ingresos (ventas)', r.ventas, { color: '#15803d' })}
        ${r.comprasContado > 0 ? fila('(−) Compras contado', -r.comprasContado, { color: '#0369a1' }) : ''}
        ${r.abonosDelPeriodo > 0 ? fila('(−) Abonos a proveedores', -r.abonosDelPeriodo, { color: '#a16207' }) : ''}
        ${fila('(−) Gastos pagados', -r.gastos, { color: '#dc2626' })}
        <tr><td colspan="2" style="border-top:2px solid #0f172a;padding:0"></td></tr>
        ${fila('= FLUJO DE CAJA', r.flujoCaja, { bold: true, color: colCaja, big: true })}
      </table>

      <!-- ESTADO DE RESULTADOS -->
      ${tituloSec('⭐ Utilidad del periodo', colNeta)}
      <table style="width:100%;border-collapse:collapse">
        ${fila('Utilidad bruta', r.utilidadBruta)}
        ${fila('(−) Gastos operativos', -r.gastos, { color: '#dc2626' })}
        <tr><td colspan="2" style="border-top:2px solid #0f172a;padding:0"></td></tr>
        ${fila('= UTILIDAD NETA', r.utilidadNeta, { bold: true, color: colNeta, big: true })}
      </table>
      <div style="font-size:10.5px;color:#64748b;margin-top:4px;font-style:italic">
        Margen neto: <b>${netaPct.toFixed(1)}%</b>
      </div>

      <!-- TOP PRODUCTOS -->
      ${r.topProductos && r.topProductos.length > 0 ? `
        ${tituloSec('🏆 Productos más vendidos del periodo', '#a16207')}
        <table style="width:100%;border-collapse:collapse;font-size:10.5px">
          <thead>
            <tr style="border-bottom:1px solid #cbd5e1;color:#64748b;font-size:9.5px;font-weight:700;text-transform:uppercase;text-align:left">
              <th style="padding:4px 0">#</th>
              <th style="padding:4px 0">Producto</th>
              <th style="padding:4px 0;text-align:right">Unidades</th>
              <th style="padding:4px 0;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${r.topProductos.slice(0, 10).map((it, i) => `
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

      <!-- INVENTARIO AL CIERRE -->
      ${tituloSec('📦 Inventario al cierre', '#8b5cf6')}
      <table style="width:100%;border-collapse:collapse">
        ${fila('SKUs', fmt(r.invSKUs))}
        ${fila('Unidades totales', fmt(r.invUnidades))}
        ${fila('Valor a costo', r.invValorCosto, { bold: true })}
        ${fila('Valor a venta', r.invValorVenta)}
        ${r.invBajoStock > 0 ? fila('  Con stock bajo', `${fmt(r.invBajoStock)} producto(s)`, { color: '#a16207' }) : ''}
        ${r.invSinStock > 0 ? fila('  Agotados', `${fmt(r.invSinStock)} producto(s)`, { color: '#dc2626' }) : ''}
      </table>

      <!-- FIRMA -->
      <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
        <div style="text-align:center">
          <div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#475569">
            <b>Responsable del cierre</b><br>
            <span style="font-size:10px;color:#94a3b8">Nombre + CC</span>
          </div>
        </div>
        <div style="text-align:center">
          <div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#475569">
            <b>Aprobación</b><br>
            <span style="font-size:10px;color:#94a3b8">Administrador / Dueño</span>
          </div>
        </div>
      </div>

      <!-- PIE -->
      <div style="border-top:1px solid #cbd5e1;margin-top:18px;padding-top:8px;font-size:9.5px;color:#94a3b8;font-style:italic;text-align:center">
        Cierre generado por PosPunto · ${esc(fechaGen)}
      </div>
    </div>
  `;

  try {
    imprimirCarta(html, { titulo: `Cierre caja ${r.desde}` });
    Toast.info('Selecciona "Guardar como PDF" en el diálogo de impresión');
  } catch (err) {
    console.error('Error imprimiendo cierre PDF:', err);
    Toast.error('No se pudo generar el cierre PDF');
  }
}
