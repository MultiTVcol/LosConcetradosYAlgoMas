/**
 * modules/compras/facturas-compra.view.js — Facturas de compra (independiente)
 *
 * Vista dedicada para ver TODAS las facturas de compra registradas:
 *   - KPIs: facturas, total comprado, por pagar, vencidas
 *   - Cuentas por pagar a proveedores (aging) con abono
 *   - Historial completo con filtros (texto + tipo) y detalle
 *
 * La lógica de datos vive en compras.repo.js (no se duplica negocio).
 */

import * as Repo from './compras.repo.js';
import * as ProveedoresRepo from './proveedores.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';
import { pageHeader, kpiGrid, badge, menuButton, wireMenus } from '../../app/ui-kit.js';
import { Router } from '../../core/index.js';

let _contenedor = null;
let _compras = [];
// modo: 'mes' (este mes, por defecto) | 'todas' | 'custom' (rango desde/hasta)
let _filtro = { q: '', tipo: '', modo: 'mes', desde: '', hasta: '' };
let _offRealtime = null;

export async function render(contenedor) {
  _contenedor = contenedor;
  _filtro = { q: '', tipo: '', modo: 'mes', desde: '', hasta: '' };
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = `<div style="padding:28px 32px;color:#64748b;font-size:14px">Cargando facturas de compra…</div>`;
  try { _compras = await Repo.listar(); } catch (e) { _compras = []; }

  pintar();

  _offRealtime = Realtime.escuchar('compras', async () => {
    try { _compras = await Repo.listar(); pintar(); } catch (err) { console.warn('Realtime facturas-compra:', err); }
  });
}

function pintar() {
  _contenedor.innerHTML = htmlLayout();
  refrescarIconos(_contenedor);
  adjuntar();
  pintarCxp();
  pintarHistorial();
}

// ============================================================
//  LAYOUT
// ============================================================

function htmlKpis() {
  const mes = todayISO().slice(0, 7);
  const n = _compras.length;
  const total = _compras.reduce((s, c) => s + num(c.total), 0);
  const delMes = _compras.filter((c) => (c.fecha || '').slice(0, 7) === mes).reduce((s, c) => s + num(c.total), 0);
  const creditos = _compras.filter((c) => c.tipoPago === 'credito' && num(c.saldo) > 0.5);
  const porPagar = creditos.reduce((s, c) => s + num(c.saldo), 0);
  const vencidas = creditos.filter((c) => c.vence && c.vence < todayISO()).length;
  return kpiGrid([
    { label: 'Facturas de compra', valor: fmt(n), sub: 'Registradas', icono: 'file-text', color: '#2563eb' },
    { label: 'Comprado este mes', valor: money(delMes), sub: 'Mes en curso', icono: 'shopping-cart', color: '#0369a1' },
    { label: 'Por pagar', valor: money(porPagar), sub: `${fmt(creditos.length)} a crédito`, icono: 'wallet', color: porPagar > 0 ? '#d97706' : '#16a34a' },
    { label: 'Vencidas', valor: fmt(vencidas), sub: 'Crédito vencido', icono: 'alert-triangle', color: vencidas > 0 ? '#dc2626' : '#16a34a' },
  ]);
}

function htmlLayout() {
  const acciones = `
    <button id="fc-cxp-nueva" style="display:inline-flex;align-items:center;gap:7px;padding:10px 14px;background:white;border:1px solid #fde68a;color:#a16207;border-radius:12px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit" title="Registrar una deuda existente sin tocar inventario (migración)">
      <i data-lucide="file-plus" style="width:16px;height:16px;stroke-width:2"></i> Cuenta por pagar
    </button>
    <button id="fc-nueva" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#2563eb;color:white;border:0;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #2563eb40">
      <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i> Nueva compra
    </button>
  `;
  return `
    <div style="padding:20px 28px;max-width:1280px">
      ${pageHeader({
        icono: 'receipt-text',
        titulo: 'Facturas de compra',
        descripcion: 'Todas las compras a proveedores y las cuentas por pagar.',
        acciones,
      })}
      ${_compras.length > 0 ? htmlKpis() : ''}
      <div id="fc-cxp"></div>
      <div id="fc-hist"></div>
    </div>
  `;
}

function adjuntar() {
  _contenedor.querySelector('#fc-nueva')?.addEventListener('click', () => Router.navegar('compras'));
  _contenedor.querySelector('#fc-cxp-nueva')?.addEventListener('click', () => abrirCuentaPorPagar());
}

