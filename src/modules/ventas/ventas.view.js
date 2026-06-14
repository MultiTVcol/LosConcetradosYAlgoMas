/**
 * modules/ventas/ventas.view.js — Vista del Punto de Venta (estilo legacy PetPOS)
 *
 * Layout split moderno:
 *   - IZQUIERDA: pasos 1 (cliente) + 2 (buscador con dropdown inline)
 *   - DERECHA: paso 3 (borrador de la factura / carrito)
 *
 * Buscador con dropdown INLINE (no flotante), estilo legacy.
 *
 * Selector de cliente:
 *   - Modal con búsqueda por nombre, documento, teléfono, email
 *   - Navegación ↑↓ Enter Esc
 *   - Opción "Sin cliente (ocasional)" arriba
 *   - Botón "Crear nuevo cliente" abre form inline sin salir de ventas
 *
 * Modo lector USB (réplica fiel del legacy):
 *   - Config en localStorage 'pospunto:lector' = 'pistola' (default) | 'manual'
 *   - Modo 'pistola': scannerMode=true → tryScannerExact con debounce 60ms
 *       Match exacto en barras (prioridad) o codigo → addToCart directo (sin modal)
 *       Solo dispara con query.length >= 3 (evita falsos con "1" mientras se tipea "100")
 *       Anti-dobles lecturas: ignora el mismo código en < 1800ms
 *   - Modo 'manual': scannerMode=false → dropdown clásico + modal cantidad
 *   - Enter manual o click SIEMPRE va por modal cantidad (independiente del modo)
 */

import * as Repo from './ventas.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc, uid } from '../../core/strings.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { imprimirPOS } from '../../services/printer.js';
import * as PlantillaRepo from '../factura/plantilla.repo.js';
import * as EditorPlantilla from '../factura/editor-plantilla.view.js';
import * as ConfigRepo from '../config/config.repo.js';
import { html as facturaHTML } from '../factura/factura.html.js';
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';

// ============================================================
//  ESTADO DEL MÓDULO
// ============================================================

let _contenedor = null;
let _productos = [];
let _clientes = [];
let _carrito = [];
let _cliente = null;
let _descuento = 0;
let _mostrarUtilidad = false;   // preferencia leída desde Configuración

// Estado del buscador inline
let _resultados = [];        // productos visibles en el dropdown
let _indiceActivo = -1;      // ítem seleccionado con teclado
let _dropdownAbierto = false;

// Estado del lector USB (réplica legacy)
let _debounceTimer = null;
let _scanLast = { code: '', t: 0 };   // anti-dobles lecturas
let _offRealtime = null;              // limpieza realtime

// Estado del modal de cobro (réplica legacy: payments / payMode / payMethod)
let _payments = { efectivo: 0, transferencia: 0, qr: 0, tarjeta: 0 };
let _payMode = 'simple';      // 'simple' | 'mixto'
let _payMethod = 'efectivo';  // método seleccionado en modo simple
let _cobroModal = null;       // controlador del modal abierto (Modal.abrir)

// ============================================================
//  RENDERIZADO
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;

  _carrito = [];
  _cliente = null;
  _descuento = 0;
  _resultados = [];
  _indiceActivo = -1;
  _dropdownAbierto = false;
  _scanLast = { code: '', t: 0 };
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlCargando();

  try {
    _productos = await ProductosRepo.listar();
  } catch (err) {
    console.error('Error cargando productos:', err);
    _productos = [];
  }

  try {
    _clientes = await ClientesRepo.listar();
  } catch (err) {
    console.error('Error cargando clientes:', err);
    _clientes = [];
  }

  try {
    const cfg = await ConfigRepo.leer();
    _mostrarUtilidad = !!cfg.mostrarUtilidad;
  } catch (err) {
    _mostrarUtilidad = false;
  }

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);

  // Realtime: refrescar catálogo cuando otra terminal modifica productos
  // o clientes (precios especiales, stock por compras, etc.)
  const refrescarCatalogo = async () => {
    try {
      _productos = await ProductosRepo.listar();
      _clientes = await ClientesRepo.listar();
    } catch (err) { console.warn('Realtime ventas:', err); }
  };
  _offRealtime = Realtime.escucharVarias(['productos', 'clientes'], refrescarCatalogo);
}

function renderizarCarrito() {
  if (!_contenedor) return;

  const totales = Repo.calcularTotales(_carrito, _descuento);

  // Re-renderizar el header completo (incluye botón Vaciar + subtítulo cliente/ítems)
  const headerActual = _contenedor.querySelector('#venta-subtitulo')?.parentElement;
  if (headerActual) {
    headerActual.outerHTML = htmlHeaderCarrito();
  }

  const lista = _contenedor.querySelector('#venta-lista-carrito');
  if (lista) {
    if (_carrito.length === 0) {
      lista.outerHTML = htmlListaVacia();
    } else {
      lista.outerHTML = htmlListaItems();
    }
  }

  const cajaTotales = _contenedor.querySelector('#venta-totales');
  if (cajaTotales) {
    cajaTotales.outerHTML = htmlTotales(totales);
  }

  const btnCobrar = _contenedor.querySelector('#venta-btn-cobrar-wrap');
  if (btnCobrar) {
    btnCobrar.outerHTML = htmlBotonCobrar(totales);
  }

  refrescarIconos(_contenedor);
  adjuntarEventosCarrito(_contenedor);
}

function renderizarPaso1() {
  if (!_contenedor) return;
  const cont = _contenedor.querySelector('#paso1-cliente-wrap');
  if (cont) {
    cont.outerHTML = htmlPaso1Cliente();
    refrescarIconos(_contenedor);
    adjuntarEventosCarrito(_contenedor);
  }
}

function renderizarDropdown() {
  if (!_contenedor) return;
  const lista = _contenedor.querySelector('#prodSearchList');
  if (!lista) return;

  const input = _contenedor.querySelector('#venta-buscar');
  const query = (input?.value || '').trim();

  if (!query) {
    lista.classList.remove('ac-list-open');
    lista.innerHTML = '';
    _dropdownAbierto = false;
    _indiceActivo = -1;
    return;
  }

  if (_resultados.length === 0) {
    lista.innerHTML = `<div class="ac-empty">Sin resultados 🐾</div>`;
    lista.classList.add('ac-list-open');
    _dropdownAbierto = true;
    _indiceActivo = -1;
    return;
  }

  lista.innerHTML = _resultados.slice(0, 30).map((p, i) => htmlItemDropdown(p, i === _indiceActivo, query)).join('');
  lista.classList.add('ac-list-open');
  _dropdownAbierto = true;

  // Adjuntar eventos a los items del dropdown
  lista.querySelectorAll('.ac-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // evita perder foco del input
    });
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const producto = _productos.find(p => p.id === id);
      if (producto) {
        cerrarDropdown();
        const input = _contenedor.querySelector('#venta-buscar');
        if (input) input.value = '';
        abrirModalCantidad(producto);
      }
    });
  });
}

function cerrarDropdown() {
  if (!_contenedor) return;
  const lista = _contenedor.querySelector('#prodSearchList');
  if (lista) {
    lista.classList.remove('ac-list-open');
    lista.innerHTML = '';
  }
  _dropdownAbierto = false;
  _indiceActivo = -1;
}

// ============================================================
//  HTML BUILDERS
// ============================================================

function htmlCargando() {
  return `
    <div style="padding:48px;text-align:center;color:#94a3b8;font-size:14px">
      Cargando punto de venta…
    </div>
  `;
}

