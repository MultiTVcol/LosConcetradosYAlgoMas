/**
 * modules/dashboard/dashboard.view.js — Vista del Dashboard
 *
 * Replica de renderDashboard del legacy:
 *   - Card "Cierre de Caja" destacada (link a #cierre)
 *   - KPIs: Ventas hoy / Utilidad hoy / Semana / Mes / Valor inventario
 *   - Atajos: Nueva venta, Productos, Clientes, Compras
 *   - Últimas ventas + Alertas de stock bajo
 *   - Stats: Productos, Clientes, Compras, Stock crítico
 */

import * as VentasRepo from '../ventas/ventas.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import * as Realtime from '../../services/realtime.js';
import { Router } from '../../core/index.js';
import { money, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { refrescarIconos } from '../../app/shell.js';

let _offRealtime = null;

// ============================================================
//  HELPERS
// ============================================================

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calcula total/utilidad/cantidad de ventas dentro de un rango de fechas (YYYY-MM-DD).
 */
function rangoTotales(ventas, desde, hasta) {
  let total = 0;
  let utilidad = 0;
  let n = 0;
  for (const v of ventas) {
    const d = (v.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      total += Number(v.total) || 0;
      utilidad += Number(v.utilidad) || 0;
      n++;
    }
  }
  return { total, utilidad, n };
}

// ============================================================
//  RENDERIZADO
// ============================================================

export async function render(contenedor) {
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }
  contenedor.innerHTML = htmlCargando();

  let ventas = [];
  let productos = [];
  let clientes = [];

  try { ventas = await VentasRepo.listar(); } catch (e) { console.warn('No se pudieron cargar ventas:', e); }
  try { productos = await ProductosRepo.listar(); } catch (e) { console.warn('No se pudieron cargar productos:', e); }
  try { clientes = await ClientesRepo.listar(); } catch (e) { console.warn('No se pudieron cargar clientes:', e); }

  const hoy = todayISO();
  const d = new Date();
  const ini = new Date(d);
  ini.setDate(d.getDate() - d.getDay()); // domingo de esta semana
  const semDesde = ini.toISOString().slice(0, 10);
  const mesDesde = hoy.slice(0, 8) + '01';

  const tHoy = rangoTotales(ventas, hoy, hoy);
  const tSem = rangoTotales(ventas, semDesde, hoy);
  const tMes = rangoTotales(ventas, mesDesde, hoy);

  const bajos = productos.filter((p) => Number(p.stock) <= Number(p.stock_min || 0));
  const ultimas = [...ventas].slice(0, 5);

  let invValorCosto = 0;
  let invUnidades = 0;
  for (const p of productos) {
    const st = Number(p.stock) || 0;
    if (st > 0) {
      invValorCosto += st * (Number(p.costo) || 0);
      invUnidades += st;
    }
  }

  contenedor.innerHTML = htmlLayout({
    tHoy, tSem, tMes,
    bajos, ultimas,
    totalProd: productos.length,
    totalCli: clientes.length,
    invValorCosto, invUnidades,
  });

  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);

  // Realtime: re-renderizar dashboard al recibir cambios remotos
  _offRealtime = Realtime.escucharVarias(
    ['ventas', 'productos', 'clientes', 'compras', 'gastos'],
    () => render(contenedor),
  );
}

function adjuntarEventos(contenedor) {
  contenedor.querySelectorAll('[data-ir]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const ruta = el.dataset.ir;
      Router.navegar(ruta);
    });
  });
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando dashboard…</div>`;
}

function htmlLayout(d) {
  const { tHoy, tSem, tMes, bajos, ultimas, totalProd, totalCli, invValorCosto, invUnidades } = d;

  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="home" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Inicio</h1>
      </div>

      ${htmlCardCierre()}

      ${htmlKPIs(tHoy, tSem, tMes, invValorCosto, invUnidades)}

      ${htmlAtajos()}

      <div style="display:grid;gap:16px;grid-template-columns:1.5fr 1fr;margin-bottom:18px" class="dash-grid">
        ${htmlUltimasVentas(ultimas)}
        ${htmlAlertasStock(bajos)}
      </div>

      ${htmlStats(totalProd, totalCli, bajos.length)}
    </div>
  `;
}

