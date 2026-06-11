/**
 * modules/compras/compras.view.js — Vista del módulo Compras
 *
 * Replica del renderCompras del legacy:
 *   - Barra superior con resumen + botón "Ver proveedores" y "Agregar"
 *   - Layout 2-col: izquierda = form de compra, derecha = items del pedido
 *   - Bloque de cuentas por pagar (créditos pendientes) con abonos
 *   - Historial de compras con filtros
 */

import * as Repo from './compras.repo.js';
import * as ProveedoresRepo from './proveedores.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { bindMilesInput, bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';

// ============================================================
//  ESTADO
// ============================================================

let _contenedor = null;
let _productos = [];
let _proveedores = [];
let _compras = [];
let _offRealtime = null;

let _proveedorSel = null;     // Proveedor seleccionado para la compra actual
let _items = [];              // Items del pedido en curso
let _filtroHist = { q: '', tipo: '' };

let _resultadosBusqueda = [];
let _indiceActivo = -1;
let _dropdownAbierto = false;

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;
  _proveedorSel = null;
  _items = [];
  _filtroHist = { q: '', tipo: '' };

  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlCargando();
  await refrescarDatos();

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarItemsCompra();

  // Realtime: refrescar listados de compras/proveedores/productos en vivo
  _offRealtime = Realtime.escucharVarias(['compras', 'proveedores', 'productos'], async () => {
    try {
      await refrescarDatos();
      pintarCuentasPorPagar();
      pintarHistorial();
    } catch (err) { console.warn('Realtime compras:', err); }
  });
}

async function refrescarDatos() {
  try { _productos = await ProductosRepo.listar(); } catch (e) { _productos = []; }
  try { _proveedores = await ProveedoresRepo.listar(); } catch (e) { _proveedores = []; }
  try { _compras = await Repo.listar(); } catch (e) { _compras = []; }
}

// ============================================================
//  LAYOUT BASE
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando compras…</div>`;
}

function htmlLayout() {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <i data-lucide="truck" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Compras</h1>
      </div>

      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="width:44px;height:44px;border-radius:11px;background:#eef2ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-size:22px">🚚</div>
          <div>
            <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f172a">Módulo de Compras</div>
            <div style="font-size:12.5px;color:#64748b">${fmt(_proveedores.length)} proveedor(es) · ${fmt(_compras.length)} compras registradas</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="comp-btn-prov-list"
            style="padding:10px 14px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569">🏢 Ver proveedores</button>
          <button id="comp-btn-prov-nuevo"
            style="padding:10px 14px;background:#4f46e5;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">+ Agregar proveedor</button>
        </div>
      </div>

      <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;align-items:start">
        ${htmlFormCompra()}
        ${htmlPanelItems()}
      </div>

      <div id="comp-cxp"></div>
      <div id="comp-hist"></div>
    </div>
  `;
}

function htmlFormCompra() {
  const prov = _proveedorSel;
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
      <h3 style="font-size:15.5px;font-weight:700;margin:0;color:#0f172a">Registrar compra de mercancía</h3>
      <div style="font-size:12.5px;color:#64748b">Selecciona proveedor y agrega productos para sumarlos al inventario.</div>

      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Proveedor</div>
        ${prov ? `
          <div id="comp-prov-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;cursor:pointer">
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px;color:#0f172a">${esc(prov.nombre)}</b> ${prov.nit ? `<span style="background:#e0e7ff;color:#4338ca;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px">${esc(prov.nit)}</span>` : ''}</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px">${[prov.telefono, prov.ciudad, prov.contacto].filter(Boolean).map(esc).join(' · ') || 'Sin datos adicionales'}</div>
            </div>
            <button id="comp-prov-cambiar"
              style="padding:6px 12px;border:1px solid #e2e8f0;background:white;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:inherit;color:#475569">Cambiar</button>
          </div>
        ` : `
          <div id="comp-prov-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:9px;cursor:pointer">
            <div>
              <div style="font-weight:600;font-size:13.5px;color:#0f172a">Sin proveedor asignado</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px">${_proveedores.length ? 'Click para seleccionar o crear uno' : 'Crea tu primer proveedor para empezar'}</div>
            </div>
            <button style="padding:7px 13px;background:#4f46e5;color:white;border:0;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit">${_proveedores.length ? 'Seleccionar' : '+ Nuevo'}</button>
          </div>
        `}
      </div>

      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha de compra</div>
          <input id="comp-fecha" type="date" value="${todayISO()}"
            style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">N° factura / remisión</div>
          <input id="comp-ref" type="text" placeholder="Ej: FC-1024" autocomplete="off"
            style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
      </div>

      <hr style="border:0;border-top:1px solid #e2e8f0;margin:4px 0">

      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Agregar producto al pedido</div>
        ${htmlSelectorLectorCompra()}
      </div>
      <div style="position:relative">
        <div style="background:#f8fafc;border:2px dashed #60a5fa;border-radius:12px;padding:12px">
          <input id="comp-buscar" type="text" placeholder="Buscar por código, barras, nombre o categoría..." autocomplete="off"
            style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
          <div style="color:#64748b;font-size:12px;margin-top:6px">↑↓ navegar · Enter agregar · Esc cerrar · los códigos salen primero</div>
        </div>
        <div id="comp-resultados" style="margin-top:4px;display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto"></div>
        ${getLectorModeCompra() === 'pistola' ? `
          <div style="color:#64748b;font-size:12.5px;margin-top:10px;display:flex;align-items:center;gap:6px">
            🔫 <span><strong>Lector USB activo:</strong> escanea y se agrega automáticamente al pedido.</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function htmlSelectorLectorCompra() {
  const modo = getLectorModeCompra();
  const esPistola = modo === 'pistola';
  return `
    <div style="display:flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:8px;padding:3px">
      <button class="lm-btn-comp" data-modo="pistola"
        style="padding:5px 10px;border:0;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:${esPistola ? 'white' : 'transparent'};color:${esPistola ? '#4f46e5' : '#64748b'};${esPistola ? 'box-shadow:0 1px 3px rgba(0,0,0,.08)' : ''}">🔫 Pistola</button>
      <button class="lm-btn-comp" data-modo="manual"
        style="padding:5px 10px;border:0;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:${!esPistola ? 'white' : 'transparent'};color:${!esPistola ? '#4f46e5' : '#64748b'};${!esPistola ? 'box-shadow:0 1px 3px rgba(0,0,0,.08)' : ''}">⌨️ Manual</button>
    </div>
  `;
}

function htmlPanelItems() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
      <h3 style="font-size:15.5px;font-weight:700;margin:0;color:#0f172a">Productos del pedido</h3>
      <div id="comp-items" style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto"></div>
      <div id="comp-total" style="border-top:1px solid #e2e8f0;padding-top:12px;margin-top:6px"></div>
      <button id="comp-btn-registrar"
        style="width:100%;padding:14px;background:#15803d;color:white;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)">
        💵 Registrar pago
      </button>
    </div>
  `;
}

// ============================================================
//  EVENTOS PRINCIPALES
// ============================================================

function adjuntarEventos(contenedor) {
  contenedor.querySelector('#comp-btn-prov-list').onclick = () => abrirSelectorProveedor();
  contenedor.querySelector('#comp-btn-prov-nuevo').onclick = () => abrirFormProveedor();
  contenedor.querySelector('#comp-prov-box').onclick = () => abrirSelectorProveedor();
  const cambiar = contenedor.querySelector('#comp-prov-cambiar');
  if (cambiar) cambiar.onclick = (e) => { e.stopPropagation(); abrirSelectorProveedor(); };

  contenedor.querySelector('#comp-btn-registrar').onclick = () => abrirRegistroPago();

  cablearBuscador(contenedor);
  cablearSelectorLector(contenedor);

  pintarCuentasPorPagar();
  pintarHistorial();
}

function cablearBuscador(contenedor) {
  const inp = contenedor.querySelector('#comp-buscar');
  if (!inp) return;
  let debounce;
  inp.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    const query = e.target.value;
    debounce = setTimeout(() => {
      // Modo pistola: intentar match exacto y agregar directo al pedido
      if (getLectorModeCompra() === 'pistola') {
        const exact = tryScannerExactCompra(query);
        if (exact) {
          procesarEscaneoCompra(exact, query, inp);
          return;
        }
      }
      _resultadosBusqueda = filtrarProductos(query);
      _indiceActivo = _resultadosBusqueda.length > 0 ? 0 : -1;
      _dropdownAbierto = true;
      pintarResultadosBusqueda();
    }, 80);
  });
  inp.addEventListener('keydown', (e) => {
    if (!_dropdownAbierto && e.key !== 'Escape') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!_resultadosBusqueda.length) return;
      _indiceActivo = (_indiceActivo + 1) % Math.min(_resultadosBusqueda.length, 30);
      pintarResultadosBusqueda();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!_resultadosBusqueda.length) return;
      const max = Math.min(_resultadosBusqueda.length, 30);
      _indiceActivo = (_indiceActivo - 1 + max) % max;
      pintarResultadosBusqueda();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = _resultadosBusqueda[_indiceActivo];
      if (p) abrirModalCantidadCompra(p.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _dropdownAbierto = false;
      pintarResultadosBusqueda();
    }
  });
  setTimeout(() => inp.focus(), 80);
}