function htmlLayout() {
  const totales = Repo.calcularTotales(_carrito, _descuento);
  return `
    <style>
      .ac-list {
        position:absolute; top:calc(100% + 6px); left:0; right:0;
        background:white; border:1.5px solid #e2e8f0;
        border-radius:14px; max-height:60vh; overflow:auto; z-index:60;
        box-shadow:0 14px 36px rgba(0,0,0,.18);
        display:none;
      }
      .ac-list.ac-list-open { display:block; }
      .ac-item {
        display:flex; gap:12px; align-items:center; justify-content:space-between;
        padding:12px 14px; cursor:pointer;
        border-bottom:1px solid #f1f5f9;
        transition:background .12s, border-color .12s;
      }
      .ac-item:last-child { border-bottom:none; }
      .ac-item:hover, .ac-item.active { background:#eff6ff; }
      .ac-item.active { outline:2px solid #2563eb; outline-offset:-2px; }
      .ac-item mark {
        background:rgba(74,222,128,.40); color:inherit;
        padding:0 2px; border-radius:3px; font-weight:800;
      }
      .ac-item .ac-nom { font-weight:700; font-size:16px; line-height:1.25; color:#0f172a; }
      .ac-item .ac-cod {
        font-family:'JetBrains Mono',ui-monospace,monospace;
        font-weight:800; font-size:13.5px;
      }
      .ac-item .ac-meta {
        font-size:12.5px; color:#64748b; margin-top:4px;
        display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center;
      }
      .ac-item .ac-right { text-align:right; white-space:nowrap; flex-shrink:0; }
      .ac-item .ac-precio { font-weight:800; color:#2563eb; font-size:17px; font-family:'JetBrains Mono',ui-monospace,monospace; }
      .ac-item .ac-badge { display:inline-block; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:600; margin-top:4px; font-family:'JetBrains Mono',ui-monospace,monospace; }
      .ac-item .badge-ok { background:#dcfce7; color:#166534; }
      .ac-item .badge-danger { background:#fef2f2; color:#991b1b; }
      .ac-empty { padding:18px; text-align:center; color:#94a3b8; font-size:14px; }
      .ac-hint { margin-top:8px; font-size:12px; color:#94a3b8; }
      .ac-hint kbd {
        background:#f1f5f9; border:1px solid #e2e8f0;
        border-radius:5px; padding:1px 6px; font-family:inherit;
        font-size:11px; font-weight:700; color:#475569;
      }
      .paso-badge {
        display:inline-flex; align-items:center; justify-content:center;
        width:26px; height:26px; border-radius:50%;
        background:#2563eb; color:white; font-weight:700; font-size:13px;
        font-family:'JetBrains Mono',ui-monospace,monospace;
      }
      /* Selector de cliente */
      .sc-item {
        display:flex; gap:12px; align-items:center;
        padding:10px 12px; cursor:pointer; border-radius:10px;
        border:1px solid transparent; transition:background .12s, border-color .12s;
      }
      .sc-item:hover, .sc-item.active { background:#eff6ff; border-color:#bfdbfe; }
      .sc-item.active { outline:2px solid #2563eb; outline-offset:-2px; }
      .sc-item mark { background:rgba(74,222,128,.40); color:inherit; padding:0 2px; border-radius:3px; font-weight:800; }
      .sc-avatar {
        width:38px; height:38px; border-radius:50%; flex-shrink:0;
        background:linear-gradient(135deg,#eff6ff,#ffffff); color:#2563eb;
        display:flex; align-items:center; justify-content:center;
        font-weight:800; font-size:15px; border:1.5px solid #bfdbfe;
      }
      .sc-input {
        width:100%; padding:11px 14px; border:1.5px solid #cbd5e1; border-radius:10px;
        font-size:15px; outline:none; font-family:inherit; background:white; box-sizing:border-box;
      }
      .sc-input:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37, 99, 235,.15); }
    </style>
    <div style="display:grid;grid-template-columns:1fr 420px;height:100vh;gap:0">
      ${htmlPanelIzquierdo()}
      ${htmlPanelDerecho(totales)}
    </div>
  `;
}

// ============================================================
//  PANEL IZQUIERDO — Pasos 1 (cliente) + 2 (buscar producto)
// ============================================================

function htmlPanelIzquierdo() {
  return `
    <div style="padding:24px 32px;overflow-y:auto;background:#fafafa">
      ${htmlHeaderVentas()}
      ${htmlPaso1Cliente()}
      ${htmlPaso2BuscarProducto()}
    </div>
  `;
}

function htmlHeaderVentas() {
  return `
    <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <i data-lucide="shopping-cart" style="width:28px;height:28px;color:#2563eb;stroke-width:1.75"></i>
          <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.025em;margin:0;color:#0f172a">
            Punto de Venta
          </h1>
        </div>
        <div style="color:#64748b;font-size:13.5px">
          Seguí los 3 pasos para registrar una venta
        </div>
      </div>
      <button id="venta-btn-personalizar-ticket"
        title="Personaliza tu ticket POS 80mm"
        style="padding:10px 14px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;display:flex;align-items:center;gap:6px;flex-shrink:0">
        Personaliza tu ticket
      </button>
    </div>
  `;
}

