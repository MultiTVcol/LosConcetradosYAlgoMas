/**
 * modules/ventas/cuentas-cobrar.view.js — Cuentas por cobrar (ventas a crédito)
 *
 * Espejo del módulo de Facturas de compra, pero para lo que los CLIENTES
 * deben: ventas a crédito con saldo pendiente, aging y recaudos (abonos).
 *
 * La lógica de datos vive en ventas.repo.js (no se duplica negocio).
 */

import * as Repo from './ventas.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { Toast, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';
import { pageHeader, kpiGrid, badge, avatar, menuButton, wireMenus } from '../../app/ui-kit.js';
import { Router } from '../../core/index.js';

const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta', 'QR', 'Otro'];

let _contenedor = null;
let _ventas = [];        // solo ventas a crédito
// modo: 'todas' (por defecto, para no ocultar deudas viejas) | 'mes' | 'custom'
let _filtro = { q: '', estado: '', modo: 'todas', desde: '', hasta: '' };
let _offRealtime = null;

export async function render(contenedor) {
  _contenedor = contenedor;
  _filtro = { q: '', estado: '', modo: 'todas', desde: '', hasta: '' };
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = `<div style="padding:28px 32px;color:#64748b;font-size:14px">Cargando cuentas por cobrar…</div>`;
  await cargar();
  pintar();

  _offRealtime = Realtime.escuchar('ventas', async () => {
    try { await cargar(); pintar(); } catch (err) { console.warn('Realtime CXC:', err); }
  });
}

async function cargar() {
  let todas = [];
  try { todas = await Repo.listar(); } catch (e) { todas = []; }
  _ventas = todas.filter((v) => v.tipoPago === 'credito' && v.estado !== 'anulada');
}

function pintar() {
  _contenedor.innerHTML = htmlLayout();
  refrescarIconos(_contenedor);
  _contenedor.querySelector('#cxc-nueva')?.addEventListener('click', () => Router.navegar('ventas'));
  pintarHistorial();
}

// ============================================================
//  KPIs
// ============================================================

function htmlKpis() {
  const mes = todayISO().slice(0, 7);
  const pendientes = _ventas.filter((v) => num(v.saldo) > 0.5);
  const porCobrar = pendientes.reduce((s, v) => s + num(v.saldo), 0);
  const vencidas = pendientes.filter((v) => v.vence && v.vence < todayISO()).length;
  let recaudadoMes = 0;
  for (const v of _ventas) {
    for (const a of (v.abonos || [])) {
      if ((a.fecha || '').slice(0, 7) === mes) recaudadoMes += num(a.monto);
    }
  }
  return kpiGrid([
    { label: 'Por cobrar', valor: money(porCobrar), sub: `${fmt(pendientes.length)} venta(s) a crédito`, icono: 'hand-coins', color: porCobrar > 0 ? '#d97706' : '#16a34a' },
    { label: 'Créditos pendientes', valor: fmt(pendientes.length), sub: 'Con saldo', icono: 'file-text', color: '#2563eb' },
    { label: 'Vencidas', valor: fmt(vencidas), sub: 'Pasaron del vencimiento', icono: 'alert-triangle', color: vencidas > 0 ? '#dc2626' : '#16a34a' },
    { label: 'Recaudado este mes', valor: money(recaudadoMes), sub: 'Abonos del mes', icono: 'trending-up', color: '#16a34a' },
  ]);
}

function htmlLayout() {
  const acciones = `
    <button id="cxc-nueva" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#2563eb;color:white;border:0;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #2563eb40">
      <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i> Nueva venta
    </button>
  `;
  return `
    <div style="padding:20px 28px;max-width:1280px">
      ${pageHeader({
        icono: 'hand-coins',
        titulo: 'Cuentas por cobrar',
        descripcion: 'Ventas a crédito de tus clientes y sus saldos pendientes.',
        acciones,
      })}
      ${_ventas.length > 0 ? htmlKpis() : ''}
      <div id="cxc-hist"></div>
    </div>
  `;
}

// ============================================================
//  HISTORIAL / TABLA
// ============================================================