function cablearSelectorLector(contenedor) {
  contenedor.querySelectorAll('.lm-btn-comp').forEach((btn) => {
    btn.onclick = () => {
      const modo = btn.dataset.modo;
      if (modo === getLectorModeCompra()) return;
      setLectorModeCompra(modo);
      Toast.ok(modo === 'pistola' ? '🔫 Modo lector USB' : '⌨️ Modo manual');
      actualizarFormCompra();
    };
  });
}

function filtrarProductos(q) {
  // Usar el MISMO ranking que Ventas: codigo exacto > codigo empieza con >
  // barras > codigo incluye > nombre empieza con > nombre incluye > ...
  return ProductosRepo.filtrarConPrioridad(_productos, q);
}

function _qActual() {
  return (_contenedor?.querySelector('#comp-buscar')?.value || '').trim().toLowerCase();
}

function _hl(s, q) {
  if (!q) return esc(s || '');
  const txt = String(s || '');
  const ix = txt.toLowerCase().indexOf(q);
  if (ix < 0) return esc(txt);
  return `${esc(txt.slice(0, ix))}<mark style="background:rgba(74,222,128,.40);padding:0 2px;border-radius:3px;font-weight:800">${esc(txt.slice(ix, ix + q.length))}</mark>${esc(txt.slice(ix + q.length))}`;
}

function pintarResultadosBusqueda() {
  const box = _contenedor.querySelector('#comp-resultados');
  if (!box) return;
  if (!_dropdownAbierto || _resultadosBusqueda.length === 0) {
    box.innerHTML = '';
    return;
  }
  const q = _qActual();
  box.innerHTML = _resultadosBusqueda.slice(0, 30).map((p, i) => {
    const activo = i === _indiceActivo;
    return `
      <button class="comp-res" data-id="${esc(p.id)}"
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ${activo ? '#4f46e5' : '#e2e8f0'};background:${activo ? '#eef2ff' : 'white'};border-radius:9px;cursor:pointer;font-family:inherit;text-align:left">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:800;font-size:13px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:5px">${_hl(p.codigo || '—', q)}</span>
            <b style="font-size:13.5px;color:#0f172a">${_hl(p.nombre, q)}</b>
          </div>
          <div style="color:#64748b;font-size:11.5px;margin-top:3px">Stock: ${fmt(p.stock || 0)} · Último costo: ${money(p.costo || 0)}${p.categoria ? ' · ' + esc(p.categoria) : ''}</div>
        </div>
        <span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:4px 9px;border-radius:6px;flex-shrink:0">＋ Añadir</span>
      </button>
    `;
  }).join('');
  box.querySelectorAll('.comp-res').forEach((b) => {
    b.onclick = () => abrirModalCantidadCompra(b.dataset.id);
  });
}

// ============================================================
//  ITEMS DEL PEDIDO
// ============================================================