function htmlPaso1Cliente() {
  // Si hay cliente seleccionado, mostrar versión expandida con info + botón X
  if (_cliente) {
    const inicial = String(_cliente.nombre || '?').trim().charAt(0).toUpperCase() || '?';
    const subline = [_cliente.documento, _cliente.telefono].filter(Boolean).join(' · ');
    return `
      <div id="paso1-cliente-wrap" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="paso-badge">1</span>
          <h3 style="font-size:16px;font-weight:600;margin:0;color:#0f172a">Cliente</h3>
        </div>

        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px">
          <div class="sc-avatar" style="width:42px;height:42px;font-size:17px">${esc(inicial)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14.5px;color:#0f172a;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(_cliente.nombre)}
            </div>
            ${subline ? `
              <div style="font-size:12px;color:#64748b;margin-top:2px">${esc(subline)}</div>
            ` : ''}
          </div>
          <button
            id="venta-btn-cambiar-cliente"
            title="Cambiar cliente"
            style="background:white;border:1px solid #bfdbfe;border-radius:8px;padding:6px 10px;cursor:pointer;color:#2563eb;font-size:12px;font-weight:600;font-family:inherit"
          >Cambiar</button>
          <button
            id="venta-btn-quitar-cliente"
            title="Quitar cliente"
            style="background:#fef2f2;border:0;border-radius:8px;width:30px;height:30px;cursor:pointer;color:#dc2626;display:flex;align-items:center;justify-content:center;flex-shrink:0"
          >
            <i data-lucide="x" style="width:14px;height:14px;stroke-width:2.25"></i>
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div id="paso1-cliente-wrap" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span class="paso-badge">1</span>
        <h3 style="font-size:16px;font-weight:600;margin:0;color:#0f172a">Cliente</h3>
      </div>

      <button
        id="venta-btn-cliente"
        style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;color:#475569;text-align:left;width:100%"
      >
        <span style="display:flex;align-items:center;gap:10px">
          <i data-lucide="user" style="width:18px;height:18px"></i>
          <span>Sin cliente (cliente ocasional)</span>
        </span>
        <i data-lucide="chevron-down" style="width:16px;height:16px;color:#94a3b8"></i>
      </button>
    </div>
  `;
}

function htmlPaso2BuscarProducto() {
  if (_productos.length === 0) {
    return `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="paso-badge">2</span>
          <h3 style="font-size:16px;font-weight:600;margin:0;color:#0f172a">Buscar producto</h3>
        </div>
        <div style="background:#fef3c7;border:1px dashed #d97706;border-radius:10px;padding:20px;text-align:center">
          <i data-lucide="alert-circle" style="width:32px;height:32px;color:#d97706;stroke-width:1.5;display:inline-block;margin-bottom:8px"></i>
          <div style="font-size:14px;font-weight:600;color:#92400e;margin-bottom:4px">
            No hay productos cargados
          </div>
          <div style="font-size:13px;color:#a16207;line-height:1.5">
            Andá al módulo <strong>Productos</strong> y agregá al menos uno antes de vender.
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="paso-badge">2</span>
          <h3 style="font-size:16px;font-weight:600;margin:0;color:#0f172a">Buscar o escanear producto</h3>
        </div>
        <div style="display:flex;align-items:center;gap:6px;color:#64748b;font-size:12.5px;font-weight:600">
          <i data-lucide="scan-barcode" style="width:16px;height:16px;stroke-width:2;color:#2563eb"></i> Pistola lista
        </div>
      </div>

      <div style="position:relative">
        <div style="background:#f8fafc;border:2px dashed #60a5fa;border-radius:14px;padding:14px">
          <div style="display:flex;gap:8px">
            <input
              id="venta-buscar"
              type="text"
              placeholder="Escanea con la pistola o escribe (código, nombre, categoría)…"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="prodSearchList"
              style="flex:1;padding:14px 16px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;outline:none;font-family:inherit;background:white;color:#0f172a;box-sizing:border-box"
            />
          </div>
          <div class="ac-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> navegar · <kbd>Enter</kbd> agregar · <kbd>Esc</kbd> cerrar · escanea para agregar al instante
          </div>
        </div>

        <div class="ac-list" id="prodSearchList" role="listbox" aria-label="Resultados de productos"></div>
      </div>
    </div>
  `;
}

function htmlItemDropdown(p, isActive, query) {
  const q = (query || '').toLowerCase();
  const stockBajo = Number(p.stock) <= Number(p.stock_min || 0);
  const stock = Number(p.stock) || 0;

  return `
    <div class="ac-item ${isActive ? 'active' : ''}" data-id="${esc(p.id)}" role="option">
      <div style="min-width:0;flex:1">
        <div class="ac-nom">${hl(p.nombre, q)}</div>
        <div class="ac-meta">
          <span class="ac-cod">${hl(p.codigo || '', q)}</span>
          ${p.barras ? `<span>· ${hl(p.barras, q)}</span>` : ''}
          ${p.categoria ? `<span>· ${hl(p.categoria, q)}</span>` : ''}
          ${p.proveedor ? `<span>· ${hl(p.proveedor, q)}</span>` : ''}
        </div>
      </div>
      <div class="ac-right">
        <div class="ac-precio">${money(p.precio)}</div>
        <div class="ac-badge ${stockBajo ? 'badge-danger' : 'badge-ok'}">Stock ${stock}</div>
      </div>
    </div>
  `;
}

/**
 * Resaltado HTML del texto que coincide con la búsqueda.
 */
function hl(s, q) {
  if (!s) return '';
  const str = String(s);
  if (!q) return esc(str);
  const i = str.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(str);
  return esc(str.slice(0, i))
       + '<mark>' + esc(str.slice(i, i + q.length)) + '</mark>'
       + esc(str.slice(i + q.length));
}

// ============================================================
//  PANEL DERECHO — Paso 3 (borrador de la factura)
// ============================================================

function htmlPanelDerecho(totales) {
  return `
    <div style="background:white;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;height:100vh">
      ${htmlHeaderCarrito()}
      ${_carrito.length === 0 ? htmlListaVacia() : htmlListaItems()}
      ${htmlTotales(totales)}
      ${htmlBotonCobrar(totales)}
    </div>
  `;
}

function htmlHeaderCarrito() {
  const hayItems = _carrito.length > 0;
  const cliente = _cliente ? _cliente.nombre : 'Cliente General';
  return `
    <div style="padding:20px 24px 12px;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="paso-badge">3</span>
          <span style="font-size:16px;font-weight:600;color:#0f172a">Borrador de la factura</span>
        </div>
        <button id="venta-btn-vaciar"
          ${!hayItems ? 'disabled' : ''}
          style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:white;border:1px solid #e2e8f0;border-radius:8px;cursor:${hayItems ? 'pointer' : 'not-allowed'};font-size:12.5px;font-weight:600;color:${hayItems ? '#475569' : '#cbd5e1'};font-family:inherit">
          <i data-lucide="trash-2" style="width:13px;height:13px"></i> Vaciar
        </button>
      </div>
      <div id="venta-subtitulo" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;font-size:13px;color:#64748b">
        Factura para <b style="color:#0f172a">${esc(cliente)}</b> · <span id="venta-contador">${_carrito.length} ítem${_carrito.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  `;
}

function htmlListaVacia() {
  return `
    <div id="venta-lista-carrito" style="flex:1;overflow-y:auto;padding:24px;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center;color:#94a3b8">
        <div style="width:64px;height:64px;margin:0 auto 12px;border-radius:16px;background:#f8fafc;display:flex;align-items:center;justify-content:center">
          <i data-lucide="shopping-bag" style="width:32px;height:32px;color:#cbd5e1;stroke-width:1.5"></i>
        </div>
        <div style="font-size:14px;color:#64748b;font-weight:500;margin-bottom:4px">Carrito vacío</div>
        <div style="font-size:12.5px;color:#94a3b8;line-height:1.5;max-width:240px">
          Buscá un producto a la izquierda para agregarlo al borrador
        </div>
      </div>
    </div>
  `;
}

function htmlListaItems() {
  return `
    <div id="venta-lista-carrito" style="flex:1;overflow-y:auto;padding:6px 14px 12px">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead>
          <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left">
            <th style="padding:8px 6px;width:42px">Cant</th>
            <th style="padding:8px 6px">Producto</th>
            <th style="padding:8px 6px;text-align:right">Vr/Unit</th>
            <th style="padding:8px 6px;text-align:right">Valor</th>
            <th style="padding:8px 6px;width:70px"></th>
          </tr>
        </thead>
        <tbody>
          ${_carrito.map((item, idx) => htmlFilaCarrito(item, idx)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function htmlFilaCarrito(item, idx) {
  const subtotal = Repo.calcularSubtotalItem(item);
  const tieneDesc = Number(item.descuento) > 0;
  return `
    <tr data-idx="${idx}" style="border-bottom:1px solid #f1f5f9">
      <td style="padding:10px 6px;vertical-align:top">
        <b style="color:#0f172a;font-family:'JetBrains Mono',ui-monospace,monospace">${item.cantidad}</b>
      </td>
      <td style="padding:10px 6px;vertical-align:top;color:#0f172a">
        <div style="font-weight:600">${esc(item.nombre)}</div>
        ${tieneDesc ? `<div style="color:#dc2626;font-size:11.5px;margin-top:2px">desc. ${money(item.descuento)} c/u</div>` : ''}
      </td>
      <td style="padding:10px 6px;text-align:right;vertical-align:top;white-space:nowrap;font-family:'JetBrains Mono',ui-monospace,monospace">
        ${money(item.precio)}
      </td>
      <td style="padding:10px 6px;text-align:right;vertical-align:top;white-space:nowrap;font-family:'JetBrains Mono',ui-monospace,monospace">
        <b>${money(subtotal)}</b>
      </td>
      <td style="padding:10px 6px;vertical-align:top">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-editar-linea" data-idx="${idx}" title="Editar línea"
            style="width:28px;height:28px;background:#fef3c7;border:1px solid #fde68a;border-radius:7px;cursor:pointer;color:#a16207;display:flex;align-items:center;justify-content:center">
            <i data-lucide="pencil" style="width:13px;height:13px"></i>
          </button>
          <button class="btn-remover-item" data-idx="${idx}" title="Quitar"
            style="width:28px;height:28px;background:#fef2f2;border:1px solid #fecaca;border-radius:7px;cursor:pointer;color:#dc2626;display:flex;align-items:center;justify-content:center">
            <i data-lucide="x" style="width:13px;height:13px;stroke-width:2.25"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function htmlTotales(t) {
  const mostrarUtilidad = _mostrarUtilidad && _carrito.length > 0;
  const utilidad = Number(t.utilidad) || 0;
  const margenPct = t.total > 0 ? (utilidad / t.total * 100) : 0;
  const colorUtil = utilidad >= 0 ? '#15803d' : '#dc2626';
  const bgUtil = utilidad >= 0 ? '#dcfce7' : '#fef2f2';
  const sinCosto = t.costoTotal === 0 && _carrito.length > 0;
  return `
    <div id="venta-totales" style="padding:14px 24px;border-top:2px dashed #cbd5e1;background:#fafafa">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#475569;margin-bottom:6px">
        <span>Subtotal</span>
        <b style="font-family:'JetBrains Mono',ui-monospace,monospace;color:#0f172a">${money(t.subtotal)}</b>
      </div>
      ${t.impuesto > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#64748b;margin-bottom:6px">
          <span>Impuesto</span>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(t.impuesto)}</b>
        </div>
      ` : ''}
      ${t.descuentoLineas > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#dc2626;margin-bottom:6px">
          <span>Descuento</span>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace">− ${money(t.descuentoLineas)}</b>
        </div>
      ` : ''}
      ${mostrarUtilidad ? `
        <div style="display:flex;justify-content:space-between;align-items:center;background:${bgUtil};border:1px solid ${utilidad >= 0 ? '#bbf7d0' : '#fecaca'};border-radius:8px;padding:8px 12px;margin:8px 0">
          <div>
            <div style="font-size:12.5px;font-weight:700;color:${colorUtil};display:flex;align-items:center;gap:6px">
              Utilidad estimada
            </div>
            ${sinCosto
              ? `<div style="font-size:11px;color:#a16207;margin-top:1px">Define el costo de los productos para un cálculo real</div>`
              : `<div style="font-size:11px;color:#64748b;margin-top:1px">Margen: <b>${margenPct.toFixed(1)}%</b> · Costo: ${money(t.costoTotal)}</div>`
            }
          </div>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace;color:${colorUtil};font-size:16px">${money(utilidad)}</b>
        </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px">
        <span style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">TOTAL</span>
        <span style="font-size:26px;font-weight:800;color:#1d4ed8;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">
          ${money(t.total)}
        </span>
      </div>
    </div>
  `;
}

function htmlBotonCobrar(t) {
  const habilitado = _carrito.length > 0;
  return `
    <div id="venta-btn-cobrar-wrap" style="padding:16px 24px 20px;background:white">
      <button
        id="venta-btn-cobrar"
        ${!habilitado ? 'disabled' : ''}
        style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 22px;background:${habilitado ? '#15803d' : '#cbd5e1'};color:white;border:0;border-radius:12px;cursor:${habilitado ? 'pointer' : 'not-allowed'};font-size:15px;font-weight:600;font-family:inherit;${habilitado ? 'box-shadow:0 4px 12px -2px rgba(21,128,61,.35)' : ''};"
      >
        <i data-lucide="dollar-sign" style="width:18px;height:18px;stroke-width:2.25"></i>
        COBRAR
      </button>
    </div>
  `;
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventosPaso2(contenedor) {
  const inputBuscar = contenedor.querySelector('#venta-buscar');
  if (inputBuscar) {
    setTimeout(() => inputBuscar.focus(), 200);

    inputBuscar.addEventListener('input', (e) => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      const query = e.target.value;

      _debounceTimer = setTimeout(() => {
        // Pistola SIEMPRE activa: si el texto coincide EXACTO con un código
        // de barras (o código, ≥4 chars), es un escaneo → abrir cantidad
        // directo. Si no, se muestra el dropdown para búsqueda manual.
        const exact = tryScannerExact(query);
        if (exact) {
          procesarEscaneo(exact, query, inputBuscar);
          return;
        }
        // Render normal del dropdown
        _resultados = ProductosRepo.filtrarConPrioridad(_productos, query);
        _indiceActivo = _resultados.length > 0 ? 0 : -1;
        renderizarDropdown();
      }, 60);
    });

    inputBuscar.addEventListener('keydown', (e) => {
      // Si el dropdown no está abierto, no manejar nada especial
      if (!_dropdownAbierto && e.key !== 'Escape') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_resultados.length === 0) return;
        _indiceActivo = (_indiceActivo + 1) % Math.min(_resultados.length, 30);
        renderizarDropdown();
        scrollItemActivoAlaVista();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_resultados.length === 0) return;
        const max = Math.min(_resultados.length, 30);
        _indiceActivo = (_indiceActivo - 1 + max) % max;
        renderizarDropdown();
        scrollItemActivoAlaVista();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (_indiceActivo >= 0 && _resultados[_indiceActivo]) {
          const producto = _resultados[_indiceActivo];
          cerrarDropdown();
          inputBuscar.value = '';
          abrirModalCantidad(producto);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (_dropdownAbierto) {
          cerrarDropdown();
        } else {
          inputBuscar.value = '';
          inputBuscar.blur();
        }
      }
    });

    inputBuscar.addEventListener('blur', () => {
      // Cierre con leve delay para permitir click en items del dropdown
      setTimeout(() => cerrarDropdown(), 200);
    });
  }

  // Selector de modo lector (chip pistola/manual)
  contenedor.querySelectorAll('.lm-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modo = btn.dataset.modo;
      if (modo === getLectorMode()) return;
      setLectorMode(modo);
      Toast.ok(modo === 'pistola' ? 'Modo lector USB' : 'Modo manual');
      // Re-renderizar el paso 2 y re-adjuntar solo sus eventos
      const paso2 = contenedor.querySelector('#paso1-cliente-wrap')?.nextElementSibling;
      if (paso2) {
        paso2.outerHTML = htmlPaso2BuscarProducto();
        refrescarIconos(contenedor);
        adjuntarEventosPaso2(contenedor);
      }
    });
  });
}

function adjuntarEventos(contenedor) {
  // Bug fix: remover listener previo antes de agregar uno nuevo para evitar duplicados
  document.removeEventListener('mousedown', cerrarDropdownSiClickFuera);
  document.addEventListener('mousedown', cerrarDropdownSiClickFuera);

  adjuntarEventosPaso2(contenedor);
  adjuntarEventosCarrito(contenedor);

  // Personaliza tu ticket POS 80mm
  const btnPlt = contenedor.querySelector('#venta-btn-personalizar-ticket');
  if (btnPlt) btnPlt.onclick = () => EditorPlantilla.abrir('venta');
}

function cerrarDropdownSiClickFuera(e) {
  if (!_dropdownAbierto || !_contenedor) return;
  const lista = _contenedor.querySelector('#prodSearchList');
  const input = _contenedor.querySelector('#venta-buscar');
  if (!lista || !input) return;
  if (!lista.contains(e.target) && e.target !== input) {
    cerrarDropdown();
  }
}

function scrollItemActivoAlaVista() {
  if (!_contenedor) return;
  const lista = _contenedor.querySelector('#prodSearchList');
  const activo = lista?.querySelector('.ac-item.active');
  if (activo) {
    activo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function adjuntarEventosCarrito(contenedor) {
  contenedor.querySelectorAll('.btn-editar-linea').forEach((btn) => {
    btn.addEventListener('click', () => editarLineaCarrito(parseInt(btn.dataset.idx, 10)));
  });
  contenedor.querySelectorAll('.btn-remover-item').forEach((btn) => {
    btn.addEventListener('click', () => removerDelCarrito(parseInt(btn.dataset.idx, 10)));
  });

  // Botón Vaciar carrito
  const btnVaciar = contenedor.querySelector('#venta-btn-vaciar');
  if (btnVaciar) {
    btnVaciar.onclick = () => vaciarCarrito();
  }

  // Botón cliente (sin cliente seleccionado)
  const btnCliente = contenedor.querySelector('#venta-btn-cliente');
  if (btnCliente) {
    btnCliente.onclick = () => abrirSelectorCliente();
  }

  // Botón cambiar cliente (con cliente seleccionado)
  const btnCambiarCli = contenedor.querySelector('#venta-btn-cambiar-cliente');
  if (btnCambiarCli) {
    btnCambiarCli.onclick = () => abrirSelectorCliente();
  }

  // Botón quitar cliente (X)
  const btnQuitarCli = contenedor.querySelector('#venta-btn-quitar-cliente');
  if (btnQuitarCli) {
    btnQuitarCli.onclick = (e) => {
      e.stopPropagation();
      seleccionarCliente(null);
    };
  }

  const btnCobrar = contenedor.querySelector('#venta-btn-cobrar');
  if (btnCobrar) {
    btnCobrar.onclick = () => abrirModalCobro();
  }
}

// ============================================================
//  LECTOR USB (réplica fiel del legacy)
// ============================================================

/**
 * Modo del lector USB persistido en localStorage.
 * Valores: 'pistola' | 'manual' (default).
 * Default Manual: la Pistola es opt-in para evitar que digitar codigos
 * cortos (142, 234...) los agregue solos al carrito.
 */
const LECTOR_KEY = 'pospunto:lector';
// Codigos de barras EAN/UPC son siempre largos (>= 8 chars). Asi
// la Pistola solo dispara con queries que parezcan barcode real
// y nunca con codigos internos cortos digitados a mano.
const PISTOLA_MIN_CHARS = 4;

function getLectorMode() {
  try {
    const v = localStorage.getItem(LECTOR_KEY);
    return v === 'pistola' ? 'pistola' : 'manual';
  } catch {
    return 'manual';
  }
}

function setLectorMode(modo) {
  try {
    localStorage.setItem(LECTOR_KEY, modo === 'pistola' ? 'pistola' : 'manual');
  } catch {}
}

/**
 * Match EXACTO en barras o código (replica `tryScannerExact` del legacy).
 *
 * - Requiere query.length >= PISTOLA_MIN_CHARS (4) para evitar que
 *   digitar codigos cortos a mano (142, 234, 567...) los agregue
 *   solos al carrito.
 * - Prioriza `barras` (escáner físico) antes que `codigo`.
 * - Trim + case-insensitive.
 */
function tryScannerExact(query) {
  const qn = (query || '').trim().toLowerCase();
  if (qn.length < PISTOLA_MIN_CHARS) return null;
  // Barras primero
  let p = _productos.find(x => String(x.barras || '').trim().toLowerCase() === qn);
  if (p) return p;
  // Después código
  p = _productos.find(x => String(x.codigo || '').trim().toLowerCase() === qn);
  return p || null;
}

/**
 * Procesa un escaneo del lector USB:
 *   - Anti-doble lectura (mismo código en < 1800ms se ignora)
 *   - Agrega directo al carrito (cantidad 1, sin modal)
 *   - Limpia el input y devuelve el foco
 */
function procesarEscaneo(producto, codigoOriginal, inputBuscar) {
  const code = String(codigoOriginal || '').trim();
  const now = Date.now();

  // Anti-dobles lecturas (réplica legacy)
  if (code === _scanLast.code && (now - _scanLast.t) < 1800) {
    inputBuscar.value = '';
    cerrarDropdown();
    inputBuscar.focus();
    return;
  }
  _scanLast = { code, t: now };

  inputBuscar.value = '';
  cerrarDropdown();

  // Abrir el modal de cantidad. Al cerrarse, su onClose devuelve el foco
  // al buscador para poder seguir escaneando.
  abrirModalCantidad(producto);
}

/**
 * Agrega un producto directo al carrito (sin abrir modal).
 * Usado por el lector USB. Permite sobreventa (stock negativo) como el legacy.
 */
function addToCartDirecto(producto, cantidad = 1) {
  if (!producto) return;
  agregarAlCarritoConCantidad(producto, Math.max(1, cantidad));
}

// ============================================================
//  MODAL DE CANTIDAD / EDITAR LÍNEA (estilo legacy fielmente)
// ============================================================

const QUICK_QTYS = [1, 2, 3, 5, 6, 10, 12, 24];

function abrirModalCantidad(producto) {
  abrirModalLinea(producto, null);
}

function editarLineaCarrito(idx) {
  const linea = _carrito[idx];
  if (!linea) return;
  abrirModalLinea(null, linea);
}

/**
 * Modal unificado para Agregar producto / Editar línea.
 *
 * @param {Object|null} producto - Producto a agregar (null si es edición)
 * @param {Object|null} linea    - Línea existente del carrito (null si es nuevo)
 */
function abrirModalLinea(producto, linea) {
  const esEdicion = !!linea;
  const base = producto || linea;
  if (!base) return;

  // Valores iniciales — precio: si hay cliente con precio especial, usarlo
  const cantIni = esEdicion ? Number(linea.cantidad) : 1;
  const precioStd = Number(producto?.precio) || 0;
  const precioCliente = !esEdicion && producto ? ClientesRepo.getPrecioPara(_cliente, producto) : precioStd;
  const precioIni = esEdicion ? Number(linea.precio) : precioCliente;
  const descIni = esEdicion ? Number(linea.descuento || 0) : 0;
  const tienePE = !esEdicion && producto && ClientesRepo.tienePrecioEspecial(_cliente, producto);

  // Para "agregar": mostrar stock disponible
  const stockReal = esEdicion ? null : (Number(producto.stock) || 0);

  const titulo = esEdicion ? 'Editar línea' : 'Agregar producto';
  const textoBoton = esEdicion ? 'Guardar' : '＋ Agregar al borrador';

  const html = `
    <div>
      <div style="font-weight:700;font-size:17px;color:#0f172a">${esc(base.nombre)}</div>
      <div style="color:#64748b;font-size:12.5px;margin-top:2px;margin-bottom:${tienePE ? '8' : '14'}px;font-family:'JetBrains Mono',ui-monospace,monospace">
        ${esc(base.codigo || '')}${stockReal != null ? ` · Stock: <b style="color:#0f172a">${fmt(stockReal)}</b>` : ''}
      </div>
      ${tienePE ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:7px 10px;margin-bottom:14px;font-size:12.5px;color:#1d4ed8;font-weight:600">
          Precio especial para <b>${esc(_cliente?.nombre || '')}</b> · Estándar: <span style="text-decoration:line-through;color:#94a3b8">${money(precioStd)}</span>
        </div>
      ` : ''}

      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Cantidad *</div>
      <div style="display:flex;align-items:center;gap:8px">
        <button id="mc-menos" type="button"
          style="width:48px;height:48px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;cursor:pointer;color:#475569;font-size:22px;font-weight:700">−</button>
        <input id="mc-cant" data-miles type="text" inputmode="numeric" value="${cantIni}"
          style="flex:1;padding:11px;border:1.5px solid #2563eb;border-radius:10px;font-size:24px;font-weight:800;font-family:'JetBrains Mono',ui-monospace,monospace;color:#0f172a;outline:none;text-align:center;box-sizing:border-box" />
        <button id="mc-mas" type="button"
          style="width:48px;height:48px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;cursor:pointer;color:#475569;font-size:22px;font-weight:700">+</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        ${QUICK_QTYS.map((n) => `
          <button class="mc-chip" type="button" data-q="${n}"
            style="padding:6px 14px;border:1px solid #e2e8f0;background:white;border-radius:999px;cursor:pointer;font-size:13.5px;font-weight:600;color:#475569;font-family:inherit">${n}</button>
        `).join('')}
      </div>

      <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:14px">
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Precio unitario</div>
          <input id="mc-precio" data-miles type="text" inputmode="numeric" value="${precioIni}"
            style="width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:17px;font-weight:600;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box" />
        </div>
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Descuento c/u</div>
          <input id="mc-desc" data-miles type="text" inputmode="numeric" value="${descIni || ''}" placeholder="0"
            style="width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:17px;font-weight:600;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box" />
        </div>
      </div>

      <div id="mc-sub" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;font-size:18px;font-weight:800;color:#0f172a;margin-top:14px"></div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button id="mc-cancelar" type="button"
          style="flex:1;padding:12px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="mc-aceptar" type="button"
          style="flex:1.4;padding:12px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">${textoBoton}</button>
      </div>
    </div>
  `;

  const modal = Modal.abrir({
    titulo,
    contenido: html,
    ancho: 'md',
    cerrarAlClicarFondo: true,
    mostrarBotonCerrar: false,
    onClose: () => {
      setTimeout(() => {
        const inp = _contenedor?.querySelector('#venta-buscar');
        if (inp) inp.focus();
      }, 100);
    },
  });

  const body = modal.body;
  bindMilesInputs(body);
  const inpCant = body.querySelector('#mc-cant');
  const inpPrecio = body.querySelector('#mc-precio');
  const inpDesc = body.querySelector('#mc-desc');
  const subBox = body.querySelector('#mc-sub');

  const actualizarSubtotal = () => {
    const c = num(inpCant.value);
    const p = num(inpPrecio.value);
    const d = num(inpDesc.value);
    if (c > 0) {
      const total = Math.max(0, p - d) * c;
      subBox.innerHTML = `Subtotal: <span style="color:#1d4ed8;font-family:'JetBrains Mono',ui-monospace,monospace">${money(total)}</span>`;
    } else {
      subBox.innerHTML = `<span style="color:#94a3b8;font-size:14px;font-weight:500">Escribe la cantidad para continuar</span>`;
    }
  };

  inpCant.addEventListener('input', actualizarSubtotal);
  inpPrecio.addEventListener('input', actualizarSubtotal);
  inpDesc.addEventListener('input', actualizarSubtotal);

  body.querySelector('#mc-menos').addEventListener('click', () => {
    inpCant.value = Math.max(0, (num(inpCant.value) || 0) - 1);
    actualizarSubtotal();
  });
  body.querySelector('#mc-mas').addEventListener('click', () => {
    inpCant.value = (num(inpCant.value) || 0) + 1;
    actualizarSubtotal();
  });

  body.querySelectorAll('.mc-chip').forEach((b) => {
    b.addEventListener('click', () => {
      inpCant.value = Number(b.dataset.q);
      actualizarSubtotal();
      inpCant.focus();
    });
  });

  inpCant.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); body.querySelector('#mc-aceptar').click(); }
  });
  inpPrecio.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); body.querySelector('#mc-aceptar').click(); }
  });
  inpDesc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); body.querySelector('#mc-aceptar').click(); }
  });

  body.querySelector('#mc-cancelar').addEventListener('click', () => modal.cerrar());
  body.querySelector('#mc-aceptar').addEventListener('click', () => {
    const cantidad = num(inpCant.value);
    if (cantidad <= 0) {
      Toast.warn('Escribe la cantidad');
      inpCant.focus();
      return;
    }
    const precio = num(inpPrecio.value);
    const descuento = num(inpDesc.value);

    if (esEdicion) {
      linea.cantidad = cantidad;
      linea.precio = precio;
      linea.descuento = descuento;
      renderizarCarrito();
    } else {
      agregarAlCarritoConCantidad(producto, cantidad, { precio, descuento });
    }
    modal.cerrar();
  });

  actualizarSubtotal();
  setTimeout(() => { inpCant.focus(); try { inpCant.select(); } catch (e) { /**/ } }, 200);
}

