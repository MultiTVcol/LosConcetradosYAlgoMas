/**
 * modules/dashboard/dashboard.view.js — Vista del Dashboard
 *
 * Replica fiel del dashboard legacy:
 *   - Header con título + reloj en vivo + chip de usuario "En línea"
 *   - Card "Cierre de Caja" con estado de sincronización
 *   - KPIs: Ventas hoy / Utilidad hoy / Semana / Mes / Por pagar / Inventario
 *   - Atajos: Nueva venta, Productos, Clientes, Compras
 *   - Últimas ventas + Alertas de stock bajo
 *   - Stats: Productos, Clientes, Compras registradas, Stock crítico
 */

import * as VentasRepo from '../ventas/ventas.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import * as ComprasRepo from '../compras/compras.repo.js';
import * as Realtime from '../../services/realtime.js';
import * as Auth from '../../services/auth.js';
import { Router } from '../../core/index.js';
import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { refrescarIconos } from '../../app/shell.js';

let _offRealtime = null;
let _offEstado = null;
let _clockTimer = null;

// ============================================================
//  HELPERS
// ============================================================

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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

function horaBonita() {
  return new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

function fechaBonita() {
  return new Date().toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ============================================================
//  RENDERIZADO
// ============================================================

export async function render(contenedor) {
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }
  if (_offEstado) { try { _offEstado(); } catch (e) { /**/ } _offEstado = null; }
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }

  contenedor.innerHTML = htmlCargando();

  let ventas = [];
  let productos = [];
  let clientes = [];
  let compras = [];

  try { ventas = await VentasRepo.listar(); } catch (e) { console.warn('No se pudieron cargar ventas:', e); }
  try { productos = await ProductosRepo.listar(); } catch (e) { console.warn('No se pudieron cargar productos:', e); }
  try { clientes = await ClientesRepo.listar(); } catch (e) { console.warn('No se pudieron cargar clientes:', e); }
  try { compras = await ComprasRepo.listar(); } catch (e) { console.warn('No se pudieron cargar compras:', e); }

  const hoy = todayISO();
  const d = new Date();
  const ini = new Date(d);
  ini.setDate(d.getDate() - d.getDay()); // domingo de esta semana
  const semDesde = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-${String(ini.getDate()).padStart(2, '0')}`;
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

  // Cuentas por pagar a proveedores (compras a crédito con saldo)
  let cxpTotal = 0;
  let cxpFacturas = 0;
  for (const c of compras) {
    if (c.tipoPago === 'credito' && num(c.saldo) > 0.5) {
      cxpTotal += num(c.saldo);
      cxpFacturas++;
    }
  }

  contenedor.innerHTML = htmlLayout({
    tHoy, tSem, tMes,
    bajos, ultimas,
    totalProd: productos.length,
    totalCli: clientes.length,
    totalCompras: compras.length,
    invValorCosto, invUnidades,
    cxpTotal, cxpFacturas,
  });

  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  iniciarReloj(contenedor);
  cablearEstadoSync(contenedor);

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

/** Reloj en vivo del header (se detiene solo al salir del dashboard). */
function iniciarReloj(contenedor) {
  const elHora = contenedor.querySelector('#dash-reloj');
  const elFecha = contenedor.querySelector('#dash-fecha');
  if (!elHora) return;
  _clockTimer = setInterval(() => {
    if (!elHora.isConnected) {
      clearInterval(_clockTimer);
      _clockTimer = null;
      return;
    }
    elHora.textContent = horaBonita();
    if (elFecha) elFecha.textContent = fechaBonita();
  }, 1000);
}

/** Estado de sincronización en el banner de cierre + chip del usuario. */
function cablearEstadoSync(contenedor) {
  const aplicar = (estado) => {
    const linea = contenedor.querySelector('#dash-sync-estado');
    const punto = contenedor.querySelector('#dash-user-punto');
    const textoLinea = contenedor.querySelector('#dash-user-estado');
    const activo = !!(estado && estado.activo && estado.tablas.length > 0);
    if (linea && linea.isConnected) {
      linea.innerHTML = activo
        ? `<span style="width:8px;height:8px;border-radius:50%;background:#15803d;display:inline-block"></span> Sistema sincronizado — listo para cerrar`
        : `<span style="width:8px;height:8px;border-radius:50%;background:#cbd5e1;display:inline-block"></span> Sin conexión en vivo — el cierre usará datos locales`;
      linea.style.color = activo ? '#15803d' : '#94a3b8';
    }
    if (punto && punto.isConnected) {
      punto.style.background = activo ? '#22c55e' : '#cbd5e1';
    }
    if (textoLinea && textoLinea.isConnected) {
      textoLinea.textContent = activo ? 'En línea' : 'Sin conexión';
      textoLinea.style.color = activo ? '#15803d' : '#94a3b8';
    }
  };
  try {
    _offEstado = Realtime.onEstadoChange(aplicar);
  } catch (e) { /**/ }
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando dashboard…</div>`;
}