function pintarHistorial() {
  const box = _contenedor.querySelector('#cxc-hist');
  if (!box) return;

  if (_ventas.length === 0) {
    box.innerHTML = `
      <div class="ui-table-card" style="padding:48px 24px;text-align:center;color:#94a3b8">
        <i data-lucide="hand-coins" style="width:40px;height:40px;color:#cbd5e1;stroke-width:1.5"></i>
        <div style="margin-top:10px;font-weight:600;color:#475569">No hay ventas a crédito</div>
        <div style="font-size:13px;margin-top:2px">Al cobrar una venta, elige <b>Crédito</b> para que el cliente quede debiendo.</div>
      </div>`;
    refrescarIconos(box);
    return;
  }

  const presetBtn = (modo, label) => `
    <button class="cxc-preset" data-modo="${modo}"
      style="padding:7px 13px;border:1px solid ${_filtro.modo === modo ? '#2563eb' : '#d1d5db'};background:${_filtro.modo === modo ? '#2563eb' : '#fff'};color:${_filtro.modo === modo ? '#fff' : '#374151'};border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${label}</button>`;

  box.innerHTML = `
    <div class="ui-table-card">
      <div style="padding:16px 18px;border-bottom:1px solid #f3f4f6;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0;color:#111827">Ventas a crédito</h3>
            <div id="cxc-sub" style="font-size:12.5px;color:#6b7280;margin-top:2px"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="cxc-q" class="ui-input" type="text" placeholder="Buscar cliente o N° de factura…" value="${esc(_filtro.q)}" style="min-width:210px;width:auto" />
            <select id="cxc-estado" class="ui-input" style="width:auto;min-width:150px">
              <option value="">Todos los estados</option>
              <option value="pendiente" ${_filtro.estado === 'pendiente' ? 'selected' : ''}>Con saldo</option>
              <option value="vencida" ${_filtro.estado === 'vencida' ? 'selected' : ''}>Vencidas</option>
              <option value="pagada" ${_filtro.estado === 'pagada' ? 'selected' : ''}>Pagadas</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${presetBtn('todas', 'Todas')}
          ${presetBtn('mes', 'Este mes')}
          ${presetBtn('custom', 'Rango…')}
          ${_filtro.modo === 'custom' ? `
            <span style="color:#94a3b8;font-size:12.5px">Desde</span>
            <input id="cxc-desde" class="ui-input" type="date" value="${esc(_filtro.desde)}" style="width:auto" />
            <span style="color:#94a3b8;font-size:12.5px">Hasta</span>
            <input id="cxc-hasta" class="ui-input" type="date" value="${esc(_filtro.hasta)}" style="width:auto" />
          ` : ''}
        </div>
      </div>
      <div id="cxc-body" style="overflow-x:auto"></div>
    </div>
  `;

  const inpQ = box.querySelector('#cxc-q');
  const selE = box.querySelector('#cxc-estado');
  let deb;
  inpQ?.addEventListener('input', (e) => {
    if (deb) clearTimeout(deb);
    deb = setTimeout(() => { _filtro.q = e.target.value; renderFilas(); }, 120);
  });
  selE?.addEventListener('change', (e) => { _filtro.estado = e.target.value; renderFilas(); });

  box.querySelectorAll('.cxc-preset').forEach((b) => {
    b.addEventListener('click', () => {
      const modo = b.dataset.modo;
      if (modo === 'custom' && !_filtro.desde && !_filtro.hasta) {
        _filtro.desde = todayISO().slice(0, 8) + '01';
        _filtro.hasta = todayISO();
      }
      _filtro.modo = modo;
      pintarHistorial();
    });
  });
  box.querySelector('#cxc-desde')?.addEventListener('change', (e) => { _filtro.desde = e.target.value; renderFilas(); });
  box.querySelector('#cxc-hasta')?.addEventListener('change', (e) => { _filtro.hasta = e.target.value; renderFilas(); });

  renderFilas();
}