// ============================================================
//  SELECTOR DE CLIENTE
// ============================================================

/**
 * Filtra clientes por query (nombre, documento, telefono, email).
 * Prioriza: documento exacto > documento startsWith > nombre startsWith > resto.
 */
function filtrarClientes(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return _clientes.slice().sort((a, b) =>
    String(a.nombre || '').localeCompare(String(b.nombre || ''))
  );

  const out = [];
  for (const c of _clientes) {
    const nom = String(c.nombre || '').toLowerCase();
    const doc = String(c.documento || '').toLowerCase();
    const tel = String(c.telefono || '').toLowerCase();
    const mail = String(c.email || '').toLowerCase();

    let prio = -1;
    if (doc === q) prio = 0;
    else if (doc && doc.startsWith(q)) prio = 1;
    else if (nom.startsWith(q)) prio = 2;
    else if (tel && tel.startsWith(q)) prio = 3;
    else if (doc.includes(q)) prio = 4;
    else if (nom.includes(q)) prio = 5;
    else if (tel.includes(q)) prio = 6;
    else if (mail.includes(q)) prio = 7;

    if (prio >= 0) out.push({ c, prio });
  }
  out.sort((a, b) => a.prio - b.prio);
  return out.map(o => o.c);
}

function abrirSelectorCliente() {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlSelectorCliente();

  const modal = Modal.abrir({
    titulo: '',
    ancho: 'md',
    contenido: wrapper,
    cerrarAlClicarFondo: true,
    mostrarBotonCerrar: false,
    onClose: () => {
      setTimeout(() => {
        const inp = _contenedor?.querySelector('#venta-buscar');
        if (inp) inp.focus();
      }, 100);
    },
  });

  refrescarIconos(wrapper);
  montarVistaSelectorCliente(wrapper, modal);
}