function htmlLayout(d) {
  const {
    tHoy, tSem, tMes, bajos, ultimas,
    totalProd, totalCli, totalCompras,
    invValorCosto, invUnidades, cxpTotal, cxpFacturas,
  } = d;

  return `
    ${htmlHeader()}
    <div style="padding:24px 40px 36px;max-width:1380px">
      ${htmlCardCierre()}

      ${htmlKPIs(tHoy, tSem, tMes, invValorCosto, invUnidades, cxpTotal, cxpFacturas)}

      ${htmlAtajos()}

      <div style="display:grid;gap:16px;grid-template-columns:1.5fr 1fr;margin-bottom:18px" class="dash-grid">
        ${htmlUltimasVentas(ultimas)}
        ${htmlAlertasStock(bajos)}
      </div>

      ${htmlStats(totalProd, totalCli, totalCompras, bajos.length)}
    </div>
  `;
}

/** Header estilo legacy: título + reloj en vivo + chip del usuario. */
function htmlHeader() {
  const u = Auth.usuarioActual();
  const nombre = u?.nombre || 'Usuario';
  const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';

  return `
    <div style="background:white;border-bottom:1px solid #e2e8f0;padding:14px 40px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.015em">Inicio</h1>

      <div style="display:flex;align-items:center;gap:18px">
        <div style="text-align:right">
          <div id="dash-reloj" style="font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-0.01em">${esc(horaBonita())}</div>
          <div id="dash-fecha" style="font-size:12px;color:#64748b;margin-top:1px">${esc(fechaBonita())}</div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:6px 16px 6px 7px">
          <div style="position:relative;flex-shrink:0">
            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#4338ca);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px">${esc(iniciales)}</div>
            <span id="dash-user-punto" style="position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#cbd5e1;border:2px solid white"></span>
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.2">${esc(nombre)}</div>
            <div id="dash-user-estado" style="font-size:11.5px;color:#94a3b8;font-weight:600">Sin conexión</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function htmlCardCierre() {
  return `
    <div data-ir="cierre" style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px 22px;margin-bottom:18px;cursor:pointer;display:flex;align-items:center;gap:16px;flex-wrap:wrap;transition:all .2s ease">
      <div style="width:48px;height:48px;border-radius:12px;background:#eef2ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(79,70,229,.15)">
        <i data-lucide="shield-check" style="width:24px;height:24px;stroke-width:2"></i>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:16px;font-weight:700;color:#0f172a;letter-spacing:-0.012em">Cierre de Caja</div>
        <div style="font-size:13px;color:#64748b;margin-top:2px">Genera el informe del día e imprime el ticket de cierre</div>
        <div id="dash-sync-estado" style="font-size:12.5px;font-weight:600;color:#94a3b8;margin-top:5px;display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:#cbd5e1;display:inline-block"></span> Verificando sincronización…
        </div>
      </div>
      <button data-ir="cierre"
        style="white-space:nowrap;padding:12px 20px;background:#4f46e5;color:white;border:0;border-radius:11px;cursor:pointer;font-size:14.5px;font-weight:700;font-family:inherit;display:flex;align-items:center;gap:8px;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
        <i data-lucide="shield-check" style="width:16px;height:16px"></i>
        Hacer Cierre
      </button>
    </div>
  `;
}

function htmlKPIs(tHoy, tSem, tMes, invValorCosto, invUnidades, cxpTotal, cxpFacturas) {
  // Tarjeta KPI estilo legacy: etiqueta normal (sin mayúsculas), número
  // grande en Inter (sin monospace), badge de conteo + texto abajo.
  const kpi = ({ label, valor, colorValor = '#0f172a', sub, icono, emoji, colorBg, colorFg, borde = '#e2e8f0', ir = '' }) => `
    <div ${ir ? `data-ir="${ir}"` : ''} style="background:white;border:1px solid ${borde};border-radius:14px;padding:18px 20px;position:relative;overflow:hidden${ir ? ';cursor:pointer' : ''}">
      <div style="position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:10px;background:${colorBg};color:${colorFg};display:flex;align-items:center;justify-content:center;${emoji ? 'font-size:18px' : ''}">
        ${emoji ? emoji : `<i data-lucide="${icono}" style="width:17px;height:17px"></i>`}
      </div>
      <div style="font-size:13.5px;color:#475569;font-weight:600;margin-bottom:10px;letter-spacing:-0.005em">${label}</div>
      <div style="font-size:27px;font-weight:800;color:${colorValor};letter-spacing:-0.025em;line-height:1.1">${valor}</div>
      <div style="color:#64748b;font-weight:500;margin-top:10px;font-size:13px;display:flex;align-items:center;gap:7px">${sub}</div>
    </div>
  `;

  const badge = (n, bg = '#eef2ff', fg = '#4338ca') =>
    `<span style="background:${bg};color:${fg};font-size:12px;font-weight:700;padding:2px 9px;border-radius:7px">${fmt(n)}</span>`;

  return `
    <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));margin-bottom:18px">
      ${kpi({
        label: 'Ventas de hoy', valor: money(tHoy.total),
        sub: `${badge(tHoy.n)} factura(s) emitidas`,
        icono: 'dollar-sign', colorBg: '#eef2ff', colorFg: '#4f46e5',
      })}
      ${kpi({
        label: 'Utilidad de hoy', valor: money(tHoy.utilidad), colorValor: '#15803d',
        sub: 'Ganancia estimada',
        icono: 'trending-up', colorBg: '#dcfce7', colorFg: '#15803d',
      })}
      ${kpi({
        label: 'Ventas de la semana', valor: money(tSem.total),
        sub: `${badge(tSem.n)} facturas`,
        icono: 'calendar', colorBg: '#e0f2fe', colorFg: '#0284c7',
      })}
      ${kpi({
        label: 'Ventas del mes', valor: money(tMes.total),
        sub: `${badge(tMes.n)} facturas`,
        icono: 'bar-chart-3', colorBg: '#eef2ff', colorFg: '#4f46e5',
      })}
      ${kpi({
        label: 'Por pagar a proveedores', valor: money(cxpTotal), colorValor: '#d97706',
        sub: `${badge(cxpFacturas, '#fef3c7', '#92400e')} factura(s) a crédito`,
        emoji: '📋', colorBg: '#fef3c7', colorFg: '#a16207',
        borde: '#fde68a', ir: 'compras',
      })}
      ${kpi({
        label: 'Valor inventario (costo)', valor: money(invValorCosto), colorValor: '#8b5cf6',
        sub: `${badge(invUnidades, 'rgba(139,92,246,.14)', '#7c3aed')} unidades en bodega`,
        emoji: '📦', colorBg: 'rgba(139,92,246,.14)', colorFg: '#8b5cf6',
        borde: '#ddd6fe', ir: 'productos',
      })}
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
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h3 style="font-size:16.5px;font-weight:700;margin:0;color:#0f172a;letter-spacing:-0.01em">Últimas ventas</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">Movimientos más recientes</div>
        </div>
        <button data-ir="facturas"
          style="background:white;border:1px solid #e2e8f0;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:12.5px;font-weight:600;color:#475569;font-family:inherit">
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
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left">
              <th style="padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Factura</th>
              <th style="padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Cliente</th>
              <th style="padding:8px 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${ultimas.map((f) => {
              const hora = f.data?.timestamp
                ? new Date(f.data.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
              return `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:13px 10px">
                  <b style="color:#4f46e5;font-size:14px">${esc(f.numero || '—')}</b><br>
                  <span style="color:#94a3b8;font-size:12px">${esc((f.fecha || '').slice(0, 10))}${hora ? ' ' + hora : ''}</span>
                </td>
                <td style="padding:13px 10px;color:#0f172a;font-weight:500">${esc(f.cliente_nombre || 'Cliente ocasional')}</td>
                <td style="padding:13px 10px;text-align:right;font-weight:700;color:#0f172a;font-size:14.5px">
                  ${money(f.total)}
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function htmlAlertasStock(bajos) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h3 style="font-size:16.5px;font-weight:700;margin:0;color:#0f172a;letter-spacing:-0.01em">Alertas de inventario</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">Productos con stock bajo</div>
        </div>
        ${bajos.length ? `<span style="background:#fef2f2;color:#dc2626;font-size:12px;font-weight:700;padding:4px 10px;border-radius:7px">${fmt(bajos.length)}</span>` : ''}
      </div>
      ${bajos.length === 0 ? `
        <div style="text-align:center;padding:38px 12px;color:#64748b">
          <i data-lucide="check-circle-2" style="width:44px;height:44px;color:#22c55e;stroke-width:1.5"></i>
          <div style="margin-top:12px;font-weight:700;color:#15803d;font-size:14.5px">Inventario saludable</div>
          <div style="font-size:13px;margin-top:4px;color:#94a3b8">Todo está en niveles correctos</div>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;padding-right:4px">
          ${bajos.slice(0, 15).map((p) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 13px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
              <div style="min-width:0;flex:1">
                <b style="font-size:13.5px;color:#0f172a;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nombre)}</b>
                <span style="color:#94a3b8;font-size:12px">${esc(p.codigo || '—')}</span>
              </div>
              <span style="background:#fef2f2;color:#dc2626;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:7px;flex-shrink:0">${fmt(p.stock)} uds</span>
            </div>
          `).join('')}
          ${bajos.length > 15 ? `<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:8px">+${bajos.length - 15} más…</div>` : ''}
        </div>
      `}
    </div>
  `;
}

function htmlStats(totalProd, totalCli, totalCompras, totalBajos) {
  const card = (icono, label, valor, colorBg, colorFg) => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:13px">
      <div style="width:38px;height:38px;border-radius:10px;background:${colorBg};color:${colorFg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i data-lucide="${icono}" style="width:18px;height:18px"></i>
      </div>
      <div>
        <div style="font-size:12.5px;color:#64748b;font-weight:500">${label}</div>
        <div style="font-size:19px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;color:#0f172a">${valor}</div>
      </div>
    </div>
  `;

  return `
    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-top:6px">
      ${card('package', 'Productos', fmt(totalProd), '#eef2ff', '#4f46e5')}
      ${card('users', 'Clientes', fmt(totalCli), '#fef3c7', '#a16207')}
      ${card('truck', 'Compras registradas', fmt(totalCompras), '#e0f2fe', '#0284c7')}
      ${card('triangle-alert', 'Stock crítico', fmt(totalBajos), '#fef2f2', '#dc2626')}
    </div>
  `;
}
