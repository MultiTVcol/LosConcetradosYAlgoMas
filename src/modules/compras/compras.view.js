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
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';
import { pageHeader } from '../../app/ui-kit.js';
import { Router } from '../../core/index.js';

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

  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlCargando();
  await refrescarDatos();

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarItemsCompra();

  // Realtime: mantener actualizados productos/proveedores para el buscador
  _offRealtime = Realtime.escucharVarias(['compras', 'proveedores', 'productos'], async () => {
    try { await refrescarDatos(); } catch (err) { console.warn('Realtime compras:', err); }
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
  const acciones = `
    <button id="comp-btn-facturas"
      style="display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:12px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit">
      <i data-lucide="receipt-text" style="width:16px;height:16px;stroke-width:2"></i> Facturas de compra</button>
    <button id="comp-btn-prov-list"
      style="padding:10px 14px;border:1px solid #e2e8f0;background:white;border-radius:12px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#374151">Proveedores</button>
    <button id="comp-btn-prov-nuevo"
      style="display:inline-flex;align-items:center;gap:7px;padding:10px 16px;background:#2563eb;color:white;border:0;border-radius:12px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #2563eb40">
      <i data-lucide="plus" style="width:16px;height:16px;stroke-width:2.25"></i> Proveedor</button>
  `;
  return `
    <div style="padding:14px 22px 20px;max-width:1280px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:14px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin:0 0 4px">
            <i data-lucide="truck" style="width:28px;height:28px;color:#2563eb;stroke-width:1.8"></i>
            <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.015em">Compras</h1>
          </div>
          <div style="color:#64748b;font-size:12.5px">Seguí los 3 pasos para registrar una compra</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${acciones}</div>
      </div>

      <div style="display:grid;gap:18px;grid-template-columns:1.35fr 1fr;align-items:start">
        <div style="display:flex;flex-direction:column;gap:12px">
          ${htmlPaso1Proveedor()}
          ${htmlPaso2BuscarProducto()}
        </div>
        ${htmlPanelBorrador()}
      </div>
    </div>
  `;
}

function htmlPaso1Proveedor() {
  const prov = _proveedorSel;
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:14px 18px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span class="paso-badge" style="background:#2563eb;color:white;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">1</span>
        <h3 style="font-size:15.5px;font-weight:600;margin:0;color:#0f172a">Proveedor</h3>
      </div>
      ${prov ? `
        <div id="comp-prov-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer">
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:8px"><b style="font-size:14px;color:#0f172a">${esc(prov.nombre)}</b>${prov.nit ? `<span style="background:#e0e7ff;color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px">${esc(prov.nit)}</span>` : ''}</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:2px">${[prov.telefono, prov.ciudad, prov.contacto].filter(Boolean).map(esc).join(' · ') || 'Sin datos adicionales'}</div>
          </div>
          <button id="comp-prov-cambiar"
            style="padding:6px 12px;border:1px solid #e2e8f0;background:white;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:inherit;color:#475569">Cambiar</button>
        </div>
      ` : `
        <div id="comp-prov-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;cursor:pointer">
          <div style="display:flex;align-items:center;gap:9px">
            <i data-lucide="user-round-search" style="width:18px;height:18px;color:#94a3b8;stroke-width:2"></i>
            <div>
              <div style="font-weight:600;font-size:13.5px;color:#0f172a">Sin proveedor asignado</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px">${_proveedores.length ? 'Click para seleccionar o crear uno' : 'Crea tu primer proveedor para empezar'}</div>
            </div>
          </div>
          <button style="padding:7px 13px;background:#2563eb;color:white;border:0;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit">${_proveedores.length ? 'Seleccionar' : '+ Nuevo'}</button>
        </div>
      `}

      <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:10px">
        <label style="display:block">
          <span style="font-size:10.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;display:block">Fecha de compra</span>
          <input id="comp-fecha" type="date" value="${todayISO()}"
            style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
        </label>
        <label style="display:block">
          <span style="font-size:10.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;display:block">N° factura / remisión</span>
          <input id="comp-ref" type="text" placeholder="Ej: FC-1024" autocomplete="off"
            style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
        </label>
      </div>
    </div>
  `;
}

function htmlPaso2BuscarProducto() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="paso-badge" style="background:#2563eb;color:white;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">2</span>
          <h3 style="font-size:15.5px;font-weight:600;margin:0;color:#0f172a">Buscar o escanear producto</h3>
        </div>
        <div style="display:flex;align-items:center;gap:10px;color:#64748b;font-size:12.5px;font-weight:600">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <i data-lucide="scan-barcode" style="width:16px;height:16px;stroke-width:2;color:#2563eb"></i> Pistola lista
          </span>
          <span style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;border-radius:999px;padding:3px 10px;font-size:11.5px">
            Pulsa <kbd style="background:white;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:5px;padding:0 6px;font-family:inherit;font-weight:700;font-size:12px;color:#0f172a">F2</kbd> para buscar
          </span>
        </div>
      </div>

      <div style="position:relative">
        <div style="background:#f8fafc;border:2px dashed #60a5fa;border-radius:12px;padding:12px">
          <input id="comp-buscar" type="text" placeholder="Escanea con la pistola o escribe (código, nombre, categoría)…" autocomplete="off"
            style="width:100%;padding:13px 15px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit;background:white" />
          <div style="color:#94a3b8;font-size:11.5px;margin-top:6px">
            <kbd style="background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit;font-size:11px">↑</kbd>
            <kbd style="background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit;font-size:11px">↓</kbd> navegar ·
            <kbd style="background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit;font-size:11px">Enter</kbd> agregar ·
            <kbd style="background:#fff;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:4px;padding:0 5px;font-family:inherit;font-size:11px">Esc</kbd> cerrar · escanea para agregar al instante
          </div>
        </div>
        <div id="comp-resultados" style="margin-top:4px;display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto"></div>
      </div>
    </div>
  `;
}

function htmlPanelBorrador() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;display:flex;flex-direction:column;min-height:520px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px">
        <span class="paso-badge" style="background:#2563eb;color:white;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">3</span>
        <h3 style="font-size:15.5px;font-weight:600;margin:0;color:#0f172a">Borrador de la compra</h3>
      </div>

      <div id="comp-items" style="flex:1;padding:6px 14px;display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:200px"></div>

      <div style="padding:14px 18px;border-top:1px solid #f1f5f9;background:#fafbff">
        <div id="comp-total" style="margin-bottom:10px"></div>
        <button id="comp-btn-registrar"
          style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 22px;background:#15803d;color:white;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)">
          <i data-lucide="package-check" style="width:18px;height:18px;stroke-width:2.25"></i>
          REGISTRAR COMPRA
          <span style="margin-left:6px;font-size:11px;font-weight:700;opacity:.85;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:5px;padding:1px 6px;font-family:inherit;letter-spacing:.02em">F9</span>
        </button>
      </div>
    </div>
  `;
}

// ============================================================
//  EVENTOS PRINCIPALES
// ============================================================

function adjuntarEventos(contenedor) {
  contenedor.querySelector('#comp-btn-facturas').onclick = () => Router.navegar('facturas-compra');
  contenedor.querySelector('#comp-btn-prov-list').onclick = () => abrirGestionProveedores();
  contenedor.querySelector('#comp-btn-prov-nuevo').onclick = () => abrirFormProveedor();
  contenedor.querySelector('#comp-prov-box').onclick = () => abrirSelectorProveedor();
  const cambiar = contenedor.querySelector('#comp-prov-cambiar');
  if (cambiar) cambiar.onclick = (e) => { e.stopPropagation(); abrirSelectorProveedor(); };

  contenedor.querySelector('#comp-btn-registrar').onclick = () => abrirRegistroPago();

  // Atajos de teclado del módulo Compras (estilo Ventas):
  //   F2 → enfocar el buscador de productos
  //   F9 → abrir "Registrar compra" (si hay items)
  document.removeEventListener('keydown', atajosCompras);
  document.addEventListener('keydown', atajosCompras);

  cablearBuscador(contenedor);
  cablearSelectorLector(contenedor);
}

function atajosCompras(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  // Solo actúa cuando esta vista está montada
  if (!document.getElementById('comp-buscar')) return;
  if (e.key === 'F2') {
    e.preventDefault();
    const inp = document.getElementById('comp-buscar');
    if (inp) { inp.focus(); try { inp.select(); } catch (_) { /**/ } }
    return;
  }
  if (e.key === 'F9') {
    e.preventDefault();
    // No abrir otro modal si ya hay uno
    const mr = document.getElementById('modal-root');
    if (mr && mr.children.length > 0) return;
    abrirRegistroPago();
  }
}

function cablearBuscador(contenedor) {
  const inp = contenedor.querySelector('#comp-buscar');
  if (!inp) return;
  let debounce;
  inp.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    const query = e.target.value;
    debounce = setTimeout(() => {
      // Pistola SIEMPRE activa: coincidencia exacta (barras/código, ≥4) abre
      // la cantidad; si no, se muestra el dropdown para búsqueda manual.
      const exact = tryScannerExactCompra(query);
      if (exact) {
        procesarEscaneoCompra(exact, query, inp);
        return;
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
      Toast.ok(modo === 'pistola' ? 'Modo lector USB' : 'Modo manual');
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
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ${activo ? '#2563eb' : '#e2e8f0'};background:${activo ? '#eff6ff' : 'white'};border-radius:9px;cursor:pointer;font-family:inherit;text-align:left">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:inherit;font-weight:800;font-size:13px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:5px">${_hl(p.codigo || '—', q)}</span>
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
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 14px;color:#94a3b8;min-height:200px">
        <i data-lucide="package" style="width:38px;height:38px;color:#cbd5e1;stroke-width:1.5"></i>
        <div style="margin-top:10px;font-weight:600;font-size:13.5px;color:#64748b">Borrador vacío</div>
        <div style="margin-top:4px;font-size:12.5px">Busca un producto a la izquierda para agregarlo</div>
      </div>
    `;
    if (tot) tot.innerHTML = '';
    refrescarIconos(box);
    return;
  }

  // Encabezado de tabla
  const head = `
    <div style="display:grid;grid-template-columns:48px 1fr 90px 100px 64px;gap:8px;align-items:center;padding:6px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;border-bottom:1px solid #f1f5f9;margin-bottom:2px">
      <span>Cant</span>
      <span>Producto</span>
      <span style="text-align:right">VR/UNIT</span>
      <span style="text-align:right">Valor</span>
      <span></span>
    </div>
  `;

  const filas = _items.map((it, ix) => {
    const sub = num(it.cantidad) * num(it.costo);
    return `
      <div class="comp-it-row" data-ix="${ix}" style="display:grid;grid-template-columns:48px 1fr 90px 100px 64px;gap:8px;align-items:center;padding:9px 4px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .1s">
        <b style="font-size:14px;color:#0f172a">${fmt(it.cantidad)}</b>
        <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;color:#0f172a">${esc(it.nombre)}</div>
        <div style="text-align:right;color:#475569;font-size:12.5px">${money(it.costo)}</div>
        <b style="text-align:right;font-size:13.5px;color:#0f172a">${money(sub)}</b>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="comp-it-edit" data-ix="${ix}" title="Editar" style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;width:26px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
            <i data-lucide="pencil" style="width:13px;height:13px;stroke-width:2.25"></i>
          </button>
          <button class="comp-it-quitar" data-ix="${ix}" title="Quitar" style="background:#fee2e2;border:1px solid #fecaca;color:#dc2626;width:26px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
            <i data-lucide="x" style="width:14px;height:14px;stroke-width:2.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  box.innerHTML = head + filas;

  // Hover de fila
  box.querySelectorAll('.comp-it-row').forEach((row) => {
    row.onmouseenter = () => { row.style.background = '#f8fafc'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    // Click en la fila (no en botones) abre el modal para editar
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const ix = Number(row.dataset.ix);
      const it = _items[ix];
      if (it && it.producto_id) abrirModalCantidadCompra(it.producto_id);
    });
  });
  box.querySelectorAll('.comp-it-edit').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const it = _items[Number(b.dataset.ix)];
      if (it && it.producto_id) abrirModalCantidadCompra(it.producto_id);
    };
  });
  box.querySelectorAll('.comp-it-quitar').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      _items.splice(Number(b.dataset.ix), 1);
      pintarItemsCompra();
    };
  });
  refrescarIconos(box);

  // Total grande (sin utilidad — es compra)
  const total = _items.reduce((s, it) => s + num(it.cantidad) * num(it.costo), 0);
  const totalU = _items.reduce((s, it) => s + num(it.cantidad), 0);
  if (tot) {
    tot.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#64748b;margin-bottom:6px">
        <span>Subtotal</span>
        <span style="color:#0f172a;font-weight:600">${money(total)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e2e8f0;padding-top:8px">
        <span style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">TOTAL</span>
        <span style="font-size:22px;font-weight:800;color:#1d4ed8;letter-spacing:-0.02em">${money(total)}</span>
      </div>
      <div style="font-size:11.5px;color:#94a3b8;text-align:right;margin-top:4px">${fmt(_items.length)} producto(s) · ${fmt(totalU)} unidad(es)</div>
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
      <div style="color:#64748b;font-size:12.5px;margin-bottom:14px">${esc(p.codigo || '')} · Stock actual: <b>${fmt(p.stock || 0)}</b> · Último costo: <b>${money(p.costo || 0)}</b>${yaEn ? ' · <span style="color:#a16207">Ya está en el pedido (se reemplaza)</span>' : ''}</div>

      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Cantidad a comprar *</div>
      <input id="comp-mc-cant" data-miles type="text" inputmode="numeric" value="${cant}" placeholder="0"
        style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:22px;font-weight:700;font-family:inherit;outline:none;box-sizing:border-box;text-align:center" />

      <div style="margin-top:14px;font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Costo unitario (lo que pagas al proveedor) *</div>
      <input id="comp-mc-costo" data-miles type="text" inputmode="numeric" value="${costo}" placeholder="0"
        style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:18px;font-weight:700;font-family:inherit;outline:none;box-sizing:border-box" />

      <div id="comp-mc-sub" style="margin-top:12px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px;font-size:14px">
        Subtotal: <b style="font-size:18px;color:#1d4ed8;font-family:inherit">${money(cant * costo)}</b>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px">
        <button id="comp-mc-cancelar"
          style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="comp-mc-aceptar"
          style="flex:1;padding:12px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">${yaEn ? 'Reemplazar' : '＋ Agregar'}</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Agregar a la compra', contenido, ancho: 'sm' });

  const inpC = m.body.querySelector('#comp-mc-cant');
  const inpK = m.body.querySelector('#comp-mc-costo');
  const sub = m.body.querySelector('#comp-mc-sub');

  // Aplicar formato de miles (1.500.000) a ambos inputs
  bindMilesInputs(m.body);

  const recalc = () => {
    const c = num(inpC.value);
    const k = num(inpK.value);
    sub.innerHTML = `Subtotal: <b style="font-size:18px;color:#1d4ed8;font-family:inherit">${money(c * k)}</b>`;
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
  // Limpiar el buscador y abrir el modal de cantidad/costo (al aceptar,
  // el modal devuelve el foco al buscador para seguir escaneando).
  if (inputBuscar) {
    inputBuscar.value = '';
    _dropdownAbierto = false;
    pintarResultadosBusqueda();
  }
  abrirModalCantidadCompra(producto.id);
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
      <input id="prov-sel-q" type="text" placeholder="Buscar proveedor..." autocomplete="off"
        style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
    </div>
    <div id="prov-sel-list" style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="prov-sel-cancel"
        style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="prov-sel-nuevo"
        style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">+ Crear proveedor</button>
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

// ============================================================
//  FILTRO DE FECHAS (helper compartido)
// ============================================================

/**
 * Calcula desde/hasta (YYYY-MM-DD) para un preset dado.
 * Presets: 'hoy' | 'semana' | 'mes' | 'mesPasado' | 'anio' | 'todo' | 'custom'
 */
function rangoPreset(preset, desdeActual = '', hastaActual = '') {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (preset === 'hoy')  { return { preset, desde: fmt(hoy), hasta: fmt(hoy) }; }
  if (preset === 'semana') {
    const d = new Date(hoy);
    const dow = (d.getDay() + 6) % 7; // lunes = 0
    d.setDate(d.getDate() - dow);
    return { preset, desde: fmt(d), hasta: fmt(hoy) };
  }
  if (preset === 'mes') {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { preset, desde: fmt(d), hasta: fmt(hoy) };
  }
  if (preset === 'mesPasado') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { preset, desde: fmt(ini), hasta: fmt(fin) };
  }
  if (preset === 'anio') {
    const d = new Date(hoy.getFullYear(), 0, 1);
    return { preset, desde: fmt(d), hasta: fmt(hoy) };
  }
  if (preset === 'todo')  { return { preset, desde: '', hasta: '' }; }
  // 'custom': respeta lo que ya hay
  return { preset: 'custom', desde: desdeActual, hasta: hastaActual };
}

/** ¿La fecha ISO (YYYY-MM-DD o más) cae en el rango (vacíos = sin tope)? */
function fechaEnRango(fechaISO, desde, hasta) {
  const d = String(fechaISO || '').slice(0, 10);
  if (!d) return false;
  if (desde && d < desde) return false;
  if (hasta && d > hasta) return false;
  return true;
}

/** HTML de la barra de filtro (presets + inputs). */
function htmlBarraFiltroFechas(estado, idPrefix = 'flt') {
  const presets = [
    ['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'],
    ['mesPasado', 'Mes pasado'], ['anio', 'Este año'], ['todo', 'Todo'],
  ];
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;margin-bottom:12px">
      <span style="font-size:10.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-right:4px">Periodo</span>
      ${presets.map(([k, label]) => `
        <button class="${idPrefix}-preset" data-preset="${k}"
          style="padding:6px 11px;border:1px solid ${estado.preset === k ? '#2563eb' : '#e2e8f0'};background:${estado.preset === k ? '#2563eb' : 'white'};color:${estado.preset === k ? 'white' : '#475569'};border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit">
          ${label}
        </button>
      `).join('')}
      <span style="display:inline-flex;align-items:center;gap:4px;margin-left:6px">
        <input id="${idPrefix}-desde" type="date" value="${esc(estado.desde || '')}"
          style="padding:6px 9px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;outline:none;font-family:inherit" />
        <span style="color:#94a3b8;font-size:11px">→</span>
        <input id="${idPrefix}-hasta" type="date" value="${esc(estado.hasta || '')}"
          style="padding:6px 9px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;outline:none;font-family:inherit" />
      </span>
    </div>
  `;
}

/** Cablea los eventos de la barra de filtro y llama onCambio(estadoNuevo) cuando cambia. */
function cablearFiltroFechas(scope, estado, idPrefix, onCambio) {
  scope.querySelectorAll(`.${idPrefix}-preset`).forEach((btn) => {
    btn.onclick = () => {
      const r = rangoPreset(btn.dataset.preset, estado.desde, estado.hasta);
      Object.assign(estado, r);
      onCambio(estado);
    };
  });
  const inpD = scope.querySelector(`#${idPrefix}-desde`);
  const inpH = scope.querySelector(`#${idPrefix}-hasta`);
  if (inpD) inpD.addEventListener('change', (e) => { estado.desde = e.target.value; estado.preset = 'custom'; onCambio(estado); });
  if (inpH) inpH.addEventListener('change', (e) => { estado.hasta = e.target.value; estado.preset = 'custom'; onCambio(estado); });
}

/**
 * Gestión completa de proveedores: KPIs, buscador, tabla con acciones de
 * editar / ver compras / eliminar, y acceso al informe por proveedor.
 * Independiente del selector simple (que sigue funcionando para elegir el
 * proveedor de la compra en curso).
 */
function abrirGestionProveedores() {
  // Estado del filtro de fechas (por defecto: este mes)
  const filtro = rangoPreset('mes');
  // Mapa reporte por proveedor — se recalcula dentro del rango cuando cambia el filtro
  let reporte = new Map();
  let filas = [];
  let totalGeneral = 0;
  let totalPorPagar = 0;
  let totalPeriodo = 0;

  const recalcular = () => {
    reporte = new Map();
    _proveedores.forEach((p) => reporte.set(p.id, { proveedor: p, compras: [], total: 0, count: 0, saldo: 0 }));
    totalGeneral = 0; totalPorPagar = 0; totalPeriodo = 0;
    for (const c of _compras) {
      const enRango = fechaEnRango(c.fecha || c.creado, filtro.desde, filtro.hasta);
      if (!enRango) continue;
      const tot = Number(c.total) || 0;
      const sal = c.tipoPago === 'credito' ? (Number(c.saldo) || 0) : 0;
      totalGeneral += tot;
      totalPorPagar += sal;
      totalPeriodo += tot;
      const r = c.proveedor_id ? reporte.get(c.proveedor_id) : null;
      if (r) { r.compras.push(c); r.total += tot; r.count += 1; r.saldo += sal; }
    }
    filas = [...reporte.values()].sort((a, b) => b.total - a.total);
  };

  recalcular();

  const contenido = `
    ${htmlBarraFiltroFechas(filtro, 'prov-gest-flt')}

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#1d4ed8;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Proveedores</div>
        <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:2px">${fmt(_proveedores.length)}</div>
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Por pagar</div>
        <div id="prov-gest-kpi-pagar" style="font-size:20px;font-weight:800;color:#92400e;margin-top:2px">${money(totalPorPagar)}</div>
      </div>
      <div style="background:#dcfce7;border:1px solid #86efac;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Compras del periodo</div>
        <div id="prov-gest-kpi-periodo" style="font-size:20px;font-weight:800;color:#166534;margin-top:2px">${money(totalPeriodo)}</div>
      </div>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.04em">Total del periodo</div>
        <div id="prov-gest-kpi-total" style="font-size:20px;font-weight:800;color:#0f172a;margin-top:2px">${money(totalGeneral)}</div>
      </div>
    </div>

    <!-- Barra: buscador + nuevo -->
    <div style="display:flex;gap:10px;margin-bottom:10px;align-items:center">
      <input id="prov-gest-q" type="text" placeholder="Buscar por nombre, NIT, contacto, ciudad…" autocomplete="off"
        style="flex:1;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
      <button id="prov-gest-nuevo"
        style="display:inline-flex;align-items:center;gap:6px;padding:10px 14px;background:#2563eb;color:white;border:0;border-radius:8px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">
        <i data-lucide="plus" style="width:15px;height:15px;stroke-width:2.25"></i> Nuevo proveedor
      </button>
    </div>

    <!-- Tabla -->
    <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-height:48vh;overflow-y:auto">
      <table id="prov-gest-tbl" style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead>
          <tr style="background:#f1f5f9;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">
            <th style="padding:10px 12px;text-align:left">Proveedor</th>
            <th style="padding:10px 12px;text-align:left">Contacto</th>
            <th style="padding:10px 12px;text-align:right;white-space:nowrap">Compras del periodo</th>
            <th style="padding:10px 12px;text-align:right;white-space:nowrap">Por pagar</th>
            <th style="padding:10px 12px;text-align:right;width:130px"></th>
          </tr>
        </thead>
        <tbody id="prov-gest-body"></tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
      <button id="prov-gest-cerrar" style="padding:11px 22px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cerrar</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Proveedores', contenido, ancho: 'xl' });

  // Cuando cambia el filtro: recalcular y refrescar KPIs + tabla
  const onCambioFiltro = () => {
    recalcular();
    // Repintar la barra (para que el preset activo se marque)
    const oldBar = m.body.querySelector(`.prov-gest-flt-preset`)?.parentElement;
    if (oldBar) {
      const tmp = document.createElement('div');
      tmp.innerHTML = htmlBarraFiltroFechas(filtro, 'prov-gest-flt');
      oldBar.replaceWith(tmp.firstElementChild);
      cablearFiltroFechas(m.body, filtro, 'prov-gest-flt', onCambioFiltro);
    }
    // Refrescar KPIs
    const kPagar = m.body.querySelector('#prov-gest-kpi-pagar');
    const kPer = m.body.querySelector('#prov-gest-kpi-periodo');
    const kTot = m.body.querySelector('#prov-gest-kpi-total');
    if (kPagar) kPagar.textContent = money(totalPorPagar);
    if (kPer) kPer.textContent = money(totalPeriodo);
    if (kTot) kTot.textContent = money(totalGeneral);
    const q = m.body.querySelector('#prov-gest-q')?.value || '';
    pintarTabla(q);
  };
  cablearFiltroFechas(m.body, filtro, 'prov-gest-flt', onCambioFiltro);

  const pintarTabla = (q = '') => {
    const ql = q.toLowerCase().trim();
    const visibles = ql
      ? filas.filter((r) => {
          const p = r.proveedor;
          return [p.nombre, p.nit, p.telefono, p.contacto, p.ciudad, p.email]
            .filter(Boolean).some((x) => String(x).toLowerCase().includes(ql));
        })
      : filas;
    const body = m.body.querySelector('#prov-gest-body');
    if (visibles.length === 0) {
      body.innerHTML = `<tr><td colspan="5" style="padding:30px;text-align:center;color:#94a3b8;font-size:13.5px">${_proveedores.length === 0 ? 'No hay proveedores. Crea el primero.' : 'Sin coincidencias.'}</td></tr>`;
      refrescarIconos(m.body);
      return;
    }
    body.innerHTML = visibles.map((r) => {
      const p = r.proveedor;
      const contacto = [p.telefono, p.email].filter(Boolean).map(esc).join(' · ') || '<span style="color:#cbd5e1">—</span>';
      const sub = [p.nit, p.ciudad].filter(Boolean).map(esc).join(' · ');
      return `
        <tr data-id="${esc(p.id)}" style="border-bottom:1px solid #f1f5f9">
          <td style="padding:11px 12px">
            <div style="font-weight:600;color:#0f172a">${esc(p.nombre)}</div>
            ${sub ? `<div style="font-size:12px;color:#64748b">${sub}</div>` : ''}
          </td>
          <td style="padding:11px 12px;color:#475569;font-size:12.5px">
            ${contacto}
            ${p.contacto ? `<div style="font-size:11.5px;color:#94a3b8">${esc(p.contacto)}</div>` : ''}
          </td>
          <td style="padding:11px 12px;text-align:right">
            <div style="font-weight:700;color:#0f172a;font-family:inherit">${money(r.total)}</div>
            <div style="font-size:11.5px;color:#64748b">${fmt(r.count)} compra(s)</div>
          </td>
          <td style="padding:11px 12px;text-align:right">
            ${r.saldo > 0
              ? `<span style="background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px">${money(r.saldo)}</span>`
              : `<span style="color:#cbd5e1;font-size:12px">—</span>`}
          </td>
          <td style="padding:11px 12px;text-align:right;white-space:nowrap">
            <button class="prov-gest-ver" data-id="${esc(p.id)}" title="Ver compras" style="width:30px;height:30px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:3px">
              <i data-lucide="eye" style="width:14px;height:14px;stroke-width:2"></i>
            </button>
            <button class="prov-gest-edit" data-id="${esc(p.id)}" title="Editar" style="width:30px;height:30px;border:1px solid #fde68a;background:#fef3c7;color:#92400e;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:3px">
              <i data-lucide="pencil" style="width:14px;height:14px;stroke-width:2"></i>
            </button>
            <button class="prov-gest-del" data-id="${esc(p.id)}" title="Eliminar" style="width:30px;height:30px;border:1px solid #fecaca;background:#fee2e2;color:#dc2626;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
              <i data-lucide="trash-2" style="width:14px;height:14px;stroke-width:2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
    refrescarIconos(m.body);

    // Wire acciones
    body.querySelectorAll('.prov-gest-ver').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); abrirInformeProveedor(btn.dataset.id); };
    });
    body.querySelectorAll('.prov-gest-edit').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const p = _proveedores.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        m.cerrar();
        setTimeout(() => abrirFormProveedor(p), 180);
      };
    });
    body.querySelectorAll('.prov-gest-del').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const p = _proveedores.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        // Total HISTÓRICO de compras a este proveedor (no solo del periodo)
        const todasSus = _compras.filter((c) => c.proveedor_id === p.id);
        const usado = todasSus.length > 0;
        const totalHist = todasSus.reduce((s, c) => s + (Number(c.total) || 0), 0);
        const ok = await Confirm.peligro(
          usado
            ? `"${p.nombre}" tiene ${fmt(todasSus.length)} compra(s) registrada(s) en total (${money(totalHist)}). Si lo eliminas, esas compras quedan sin proveedor asociado pero NO se borran. ¿Eliminar de todos modos?`
            : `¿Eliminar al proveedor "${p.nombre}"?`,
          { titulo: 'Eliminar proveedor', textoConfirmar: 'Eliminar' },
        );
        if (!ok) return;
        try {
          await ProveedoresRepo.eliminar(p.id);
          _proveedores = await ProveedoresRepo.listar();
          if (_proveedorSel && _proveedorSel.id === p.id) _proveedorSel = null;
          Toast.ok('Proveedor eliminado');
          m.cerrar();
          actualizarFormCompra();
          setTimeout(() => abrirGestionProveedores(), 200);
        } catch (err) {
          console.error(err);
          Toast.error('No se pudo eliminar el proveedor');
        }
      };
    });
  };

  pintarTabla();
  m.body.querySelector('#prov-gest-q').addEventListener('input', (e) => pintarTabla(e.target.value));
  m.body.querySelector('#prov-gest-cerrar').onclick = () => m.cerrar();
  m.body.querySelector('#prov-gest-nuevo').onclick = () => { m.cerrar(); setTimeout(() => abrirFormProveedor(), 180); };
}