function renderFilas() {
  const cont = _contenedor.querySelector('#cxc-body');
  if (!cont) return;
  const hoy = todayISO();

  let lista = [..._ventas].sort((a, b) => (a.vence || '9999').localeCompare(b.vence || '9999'));
  const q = _filtro.q.toLowerCase().trim();
  if (q) lista = lista.filter((v) => [(v.cliente_nombre || ''), (v.numero || '')].join(' ').toLowerCase().includes(q));
  if (_filtro.estado === 'pendiente') lista = lista.filter((v) => num(v.saldo) > 0.5);
  else if (_filtro.estado === 'pagada') lista = lista.filter((v) => num(v.saldo) <= 0.5);
  else if (_filtro.estado === 'vencida') lista = lista.filter((v) => num(v.saldo) > 0.5 && v.vence && v.vence < hoy);

  // Filtro por fecha de la venta
  if (_filtro.modo === 'mes') {
    const mesActual = hoy.slice(0, 7);
    lista = lista.filter((v) => (v.fecha || '').slice(0, 7) === mesActual);
  } else if (_filtro.modo === 'custom') {
    if (_filtro.desde) lista = lista.filter((v) => (v.fecha || '').slice(0, 10) >= _filtro.desde);
    if (_filtro.hasta) lista = lista.filter((v) => (v.fecha || '').slice(0, 10) <= _filtro.hasta);
  }

  // Subtítulo con conteo del filtro activo
  const sub = _contenedor.querySelector('#cxc-sub');
  if (sub) {
    const etiqueta = _filtro.modo === 'mes' ? 'este mes' : _filtro.modo === 'custom' ? 'en el rango' : 'a crédito';
    sub.textContent = `${fmt(lista.length)} venta(s) ${etiqueta} · ${fmt(_ventas.length)} en total`;
  }

  if (lista.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:28px;color:#94a3b8;font-size:13.5px">No hay ventas que coincidan${_filtro.modo === 'mes' ? ' este mes' : _filtro.modo === 'custom' ? ' en el rango' : ''}.</div>`;
    return;
  }

  cont.innerHTML = `
    <table class="ui-table">
      <thead>
        <tr>
          <th>Factura</th><th>Cliente</th><th>Fecha</th><th>Vence</th>
          <th style="text-align:right">Total</th><th style="text-align:right">Saldo</th>
          <th>Estado</th><th style="width:56px"></th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((v) => {
          const saldo = num(v.saldo);
          const pagada = saldo <= 0.5;
          const vencida = !pagada && v.vence && v.vence < hoy;
          const estado = pagada ? badge('Pagada', 'success') : vencida ? badge('Vencida', 'danger') : badge('Al día', 'warn');
          return `
            <tr data-id="${esc(v.id)}">
              <td><b style="color:#111827">${esc(v.numero || '—')}</b></td>
              <td><div class="ui-cell-user">${avatar(v.cliente_nombre || '?')}<span style="font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.cliente_nombre || 'Cliente')}</span></div></td>
              <td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:#6b7280">${esc((v.fecha || '').slice(0, 10))}</td>
              <td>${v.vence ? badge(esc(v.vence), vencida ? 'danger' : 'info') : '<span style="color:#d1d5db">—</span>'}</td>
              <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(v.total)}</td>
              <td style="text-align:right;font-weight:700;color:${pagada ? '#16a34a' : '#a16207'};font-family:'JetBrains Mono',ui-monospace,monospace">${money(saldo)}</td>
              <td>${estado}</td>
              <td style="text-align:right">${menuButton(v.id)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  refrescarIconos(cont);
  wireMenus(cont, (id) => {
    const v = _ventas.find((x) => x.id === id);
    const pend = v && num(v.saldo) > 0.5;
    return [
      { label: 'Ver detalle', value: 'ver', icono: '👁️' },
      ...(pend ? [{ label: 'Registrar abono', value: 'abonar', icono: '💵' }] : []),
    ];
  }, (accion, id) => {
    if (accion === 'ver') verDetalle(id);
    else if (accion === 'abonar') abrirAbono(id);
  });
}

// ============================================================
//  ABONO (recaudo)
// ============================================================

function abrirAbono(ventaId) {
  const v = _ventas.find((x) => x.id === ventaId);
  if (!v) return;
  const abonos = Array.isArray(v.abonos) ? v.abonos : [];
  const totalAbonado = abonos.reduce((s, a) => s + num(a.monto), 0);

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:4px"><span>Cliente</span><b style="color:#111827">${esc(v.cliente_nombre || '—')} · ${esc(v.numero || '')}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:4px"><span>Total venta</span><b style="color:#111827;font-family:'JetBrains Mono',ui-monospace,monospace">${money(v.total)}</b></div>
      ${totalAbonado > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#15803d;margin-bottom:4px"><span>Total abonado (${abonos.length})</span><b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</b></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280"><span>Saldo pendiente</span><b style="color:#a16207;font-family:'JetBrains Mono',ui-monospace,monospace">${money(v.saldo)}</b></div>
    </div>
    <div>
      <div class="ui-label" style="margin-bottom:4px">Monto del abono *</div>
      <input id="cxc-abono-monto" data-miles type="text" inputmode="numeric" placeholder="0"
        style="width:100%;padding:14px;border:1px solid #d1d5db;border-radius:12px;font-size:22px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box;text-align:right" />
    </div>
    <div style="margin-top:12px;display:grid;gap:10px;grid-template-columns:1fr 1fr">
      <div><div class="ui-label" style="margin-bottom:4px">Fecha</div><input id="cxc-abono-fecha" class="ui-input" type="date" value="${todayISO()}" /></div>
      <div><div class="ui-label" style="margin-bottom:4px">Método</div><select id="cxc-abono-metodo" class="ui-input">${METODOS.map((m) => `<option value="${esc(m)}">${m}</option>`).join('')}</select></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="cxc-abono-cancel" style="flex:1;padding:11px;border:1px solid #e5e7eb;background:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#374151">Cancelar</button>
      <button id="cxc-abono-save" style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Registrar abono</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Registrar abono', contenido, ancho: 'sm' });
  bindMilesInputs(m.body);
  setTimeout(() => m.body.querySelector('#cxc-abono-monto')?.focus(), 60);
  m.body.querySelector('#cxc-abono-monto')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.body.querySelector('#cxc-abono-save').click(); } });

  m.body.querySelector('#cxc-abono-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#cxc-abono-save').onclick = async () => {
    const btn = m.body.querySelector('#cxc-abono-save');
    if (btn.disabled) return;
    btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait';
    const monto = num(m.body.querySelector('#cxc-abono-monto').value);
    const metodo = m.body.querySelector('#cxc-abono-metodo').value;
    const fecha = m.body.querySelector('#cxc-abono-fecha').value || todayISO();
    try {
      await Repo.abonar(ventaId, { monto, metodo, fecha });
      await cargar();
      Toast.ok('Abono registrado');
      m.cerrar();
      pintarHistorial();
    } catch (err) {
      Toast.error(err.message || 'No se pudo registrar el abono');
      btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
    }
  };
}