function htmlSelectorCliente() {
  return `
    <div style="padding:4px">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:42px;height:42px;border-radius:10px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i data-lucide="users" style="width:22px;height:22px;stroke-width:1.75"></i>
        </div>
        <div>
          <h3 style="font-size:18px;font-weight:800;margin:0 0 2px;color:#0f172a;letter-spacing:-0.01em">
            Seleccionar cliente
          </h3>
          <div style="font-size:12.5px;color:#64748b">Buscá por nombre, documento, teléfono o email</div>
        </div>
      </div>

      <!-- Input -->
      <input
        id="sc-input"
        type="text"
        class="sc-input"
        placeholder="Empezá a escribir…"
        autocomplete="off"
      />

      <!-- Botón "Sin cliente" -->
      <button
        id="sc-sin"
        type="button"
        style="display:flex;align-items:center;gap:10px;width:100%;margin-top:10px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;cursor:pointer;font-family:inherit;color:#475569;text-align:left;font-size:13.5px"
      >
        <i data-lucide="user-x" style="width:18px;height:18px;color:#94a3b8"></i>
        <span><strong>Sin cliente</strong> · venta ocasional</span>
      </button>

      <!-- Lista de clientes -->
      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin:14px 0 6px">
        ${_clientes.length} cliente${_clientes.length === 1 ? '' : 's'} en la base
      </div>
      <div id="sc-lista" style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin:0 -2px;padding:0 2px"></div>

      <!-- Footer: crear nuevo + cancelar -->
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0">
        <button
          id="sc-nuevo"
          type="button"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px rgba(37, 99, 235,.4)"
        >
          <i data-lucide="user-plus" style="width:16px;height:16px;stroke-width:2.25"></i>
          Crear nuevo cliente
        </button>
        <button
          id="sc-cancelar"
          type="button"
          style="padding:10px 16px;background:white;border:1px solid #cbd5e1;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:500;font-family:inherit;color:#475569"
        >Cancelar</button>
      </div>
    </div>
  `;
}