function pintarItemsCompra() {
  const box = _contenedor.querySelector('#comp-items');
  const tot = _contenedor.querySelector('#comp-total');
  if (!box) return;

  if (_items.length === 0) {
    box.innerHTML = `
      <div style="text-align:center;padding:30px 12px;color:#94a3b8">
        <div style="font-size:42px;opacity:.5">🧺</div>
        <div style="margin-top:6px;font-weight:500;font-size:13px">Aún no has agregado productos al pedido.</div>
      </div>
    `;
    if (tot) tot.innerHTML = '';
    return;
  }

  box.innerHTML = _items.map((it, ix) => {
    const sub = num(it.cantidad) * num(it.costo);
    return `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <b style="font-size:13.5px;color:#0f172a;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.nombre)}</b>
          <button class="comp-it-quitar" data-ix="${ix}" style="background:none;border:0;color:#dc2626;font-size:16px;cursor:pointer;padding:0 6px">✕</button>
        </div>
        <div style="display:grid;gap:8px;grid-template-columns:1fr 1.2fr 1fr;align-items:end">
          <div>
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Cant</div>
            <input class="comp-it-cant" data-miles data-ix="${ix}" type="text" inputmode="numeric" value="${it.cantidad}"
              style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;outline:none;box-sizing:border-box;font-family:'JetBrains Mono',ui-monospace,monospace" />
          </div>
          <div>
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Costo unitario</div>
            <input class="comp-it-costo" data-miles data-ix="${ix}" type="text" inputmode="numeric" value="${it.costo}"
              style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;outline:none;box-sizing:border-box;font-family:'JetBrains Mono',ui-monospace,monospace" />
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Subtotal</div>
            <div style="font-weight:700;color:#0f172a;font-size:14px;font-family:'JetBrains Mono',ui-monospace,monospace">${money(sub)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.comp-it-quitar').forEach((b) => {
    b.onclick = () => { _items.splice(Number(b.dataset.ix), 1); pintarItemsCompra(); };
  });
  // Aplicar formato de miles a todos los inputs inline
  bindMilesInputs(box);
  box.querySelectorAll('.comp-it-cant').forEach((inp) => {
    inp.addEventListener('change', () => {
      const ix = Number(inp.dataset.ix);
      _items[ix].cantidad = Math.max(0, num(inp.value));
      pintarItemsCompra();
    });
  });
  box.querySelectorAll('.comp-it-costo').forEach((inp) => {
    inp.addEventListener('change', () => {
      const ix = Number(inp.dataset.ix);
      _items[ix].costo = Math.max(0, num(inp.value));
      pintarItemsCompra();
    });
  });

  const total = _items.reduce((s, it) => s + num(it.cantidad) * num(it.costo), 0);
  const totalU = _items.reduce((s, it) => s + num(it.cantidad), 0);
  if (tot) {
    tot.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
        <span style="color:#64748b">${fmt(_items.length)} producto(s) · ${fmt(totalU)} unidad(es)</span>
        <b style="color:#0f172a;font-size:20px;font-family:'JetBrains Mono',ui-monospace,monospace">${money(total)}</b>
      </div>
    `;
  }
}

// ============================================================
//  MODAL: CANTIDAD / COSTO AL AGREGAR A COMPRA
// ============================================================

function abrirModalCantidadCompra(prodId) {
  const p = _productos.find((x) => x.id === prodId);
  if (!p) return;

  const yaEn = _items.find((it) => it.producto_id === prodId);
  const cant = yaEn ? yaEn.cantidad : 1;
  const costo = yaEn ? yaEn.costo : (Number(p.costo) || 0);

  const contenido = `
    <div style="text-align:left">
      <div style="font-weight:700;font-size:16px;color:#0f172a">${esc(p.nombre)}</div>
      <div style="color:#64748b;font-size:12.5px;margin-bottom:14px">${esc(p.codigo || '')} · Stock actual: <b>${fmt(p.stock || 0)}</b> · Último costo: <b>${money(p.costo || 0)}</b>${yaEn ? ' · <span style="color:#a16207">⚠ Ya está en el pedido (se reemplaza)</span>' : ''}</div>

      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Cantidad a comprar *</div>
      <input id="comp-mc-cant" data-miles type="text" inputmode="numeric" value="${cant}" placeholder="0"
        style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:22px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box;text-align:center" />

      <div style="margin-top:14px;font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Costo unitario (lo que pagas al proveedor) *</div>
      <input id="comp-mc-costo" data-miles type="text" inputmode="numeric" value="${costo}" placeholder="0"
        style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:18px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box" />

      <div id="comp-mc-sub" style="margin-top:12px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px;font-size:14px">
        Subtotal: <b style="font-size:18px;color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace">${money(cant * costo)}</b>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px">
        <button id="comp-mc-cancelar"
          style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="comp-mc-aceptar"
          style="flex:1;padding:12px;border:0;background:#4f46e5;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">${yaEn ? '🔄 Reemplazar' : '＋ Agregar'}</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({ titulo: '➕ Agregar a la compra', contenido, ancho: 'sm' });

  const inpC = m.body.querySelector('#comp-mc-cant');
  const inpK = m.body.querySelector('#comp-mc-costo');
  const sub = m.body.querySelector('#comp-mc-sub');

  // Aplicar formato de miles (1.500.000) a ambos inputs
  bindMilesInputs(m.body);

  const recalc = () => {
    const c = num(inpC.value);
    const k = num(inpK.value);
    sub.innerHTML = `Subtotal: <b style="font-size:18px;color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c * k)}</b>`;
  };
  inpC.addEventListener('input', recalc);
  inpK.addEventListener('input', recalc);

  // Enter en cualquiera de los inputs confirma
  const confirmar = () => m.body.querySelector('#comp-mc-aceptar').click();
  inpC.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });
  inpK.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });

  setTimeout(() => { inpC.select(); inpC.focus(); }, 60);

  m.body.querySelector('#comp-mc-cancelar').onclick = () => m.cerrar();
  m.body.querySelector('#comp-mc-aceptar').onclick = () => {
    const c = Math.max(0, num(inpC.value));
    const k = Math.max(0, num(inpK.value));
    if (c <= 0) { Toast.warn('La cantidad debe ser mayor a cero'); return; }
    if (k <= 0) { Toast.warn('El costo debe ser mayor a cero'); return; }

    if (yaEn) {
      yaEn.cantidad = c;
      yaEn.costo = k;
    } else {
      _items.push({
        producto_id: p.id,
        codigo: p.codigo || '',
        nombre: p.nombre,
        cantidad: c,
        costo: k,
      });
    }
    pintarItemsCompra();
    m.cerrar();
    // Cerrar dropdown y limpiar buscador
    _dropdownAbierto = false;
    pintarResultadosBusqueda();
    const inpBuscar = _contenedor.querySelector('#comp-buscar');
    if (inpBuscar) { inpBuscar.value = ''; inpBuscar.focus(); }
  };
}