/**
 * Informe de compras de un proveedor: lista todas sus compras con fecha,
 * número/ref, total, método y estado (Pagada / Pendiente). Permite ver el
 * detalle de cada compra (futuro) y muestra el resumen.
 */
function abrirInformeProveedor(provId) {
  const p = _proveedores.find((x) => x.id === provId);
  if (!p) return;

  const todasSus = _compras
    .filter((c) => c.proveedor_id === provId)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  // Estado del filtro: por defecto "Todo" (ver todo el histórico del proveedor)
  const filtro = rangoPreset('todo');

  const fechaFmt = (s) => {
    const d = String(s || '').slice(0, 10);
    if (!d) return '—';
    const [y, mo, da] = d.split('-');
    return `${da}/${mo}/${y}`;
  };

  // Datos calculados según el filtro
  let comprasFiltradas = [];
  let total = 0;
  let saldoPend = 0;

  const recalcular = () => {
    comprasFiltradas = todasSus.filter((c) => fechaEnRango(c.fecha || c.creado, filtro.desde, filtro.hasta));
    total = comprasFiltradas.reduce((s, c) => s + (Number(c.total) || 0), 0);
    saldoPend = comprasFiltradas.reduce((s, c) => s + (c.tipoPago === 'credito' ? (Number(c.saldo) || 0) : 0), 0);
  };

  const buildFilasHTML = () => {
    if (comprasFiltradas.length === 0) {
      return `<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8;font-size:13.5px">${todasSus.length === 0 ? 'Sin compras registradas a este proveedor.' : 'Sin compras en el rango seleccionado.'}</td></tr>`;
    }
    return comprasFiltradas.map((c) => {
      const pagada = c.tipoPago === 'credito' ? (Number(c.saldo) || 0) <= 0.5 : true;
      const estado = c.tipoPago === 'credito'
        ? (pagada ? '<span style="background:#dcfce7;color:#166534;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px">Pagada</span>' : `<span style="background:#fef3c7;color:#92400e;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px">Saldo ${money(c.saldo)}</span>`)
        : '<span style="background:#dcfce7;color:#166534;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:6px">Contado</span>';
      return `
        <tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:9px 12px;color:#475569">${fechaFmt(c.fecha)}</td>
          <td style="padding:9px 12px;color:#0f172a">${esc(c.ref || '—')}</td>
          <td style="padding:9px 12px;color:#475569;font-size:12.5px">${esc(c.metodoPago || '—')}</td>
          <td style="padding:9px 12px;text-align:right;font-weight:700;color:#0f172a">${money(c.total)}</td>
          <td style="padding:9px 12px;text-align:right">${estado}</td>
        </tr>
      `;
    }).join('');
  };

  recalcular();

  const contenido = `
    <div style="margin-bottom:12px">
      <div style="font-weight:700;font-size:16px;color:#0f172a">${esc(p.nombre)}</div>
      <div style="font-size:12.5px;color:#64748b">${[p.nit, p.telefono, p.ciudad, p.contacto].filter(Boolean).map(esc).join(' · ') || 'Sin datos'}</div>
    </div>

    ${htmlBarraFiltroFechas(filtro, 'inf-prov-flt')}

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#1d4ed8;font-weight:700;text-transform:uppercase">Compras</div>
        <div id="inf-prov-kpi-cant" style="font-size:19px;font-weight:800;color:#0f172a;margin-top:2px">${fmt(comprasFiltradas.length)}</div>
      </div>
      <div style="background:#dcfce7;border:1px solid #86efac;border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:#166534;font-weight:700;text-transform:uppercase">Total comprado</div>
        <div id="inf-prov-kpi-total" style="font-size:19px;font-weight:800;color:#166534;margin-top:2px">${money(total)}</div>
      </div>
      <div id="inf-prov-kpi-pagar-box" style="background:${saldoPend > 0 ? '#fef3c7' : '#f1f5f9'};border:1px solid ${saldoPend > 0 ? '#fde68a' : '#e2e8f0'};border-radius:10px;padding:11px 13px">
        <div style="font-size:10.5px;color:${saldoPend > 0 ? '#92400e' : '#475569'};font-weight:700;text-transform:uppercase">Por pagar</div>
        <div id="inf-prov-kpi-pagar" style="font-size:19px;font-weight:800;color:${saldoPend > 0 ? '#92400e' : '#0f172a'};margin-top:2px">${money(saldoPend)}</div>
      </div>
    </div>

    <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-height:45vh;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f1f5f9;color:#475569;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">
            <th style="padding:9px 12px;text-align:left">Fecha</th>
            <th style="padding:9px 12px;text-align:left">N° / Ref</th>
            <th style="padding:9px 12px;text-align:left">Método</th>
            <th style="padding:9px 12px;text-align:right">Total</th>
            <th style="padding:9px 12px;text-align:right">Estado</th>
          </tr>
        </thead>
        <tbody id="inf-prov-body">${buildFilasHTML()}</tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button id="inf-prov-cerrar" style="padding:11px 22px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cerrar</button>
    </div>
  `;

  const mi = Modal.abrir({ titulo: 'Informe del proveedor', contenido, ancho: 'lg' });

  const onCambioFiltro = () => {
    recalcular();
    // Repintar barra (preset activo)
    const oldBar = mi.body.querySelector('.inf-prov-flt-preset')?.parentElement;
    if (oldBar) {
      const tmp = document.createElement('div');
      tmp.innerHTML = htmlBarraFiltroFechas(filtro, 'inf-prov-flt');
      oldBar.replaceWith(tmp.firstElementChild);
      cablearFiltroFechas(mi.body, filtro, 'inf-prov-flt', onCambioFiltro);
    }
    // Refrescar KPIs
    const kCant = mi.body.querySelector('#inf-prov-kpi-cant');
    const kTotal = mi.body.querySelector('#inf-prov-kpi-total');
    const kPagar = mi.body.querySelector('#inf-prov-kpi-pagar');
    const kPagarBox = mi.body.querySelector('#inf-prov-kpi-pagar-box');
    if (kCant) kCant.textContent = fmt(comprasFiltradas.length);
    if (kTotal) kTotal.textContent = money(total);
    if (kPagar) kPagar.textContent = money(saldoPend);
    if (kPagarBox) {
      kPagarBox.style.background = saldoPend > 0 ? '#fef3c7' : '#f1f5f9';
      kPagarBox.style.borderColor = saldoPend > 0 ? '#fde68a' : '#e2e8f0';
    }
    // Refrescar tabla
    const tbody = mi.body.querySelector('#inf-prov-body');
    if (tbody) tbody.innerHTML = buildFilasHTML();
  };
  cablearFiltroFechas(mi.body, filtro, 'inf-prov-flt', onCambioFiltro);
  mi.body.querySelector('#inf-prov-cerrar').onclick = () => mi.cerrar();
}