function htmlCardCierre() {
  return `
    <div data-ir="cierre" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:18px;cursor:pointer;display:flex;align-items:center;gap:14px;flex-wrap:wrap;transition:all .2s ease">
      <div style="width:44px;height:44px;border-radius:11px;background:#eef2ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(79,70,229,.15)">
        <i data-lucide="shield-check" style="width:22px;height:22px;stroke-width:2"></i>
      </div>
      <div style="flex:1;min-width:180px">
        <div style="font-size:15px;font-weight:600;color:#0f172a;letter-spacing:-0.012em">Cierre de Caja</div>
        <div style="font-size:13px;color:#64748b;margin-top:1px">Genera el informe del día e imprime el ticket de cierre</div>
      </div>
      <button data-ir="cierre"
        style="white-space:nowrap;padding:10px 16px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;display:flex;align-items:center;gap:8px;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
        <i data-lucide="shield-check" style="width:16px;height:16px"></i>
        Hacer Cierre
      </button>
    </div>
  `;
}

function htmlKPIs(tHoy, tSem, tMes, invValorCosto, invUnidades) {
  const kpi = (label, valor, sublabel, icono, colorBg, colorFg) => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px 16px;position:relative;overflow:hidden">
      <div style="position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;background:${colorBg};color:${colorFg};display:flex;align-items:center;justify-content:center">
        <i data-lucide="${icono}" style="width:16px;height:16px"></i>
      </div>
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${valor}</div>
      <div style="color:#64748b;font-weight:500;margin-top:8px;font-size:12.5px">${sublabel}</div>
    </div>
  `;

  const cardInv = invValorCosto > 0 ? `
    <div data-ir="productos" style="background:white;border:1px solid #c4b5fd;border-radius:12px;padding:18px 20px 16px;position:relative;overflow:hidden;cursor:pointer">
      <div style="position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:10px;background:rgba(139,92,246,.15);color:#8b5cf6;display:flex;align-items:center;justify-content:center;font-size:18px">📦</div>
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Valor inventario (costo)</div>
      <div style="font-size:22px;font-weight:700;color:#8b5cf6;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(invValorCosto)}</div>
      <div style="color:#64748b;font-weight:500;margin-top:8px;font-size:12.5px">
        <span style="background:rgba(139,92,246,.15);color:#8b5cf6;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-right:6px">${fmt(invUnidades)}</span> unidades en bodega
      </div>
    </div>
  ` : '';

  return `
    <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:18px">
      ${kpi('Ventas de hoy', money(tHoy.total), `<span style="background:#e0e7ff;color:#4338ca;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-right:6px">${tHoy.n}</span> factura(s) emitidas`, 'dollar-sign', '#eef2ff', '#4f46e5')}
      ${kpi('Utilidad de hoy', money(tHoy.utilidad), 'Ganancia estimada', 'trending-up', '#dcfce7', '#15803d')}
      ${kpi('Ventas de la semana', money(tSem.total), `<span style="background:#e0e7ff;color:#4338ca;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-right:6px">${tSem.n}</span> facturas`, 'calendar', '#fef3c7', '#a16207')}
      ${kpi('Ventas del mes', money(tMes.total), `<span style="background:#e0e7ff;color:#4338ca;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;margin-right:6px">${tMes.n}</span> facturas`, 'bar-chart-3', '#fef3c7', '#a16207')}
      ${cardInv}
    </div>
  `;
}

function htmlAtajos() {
  const btn = (ruta, icono, label, primario = false) => `
    <button data-ir="${ruta}"
      style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 22px;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:600;font-family:inherit;${primario ? 'background:#4f46e5;color:white;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)' : 'background:white;color:#0f172a;border:1px solid #e2e8f0'}">
      <i data-lucide="${icono}" style="width:18px;height:18px"></i>
      ${label}
    </button>
  `;

  return `
    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:22px">
      ${btn('ventas', 'shopping-cart', 'Nueva venta', true)}
      ${btn('productos', 'package', 'Gestionar productos')}
      ${btn('clientes', 'users', 'Clientes')}
      ${btn('compras', 'truck', 'Compras')}
    </div>
  `;
}

function htmlUltimasVentas(ultimas) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">Últimas ventas</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">Movimientos más recientes</div>
        </div>
        <button data-ir="facturas"
          style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12.5px;font-weight:600;color:#475569;font-family:inherit">
          Ver todas →
        </button>
      </div>
      ${ultimas.length === 0 ? `
        <div style="text-align:center;padding:32px 12px;color:#64748b">
          <div style="font-size:48px;opacity:.5">🧾</div>
          <div style="margin-top:8px;font-weight:500">Aún no hay ventas registradas hoy</div>
          <div style="font-size:13px;margin-top:4px;color:#94a3b8">¡Crea tu primera venta!</div>
        </div>
      ` : `
        <table style="width:100%;border-collapse:collapse;font-size:13.5px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left">
              <th style="padding:8px 10px">Factura</th>
              <th style="padding:8px 10px">Cliente</th>
              <th style="padding:8px 10px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${ultimas.map((f) => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:8px 10px">
                  <b style="color:#4f46e5">${esc(f.numero || '—')}</b><br>
                  <span style="color:#64748b;font-size:12px;font-family:'JetBrains Mono',ui-monospace,monospace">
                    ${esc((f.fecha || '').slice(0, 10))}
                  </span>
                </td>
                <td style="padding:8px 10px;color:#0f172a">${esc(f.cliente_nombre || 'Cliente ocasional')}</td>
                <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;color:#0f172a">
                  ${money(f.total)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function htmlAlertasStock(bajos) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">Alertas de inventario</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">Productos con stock bajo</div>
        </div>
        ${bajos.length ? `<span style="background:#fef2f2;color:#dc2626;font-size:12px;font-weight:700;padding:4px 9px;border-radius:6px">${fmt(bajos.length)}</span>` : ''}
      </div>
      ${bajos.length === 0 ? `
        <div style="text-align:center;padding:32px 12px;color:#64748b">
          <i data-lucide="check-circle-2" style="width:40px;height:40px;color:#15803d;stroke-width:1.5"></i>
          <div style="margin-top:10px;font-weight:600;color:#15803d;font-size:14px">Inventario saludable</div>
          <div style="font-size:12.5px;margin-top:4px;color:#94a3b8">Todo está en niveles correctos</div>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;padding-right:4px">
          ${bajos.slice(0, 15).map((p) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
              <div style="min-width:0;flex:1">
                <b style="font-size:13.5px;color:#0f172a;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nombre)}</b>
                <span style="color:#64748b;font-size:12px;font-family:'JetBrains Mono',ui-monospace,monospace">${esc(p.codigo || '—')}</span>
              </div>
              <span style="background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;padding:4px 9px;border-radius:6px;flex-shrink:0;font-family:'JetBrains Mono',ui-monospace,monospace">${fmt(p.stock)} uds</span>
            </div>
          `).join('')}
          ${bajos.length > 15 ? `<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:8px">+${bajos.length - 15} más…</div>` : ''}
        </div>
      `}
    </div>
  `;
}

function htmlStats(totalProd, totalCli, totalBajos) {
  const card = (icono, label, valor, colorBg, colorFg) => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;border-radius:9px;background:${colorBg};color:${colorFg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i data-lucide="${icono}" style="width:18px;height:18px"></i>
      </div>
      <div>
        <div style="font-size:11px;color:#64748b;font-weight:500;letter-spacing:-0.005em">${label}</div>
        <div style="font-size:18px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace">${valor}</div>
      </div>
    </div>
  `;

  return `
    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:6px">
      ${card('package', 'Productos', fmt(totalProd), '#eef2ff', '#4f46e5')}
      ${card('users', 'Clientes', fmt(totalCli), '#fef3c7', '#a16207')}
      ${card('truck', 'Compras registradas', fmt(0), '#fef3c7', '#a16207')}
      ${card('triangle-alert', 'Stock crítico', fmt(totalBajos), '#fef2f2', '#dc2626')}
    </div>
  `;
}