// ============================================================
//  LECTOR USB (pistola / manual) — mismo comportamiento que Ventas
// ============================================================

const LECTOR_KEY_COMPRA = 'pospunto:lector-compra';
// Longitud minima del query para que en modo Pistola se considere
// un escaneo. Los codigos de barras EAN/UPC son siempre largos
// (>= 8 chars). Asi evitamos que al escribir "10" o "12" a mano
// el sistema crea que es una pistola y agregue solo el producto.
const PISTOLA_MIN_CHARS = 4;

function getLectorModeCompra() {
  try {
    const v = localStorage.getItem(LECTOR_KEY_COMPRA);
    // Default: Manual. La Pistola es opt-in para evitar que
    // typing humano dispare auto-adicion al pedido.
    return v === 'pistola' ? 'pistola' : 'manual';
  } catch { return 'manual'; }
}

function setLectorModeCompra(modo) {
  try { localStorage.setItem(LECTOR_KEY_COMPRA, modo); } catch {}
}

/**
 * Devuelve el producto si la query coincide EXACTAMENTE con un
 * codigo o un codigo de barras. Pensado para la pistola.
 * Requiere PISTOLA_MIN_CHARS para evitar auto-adicion al digitar.
 */
function tryScannerExactCompra(query) {
  const q = String(query || '').trim();
  if (q.length < PISTOLA_MIN_CHARS) return null;
  return _productos.find((p) => {
    const c = String(p.codigo || '').trim();
    const b = String(p.barras || '').trim();
    return (c && c === q) || (b && b === q);
  }) || null;
}

/**
 * Procesa un escaneo: agrega +1 al pedido y limpia el buscador.
 * Si el producto ya está en el pedido, suma 1 a su cantidad.
 */
function procesarEscaneoCompra(producto, codigoOriginal, inputBuscar) {
  agregarItemDirecto(producto, 1);
  Toast.ok(`✓ ${producto.nombre} agregado (${codigoOriginal})`);
  if (inputBuscar) {
    inputBuscar.value = '';
    _dropdownAbierto = false;
    pintarResultadosBusqueda();
    setTimeout(() => inputBuscar.focus(), 30);
  }
}

/**
 * Agrega un producto al pedido SIN abrir el modal. Si ya está,
 * le suma `cantidad` a la línea existente.
 */
function agregarItemDirecto(producto, cantidad = 1) {
  const cant = Math.max(0, num(cantidad));
  if (cant <= 0) return;
  const costo = Number(producto.costo) || 0;
  const yaEn = _items.find((it) => it.producto_id === producto.id);
  if (yaEn) {
    yaEn.cantidad = num(yaEn.cantidad) + cant;
  } else {
    _items.push({
      producto_id: producto.id,
      codigo: producto.codigo || '',
      nombre: producto.nombre,
      cantidad: cant,
      costo,
    });
  }
  pintarItemsCompra();
}

// ============================================================
//  PROVEEDORES
// ============================================================

function abrirSelectorProveedor() {
  const contenido = `
    <div style="margin-bottom:12px">
      <input id="prov-sel-q" type="text" placeholder="🔎 Buscar proveedor..." autocomplete="off"
        style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
    </div>
    <div id="prov-sel-list" style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="prov-sel-cancel"
        style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="prov-sel-nuevo"
        style="flex:1;padding:11px;border:0;background:#4f46e5;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">+ Crear proveedor</button>
    </div>
  `;
  const m = Modal.abrir({ titulo: 'Seleccionar proveedor', contenido, ancho: 'md' });

  const pintar = (lista) => {
    const box = m.body.querySelector('#prov-sel-list');
    if (lista.length === 0) {
      box.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;font-size:13.5px">No hay proveedores que coincidan.</div>`;
      return;
    }
    box.innerHTML = lista.map((p) => `
      <button class="prov-sel-item" data-id="${esc(p.id)}"
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 13px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-family:inherit;text-align:left">
        <div style="min-width:0;flex:1">
          <b style="font-size:13.5px;color:#0f172a">${esc(p.nombre)}</b>
          <div style="font-size:11.5px;color:#64748b">${[p.nit, p.telefono, p.ciudad].filter(Boolean).map(esc).join(' · ') || 'Sin datos'}</div>
        </div>
        <i data-lucide="chevron-right" style="width:14px;height:14px;color:#94a3b8"></i>
      </button>
    `).join('');
    refrescarIconos(m.body);
    box.querySelectorAll('.prov-sel-item').forEach((btn) => {
      btn.onclick = () => {
        _proveedorSel = _proveedores.find((x) => x.id === btn.dataset.id) || null;
        m.cerrar();
        actualizarFormCompra();
      };
    });
  };

  pintar(_proveedores);
  m.body.querySelector('#prov-sel-q').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    pintar(q ? _proveedores.filter((p) => [p.nombre, p.nit, p.telefono, p.ciudad].filter(Boolean).some((x) => String(x).toLowerCase().includes(q))) : _proveedores);
  });
  m.body.querySelector('#prov-sel-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#prov-sel-nuevo').onclick = () => {
    m.cerrar();
    setTimeout(() => abrirFormProveedor(), 220);
  };
}