// ============================================================
//  DETALLE
// ============================================================

function verDetalle(ventaId) {
  const v = _ventas.find((x) => x.id === ventaId);
  if (!v) return;
  const items = Array.isArray(v.items) ? v.items : [];
  const abonos = Array.isArray(v.abonos) ? v.abonos : [];
  const totalAbonado = abonos.reduce((s, a) => s + num(a.monto), 0);
  const saldo = num(v.saldo);
  const pagada = saldo <= 0.5;
  const vencida = !pagada && v.vence && v.vence < todayISO();

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:15px;color:#111827">${esc(v.cliente_nombre || 'Cliente')}</div>
          <div style="color:#6b7280;font-size:12.5px;margin-top:2px;font-family:'JetBrains Mono',ui-monospace,monospace">Factura: ${esc(v.numero || '—')} · ${esc((v.fecha || '').slice(0, 10))}</div>
        </div>
        ${pagada ? badge('Pagada', 'success') : vencida ? badge('Vencida', 'danger') : badge('Al día', 'warn')}
      </div>
      <div style="display:grid;gap:6px;grid-template-columns:1fr 1fr;font-size:13px">
        <div style="color:#6b7280">Total venta</div>
        <div style="text-align:right;font-weight:700;color:#111827;font-family:'JetBrains Mono',ui-monospace,monospace">${money(v.total)}</div>
        <div style="color:#6b7280">Total abonado (${abonos.length})</div>
        <div style="text-align:right;font-weight:700;color:#15803d;font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</div>
        <div style="color:#6b7280">Saldo pendiente</div>
        <div style="text-align:right;font-weight:800;color:${pagada ? '#15803d' : '#a16207'};font-family:'JetBrains Mono',ui-monospace,monospace">${money(saldo)}</div>
        ${v.vence ? `<div style="color:#6b7280">Vence</div><div style="text-align:right;font-weight:700;color:${vencida ? '#dc2626' : '#475569'}">${esc(v.vence)}${vencida ? ' · vencida' : ''}</div>` : ''}
      </div>
    </div>

    ${items.length > 0 ? `
      <div style="margin-bottom:14px">
        <div class="ui-label" style="margin-bottom:6px">Productos</div>
        <div class="ui-table-card"><table class="ui-table">
          <thead><tr><th style="width:48px">Cant</th><th>Producto</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td style="font-family:'JetBrains Mono',ui-monospace,monospace"><b>${fmt(it.cantidad)}</b></td>
                <td>${esc(it.nombre)}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(it.precio)}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace"><b>${money(num(it.total) || num(it.precio) * num(it.cantidad))}</b></td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    ` : ''}

    ${abonos.length > 0 ? `
      <div style="margin-bottom:14px">
        <div class="ui-label" style="margin-bottom:6px">Abonos (${abonos.length})</div>
        <div class="ui-table-card"><table class="ui-table">
          <thead><tr><th>#</th><th>Fecha</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>
            ${[...abonos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map((a, i) => `
              <tr>
                <td style="color:#94a3b8">${i + 1}</td>
                <td style="font-family:'JetBrains Mono',ui-monospace,monospace;color:#475569">${esc((a.fecha || '').slice(0, 10))}</td>
                <td>${badge(esc(a.metodo || 'Efectivo'), 'info')}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;color:#15803d">${money(a.monto)}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    ` : ''}

    <div style="display:flex;gap:10px;margin-top:6px">
      ${!pagada ? `<button id="cxc-det-abonar" style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Registrar abono</button>` : ''}
      <button id="cxc-det-cerrar" style="flex:1;padding:11px;border:1px solid #e5e7eb;background:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#374151">Cerrar</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Detalle de la venta a crédito', contenido, ancho: 'lg' });
  m.body.querySelector('#cxc-det-cerrar').onclick = () => m.cerrar();
  const btn = m.body.querySelector('#cxc-det-abonar');
  if (btn) btn.onclick = () => { m.cerrar(); setTimeout(() => abrirAbono(ventaId), 220); };
}
