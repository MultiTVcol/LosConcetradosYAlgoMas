/**
 * modules/inventario/inventario.view.js — Inventario (kardex y conteo)
 *
 *   - KPIs: valor a costo, valor a venta, utilidad potencial, alertas
 *   - Tabla de productos con stock y valorización; click → KARDEX
 *     (la historia completa del producto: compras, ventas, bajas, conteos)
 *   - Conteo físico: comparar lo contado vs el sistema → ajuste de stock
 *     (sobrante/faltante)
 */

import * as Repo from './inventario.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { fmtDate } from '../../core/dates.js';
import { Toast, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';

let _contenedor = null;
let _res = null;       // resumen (KPIs + productos)
let _q = '';
let _offRealtime = null;

export async function render(contenedor) {
  _contenedor = contenedor;
  _q = '';
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando inventario…</div>`;
  await refrescar();

  _offRealtime = Realtime.escucharVarias(['productos', 'compras', 'ventas', 'gastos'], async () => {
    try { await refrescar(); } catch (e) { console.warn('Realtime inventario:', e); }
  });
}

async function refrescar() {
  _res = await Repo.resumen();
  _contenedor.innerHTML = htmlLayout(_res);
  refrescarIconos(_contenedor);
  adjuntarEventos(_contenedor);
  pintarTabla();
}

function adjuntarEventos(c) {
  const inp = c.querySelector('#inv-buscar');
  let debounce;
  inp?.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { _q = e.target.value; pintarTabla(); }, 100);
  });
  c.querySelector('#inv-btn-conteo')?.addEventListener('click', () => abrirConteo());
}

// ============================================================
//  HTML
// ============================================================

function htmlLayout(r) {
  const kpi = (label, valor, color, sub) => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px">
      <div style="font-size:13px;color:#475569;font-weight:600;margin-bottom:6px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color};letter-spacing:-0.02em">${valor}</div>
      <div style="color:#64748b;font-size:12px;margin-top:6px">${sub}</div>
    </div>
  `;

  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          <i data-lucide="boxes" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
          <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Inventario</h1>
        </div>
        <button id="inv-btn-conteo"
          style="padding:10px 16px;background:#4f46e5;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">📋 Conteo físico</button>
      </div>

      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:18px">
        ${kpi('Valor a costo', money(r.valorCosto), '#8b5cf6', `${fmt(r.unidades)} unidades · ${fmt(r.skus)} productos`)}
        ${kpi('Valor a venta', money(r.valorVenta), '#0f172a', 'Si se vendiera todo hoy')}
        ${kpi('Utilidad potencial', money(r.utilidadPotencial), '#15803d', 'Venta − costo')}
        ${kpi('Alertas', `${fmt(r.bajoStock)} bajos · ${fmt(r.agotados)} agotados`, r.bajoStock + r.agotados > 0 ? '#dc2626' : '#15803d', 'Stock bajo mínimo / en cero')}
      </div>

      <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">Productos</h3>
            <div style="font-size:12.5px;color:#64748b;margin-top:2px">Haz click en un producto para ver su <b>kardex</b> (toda su historia)</div>
          </div>
          <input id="inv-buscar" type="text" placeholder="🔎 Buscar por nombre o código…" autocomplete="off"
            style="padding:10px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;font-family:inherit;min-width:260px" />
        </div>
        <div id="inv-tabla" style="overflow-x:auto"></div>
      </div>
    </div>
  `;
}

function pintarTabla() {
  const box = _contenedor.querySelector('#inv-tabla');
  if (!box) return;

  const q = String(_q || '').trim().toLowerCase();
  const filas = !q ? _res.productos : _res.productos.filter((p) =>
    [p.nombre, p.codigo, p.barras, p.categoria].filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(q))
  );

  if (filas.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13.5px">Sin productos${q ? ` para "${esc(_q)}"` : ''}.</div>`;
    return;
  }

  box.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <thead>
        <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left">
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Código</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Producto</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Stock</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Costo</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Valor (costo)</th>
        </tr>
      </thead>
      <tbody>
        ${filas.slice(0, 200).map((p) => {
          const st = num(p.stock);
          const alerta = st <= 0 ? '#dc2626' : (st <= num(p.stock_min) ? '#d97706' : '#0f172a');
          return `
          <tr class="inv-fila" data-id="${esc(p.id)}" style="border-bottom:1px solid #f1f5f9;cursor:pointer">
            <td style="padding:10px 8px;color:#64748b;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px">${esc(p.codigo || '—')}</td>
            <td style="padding:10px 8px;font-weight:600;color:#0f172a">${esc(p.nombre)}</td>
            <td style="padding:10px 8px;text-align:right;font-weight:800;color:${alerta}">${fmt(st)}</td>
            <td style="padding:10px 8px;text-align:right;color:#475569">${money(p.costo)}</td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;color:#0f172a">${money(st > 0 ? st * num(p.costo) : 0)}</td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
    ${filas.length > 200 ? `<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:10px">Mostrando 200 de ${fmt(filas.length)} — usa el buscador</div>` : ''}
  `;

  box.querySelectorAll('.inv-fila').forEach((tr) => {
    tr.onclick = () => abrirKardex(tr.dataset.id);
  });
}

// ============================================================
//  KARDEX
// ============================================================

async function abrirKardex(productoId) {
  let k;
  try {
    k = await Repo.kardexDe(productoId);
  } catch (err) {
    Toast.error(err.message || 'No se pudo cargar el kardex');
    return;
  }

  const colorTipo = { Compra: '#15803d', Venta: '#4f46e5', Baja: '#dc2626', 'Conteo físico': '#a16207' };

  const contenido = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="font-size:12px;color:#94a3b8">${esc(k.producto.codigo || '')}</div>
        <div style="font-weight:800;font-size:17px;color:#0f172a">${esc(k.producto.nombre)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:#94a3b8">Stock actual</div>
        <div style="font-weight:800;font-size:20px;color:#0f172a">${fmt(k.producto.stock)} <span style="font-size:12px;color:#64748b">unidades</span></div>
      </div>
    </div>

    ${k.movimientos.length === 0 ? `
      <div style="text-align:center;padding:30px;color:#94a3b8;font-size:13.5px">
        Sin movimientos registrados todavía.<br>
        <span style="font-size:12px">El stock actual (${fmt(k.producto.stock)}) proviene de la creación del producto o de un import.</span>
      </div>
    ` : `
      <div style="max-height:48vh;overflow:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left;position:sticky;top:0;background:white">
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Fecha</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Tipo</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Doc</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Entrada</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Salida</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px dashed #e2e8f0;color:#94a3b8">
              <td colspan="5" style="padding:8px">Saldo inicial</td>
              <td style="padding:8px;text-align:right;font-weight:700">${fmt(k.saldoInicial)}</td>
            </tr>
            ${k.movimientos.map((m) => `
              <tr style="border-bottom:1px solid #f1f5f9" title="${esc(m.detalle || '')}">
                <td style="padding:8px;color:#64748b;white-space:nowrap">${esc(fmtDate(m.fecha))}</td>
                <td style="padding:8px"><span style="color:${colorTipo[m.tipo] || '#475569'};font-weight:700;font-size:12px">${esc(m.tipo)}</span></td>
                <td style="padding:8px"><span style="background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px">${esc(m.doc || '—')}</span></td>
                <td style="padding:8px;text-align:right;color:#15803d;font-weight:700">${m.entrada > 0 ? '+' + fmt(m.entrada) : ''}</td>
                <td style="padding:8px;text-align:right;color:#dc2626;font-weight:700">${m.salida > 0 ? '−' + fmt(m.salida) : ''}</td>
                <td style="padding:8px;text-align:right;font-weight:800;color:#0f172a">${fmt(m.saldo)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  Modal.abrir({ titulo: `📒 Kardex`, contenido, ancho: 'lg' });
}

// ============================================================
//  CONTEO FÍSICO
// ============================================================

function abrirConteo() {
  const contenido = `
    <div style="display:grid;gap:12px">
      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Producto a contar *</div>
        <input id="ct-buscar" type="text" placeholder="🔎 Nombre o código…" autocomplete="off"
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        <div id="ct-resultados" style="display:flex;flex-direction:column;gap:5px;max-height:170px;overflow:auto;margin-top:6px"></div>
      </div>

      <div id="ct-detalle" style="display:none">
        <div id="ct-info" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13.5px;margin-bottom:10px"></div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">¿Cuántas unidades contaste físicamente? *</div>
        <input id="ct-fisico" data-miles type="text" inputmode="numeric" placeholder="0"
          style="width:100%;padding:13px 15px;border:1.5px solid #cbd5e1;border-radius:9px;font-size:20px;font-weight:800;outline:none;box-sizing:border-box;font-family:inherit;text-align:center" />
        <div id="ct-preview" style="margin-top:10px"></div>
        <div style="margin-top:10px">
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nota</div>
          <input id="ct-nota" type="text" placeholder="Ej: conteo de fin de mes"
            style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:4px">
        <button id="ct-cancelar" style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="ct-confirmar" data-primary disabled style="flex:1.2;padding:12px;border:0;background:#94a3b8;color:white;border-radius:10px;cursor:not-allowed;font-size:14px;font-weight:700;font-family:inherit">📋 Registrar ajuste</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({ titulo: '📋 Conteo físico', contenido, ancho: 'md' });
  bindMilesInputs(m.body);

  let productoSel = null;
  const inpBuscar = m.body.querySelector('#ct-buscar');
  const boxRes = m.body.querySelector('#ct-resultados');
  const detalle = m.body.querySelector('#ct-detalle');
  const inpFisico = m.body.querySelector('#ct-fisico');
  const preview = m.body.querySelector('#ct-preview');
  const btnOk = m.body.querySelector('#ct-confirmar');

  setTimeout(() => inpBuscar.focus(), 60);

  const pintarResultados = (q) => {
    const query = String(q || '').trim().toLowerCase();
    const lista = !query ? [] : _res.productos.filter((p) =>
      [p.nombre, p.codigo, p.barras].filter(Boolean).some((x) => String(x).toLowerCase().includes(query))
    ).slice(0, 8);
    boxRes.innerHTML = lista.map((p) => `
      <button class="ct-res" data-id="${esc(p.id)}"
        style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-family:inherit;text-align:left;font-size:13px">
        <span style="font-weight:600;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nombre)}</span>
        <span style="color:#64748b;flex-shrink:0">Sistema: <b>${fmt(p.stock)}</b></span>
      </button>
    `).join('');
    boxRes.querySelectorAll('.ct-res').forEach((b) => {
      b.onclick = () => {
        productoSel = _res.productos.find((x) => x.id === b.dataset.id);
        boxRes.innerHTML = '';
        inpBuscar.value = productoSel.nombre;
        detalle.style.display = 'block';
        m.body.querySelector('#ct-info').innerHTML = `
          <b style="color:#0f172a">${esc(productoSel.nombre)}</b><br>
          Sistema: <b>${fmt(productoSel.stock)}</b> unidades · Costo: <b>${money(productoSel.costo)}</b>
        `;
        inpFisico.value = '';
        actualizarPreview();
        setTimeout(() => inpFisico.focus(), 50);
      };
    });
  };

  const actualizarPreview = () => {
    if (!productoSel) return;
    const fisico = num(inpFisico.value);
    const delta = fisico - num(productoSel.stock);
    const valor = delta * num(productoSel.costo);
    const habilitado = inpFisico.value.trim() !== '' && delta !== 0;

    btnOk.disabled = !habilitado;
    btnOk.style.background = habilitado ? '#4f46e5' : '#94a3b8';
    btnOk.style.cursor = habilitado ? 'pointer' : 'not-allowed';

    if (inpFisico.value.trim() === '') { preview.innerHTML = ''; return; }
    if (delta === 0) {
      preview.innerHTML = `<div style="background:#dcfce7;border:1px solid #86efac;border-radius:9px;padding:10px 13px;font-size:13px;color:#166534">✓ El físico coincide con el sistema — no hay ajuste que hacer.</div>`;
    } else {
      const esSobra = delta > 0;
      preview.innerHTML = `
        <div style="background:${esSobra ? '#eef2ff' : '#fef2f2'};border:1px solid ${esSobra ? '#c7d2fe' : '#fecaca'};border-radius:9px;padding:10px 13px;font-size:13px;color:${esSobra ? '#4338ca' : '#991b1b'}">
          ${esSobra ? '➕ SOBRANTE' : '➖ FALTANTE'} de <b>${fmt(Math.abs(delta))}</b> unidad(es)
          · valor <b>${money(Math.abs(valor))}</b><br>
          <span style="font-size:11.5px">El stock del producto pasará de <b>${fmt(productoSel.stock)}</b> a <b>${fmt(fisico)}</b>.</span>
        </div>
      `;
    }
  };

  let debounce;
  inpBuscar.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    productoSel = null;
    detalle.style.display = 'none';
    btnOk.disabled = true;
    btnOk.style.background = '#94a3b8';
    debounce = setTimeout(() => pintarResultados(e.target.value), 100);
  });
  inpFisico.addEventListener('input', actualizarPreview);

  m.body.querySelector('#ct-cancelar').onclick = () => m.cerrar();
  btnOk.onclick = async () => {
    if (!productoSel || btnOk.disabled) return;
    try {
      const ajuste = await Repo.registrarConteo({
        producto_id: productoSel.id,
        fisico: num(inpFisico.value),
        nota: m.body.querySelector('#ct-nota').value,
      });
      Toast.ok(`Ajuste ${ajuste.numero} registrado`);
      m.cerrar();
      await refrescar();
    } catch (err) {
      Toast.error(err.message || 'No se pudo registrar el conteo');
    }
  };
}