function abrirFormProveedor(prov = null) {
  const datos = prov || { nombre: '', nit: '', telefono: '', contacto: '', ciudad: '', direccion: '', email: '', nota: '' };
  const titulo = prov ? '✏️ Editar proveedor' : '➕ Nuevo proveedor';

  const campos = [
    ['nombre', 'Nombre *', 'text'],
    ['nit', 'NIT/RUT', 'text'],
    ['telefono', 'Teléfono', 'text'],
    ['contacto', 'Persona de contacto', 'text'],
    ['ciudad', 'Ciudad', 'text'],
    ['direccion', 'Dirección', 'text'],
    ['email', 'Email', 'email'],
  ];

  const contenido = `
    <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
      ${campos.map(([k, label, type]) => `
        <div ${k === 'direccion' || k === 'email' ? 'style="grid-column:1/-1"' : ''}>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
          <input id="prov-${k}" type="${type}" value="${esc(datos[k] || '')}"
            style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
      `).join('')}
      <div style="grid-column:1/-1">
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nota</div>
        <input id="prov-nota" type="text" value="${esc(datos.nota || '')}"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="prov-cancel"
        style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="prov-save"
        style="flex:1;padding:11px;border:0;background:#4f46e5;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">💾 Guardar</button>
    </div>
  `;

  const m = Modal.abrir({ titulo, contenido, ancho: 'md' });
  setTimeout(() => m.body.querySelector('#prov-nombre')?.focus(), 60);

  m.body.querySelector('#prov-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#prov-save').onclick = async () => {
    const obj = {
      id: prov?.id,
      nombre: m.body.querySelector('#prov-nombre').value.trim(),
      nit: m.body.querySelector('#prov-nit').value.trim(),
      telefono: m.body.querySelector('#prov-telefono').value.trim(),
      contacto: m.body.querySelector('#prov-contacto').value.trim(),
      ciudad: m.body.querySelector('#prov-ciudad').value.trim(),
      direccion: m.body.querySelector('#prov-direccion').value.trim(),
      email: m.body.querySelector('#prov-email').value.trim(),
      nota: m.body.querySelector('#prov-nota').value.trim(),
    };
    if (!obj.nombre) { Toast.warn('El nombre es obligatorio'); return; }
    try {
      const guardado = await ProveedoresRepo.guardar(obj);
      _proveedores = await ProveedoresRepo.listar();
      _proveedorSel = guardado;
      Toast.ok(prov ? 'Proveedor actualizado' : 'Proveedor creado');
      m.cerrar();
      actualizarFormCompra();
    } catch (err) {
      console.error('❌ Error guardando proveedor:', err);
      const msg = err?.message || String(err) || 'error desconocido';
      Toast.error('No se pudo guardar: ' + msg);
    }
  };
}

function actualizarFormCompra() {
  // Re-renderizar el formulario izquierdo manteniendo los items
  const formCol = _contenedor.querySelector('#comp-buscar')?.closest('div[style*="grid-template-columns:1fr 1fr"]');
  if (!formCol) {
    // fallback: re-render todo el layout
    _contenedor.innerHTML = htmlLayout();
    refrescarIconos(_contenedor);
    adjuntarEventos(_contenedor);
    pintarItemsCompra();
    return;
  }
  // Reemplazo solo el panel izquierdo
  const izquierda = formCol.firstElementChild;
  if (izquierda) {
    izquierda.outerHTML = htmlFormCompra();
    refrescarIconos(_contenedor);
    // Re-cablear eventos del panel izquierdo
    _contenedor.querySelector('#comp-prov-box').onclick = () => abrirSelectorProveedor();
    const cambiar = _contenedor.querySelector('#comp-prov-cambiar');
    if (cambiar) cambiar.onclick = (e) => { e.stopPropagation(); abrirSelectorProveedor(); };
    cablearBuscador(_contenedor);
    cablearSelectorLector(_contenedor);
  }
}

// ============================================================
//  REGISTRAR PAGO / CONFIRMAR COMPRA
// ============================================================