// ============================================================
//  CREAR CUENTA POR PAGAR (sin afectar inventario — migración)
// ============================================================

async function abrirCuentaPorPagar() {
  let provs = [];
  try { provs = await ProveedoresRepo.listar(); } catch (e) { provs = []; }
  const vd = new Date(); vd.setDate(vd.getDate() + 30);
  const venceDef = vd.toISOString().slice(0, 10);

  const contenido = `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 13px;margin-bottom:14px;font-size:12.5px;color:#92400e">
      Registra una factura de compra que quedó <b>pendiente de pago</b>. <b>No suma stock</b> al inventario — úsalo para migraciones o saldos iniciales.
    </div>
    <div style="display:grid;gap:12px">
      <div>
        <div class="ui-label" style="margin-bottom:4px">Proveedor *</div>
        <input id="cxp-prov" class="ui-input" list="cxp-prov-list" placeholder="Nombre del proveedor" autocomplete="off" />
        <datalist id="cxp-prov-list">${provs.map((p) => `<option value="${esc(p.nombre || '')}"></option>`).join('')}</datalist>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div class="ui-label" style="margin-bottom:4px">N° factura / remisión</div>
          <input id="cxp-ref" class="ui-input" type="text" placeholder="Ej: FC-1024" autocomplete="off" />
        </div>
        <div>
          <div class="ui-label" style="margin-bottom:4px">Fecha de la factura</div>
          <input id="cxp-fecha" class="ui-input" type="date" value="${todayISO()}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div class="ui-label" style="margin-bottom:4px">Monto total adeudado *</div>
          <input id="cxp-total" data-miles type="text" inputmode="numeric" placeholder="0"
            style="width:100%;padding:12px 14px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:18px;font-weight:700;outline:none;box-sizing:border-box;font-family:inherit;text-align:right" />
        </div>
        <div>
          <div class="ui-label" style="margin-bottom:4px">Abono inicial (opcional)</div>
          <input id="cxp-abono" data-miles type="text" inputmode="numeric" placeholder="0" class="ui-input" style="text-align:right" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
        <div>
          <div class="ui-label" style="margin-bottom:4px">Vencimiento</div>
          <input id="cxp-vence" class="ui-input" type="date" value="${venceDef}" />
        </div>
        <div id="cxp-saldo" style="font-size:13px;color:#64748b;padding-bottom:10px">Saldo: <b style="color:#a16207">$0</b></div>
      </div>
      <div>
        <div class="ui-label" style="margin-bottom:4px">Nota</div>
        <input id="cxp-nota" class="ui-input" type="text" placeholder="Ej: saldo migrado del sistema anterior" autocomplete="off" />
      </div>
      <div style="display:flex;gap:10px;margin-top:4px">
        <button id="cxp-cancel" style="flex:1;padding:11px;border:1px solid #e5e7eb;background:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#374151">Cancelar</button>
        <button id="cxp-save" style="flex:1.3;padding:11px;border:0;background:#a16207;color:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Guardar cuenta por pagar</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Nueva cuenta por pagar', contenido, ancho: 'md' });
  bindMilesInputs(m.body);
  setTimeout(() => m.body.querySelector('#cxp-prov')?.focus(), 60);

  const inpTotal = m.body.querySelector('#cxp-total');
  const inpAbono = m.body.querySelector('#cxp-abono');
  const saldoBox = m.body.querySelector('#cxp-saldo');
  const recalc = () => {
    const t = num(inpTotal.value);
    const ab = Math.min(num(inpAbono.value), t);
    saldoBox.innerHTML = `Saldo: <b style="color:#a16207">${money(Math.max(0, t - ab))}</b>`;
  };
  inpTotal.addEventListener('input', recalc);
  inpAbono.addEventListener('input', recalc);

  m.body.querySelector('#cxp-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#cxp-save').onclick = async () => {
    const btn = m.body.querySelector('#cxp-save');
    if (btn.disabled) return;
    btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait';
    try {
      await Repo.registrarCuentaPorPagar({
        proveedor: m.body.querySelector('#cxp-prov').value,
        ref: m.body.querySelector('#cxp-ref').value,
        fecha: m.body.querySelector('#cxp-fecha').value || todayISO(),
        total: num(inpTotal.value),
        abonoInicial: num(inpAbono.value),
        vence: m.body.querySelector('#cxp-vence').value || '',
        nota: m.body.querySelector('#cxp-nota').value,
      });
      Toast.ok('Cuenta por pagar registrada');
      m.cerrar();
      _compras = await Repo.listar();
      pintar();
    } catch (err) {
      Toast.error(err.message || 'No se pudo registrar la cuenta');
      btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
    }
  };
}

// ============================================================
//  CUENTAS POR PAGAR
// ============================================================

function pintarCxp() {
  const box = _contenedor.querySelector('#fc-cxp');
  if (!box) return;

  const creditos = _compras.filter((c) => c.tipoPago === 'credito' && num(c.saldo) > 0.5)
    .sort((a, b) => (a.vence || '9999').localeCompare(b.vence || '9999'));
  if (creditos.length === 0) { box.innerHTML = ''; return; }

  const totalDeuda = creditos.reduce((s, c) => s + num(c.saldo), 0);

  box.innerHTML = `
    <div class="ui-table-card" style="border-left:4px solid #d97706;margin-bottom:18px">
      <div style="padding:16px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid #f3f4f6">
        <div>
          <h3 style="font-size:15px;font-weight:700;margin:0;color:#111827">Cuentas por pagar a proveedores</h3>
          <div style="font-size:12.5px;color:#6b7280;margin-top:2px">${fmt(creditos.length)} a crédito · deuda total <b style="color:#a16207">${money(totalDeuda)}</b></div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="ui-table">
          <thead>
            <tr>
              <th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Vence</th>
              <th style="text-align:right">Total</th><th style="text-align:right">Saldo</th>
              <th style="width:56px"></th>
            </tr>
          </thead>
          <tbody>
            ${creditos.map((c) => {
              const vencido = c.vence && c.vence < todayISO();
              return `
                <tr data-id="${esc(c.id)}">
                  <td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:#6b7280">${esc((c.fecha || '').slice(0, 10))}</td>
                  <td style="font-weight:600;color:#111827">${esc(c.proveedor || 'Sin proveedor')}</td>
                  <td style="color:#6b7280">${esc(c.ref || '—')}</td>
                  <td>${c.vence ? badge(esc(c.vence), vencido ? 'danger' : 'info') : '<span style="color:#d1d5db">—</span>'}</td>
                  <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</td>
                  <td style="text-align:right;color:#a16207;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.saldo)}</td>
                  <td style="text-align:right">${menuButton(c.id)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  refrescarIconos(box);
  wireMenus(box, () => ([
    { label: 'Ver detalle', value: 'ver', icono: '👁️' },
    { label: 'Registrar abono', value: 'abonar', icono: '💵' },
  ]), (accion, id) => {
    if (accion === 'ver') verDetalle(id);
    else if (accion === 'abonar') abrirAbono(id);
  });
}

// ============================================================
//  HISTORIAL
// ============================================================

function pintarHistorial() {
  const box = _contenedor.querySelector('#fc-hist');
  if (!box) return;

  if (_compras.length === 0) {
    box.innerHTML = `
      <div class="ui-table-card" style="padding:48px 24px;text-align:center;color:#94a3b8">
        <i data-lucide="receipt-text" style="width:40px;height:40px;color:#cbd5e1;stroke-width:1.5"></i>
        <div style="margin-top:10px;font-weight:600;color:#475569">Aún no hay facturas de compra</div>
        <div style="font-size:13px;margin-top:2px">Registra tu primera compra a un proveedor.</div>
      </div>`;
    refrescarIconos(box);
    return;
  }

  const presetBtn = (modo, label) => `
    <button class="fc-preset" data-modo="${modo}"
      style="padding:7px 13px;border:1px solid ${_filtro.modo === modo ? '#2563eb' : '#d1d5db'};background:${_filtro.modo === modo ? '#2563eb' : '#fff'};color:${_filtro.modo === modo ? '#fff' : '#374151'};border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${label}</button>`;

  box.innerHTML = `
    <div class="ui-table-card">
      <div style="padding:16px 18px;border-bottom:1px solid #f3f4f6;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0;color:#111827">Historial de compras</h3>
            <div id="fc-hist-sub" style="font-size:12.5px;color:#6b7280;margin-top:2px"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="fc-q" class="ui-input" type="text" placeholder="Buscar proveedor o factura…" value="${esc(_filtro.q)}" style="min-width:200px;width:auto" />
            <select id="fc-tipo" class="ui-input" style="width:auto;min-width:140px">
              <option value="">Contado y crédito</option>
              <option value="contado" ${_filtro.tipo === 'contado' ? 'selected' : ''}>Solo contado</option>
              <option value="credito" ${_filtro.tipo === 'credito' ? 'selected' : ''}>Solo crédito</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${presetBtn('mes', 'Este mes')}
          ${presetBtn('todas', 'Todas')}
          ${presetBtn('custom', 'Rango…')}
          ${_filtro.modo === 'custom' ? `
            <span style="color:#94a3b8;font-size:12.5px">Desde</span>
            <input id="fc-desde" class="ui-input" type="date" value="${esc(_filtro.desde)}" style="width:auto" />
            <span style="color:#94a3b8;font-size:12.5px">Hasta</span>
            <input id="fc-hasta" class="ui-input" type="date" value="${esc(_filtro.hasta)}" style="width:auto" />
          ` : ''}
        </div>
      </div>
      <div id="fc-hist-body" style="overflow-x:auto"></div>
    </div>
  `;

  const inpQ = box.querySelector('#fc-q');
  const selTipo = box.querySelector('#fc-tipo');
  let deb;
  inpQ?.addEventListener('input', (e) => {
    if (deb) clearTimeout(deb);
    deb = setTimeout(() => { _filtro.q = e.target.value; renderFilas(); }, 120);
  });
  selTipo?.addEventListener('change', (e) => { _filtro.tipo = e.target.value; renderFilas(); });

  box.querySelectorAll('.fc-preset').forEach((b) => {
    b.addEventListener('click', () => {
      const modo = b.dataset.modo;
      if (modo === 'custom' && !_filtro.desde && !_filtro.hasta) {
        _filtro.desde = todayISO().slice(0, 8) + '01';  // inicio de mes
        _filtro.hasta = todayISO();
      }
      _filtro.modo = modo;
      pintarHistorial();   // re-render para mostrar/ocultar el rango y marcar el activo
    });
  });
  box.querySelector('#fc-desde')?.addEventListener('change', (e) => { _filtro.desde = e.target.value; renderFilas(); });
  box.querySelector('#fc-hasta')?.addEventListener('change', (e) => { _filtro.hasta = e.target.value; renderFilas(); });

  renderFilas();
}

function renderFilas() {
  const cont = _contenedor.querySelector('#fc-hist-body');
  if (!cont) return;

  let lista = [..._compras];
  const q = _filtro.q.toLowerCase().trim();
  if (q) lista = lista.filter((c) => [(c.proveedor || ''), (c.ref || '')].join(' ').toLowerCase().includes(q));
  if (_filtro.tipo) lista = lista.filter((c) => c.tipoPago === _filtro.tipo);

  // Filtro de fecha (solo el historial; las cuentas por pagar muestran toda la deuda)
  if (_filtro.modo === 'mes') {
    const mesActual = todayISO().slice(0, 7);
    lista = lista.filter((c) => (c.fecha || '').slice(0, 7) === mesActual);
  } else if (_filtro.modo === 'custom') {
    if (_filtro.desde) lista = lista.filter((c) => (c.fecha || '').slice(0, 10) >= _filtro.desde);
    if (_filtro.hasta) lista = lista.filter((c) => (c.fecha || '').slice(0, 10) <= _filtro.hasta);
  }

  // Subtítulo con conteo del rango activo
  const sub = _contenedor.querySelector('#fc-hist-sub');
  if (sub) {
    const etiqueta = _filtro.modo === 'mes' ? 'este mes' : _filtro.modo === 'custom' ? 'en el rango' : 'en total';
    sub.textContent = `${fmt(lista.length)} factura(s) ${etiqueta} · ${fmt(_compras.length)} registradas`;
  }

  if (lista.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:28px;color:#94a3b8;font-size:13.5px">No hay compras en ${_filtro.modo === 'mes' ? 'este mes' : _filtro.modo === 'custom' ? 'el rango elegido' : 'el filtro'}.</div>`;
    return;
  }

  cont.innerHTML = `
    <table class="ui-table">
      <thead>
        <tr>
          <th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Tipo</th>
          <th style="text-align:right">Total</th><th style="width:56px"></th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((c) => {
          const esCredito = c.tipoPago === 'credito';
          const pagada = esCredito && num(c.saldo) <= 0.5;
          const estado = !esCredito ? badge('Contado', 'success')
            : pagada ? badge('Pagada', 'success') : badge('Crédito', 'warn');
          return `
            <tr data-id="${esc(c.id)}">
              <td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:#6b7280">${esc((c.fecha || '').slice(0, 10))}</td>
              <td style="font-weight:600;color:#111827">${esc(c.proveedor || 'Sin proveedor')}</td>
              <td style="color:#6b7280">${esc(c.ref || '—')}</td>
              <td>${estado}</td>
              <td style="text-align:right;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</td>
              <td style="text-align:right">${menuButton(c.id)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  refrescarIconos(cont);
  wireMenus(cont, (id) => {
    const c = _compras.find((x) => x.id === id);
    const credPend = c && c.tipoPago === 'credito' && num(c.saldo) > 0.5;
    return [
      { label: 'Ver detalle', value: 'ver', icono: '👁️' },
      ...(credPend ? [{ label: 'Registrar abono', value: 'abonar', icono: '💵' }] : []),
      { separador: true },
      { label: 'Eliminar', value: 'eliminar', icono: '🗑️', color: '#dc2626' },
    ];
  }, (accion, id) => {
    if (accion === 'ver') verDetalle(id);
    else if (accion === 'abonar') abrirAbono(id);
    else if (accion === 'eliminar') eliminar(id);
  });
}

// ============================================================
//  ABONO
// ============================================================

function abrirAbono(compraId) {
  const c = _compras.find((x) => x.id === compraId);
  if (!c) return;
  const abonos = Array.isArray(c.abonos) ? c.abonos : [];
  const totalAbonado = abonos.reduce((s, a) => s + num(a.monto), 0);

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:4px">
        <span>Compra</span><b style="color:#111827">${esc(c.proveedor || '—')} · ${esc(c.ref || 'Sin ref')}</b>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-bottom:4px">
        <span>Total compra</span><b style="color:#111827;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</b>
      </div>
      ${totalAbonado > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#15803d;margin-bottom:4px"><span>Total abonado (${abonos.length})</span><b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</b></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280">
        <span>Saldo pendiente</span><b style="color:#a16207;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.saldo)}</b>
      </div>
    </div>

    <div>
      <div class="ui-label" style="margin-bottom:4px">Monto del abono *</div>
      <input id="fc-abono-monto" data-miles type="text" inputmode="numeric" placeholder="0"
        style="width:100%;padding:14px;border:1px solid #d1d5db;border-radius:12px;font-size:22px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box" />
    </div>
    <div style="margin-top:12px;display:grid;gap:10px;grid-template-columns:1fr 1fr">
      <div>
        <div class="ui-label" style="margin-bottom:4px">Fecha del abono</div>
        <input id="fc-abono-fecha" class="ui-input" type="date" value="${todayISO()}" />
      </div>
      <div>
        <div class="ui-label" style="margin-bottom:4px">Método</div>
        <select id="fc-abono-metodo" class="ui-input">
          ${Repo.METODOS_PAGO.map((mp) => `<option value="${esc(mp)}">${mp}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="fc-abono-cancel" style="flex:1;padding:11px;border:1px solid #e5e7eb;background:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#374151">Cancelar</button>
      <button id="fc-abono-save" style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Registrar abono</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Registrar abono', contenido, ancho: 'sm' });
  bindMilesInputs(m.body);
  setTimeout(() => m.body.querySelector('#fc-abono-monto')?.focus(), 60);
  const inpMonto = m.body.querySelector('#fc-abono-monto');
  inpMonto?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.body.querySelector('#fc-abono-save').click(); } });

  m.body.querySelector('#fc-abono-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#fc-abono-save').onclick = async () => {
    const btn = m.body.querySelector('#fc-abono-save');
    if (btn.disabled) return;
    btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait';
    const monto = num(m.body.querySelector('#fc-abono-monto').value);
    const metodo = m.body.querySelector('#fc-abono-metodo').value;
    const fecha = m.body.querySelector('#fc-abono-fecha').value || todayISO();
    try {
      await Repo.abonar(compraId, { monto, metodo, fecha });
      _compras = await Repo.listar();
      Toast.ok('Abono registrado');
      m.cerrar();
      pintarCxp();
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

function verDetalle(compraId) {
  const c = _compras.find((x) => x.id === compraId);
  if (!c) return;
  const items = Array.isArray(c.items) ? c.items : [];
  const abonos = Array.isArray(c.abonos) ? c.abonos : [];
  const totalAbonado = abonos.reduce((s, a) => s + num(a.monto), 0);
  const esCredito = c.tipoPago === 'credito';
  const saldo = num(c.saldo);
  const pagada = esCredito && saldo <= 0.5;
  const vencido = esCredito && c.vence && c.vence < todayISO() && saldo > 0.5;

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:15px;color:#111827">${esc(c.proveedor || 'Sin proveedor')}</div>
          <div style="color:#6b7280;font-size:12.5px;margin-top:2px;font-family:'JetBrains Mono',ui-monospace,monospace">Factura: ${esc(c.ref || '—')} · ${esc((c.fecha || '').slice(0, 10))}</div>
        </div>
        ${!esCredito ? badge('Contado', 'success') : pagada ? badge('Pagada', 'success') : badge('Crédito', 'warn')}
      </div>
      <div style="display:grid;gap:6px;grid-template-columns:1fr 1fr;font-size:13px">
        <div style="color:#6b7280">Total compra</div>
        <div style="text-align:right;font-weight:700;color:#111827;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</div>
        ${esCredito ? `
          <div style="color:#6b7280">Total abonado (${abonos.length})</div>
          <div style="text-align:right;font-weight:700;color:#15803d;font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</div>
          <div style="color:#6b7280">Saldo pendiente</div>
          <div style="text-align:right;font-weight:800;color:${pagada ? '#15803d' : '#a16207'};font-family:'JetBrains Mono',ui-monospace,monospace">${money(saldo)}</div>
          ${c.vence ? `<div style="color:#6b7280">Vence</div><div style="text-align:right;font-weight:700;color:${vencido ? '#dc2626' : '#475569'}">${esc(c.vence)}${vencido ? ' · vencida' : ''}</div>` : ''}
        ` : ''}
      </div>
    </div>

    ${items.length > 0 ? `
      <div style="margin-bottom:14px">
        <div class="ui-label" style="margin-bottom:6px">Productos comprados</div>
        <div class="ui-table-card"><table class="ui-table">
          <thead><tr><th style="width:48px">Cant</th><th>Producto</th><th style="text-align:right">Costo</th><th style="text-align:right">Subtotal</th></tr></thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td style="font-family:'JetBrains Mono',ui-monospace,monospace"><b>${fmt(it.cantidad)}</b></td>
                <td>${esc(it.nombre)}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(it.costo)}</td>
                <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace"><b>${money(num(it.subtotal) || num(it.cantidad) * num(it.costo))}</b></td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    ` : ''}

    ${esCredito && abonos.length > 0 ? `
      <div style="margin-bottom:14px">
        <div class="ui-label" style="margin-bottom:6px">Historial de abonos (${abonos.length})</div>
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

    ${c.nota ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:9px;padding:10px 12px;margin-bottom:14px"><div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:3px">Nota</div><div style="font-size:13px;color:#111827">${esc(c.nota)}</div></div>` : ''}

    <div style="display:flex;gap:10px;margin-top:6px">
      ${esCredito && !pagada ? `<button id="fc-det-abonar" style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Registrar abono</button>` : ''}
      <button id="fc-det-cerrar" style="flex:1;padding:11px;border:1px solid #e5e7eb;background:white;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#374151">Cerrar</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Detalle de compra', contenido, ancho: 'lg' });
  m.body.querySelector('#fc-det-cerrar').onclick = () => m.cerrar();
  const btnAbonar = m.body.querySelector('#fc-det-abonar');
  if (btnAbonar) btnAbonar.onclick = () => { m.cerrar(); setTimeout(() => abrirAbono(compraId), 220); };
}

async function eliminar(id) {
  const c = _compras.find((x) => x.id === id);
  if (!c) return;
  const ok = await Confirm.peligro(
    `¿Eliminar esta compra? Se restará del inventario lo que se había sumado (${(c.items || []).length} producto(s)).`,
    { titulo: 'Eliminar compra', textoConfirmar: 'Eliminar' },
  );
  if (!ok) return;
  try {
    await Repo.eliminar(id);
    _compras = await Repo.listar();
    Toast.ok('Compra eliminada');
    pintar();
  } catch (err) {
    Toast.error('No se pudo eliminar la compra');
  }
}