function abrirFormProveedor(prov = null) {
  const datos = prov || { nombre: '', nit: '', telefono: '', contacto: '', ciudad: '', direccion: '', email: '', nota: '' };
  const titulo = prov ? 'Editar proveedor' : 'Nuevo proveedor';

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
        style="flex:1;padding:11px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">Guardar</button>
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
      console.error('Error guardando proveedor:', err);
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

// Métodos de pago para Compras (mismos chips que Ventas + atajos E/T/Q).
// Tarjeta y Otro quedan fuera porque el cobro a proveedor en este negocio se
// hace por estos canales.
const METODOS_COMPRA = [
  { id: 'efectivo',      label: 'Efectivo',     key: 'E' },
  { id: 'transferencia', label: 'Transfer.',    key: 'T' },
  { id: 'qr',            label: 'QR',           key: 'Q' },
];
const TECLA_METODO_COMPRA = METODOS_COMPRA.reduce((acc, m) => (acc[m.key.toLowerCase()] = m.id, acc), {});

// Bancos para "Transferencia" (mismos logos y atajos que Ventas)
const BANCOS_COMPRA = [
  { id: 'daviplata', nombre: 'Daviplata', key: 'D', color: '#E32219',
    logo: '<svg viewBox="0 0 130 30" xmlns="http://www.w3.org/2000/svg" style="height:22px;display:block" aria-label="Daviplata"><text x="0" y="24" font-family="Inter,sans-serif" font-weight="900" font-size="26" fill="#E32219" letter-spacing="-1.5">DAVI</text><text x="64" y="24" font-family="Inter,sans-serif" font-weight="700" font-size="24" fill="#0f172a" letter-spacing="-0.5">plata</text></svg>',
  },
  { id: 'nequi', nombre: 'Nequi', key: 'N', color: '#FF1F8F',
    logo: '<svg viewBox="0 0 90 30" xmlns="http://www.w3.org/2000/svg" style="height:22px;display:block" aria-label="Nequi"><rect x="2" y="3" width="9" height="9" fill="#FF1F8F"/><text x="13" y="25" font-family="Inter,sans-serif" font-weight="900" font-size="26" fill="#2A0A4A" letter-spacing="-1">Nequi</text></svg>',
  },
];

function abrirRegistroPago() {
  if (_items.length === 0) { Toast.warn('Agrega al menos un producto'); return; }
  const total = _items.reduce((s, it) => s + num(it.cantidad) * num(it.costo), 0);

  const contenido = `
    <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:stretch">

      <!-- COLUMNA IZQUIERDA: total + tipo de pago + métodos -->
      <div>
        <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:6px;text-align:center">Total a pagar</div>
        <div style="background:#eff6ff;border-radius:12px;padding:20px 12px;margin-bottom:16px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#1d4ed8;letter-spacing:-0.025em">${money(total)}</div>
        </div>

        <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:8px">Tipo</div>
        <div style="display:flex;gap:7px;margin-bottom:14px">
          <button id="comp-pago-contado" style="flex:1;padding:10px;border:1.5px solid #2563eb;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">Contado</button>
          <button id="comp-pago-credito" style="flex:1;padding:10px;border:1.5px solid #e2e8f0;background:white;color:#475569;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">Crédito</button>
        </div>

        <div id="comp-metodo-wrap">
          <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:8px">Método de pago</div>
          <div id="comp-chips" style="display:flex;flex-direction:column;gap:7px">
            ${METODOS_COMPRA.map(m => `
              <button class="comp-pm-chip" data-pm="${m.id}"
                style="padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;background:white;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569;text-align:left;display:flex;align-items:center;gap:9px"
              ><kbd style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;background:#f1f5f9;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:5px;font-family:inherit;font-weight:700;font-size:11.5px;color:#475569">${m.key}</kbd><span>${m.label}</span></button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- COLUMNA DERECHA: detalle según selección -->
      <div style="border-left:1px solid #e2e8f0;padding-left:24px;min-width:0;display:flex;flex-direction:column">
        <div id="comp-pago-area" style="flex:1"></div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px">
      <button id="comp-pago-cancel"
        style="flex:1;padding:13px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="comp-pago-confirmar"
        style="flex:1.4;padding:13px;border:0;background:#15803d;color:white;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)">Confirmar</button>
    </div>
  `;

  // Estado del modal
  let tipoPago = 'contado';   // 'contado' | 'credito'
  let metodoPago = 'efectivo'; // id de METODOS_COMPRA (solo aplica en contado)
  let bancoTransf = 'daviplata'; // 'daviplata' | 'nequi' (solo aplica cuando metodoPago='transferencia')

  const m = Modal.abrir({
    titulo: 'Registrar compra',
    contenido,
    ancho: 'lg',
    onClose: () => { document.removeEventListener('keydown', atajosRegistroPago); },
  });

  // === Helpers ===
  const enfocarConfirmar = () => {
    const btn = m.body.querySelector('#comp-pago-confirmar');
    if (btn && !btn.disabled) { try { btn.focus({ preventScroll: true }); } catch (_) { btn.focus(); } }
  };

  const marcarChipMetodo = () => {
    m.body.querySelectorAll('.comp-pm-chip').forEach((btn) => {
      const activo = btn.dataset.pm === metodoPago;
      btn.style.background = activo ? '#2563eb' : 'white';
      btn.style.color = activo ? 'white' : '#475569';
      btn.style.borderColor = activo ? '#2563eb' : '#e2e8f0';
      // El kbd interno también cambia de tono
      const kbd = btn.querySelector('kbd');
      if (kbd) {
        kbd.style.background = activo ? 'rgba(255,255,255,.18)' : '#f1f5f9';
        kbd.style.color = activo ? 'white' : '#475569';
        kbd.style.borderColor = activo ? 'rgba(255,255,255,.4)' : '#cbd5e1';
      }
    });
  };

  const seleccionarBanco = (b) => {
    bancoTransf = b;
    m.body.querySelectorAll('.comp-tb-chip').forEach((btn) => {
      const def = BANCOS_COMPRA.find(x => x.id === btn.dataset.tb);
      const activo = btn.dataset.tb === b;
      btn.style.borderColor = activo && def ? def.color : '#e2e8f0';
      btn.style.boxShadow = activo && def ? `0 0 0 3px ${def.color}22` : 'none';
      btn.style.background = activo ? '#fafbff' : 'white';
    });
    const lbl = m.body.querySelector('#comp-trans-banco');
    if (lbl) {
      const def = BANCOS_COMPRA.find(x => x.id === b);
      if (def) lbl.textContent = def.nombre;
    }
    enfocarConfirmar();
  };

  const renderArea = () => {
    const area = m.body.querySelector('#comp-pago-area');
    const wrapMetodo = m.body.querySelector('#comp-metodo-wrap');

    if (tipoPago === 'credito') {
      // En crédito no aplica método de pago
      if (wrapMetodo) wrapMetodo.style.display = 'none';
      const vd = new Date(); vd.setDate(vd.getDate() + 30);
      const venceDef = vd.toISOString().slice(0, 10);
      area.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:11px 13px;font-size:13px;color:#92400e">
            Quedará pendiente con <b>${esc(_proveedorSel?.nombre || 'el proveedor')}</b> como cuenta por pagar.
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha de vencimiento</div>
            <input id="comp-vence" type="date" value="${venceDef}"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Abono inicial (opcional)</div>
            <input id="comp-abono-ini" data-miles type="text" inputmode="numeric" placeholder="0"
              style="width:100%;padding:12px 14px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:18px;font-weight:700;outline:none;box-sizing:border-box;font-family:inherit;text-align:right" />
          </div>
        </div>
      `;
      bindMilesInputs(area);
      setTimeout(() => { area.querySelector('#comp-abono-ini')?.focus(); }, 30);
      return;
    }

    // CONTADO: mostrar área según método elegido
    if (wrapMetodo) wrapMetodo.style.display = '';
    if (metodoPago === 'transferencia') {
      area.innerHTML = `
        <div style="font-size:13.5px;color:#475569;font-weight:600;margin-bottom:10px">¿Por dónde pagas?</div>
        <div id="comp-bancos" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
          ${BANCOS_COMPRA.map(b => `
            <button class="comp-tb-chip" data-tb="${b.id}"
              style="padding:14px 16px;border:2px solid #e2e8f0;background:white;border-radius:12px;cursor:pointer;display:flex;align-items:center;gap:14px;font-family:inherit;transition:all .12s ease">
              <kbd style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;background:#f1f5f9;border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:6px;font-family:inherit;font-weight:700;font-size:13px;color:#475569">${b.key}</kbd>
              <span style="flex:1;text-align:left">${b.logo}</span>
            </button>
          `).join('')}
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;font-size:14px;color:#475569">
          Transferencia por <b id="comp-trans-banco">${esc(BANCOS_COMPRA.find(b=>b.id===bancoTransf)?.nombre||'')}</b>
          por <b>${money(total)}</b>
        </div>
      `;
      area.querySelectorAll('.comp-tb-chip').forEach(btn => {
        btn.addEventListener('click', () => seleccionarBanco(btn.dataset.tb));
      });
      seleccionarBanco(bancoTransf);
      return;
    }

    // efectivo o qr
    area.innerHTML = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;font-size:14px;color:#475569">
        Pago en <b>${metodoPago === 'qr' ? 'código QR' : 'Efectivo'}</b>
        por <b>${money(total)}</b><br>
        <span style="color:#94a3b8;font-size:13px">Confirma cuando hayas entregado el pago al proveedor.</span>
      </div>
    `;
    setTimeout(() => enfocarConfirmar(), 0);
  };

  const seleccionarMetodo = (id) => {
    metodoPago = id;
    marcarChipMetodo();
    renderArea();
  };

  const marcarTipo = () => {
    const c = m.body.querySelector('#comp-pago-contado');
    const cr = m.body.querySelector('#comp-pago-credito');
    const setOn = (btn, on) => {
      btn.style.background = on ? '#2563eb' : 'white';
      btn.style.color = on ? 'white' : '#475569';
      btn.style.borderColor = on ? '#2563eb' : '#e2e8f0';
    };
    setOn(c, tipoPago === 'contado');
    setOn(cr, tipoPago === 'credito');
  };

  // === Atajos de teclado del modal ===
  function atajosRegistroPago(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = String(e.key || '').toLowerCase();
    const ae = document.activeElement;
    const dentroDelModal = ae && m.body && m.body.contains(ae);
    if (!dentroDelModal) {
      const tag = ae && ae.tagName;
      const escribiendoFuera = ae && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable);
      if (escribiendoFuera) return;
    }
    // D/N cuando estamos en contado+transferencia
    if (tipoPago === 'contado' && metodoPago === 'transferencia' && (k === 'd' || k === 'n')) {
      e.preventDefault();
      seleccionarBanco(k === 'd' ? 'daviplata' : 'nequi');
      return;
    }
    // E/T/Q cambian de método (solo contado)
    if (tipoPago === 'contado') {
      const idM = TECLA_METODO_COMPRA[k];
      if (idM) { e.preventDefault(); seleccionarMetodo(idM); return; }
    }
  }
  document.addEventListener('keydown', atajosRegistroPago);

  // Click handlers
  m.body.querySelector('#comp-pago-contado').onclick = () => { tipoPago = 'contado'; marcarTipo(); renderArea(); };
  m.body.querySelector('#comp-pago-credito').onclick = () => { tipoPago = 'credito'; marcarTipo(); renderArea(); };
  m.body.querySelectorAll('.comp-pm-chip').forEach((btn) => {
    btn.addEventListener('click', () => seleccionarMetodo(btn.dataset.pm));
  });
  m.body.querySelector('#comp-pago-cancel').onclick = () => m.cerrar();
  m.body.querySelector('#comp-pago-confirmar').onclick = async () => {
    // Candado anti-doble-registro
    const btnConf = m.body.querySelector('#comp-pago-confirmar');
    if (btnConf.disabled) return;
    btnConf.disabled = true;
    btnConf.style.opacity = '0.6';
    btnConf.style.cursor = 'wait';

    const fecha = _contenedor.querySelector('#comp-fecha')?.value || todayISO();
    const ref = _contenedor.querySelector('#comp-ref')?.value || '';

    const datos = {
      fecha, ref,
      proveedor_id: _proveedorSel?.id || null,
      proveedor: _proveedorSel?.nombre || '',
      items: _items,
      tipoPago,
    };

    if (tipoPago === 'credito') {
      datos.vence = m.body.querySelector('#comp-vence')?.value || '';
      datos.abonoInicial = num(m.body.querySelector('#comp-abono-ini')?.value);
      datos.metodoPago = 'Crédito';
    } else if (metodoPago === 'transferencia') {
      const banco = BANCOS_COMPRA.find(b => b.id === bancoTransf);
      datos.metodoPago = banco ? `Transferencia (${banco.nombre})` : 'Transferencia';
    } else if (metodoPago === 'qr') {
      datos.metodoPago = 'QR';
    } else {
      datos.metodoPago = 'Efectivo';
    }

    try {
      const compra = await Repo.registrar(datos);
      Toast.ok(`Compra registrada · ${money(compra.total)}`);
      m.cerrar();
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
      btnConf.disabled = false;
      btnConf.style.opacity = '1';
      btnConf.style.cursor = 'pointer';
    }
  };

  marcarTipo();
  marcarChipMetodo();
  renderArea();
}