function abrirRegistroPago() {
  if (_items.length === 0) { Toast.warn('Agrega al menos un producto'); return; }
  const total = _items.reduce((s, it) => s + num(it.cantidad) * num(it.costo), 0);

  const contenido = `
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:6px">Total a pagar</div>
      <div style="background:#eef2ff;border-radius:12px;padding:18px 14px">
        <div style="font-size:32px;font-weight:800;color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(total)}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button id="comp-pago-contado" class="comp-tipo-pago"
        style="flex:1;padding:11px;border:1.5px solid #4f46e5;background:#4f46e5;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">💵 Contado</button>
      <button id="comp-pago-credito" class="comp-tipo-pago"
        style="flex:1;padding:11px;border:1.5px solid #e2e8f0;background:white;color:#475569;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">📋 Crédito</button>
    </div>

    <div id="comp-pago-area"></div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="comp-pago-cancel"
        style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="comp-pago-confirmar"
        style="flex:1;padding:12px;border:0;background:#15803d;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)">✅ Confirmar</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: '💵 Registrar compra', contenido, ancho: 'sm' });
  let tipoPago = 'contado';

  const renderArea = () => {
    const area = m.body.querySelector('#comp-pago-area');
    if (tipoPago === 'credito') {
      area.innerHTML = `
        <div style="display:grid;gap:10px">
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha de vencimiento</div>
            <input id="comp-vence" type="date"
              style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Abono inicial (opcional)</div>
            <input id="comp-abono-ini" data-miles type="text" inputmode="numeric" value="0"
              style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:'JetBrains Mono',ui-monospace,monospace" />
          </div>
        </div>
      `;
    } else {
      area.innerHTML = `
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Método de pago</div>
          <select id="comp-metodo"
            style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
            ${Repo.METODOS_PAGO.map((mp) => `<option value="${esc(mp)}">${mp}</option>`).join('')}
          </select>
        </div>
      `;
    }
    bindMilesInputs(area);
  };

  const marcarTipo = () => {
    const c = m.body.querySelector('#comp-pago-contado');
    const cr = m.body.querySelector('#comp-pago-credito');
    const setOn = (btn, on) => {
      btn.style.background = on ? '#4f46e5' : 'white';
      btn.style.color = on ? 'white' : '#475569';
      btn.style.borderColor = on ? '#4f46e5' : '#e2e8f0';
    };
    setOn(c, tipoPago === 'contado');
    setOn(cr, tipoPago === 'credito');
  };

  m.body.querySelector('#comp-pago-contado').onclick = () => { tipoPago = 'contado'; marcarTipo(); renderArea(); };
  m.body.querySelector('#comp-pago-credito').onclick = () => { tipoPago = 'credito'; marcarTipo(); renderArea(); };
  m.body.querySelector('#comp-pago-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#comp-pago-confirmar').onclick = async () => {
    const fecha = _contenedor.querySelector('#comp-fecha')?.value || todayISO();
    const ref = _contenedor.querySelector('#comp-ref')?.value || '';

    const datos = {
      fecha,
      ref,
      proveedor_id: _proveedorSel?.id || null,
      proveedor: _proveedorSel?.nombre || '',
      items: _items,
      tipoPago,
    };

    if (tipoPago === 'credito') {
      datos.vence = m.body.querySelector('#comp-vence').value || '';
      datos.abonoInicial = num(m.body.querySelector('#comp-abono-ini').value);
      datos.metodoPago = 'Crédito';
    } else {
      datos.metodoPago = m.body.querySelector('#comp-metodo').value;
    }

    try {
      const compra = await Repo.registrar(datos);
      Toast.ok(`Compra registrada · ${money(compra.total)}`);
      m.cerrar();
      // Reset
      _items = [];
      _proveedorSel = null;
      await refrescarDatos();
      _contenedor.innerHTML = htmlLayout();
      refrescarIconos(_contenedor);
      adjuntarEventos(_contenedor);
      pintarItemsCompra();
    } catch (err) {
      console.error(err);
      Toast.error('No se pudo registrar la compra');
    }
  };

  marcarTipo();
  renderArea();
}

// ============================================================
//  CUENTAS POR PAGAR
// ============================================================

function pintarCuentasPorPagar() {
  const box = _contenedor.querySelector('#comp-cxp');
  if (!box) return;

  const creditos = _compras.filter((c) => c.tipoPago === 'credito' && num(c.saldo) > 0.5);
  if (creditos.length === 0) { box.innerHTML = ''; return; }

  const totalDeuda = creditos.reduce((s, c) => s + num(c.saldo), 0);

  box.innerHTML = `
    <div style="background:white;border:1px solid #e2e8f0;border-left:4px solid #f59e0b;border-radius:12px;padding:20px;margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">📋 Cuentas por pagar a proveedores</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">
            ${fmt(creditos.length)} compra(s) a crédito pendientes · Total deuda:
            <b style="color:#a16207">${money(totalDeuda)}</b>
          </div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13.5px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left">
              <th style="padding:9px 10px">Fecha</th>
              <th style="padding:9px 10px">Proveedor</th>
              <th style="padding:9px 10px">Factura</th>
              <th style="padding:9px 10px">Vence</th>
              <th style="padding:9px 10px;text-align:right">Total</th>
              <th style="padding:9px 10px;text-align:right">Saldo</th>
              <th style="padding:9px 10px;width:90px"></th>
            </tr>
          </thead>
          <tbody>
            ${creditos.map((c) => {
              const vencido = c.vence && c.vence < todayISO();
              return `
                <tr style="border-bottom:1px solid #f1f5f9;${vencido ? 'background:rgba(239,68,68,.04)' : ''}">
                  <td style="padding:10px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:#475569">${esc((c.fecha || '').slice(0, 10))}</td>
                  <td style="padding:10px;color:#0f172a"><b>${esc(c.proveedor || 'Sin proveedor')}</b></td>
                  <td style="padding:10px;color:#64748b">${esc(c.ref || '—')}</td>
                  <td style="padding:10px">${c.vence ? `<span style="background:${vencido ? '#fef2f2' : '#e0e7ff'};color:${vencido ? '#dc2626' : '#4338ca'};font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px">${esc(c.vence)}</span>` : '—'}</td>
                  <td style="padding:10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</td>
                  <td style="padding:10px;text-align:right;color:#a16207;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.saldo)}</td>
                  <td style="padding:10px">
                    <div style="display:flex;gap:6px;justify-content:flex-end">
                      <button class="comp-ver" data-id="${esc(c.id)}" title="Ver detalle y abonos"
                        style="width:32px;height:32px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
                        <i data-lucide="eye" style="width:14px;height:14px;color:#475569"></i>
                      </button>
                      <button class="comp-abonar" data-id="${esc(c.id)}"
                        style="padding:7px 12px;background:#4f46e5;color:white;border:0;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit">💰 Abonar</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  refrescarIconos(box);
  box.querySelectorAll('.comp-abonar').forEach((btn) => {
    btn.onclick = () => abrirAbono(btn.dataset.id);
  });
  box.querySelectorAll('.comp-ver').forEach((btn) => {
    btn.onclick = () => verDetalleCompra(btn.dataset.id);
  });
}

function abrirAbono(compraId) {
  const c = _compras.find((x) => x.id === compraId);
  if (!c) return;

  const abonos = Array.isArray(c.abonos) ? c.abonos : [];
  const totalAbonado = abonos.reduce((s, a) => s + num(a.monto), 0);

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px">
        <span>Compra</span>
        <b style="color:#0f172a">${esc(c.proveedor || '—')} · ${esc(c.ref || 'Sin ref')}</b>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px">
        <span>Total compra</span>
        <b style="color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</b>
      </div>
      ${totalAbonado > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#15803d;margin-bottom:4px">
          <span>Total abonado (${abonos.length})</span>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</b>
        </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b">
        <span>Saldo pendiente</span>
        <b style="color:#a16207;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.saldo)}</b>
      </div>
    </div>

    ${abonos.length > 0 ? `
      <div style="margin-bottom:14px">
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Abonos anteriores</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:140px;overflow-y:auto">
          ${abonos.map((a, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;font-size:12.5px">
              <div>
                <span style="color:#475569;font-family:'JetBrains Mono',ui-monospace,monospace">${esc((a.fecha || '').slice(0, 10))}</span>
                <span style="background:#e0e7ff;color:#4338ca;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;margin-left:6px">${esc(a.metodo || 'Efectivo')}</span>
              </div>
              <b style="color:#15803d;font-family:'JetBrains Mono',ui-monospace,monospace">${money(a.monto)}</b>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div>
      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Monto del abono *</div>
      <input id="comp-abono-monto" data-miles type="text" inputmode="numeric" placeholder="0"
        style="width:100%;padding:14px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:22px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box" />
    </div>

    <div style="margin-top:12px;display:grid;gap:10px;grid-template-columns:1fr 1fr">
      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha del abono</div>
        <input id="comp-abono-fecha" type="date" value="${todayISO()}"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Método</div>
        <select id="comp-abono-metodo"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
          ${Repo.METODOS_PAGO.map((mp) => `<option value="${esc(mp)}">${mp}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="comp-abono-cancel"
        style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="comp-abono-save"
        style="flex:1;padding:11px;border:0;background:#4f46e5;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">💾 Registrar abono</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: '💰 Registrar abono', contenido, ancho: 'sm' });
  bindMilesInputs(m.body);
  setTimeout(() => m.body.querySelector('#comp-abono-monto')?.focus(), 60);

  // Enter en monto confirma
  const inpMonto = m.body.querySelector('#comp-abono-monto');
  inpMonto?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); m.body.querySelector('#comp-abono-save').click(); }
  });

  m.body.querySelector('#comp-abono-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#comp-abono-save').onclick = async () => {
    const monto = num(m.body.querySelector('#comp-abono-monto').value);
    const metodo = m.body.querySelector('#comp-abono-metodo').value;
    const fecha = m.body.querySelector('#comp-abono-fecha').value || todayISO();
    try {
      await Repo.abonar(compraId, { monto, metodo, fecha });
      _compras = await Repo.listar();
      Toast.ok('Abono registrado');
      m.cerrar();
      pintarCuentasPorPagar();
      pintarHistorial();
    } catch (err) {
      console.error(err);
      Toast.error(err.message || 'No se pudo registrar el abono');
    }
  };
}

// ============================================================
//  HISTORIAL DE COMPRAS
// ============================================================

function pintarHistorial() {
  const box = _contenedor.querySelector('#comp-hist');
  if (!box) return;

  if (_compras.length === 0) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">📚 Historial de compras</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">${fmt(_compras.length)} compra(s) registradas</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="hist-q" type="text" placeholder="Buscar proveedor o factura..." value="${esc(_filtroHist.q)}"
            style="padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;outline:none;font-family:inherit;min-width:200px" />
          <select id="hist-tipo"
            style="padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;outline:none;font-family:inherit;background:white;min-width:130px">
            <option value="">Todas</option>
            <option value="contado" ${_filtroHist.tipo === 'contado' ? 'selected' : ''}>Solo contado</option>
            <option value="credito" ${_filtroHist.tipo === 'credito' ? 'selected' : ''}>Solo crédito</option>
          </select>
        </div>
      </div>
      <div id="hist-body"></div>
    </div>
  `;

  const inpQ = box.querySelector('#hist-q');
  const selTipo = box.querySelector('#hist-tipo');
  let deb;
  inpQ?.addEventListener('input', (e) => {
    if (deb) clearTimeout(deb);
    deb = setTimeout(() => { _filtroHist.q = e.target.value; renderFilasHistorial(); }, 120);
  });
  selTipo?.addEventListener('change', (e) => { _filtroHist.tipo = e.target.value; renderFilasHistorial(); });

  renderFilasHistorial();
}

function renderFilasHistorial() {
  const cont = _contenedor.querySelector('#hist-body');
  if (!cont) return;

  let lista = [..._compras];
  const q = _filtroHist.q.toLowerCase().trim();
  if (q) lista = lista.filter((c) => [(c.proveedor || ''), (c.ref || '')].join(' ').toLowerCase().includes(q));
  if (_filtroHist.tipo) lista = lista.filter((c) => c.tipoPago === _filtroHist.tipo);

  if (lista.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;font-size:13.5px">No hay compras que coincidan.</div>`;
    return;
  }

  cont.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead>
          <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left">
            <th style="padding:9px 10px">Fecha</th>
            <th style="padding:9px 10px">Proveedor</th>
            <th style="padding:9px 10px">Factura</th>
            <th style="padding:9px 10px">Tipo</th>
            <th style="padding:9px 10px;text-align:right">Total</th>
            <th style="padding:9px 10px;width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${lista.map((c) => `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:10px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;color:#475569">${esc((c.fecha || '').slice(0, 10))}</td>
              <td style="padding:10px;color:#0f172a"><b>${esc(c.proveedor || 'Sin proveedor')}</b></td>
              <td style="padding:10px;color:#64748b">${esc(c.ref || '—')}</td>
              <td style="padding:10px"><span style="background:${c.tipoPago === 'credito' ? '#fef3c7' : '#dcfce7'};color:${c.tipoPago === 'credito' ? '#92400e' : '#166534'};font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px">${c.tipoPago === 'credito' ? 'Crédito' : 'Contado'}</span></td>
              <td style="padding:10px;text-align:right;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</td>
              <td style="padding:10px">
                <div style="display:flex;gap:6px;justify-content:flex-end">
                  <button class="hist-ver" data-id="${esc(c.id)}" title="Ver detalle y abonos"
                    style="width:32px;height:32px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
                    <i data-lucide="eye" style="width:14px;height:14px;color:#475569"></i>
                  </button>
                  <button class="hist-eliminar" data-id="${esc(c.id)}"
                    style="width:32px;height:32px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center"
                    title="Eliminar"><i data-lucide="trash-2" style="width:14px;height:14px;color:#dc2626"></i></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  refrescarIconos(_contenedor);
  cont.querySelectorAll('.hist-ver').forEach((b) => {
    b.onclick = () => verDetalleCompra(b.dataset.id);
  });
  cont.querySelectorAll('.hist-eliminar').forEach((b) => {
    b.onclick = () => eliminarCompra(b.dataset.id);
  });
}

// ============================================================
//  DETALLE DE COMPRA CON HISTORIAL DE ABONOS
// ============================================================

function verDetalleCompra(compraId) {
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
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:15px;color:#0f172a">${esc(c.proveedor || 'Sin proveedor')}</div>
          <div style="color:#64748b;font-size:12.5px;margin-top:2px;font-family:'JetBrains Mono',ui-monospace,monospace">
            Factura: ${esc(c.ref || '—')} · ${esc((c.fecha || '').slice(0, 10))}
          </div>
        </div>
        <span style="background:${esCredito ? (pagada ? '#dcfce7' : '#fef3c7') : '#dcfce7'};color:${esCredito ? (pagada ? '#166534' : '#92400e') : '#166534'};font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px">
          ${esCredito ? (pagada ? '✓ Pagada' : 'Crédito') : 'Contado'}
        </span>
      </div>
      <div style="display:grid;gap:6px;grid-template-columns:1fr 1fr;font-size:13px">
        <div style="color:#64748b">Total compra</div>
        <div style="text-align:right;font-weight:700;color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace">${money(c.total)}</div>
        ${esCredito ? `
          <div style="color:#64748b">Total abonado (${abonos.length})</div>
          <div style="text-align:right;font-weight:700;color:#15803d;font-family:'JetBrains Mono',ui-monospace,monospace">${money(totalAbonado)}</div>
          <div style="color:#64748b">Saldo pendiente</div>
          <div style="text-align:right;font-weight:800;color:${pagada ? '#15803d' : '#a16207'};font-family:'JetBrains Mono',ui-monospace,monospace">${money(saldo)}</div>
          ${c.vence ? `
            <div style="color:#64748b">Vence</div>
            <div style="text-align:right;font-weight:700;color:${vencido ? '#dc2626' : '#475569'}">
              ${esc(c.vence)}${vencido ? ' ⚠ vencida' : ''}
            </div>
          ` : ''}
        ` : ''}
      </div>
    </div>

    ${items.length > 0 ? `
      <div style="margin-bottom:14px">
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Productos comprados</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left">
              <th style="padding:6px 8px;width:36px">Cant</th>
              <th style="padding:6px 8px">Producto</th>
              <th style="padding:6px 8px;text-align:right">Costo</th>
              <th style="padding:6px 8px;text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it) => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:7px 8px;font-family:'JetBrains Mono',ui-monospace,monospace"><b>${fmt(it.cantidad)}</b></td>
                <td style="padding:7px 8px">${esc(it.nombre)}</td>
                <td style="padding:7px 8px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(it.costo)}</td>
                <td style="padding:7px 8px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace"><b>${money(num(it.subtotal) || num(it.cantidad) * num(it.costo))}</b></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    ${esCredito ? `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Historial de abonos (${abonos.length})</div>
          ${!pagada ? `
            <button id="comp-det-abonar" style="padding:6px 12px;background:#4f46e5;color:white;border:0;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit">💰 Nuevo abono</button>
          ` : ''}
        </div>
        ${abonos.length === 0 ? `
          <div style="text-align:center;padding:18px 12px;color:#94a3b8;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;font-size:13px">
            Aún no se han registrado abonos a esta compra.
          </div>
        ` : `
          <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#f8fafc;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left">
                  <th style="padding:8px 10px">#</th>
                  <th style="padding:8px 10px">Fecha</th>
                  <th style="padding:8px 10px">Método</th>
                  <th style="padding:8px 10px;text-align:right">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${[...abonos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map((a, i) => `
                  <tr style="border-top:1px solid #f1f5f9">
                    <td style="padding:8px 10px;color:#94a3b8">${i + 1}</td>
                    <td style="padding:8px 10px;font-family:'JetBrains Mono',ui-monospace,monospace;color:#475569">${esc((a.fecha || '').slice(0, 10))}</td>
                    <td style="padding:8px 10px"><span style="background:#e0e7ff;color:#4338ca;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px">${esc(a.metodo || 'Efectivo')}</span></td>
                    <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;color:#15803d">${money(a.monto)}</td>
                  </tr>
                `).join('')}
                <tr style="background:#dcfce7;border-top:2px solid #15803d">
                  <td colspan="3" style="padding:9px 10px;font-weight:800;color:#166534">Total abonado</td>
                  <td style="padding:9px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:800;color:#166534">${money(totalAbonado)}</td>
                </tr>
                <tr style="background:#fef3c7">
                  <td colspan="3" style="padding:9px 10px;font-weight:800;color:#92400e">Saldo pendiente</td>
                  <td style="padding:9px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:800;color:#92400e">${money(saldo)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `}
      </div>
    ` : ''}

    ${c.nota ? `
      <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:9px;padding:10px 12px;margin-bottom:14px">
        <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:3px">📝 Nota</div>
        <div style="font-size:13px;color:#0f172a">${esc(c.nota)}</div>
      </div>
    ` : ''}

    <div style="display:flex;gap:10px;margin-top:6px">
      <button id="comp-det-cerrar"
        style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cerrar</button>
    </div>
  `;

  const m = Modal.abrir({
    titulo: `Detalle de compra`,
    contenido,
    ancho: 'lg',
  });

  m.body.querySelector('#comp-det-cerrar').onclick = () => m.cerrar();
  const btnAbonar = m.body.querySelector('#comp-det-abonar');
  if (btnAbonar) {
    btnAbonar.onclick = () => {
      m.cerrar();
      setTimeout(() => abrirAbono(compraId), 220);
    };
  }
}

async function eliminarCompra(id) {
  const c = _compras.find((x) => x.id === id);
  if (!c) return;
  const ok = await Confirm.peligro(
    `¿Eliminar esta compra? Se restará del inventario lo que se había sumado (${c.items.length} producto(s)).`,
    { titulo: 'Eliminar compra', textoConfirmar: '🗑️ Eliminar' },
  );
  if (!ok) return;
  try {
    await Repo.eliminar(id);
    await refrescarDatos();
    Toast.ok('Compra eliminada');
    pintarCuentasPorPagar();
    pintarHistorial();
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo eliminar la compra');
  }
}