function montarVistaSelectorCliente(wrapper, modal) {
  const inp = wrapper.querySelector('#sc-input');
  const btnSin = wrapper.querySelector('#sc-sin');
  const btnNuevo = wrapper.querySelector('#sc-nuevo');
  const btnCancelar = wrapper.querySelector('#sc-cancelar');
  const lista = wrapper.querySelector('#sc-lista');

  let _indice = 0;

  function renderLista(query) {
    const cli = filtrarClientes(query);
    if (cli.length === 0) {
      lista.innerHTML = `
        <div style="padding:18px;text-align:center;color:#94a3b8;font-size:13.5px">
          ${query ? 'Sin coincidencias 🐾' : 'Todavía no hay clientes cargados'}
        </div>
      `;
      return cli;
    }
    lista.innerHTML = cli.slice(0, 50).map((c, i) => htmlSelectorClienteItem(c, i === _indice, query)).join('');
    // adjuntar eventos
    lista.querySelectorAll('.sc-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const c = _clientes.find(x => x.id === id);
        if (c) {
          seleccionarCliente(c);
          modal.cerrar();
        }
      });
    });
    return cli;
  }

  let _vis = renderLista('');

  inp.addEventListener('input', (e) => {
    _indice = 0;
    _vis = renderLista(e.target.value);
  });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_vis.length === 0) return;
      _indice = Math.min(_vis.length - 1, _indice + 1);
      _vis = renderLista(inp.value);
      const el = lista.querySelector('.sc-item.active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_vis.length === 0) return;
      _indice = Math.max(0, _indice - 1);
      _vis = renderLista(inp.value);
      const el = lista.querySelector('.sc-item.active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_vis[_indice]) {
        seleccionarCliente(_vis[_indice]);
        modal.cerrar();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      modal.cerrar();
    }
  });

  btnSin.addEventListener('click', () => {
    seleccionarCliente(null);
    modal.cerrar();
  });

  btnCancelar.addEventListener('click', () => modal.cerrar());

  btnNuevo.addEventListener('click', () => {
    // Reemplazar contenido por el form de creación
    const nombrePrellenado = inp.value.trim();
    wrapper.innerHTML = htmlFormNuevoCliente(nombrePrellenado);
    refrescarIconos(wrapper);
    montarFormNuevoCliente(wrapper, modal);
  });

  setTimeout(() => inp.focus(), 250);
}

function htmlSelectorClienteItem(c, active, query) {
  const q = (query || '').toLowerCase();
  const inicial = String(c.nombre || '?').trim().charAt(0).toUpperCase() || '?';
  const partes = [];
  if (c.documento) partes.push(hl(c.documento, q));
  if (c.telefono) partes.push(hl(c.telefono, q));
  if (c.email) partes.push(hl(c.email, q));

  return `
    <div class="sc-item ${active ? 'active' : ''}" data-id="${esc(c.id)}" role="option">
      <div class="sc-avatar">${esc(inicial)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;color:#0f172a;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${hl(c.nombre, q)}
        </div>
        ${partes.length > 0 ? `
          <div style="font-size:12px;color:#64748b;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap">
            ${partes.map(p => `<span>${p}</span>`).join('<span style="color:#cbd5e1">·</span>')}
          </div>
        ` : ''}
      </div>
      <i data-lucide="chevron-right" style="width:16px;height:16px;color:#cbd5e1;flex-shrink:0"></i>
    </div>
  `;
}

// ============================================================
//  FORM INLINE — CREAR NUEVO CLIENTE
// ============================================================

function htmlFormNuevoCliente(nombrePrellenado) {
  return `
    <div style="padding:4px">
      <!-- Header con back -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button
          id="fc-back"
          type="button"
          title="Volver al selector"
          style="background:#f1f5f9;border:0;border-radius:8px;width:32px;height:32px;cursor:pointer;color:#475569;display:flex;align-items:center;justify-content:center;flex-shrink:0"
        >
          <i data-lucide="arrow-left" style="width:16px;height:16px"></i>
        </button>
        <div style="width:42px;height:42px;border-radius:10px;background:#dcfce7;color:#15803d;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i data-lucide="user-plus" style="width:22px;height:22px;stroke-width:1.75"></i>
        </div>
        <div>
          <h3 style="font-size:18px;font-weight:800;margin:0 0 2px;color:#0f172a;letter-spacing:-0.01em">
            Nuevo cliente
          </h3>
          <div style="font-size:12.5px;color:#64748b">Lo creamos y lo seleccionamos al toque</div>
        </div>
      </div>

      <!-- Form -->
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:4px">Nombre *</label>
          <input id="fc-nombre" type="text" class="sc-input" value="${esc(nombrePrellenado)}" placeholder="Ej: Juan Pérez" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:4px">Documento</label>
            <input id="fc-documento" type="text" class="sc-input" placeholder="CC / NIT" />
          </div>
          <div>
            <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:4px">Teléfono</label>
            <input id="fc-telefono" type="text" class="sc-input" placeholder="+57 …" />
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:4px">Email</label>
          <input id="fc-email" type="email" class="sc-input" placeholder="ejemplo@email.com" />
        </div>
        <div>
          <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:4px">Dirección</label>
          <input id="fc-direccion" type="text" class="sc-input" placeholder="Opcional" />
        </div>
      </div>

      <div id="fc-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;color:#991b1b;font-size:13px;margin-top:12px"></div>

      <!-- Footer -->
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0">
        <button
          id="fc-cancelar"
          type="button"
          style="padding:10px 16px;background:white;border:1px solid #cbd5e1;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:500;font-family:inherit;color:#475569"
        >Cancelar</button>
        <button
          id="fc-guardar"
          type="button"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#15803d;color:white;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px rgba(21,128,61,.4)"
        >
          <i data-lucide="check" style="width:16px;height:16px;stroke-width:2.5"></i>
          Guardar y seleccionar
        </button>
      </div>
    </div>
  `;
}

function montarFormNuevoCliente(wrapper, modal) {
  const inpNombre = wrapper.querySelector('#fc-nombre');
  const inpDoc = wrapper.querySelector('#fc-documento');
  const inpTel = wrapper.querySelector('#fc-telefono');
  const inpMail = wrapper.querySelector('#fc-email');
  const inpDir = wrapper.querySelector('#fc-direccion');
  const errBox = wrapper.querySelector('#fc-error');
  const btnBack = wrapper.querySelector('#fc-back');
  const btnCancelar = wrapper.querySelector('#fc-cancelar');
  const btnGuardar = wrapper.querySelector('#fc-guardar');

  function volverAlSelector() {
    wrapper.innerHTML = htmlSelectorCliente();
    refrescarIconos(wrapper);
    montarVistaSelectorCliente(wrapper, modal);
  }

  btnBack.addEventListener('click', volverAlSelector);
  btnCancelar.addEventListener('click', () => modal.cerrar());

  async function guardar() {
    errBox.style.display = 'none';
    const nombre = inpNombre.value.trim();
    if (!nombre) {
      errBox.style.display = 'block';
      errBox.textContent = 'El nombre es obligatorio';
      inpNombre.focus();
      return;
    }

    const email = inpMail.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errBox.style.display = 'block';
      errBox.textContent = 'El email no es válido';
      inpMail.focus();
      return;
    }

    btnGuardar.disabled = true;
    btnGuardar.innerHTML = `<i data-lucide="loader" style="width:16px;height:16px"></i> Guardando…`;
    refrescarIconos(wrapper);

    const nuevo = {
      id: uid(),
      nombre,
      documento: inpDoc.value.trim(),
      telefono: inpTel.value.trim(),
      email,
      direccion: inpDir.value.trim(),
    };

    try {
      const guardado = await ClientesRepo.guardar(nuevo);
      const clienteFinal = guardado || nuevo;

      // Agregar a la lista local
      _clientes.push(clienteFinal);

      // Seleccionarlo
      seleccionarCliente(clienteFinal);
      modal.cerrar();
      Toast.ok(`Cliente "${clienteFinal.nombre}" creado`);
    } catch (err) {
      console.error('Error guardando cliente:', err);
      errBox.style.display = 'block';
      errBox.textContent = 'No se pudo guardar. Intentá de nuevo.';
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = `<i data-lucide="check" style="width:16px;height:16px;stroke-width:2.5"></i> Guardar y seleccionar`;
      refrescarIconos(wrapper);
    }
  }

  btnGuardar.addEventListener('click', guardar);

  // Enter en cualquier input dispara guardar
  [inpNombre, inpDoc, inpTel, inpMail, inpDir].forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        guardar();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        volverAlSelector();
      }
    });
  });

  setTimeout(() => {
    if (inpNombre.value) {
      inpDoc.focus(); // si el nombre ya viene pre-llenado, focus en doc
    } else {
      inpNombre.focus();
    }
  }, 250);
}

// ============================================================
//  ACCIONES SOBRE EL CLIENTE
// ============================================================

function seleccionarCliente(cliente) {
  _cliente = cliente || null;
  // Re-aplicar precios especiales al carrito existente
  if (_carrito.length > 0) {
    let cambios = 0;
    for (const it of _carrito) {
      const prod = _productos.find((p) => p.id === it.producto_id);
      if (!prod) continue;
      const precioNuevo = ClientesRepo.getPrecioPara(_cliente, prod);
      if (Math.round(precioNuevo) !== Math.round(it.precio)) {
        it.precio = precioNuevo;
        cambios++;
      }
    }
    if (cambios > 0) renderizarCarrito();
  }
  renderizarPaso1();
  if (cliente) {
    Toast.ok(`Cliente: ${cliente.nombre}`);
  }
}

// ============================================================
//  LÓGICA DEL CARRITO
// ============================================================

function agregarAlCarritoConCantidad(producto, cantidad, opciones = {}) {
  if (!producto || !cantidad || cantidad < 1) return;

  const precio = opciones.precio != null ? Number(opciones.precio) : (Number(producto.precio) || 0);
  const descuento = opciones.descuento != null ? Number(opciones.descuento) : 0;

  const existente = _carrito.find(it => it.producto_id === producto.id);
  if (existente) {
    existente.cantidad += cantidad;
    if (opciones.precio != null) existente.precio = precio;
    if (opciones.descuento != null) existente.descuento = descuento;
  } else {
    _carrito.push({
      id: uid(),
      producto_id: producto.id,
      codigo: producto.codigo || '',
      nombre: producto.nombre,
      descuento,
      costo: Number(producto.costo) || 0,
      precio,
      cantidad: cantidad,
      impuesto_pct: Number(producto.impuesto_pct) || 0,
      stock_disponible: Number(producto.stock) || 0,
    });
  }
  renderizarCarrito();
  Toast.ok(`${cantidad} × ${producto.nombre}`);
}

function removerDelCarrito(idx) {
  if (idx < 0 || idx >= _carrito.length) return;
  _carrito.splice(idx, 1);
  renderizarCarrito();
}

async function vaciarCarrito() {
  if (_carrito.length === 0) return;
  const ok = await Confirm.peligro('¿Vaciar el borrador de la factura?', {
    titulo: 'Vaciar carrito',
    textoConfirmar: 'Sí, vaciar',
  });
  if (!ok) return;
  _carrito = [];
  _cliente = null;
  _descuento = 0;
  renderizarCarrito();
  renderizarPaso1();
}

// ============================================================
//  MODAL DE COBRO (réplica fiel del legacy)
// ============================================================

const METODOS_PAGO = [
  { id: 'efectivo',      label: 'Efectivo' },
  { id: 'transferencia', label: 'Transfer.' },
  { id: 'qr',            label: 'QR' },
  { id: 'tarjeta',       label: 'Tarjeta' },
  { id: 'mixto',         label: 'Mixto' },
  { id: 'credito',       label: 'Crédito' },
];

const METODOS_LABEL = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  qr: 'QR',
  tarjeta: 'Tarjeta',
};

function abrirModalCobro() {
  if (_carrito.length === 0) {
    Toast.warn('El carrito está vacío');
    return;
  }

  // Reset del estado del modal
  _payments = { efectivo: 0, transferencia: 0, qr: 0, tarjeta: 0 };
  _payMode = 'simple';
  _payMethod = 'efectivo';

  const totales = Repo.calcularTotales(_carrito, _descuento);

  const contenido = `
    <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:stretch">

      <!-- COLUMNA IZQUIERDA: total + métodos de pago -->
      <div>
        <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:6px;text-align:center">Total a pagar</div>
        <div style="background:#eff6ff;border-radius:12px;padding:20px 12px;margin-bottom:16px;text-align:center">
          <div style="font-size:28px;font-weight:800;color:#1d4ed8;letter-spacing:-0.025em">
            ${money(totales.total)}
          </div>
        </div>

        <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:8px">
          Método de pago
        </div>
        <div id="cobro-chips" style="display:flex;flex-direction:column;gap:7px">
          ${METODOS_PAGO.map(m => `
            <button
              class="pm-chip"
              data-pm="${m.id}"
              style="padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;background:white;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569;text-align:left"
            >${m.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- COLUMNA DERECHA: detalle del pago -->
      <div style="border-left:1px solid #e2e8f0;padding-left:24px;min-width:0;display:flex;flex-direction:column">
        <div id="cobro-area" style="flex:1"></div>
      </div>
    </div>

    <!-- BOTONES (ancho completo, abajo) -->
    <div style="display:flex;gap:10px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px">
      <button
        id="cobro-btn-cancelar"
        style="flex:1;padding:13px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569"
      >Cancelar</button>
      <button
        id="cobro-btn-confirmar"
        style="flex:1.4;padding:13px;border:0;background:#15803d;color:white;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)"
      >Confirmar</button>
    </div>
  `;

  _cobroModal = Modal.abrir({
    titulo: 'Cobrar venta',
    contenido,
    ancho: 'lg',
    onClose: () => { _cobroModal = null; },
  });

  // Cablear eventos dentro del modal
  const body = _cobroModal.body;

  body.querySelectorAll('.pm-chip').forEach((btn) => {
    btn.addEventListener('click', () => seleccionarMetodoPago(btn.dataset.pm));
  });

  body.querySelector('#cobro-btn-cancelar').onclick = () => _cobroModal?.cerrar();
  body.querySelector('#cobro-btn-confirmar').onclick = () => confirmarVenta();

  // Activar método por defecto
  seleccionarMetodoPago('efectivo');
}

function seleccionarMetodoPago(metodo) {
  if (!_cobroModal) return;
  const body = _cobroModal.body;
  const totales = Repo.calcularTotales(_carrito, _descuento);

  // Marcar visualmente el chip activo
  body.querySelectorAll('.pm-chip').forEach((btn) => {
    const activo = btn.dataset.pm === metodo;
    btn.style.background = activo ? '#2563eb' : 'white';
    btn.style.color = activo ? 'white' : '#475569';
    btn.style.borderColor = activo ? '#2563eb' : '#e2e8f0';
  });

  const area = body.querySelector('#cobro-area');
  if (!area) return;

  if (metodo === 'credito') {
    _payMode = 'credito';
    const vd = new Date(); vd.setDate(vd.getDate() + 30);
    const venceDef = vd.toISOString().slice(0, 10);
    const hayCliente = !!(_cliente && _cliente.id);
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${hayCliente
          ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:11px 13px;font-size:13px;color:#1d4ed8"><b>${esc(_cliente.nombre)}</b> queda debiendo esta venta.</div>`
          : `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:11px 13px;font-size:13px;color:#991b1b">Para vender a crédito primero <b>selecciona un cliente</b> (no "Cliente ocasional").</div>`}
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Abono inicial (opcional)</div>
          <input id="cobro-cred-abono" data-miles type="text" inputmode="numeric" placeholder="0"
            style="width:100%;padding:12px 14px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:18px;font-weight:700;outline:none;box-sizing:border-box;font-family:inherit;text-align:right" />
        </div>
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha de vencimiento</div>
          <input id="cobro-cred-vence" type="date" value="${venceDef}"
            style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
        <div id="cobro-cred-saldo" style="font-size:13px;color:#64748b">Quedará a crédito: <b style="color:#a16207">${money(totales.total)}</b></div>
      </div>
    `;
    bindMilesInputs(area);
    const inpAb = area.querySelector('#cobro-cred-abono');
    const saldoBox = area.querySelector('#cobro-cred-saldo');
    inpAb.addEventListener('input', () => {
      const ab = Math.min(num(inpAb.value), totales.total);
      saldoBox.innerHTML = `Quedará a crédito: <b style="color:#a16207">${money(Math.max(0, totales.total - ab))}</b>`;
    });
    return;
  }

  if (metodo === 'mixto') {
    _payMode = 'mixto';
    area.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${[
          ['efectivo',      'Efectivo'],
          ['transferencia', 'Transferencia'],
          ['qr',            'QR'],
          ['tarjeta',       'Tarjeta'],
        ].map(([k, label]) => `
          <div style="display:flex;align-items:center;gap:10px">
            <span style="flex:1;font-weight:600;font-size:13.5px;color:#475569">${label}</span>
            <input
              class="cobro-mixto-input"
              data-key="${k}"
              data-miles
              type="text"
              inputmode="numeric"
              placeholder="0"
              value="${_payments[k] || ''}"
              style="width:150px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14.5px;font-weight:600;text-align:right;outline:none;font-family:inherit"
            />
          </div>
        `).join('')}
        <div id="cobro-mixto-info" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:4px"></div>
      </div>
    `;

    bindMilesInputs(area);
    area.querySelectorAll('.cobro-mixto-input').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        _payments[inp.dataset.key] = num(e.target.value);
        actualizarMixto();
      });
    });
    actualizarMixto();
  } else {
    _payMode = 'simple';
    _payMethod = metodo;

    if (metodo === 'efectivo') {
      area.innerHTML = `
        <div style="font-size:13.5px;color:#475569;font-weight:600;margin-bottom:8px">¿Con cuánto paga el cliente?</div>
        <input
          id="cobro-recibido"
          data-miles
          type="text"
          inputmode="numeric"
          placeholder="Ej: 50.000"
          style="width:100%;padding:14px 16px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:19px;outline:none;box-sizing:border-box;font-weight:700;font-family:inherit"
        />
        <button
          id="cobro-btn-exacto"
          style="width:100%;margin-top:10px;padding:13px;border:2px solid #2563eb;background:#eff6ff;color:#1d4ed8;border-radius:10px;cursor:pointer;font-size:14.5px;font-weight:700;font-family:inherit"
        >Exacto · ${money(totales.total)}</button>
        <div
          id="cobro-cambio-box"
          style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:15px;text-align:center;font-size:14px;margin-top:12px"
        ><b>Cambio:</b> ${money(0)}</div>
      `;

      bindMilesInputs(area);
      const inpRec = area.querySelector('#cobro-recibido');
      inpRec.addEventListener('input', () => actualizarCambio());
      area.querySelector('#cobro-btn-exacto').onclick = () => {
        inpRec.value = fmt(totales.total);
        actualizarCambio();
      };
      setTimeout(() => inpRec.focus(), 60);
    } else {
      area.innerHTML = `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;font-size:14px;color:#475569">
          Pago por <b>${metodo === 'qr' ? 'código QR' : METODOS_LABEL[metodo]}</b>
          por <b>${money(totales.total)}</b><br>
          <span style="color:#94a3b8;font-size:13px">Confirmá cuando recibas el pago.</span>
        </div>
      `;
    }
  }
}

function actualizarCambio() {
  if (!_cobroModal) return;
  const inp = _cobroModal.body.querySelector('#cobro-recibido');
  const box = _cobroModal.body.querySelector('#cobro-cambio-box');
  if (!inp || !box) return;

  const totales = Repo.calcularTotales(_carrito, _descuento);
  const recibido = num(inp.value);
  const cambio = recibido - totales.total;
  const color = cambio >= 0 ? '#15803d' : '#dc2626';

  box.innerHTML = `
    <b>Cambio:</b>
    <span style="font-size:20px;font-weight:800;color:${color};letter-spacing:-0.02em">
      ${money(Math.max(0, cambio))}
    </span>
    ${cambio < 0 ? `<div style="color:#dc2626;font-weight:700;margin-top:4px">Faltan ${money(-cambio)}</div>` : ''}
  `;
}

function actualizarMixto() {
  if (!_cobroModal) return;
  const info = _cobroModal.body.querySelector('#cobro-mixto-info');
  if (!info) return;

  const totales = Repo.calcularTotales(_carrito, _descuento);
  const sum = _payments.efectivo + _payments.transferencia + _payments.qr + _payments.tarjeta;
  const falta = totales.total - sum;
  const negativo = falta > 0;

  info.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>Recibido</span>
      <b>${money(sum)}</b>
    </div>
    <div style="display:flex;justify-content:space-between;color:${negativo ? '#dc2626' : '#15803d'}">
      <span>${negativo ? 'Falta' : 'Cambio/Sobra'}</span>
      <b>${money(Math.abs(falta))}</b>
    </div>
  `;
}

async function confirmarVenta() {
  const totales = Repo.calcularTotales(_carrito, _descuento);
  let metodo = '';
  let recibido = 0;
  let cambio = 0;
  let tipoPago = 'contado';
  let abonoInicial = 0;
  let vence = '';

  if (_payMode === 'credito') {
    if (!_cliente || !_cliente.id) {
      Toast.warn('Para vender a crédito primero selecciona un cliente');
      return;
    }
    const b = _cobroModal?.body;
    abonoInicial = Math.min(num(b?.querySelector('#cobro-cred-abono')?.value), totales.total);
    vence = b?.querySelector('#cobro-cred-vence')?.value || '';
    tipoPago = 'credito';
    metodo = 'Crédito';
    recibido = abonoInicial;
    cambio = 0;
  } else if (_payMode === 'mixto') {
    const sum = _payments.efectivo + _payments.transferencia + _payments.qr + _payments.tarjeta;
    if (sum < totales.total - 0.5) {
      Toast.warn('El pago mixto no cubre el total');
      return;
    }
    const detalle = Object.entries(_payments)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${METODOS_LABEL[k]}: ${money(v)}`)
      .join(', ');
    metodo = `Mixto (${detalle})`;
    recibido = sum;
    cambio = Math.max(0, sum - totales.total);
  } else {
    metodo = METODOS_LABEL[_payMethod] || 'Efectivo';
    if (_payMethod === 'efectivo') {
      const inp = _cobroModal?.body.querySelector('#cobro-recibido');
      recibido = num(inp?.value);
      if (recibido < totales.total - 0.5) {
        Toast.warn('El efectivo recibido es menor al total');
        return;
      }
      cambio = recibido - totales.total;
    } else {
      recibido = totales.total;
    }
  }

  // Registrar la venta (local + nube + descuento de stock)
  let venta;
  try {
    venta = await Repo.registrar({
      items: _carrito,
      cliente: _cliente,
      metodo_pago: metodo,
      descuento: _descuento,
      tipoPago,
      abonoInicial,
      vence,
      metodoAbono: 'Efectivo',
      data: { recibido, cambio },
    });
  } catch (err) {
    console.error('Error registrando venta:', err);
    Toast.error('No se pudo registrar la venta');
    return;
  }

  _cobroModal?.cerrar();
  Toast.ok(`Venta ${venta.numero} registrada · ${money(venta.total)}`);

  if (cambio > 0) {
    Toast.info(`Cambio: ${money(cambio)}`);
  }

  // Imprimir ticket POS según preferencia de impresora
  try {
    const cfg = await ConfigRepo.leer();
    const plantilla = await PlantillaRepo.leer('venta');
    const preferencia = cfg.impresoraDefault || 'preguntar';

    const tituloPrint = `Factura ${venta.numero || ''}`;
    const lanzarPOS = () => {
      const ticket = facturaHTML(venta, plantilla, cfg);
      imprimirPOS(ticket, { anchoMm: plantilla.anchoMm || 80, titulo: tituloPrint });
    };

    if (preferencia === 'pos') {
      // Preferencia explicita: imprimir directo sin preguntar.
      lanzarPOS();
    } else if (preferencia === 'preguntar') {
      // Preguntar al usuario antes de abrir el dialogo de impresion.
      // Asi no aparece el preview del navegador automaticamente: solo
      // si el usuario lo pide.
      const quiere = await Confirm.preguntar(`¿Desea imprimir el ticket de la venta ${venta.numero}?`, {
        titulo: 'Imprimir ticket',
        textoConfirmar: 'Sí, imprimir',
        textoCancelar: 'No, gracias',
      });
      if (quiere) lanzarPOS();
    }
    // Si preferencia === 'carta', no imprime POS (futura implementación carta)
  } catch (err) {
    console.warn('No se pudo imprimir el ticket:', err);
  }

  // Refrescar productos en memoria (stock actualizado) y resetear carrito
  try {
    _productos = await ProductosRepo.listar();
  } catch (err) {
    console.warn('No se pudo refrescar productos:', err);
  }

  _carrito = [];
  _cliente = null;
  _descuento = 0;
  renderizarCarrito();
  renderizarPaso1();

  // Devolver foco al buscador
  setTimeout(() => {
    _contenedor?.querySelector('#venta-buscar')?.focus();
  }, 100);
}