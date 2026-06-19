/**
 * modules/gastos/gastos.view.js — Vista del módulo Gastos
 *
 * Réplica del renderGastos del legacy con:
 *   - KPIs: Gastos del mes / del año / Mayor categoría del mes
 *   - Filtros: búsqueda + desde/hasta
 *   - Tabla con CRUD (editar / eliminar)
 *   - Formulario en dos modos:
 *       * Normal (concepto + monto + nota)
 *       * Productos (baja de inventario, descuenta stock automáticamente)
 */

import * as Repo from './gastos.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO } from '../../core/dates.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { bindMilesInputs } from '../../core/inputs.js';
import * as Realtime from '../../services/realtime.js';

// ============================================================
//  ESTADO
// ============================================================

let _contenedor = null;
let _gastos = [];
let _offRealtime = null;
let _productos = [];
let _filtro = { q: '', desde: '', hasta: '' };

// Estado temporal del form para baja de productos
let _bajaItems = [];   // [{ producto_id, nombre, codigo, cantidad, costo, motivo }]
let _formModal = null;

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;
  _filtro = { q: '', desde: '', hasta: '' };

  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlCargando();

  try { _gastos = await Repo.listar(); } catch (e) { console.warn(e); _gastos = []; }
  try { _productos = await ProductosRepo.listar(); } catch (e) { console.warn(e); _productos = []; }

  contenedor.innerHTML = htmlLayout(calcularKPIs());
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarLista();

  // Realtime
  _offRealtime = Realtime.escucharVarias(['gastos', 'productos'], async () => {
    try {
      _gastos = await Repo.listar();
      _productos = await ProductosRepo.listar();
      const kpiBox = _contenedor.querySelector('#gasto-kpis');
      if (kpiBox) {
        kpiBox.innerHTML = htmlKPIs(calcularKPIs());
        refrescarIconos(_contenedor);
      }
      pintarLista();
    } catch (err) { console.warn('Realtime gastos:', err); }
  });
}

function calcularKPIs() {
  const hoy = todayISO();
  const mesIni = hoy.slice(0, 8) + '01';
  const anioIni = hoy.slice(0, 4) + '-01-01';

  let mesTotal = 0, mesN = 0;
  let anioTotal = 0, anioN = 0;
  const porCat = {};

  for (const g of _gastos) {
    const d = (g.fecha || '').slice(0, 10);
    const m = Number(g.monto) || 0;
    if (d >= mesIni && d <= hoy) {
      mesTotal += m;
      mesN++;
      const cat = g.categoria || 'Otros';
      porCat[cat] = (porCat[cat] || 0) + m;
    }
    if (d >= anioIni && d <= hoy) {
      anioTotal += m;
      anioN++;
    }
  }

  let topCat = '—', topVal = 0;
  for (const [k, v] of Object.entries(porCat)) {
    if (v > topVal) { topVal = v; topCat = k; }
  }

  return { mesTotal, mesN, anioTotal, anioN, topCat, topVal };
}

function pintarLista() {
  if (!_contenedor) return;
  const box = _contenedor.querySelector('#gasto-lista');
  if (!box) return;

  const visibles = aplicarFiltros(_gastos, _filtro);
  const total = visibles.reduce((s, g) => s + (Number(g.monto) || 0), 0);

  if (visibles.length === 0) {
    box.innerHTML = htmlVacio();
    refrescarIconos(_contenedor);
    return;
  }

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <b style="font-size:15px;color:#0f172a">${fmt(visibles.length)} gasto${visibles.length === 1 ? '' : 's'}</b>
      <span style="background:#fef2f2;color:#dc2626;font-size:13.5px;font-weight:700;padding:7px 13px;border-radius:8px">
        Total: ${money(total)}
      </span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left">
            <th style="padding:10px 12px">Fecha</th>
            <th style="padding:10px 12px">Concepto</th>
            <th style="padding:10px 12px">Categoría</th>
            <th style="padding:10px 12px;text-align:right">Monto</th>
            <th style="padding:10px 12px;width:90px"></th>
          </tr>
        </thead>
        <tbody>
          ${visibles.map((g) => filaGasto(g)).join('')}
        </tbody>
      </table>
    </div>
  `;

  refrescarIconos(_contenedor);
  cablearAcciones(_contenedor);
}

function filaGasto(g) {
  const esProd = g.categoria === 'Productos' && Array.isArray(g.items) && g.items.length;
  const detalleProd = esProd
    ? `<br><span style="color:#94a3b8;font-size:11.5px">${g.items.map((it) => `${esc(it.nombre)} ×${fmt(it.cantidad)} <span style="opacity:.7">(${esc(it.motivo || '—')})</span>`).join(' · ')}</span>`
    : '';

  return `
    <tr style="border-bottom:1px solid #f1f5f9" data-gasto-id="${esc(g.id)}">
      <td style="padding:12px;color:#475569;font-family:inherit;font-size:13px">
        ${esc((g.fecha || '').slice(0, 10))}
      </td>
      <td style="padding:12px;color:#0f172a">
        <b>${esc(g.concepto || '—')}</b>
        ${g.nota ? `<br><span style="color:#64748b;font-size:12.5px">${esc(g.nota)}</span>` : ''}
        ${detalleProd}
      </td>
      <td style="padding:12px">
        <span style="background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px">
          ${Repo.ICONOS[g.categoria] || '📌'} ${esc(g.categoria || 'Otros')}
        </span>
      </td>
      <td style="padding:12px;text-align:right;font-family:inherit;font-weight:700;color:#dc2626">
        ${money(g.monto)}
      </td>
      <td style="padding:12px">
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="gasto-btn-editar" data-id="${esc(g.id)}" title="Editar"
            style="width:32px;height:32px;border:1px solid #fde68a;background:#fef9c3;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
            <i data-lucide="pencil" style="width:15px;height:15px;color:#a16207"></i>
          </button>
          <button class="gasto-btn-borrar" data-id="${esc(g.id)}" title="Eliminar"
            style="width:32px;height:32px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
            <i data-lucide="trash-2" style="width:15px;height:15px;color:#dc2626"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function aplicarFiltros(lista, filtro) {
  let r = [...lista];
  const q = (filtro.q || '').toLowerCase().trim();
  if (q) {
    r = r.filter((g) => {
      const text = [g.concepto, g.categoria, g.nota].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }
  if (filtro.desde) r = r.filter((g) => (g.fecha || '') >= filtro.desde);
  if (filtro.hasta) r = r.filter((g) => (g.fecha || '') <= filtro.hasta);
  return r;
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  const inpQ = contenedor.querySelector('#gasto-q');
  const inpDesde = contenedor.querySelector('#gasto-desde');
  const inpHasta = contenedor.querySelector('#gasto-hasta');
  const btnNuevo = contenedor.querySelector('#gasto-btn-nuevo');

  let debounce;
  inpQ?.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      _filtro.q = e.target.value;
      pintarLista();
    }, 120);
  });
  inpDesde?.addEventListener('change', (e) => { _filtro.desde = e.target.value; pintarLista(); });
  inpHasta?.addEventListener('change', (e) => { _filtro.hasta = e.target.value; pintarLista(); });
  btnNuevo?.addEventListener('click', () => abrirFormGasto());
}

function cablearAcciones(contenedor) {
  contenedor.querySelectorAll('.gasto-btn-editar').forEach((b) => {
    b.onclick = () => abrirFormGasto(b.dataset.id);
  });
  contenedor.querySelectorAll('.gasto-btn-borrar').forEach((b) => {
    b.onclick = () => borrarGasto(b.dataset.id);
  });
}

// ============================================================
//  FORMULARIO
// ============================================================

async function abrirFormGasto(id) {
  const g = id ? _gastos.find((x) => x.id === id) : null;
  _bajaItems = g && Array.isArray(g.items) ? g.items.map((it) => ({ ...it })) : [];

  const datos = g || { fecha: todayISO(), concepto: '', categoria: 'Servicios', monto: 0, nota: '' };

  const contenido = `
    <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
      <div>
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Fecha *</div>
        <input id="g-fecha" type="date" value="${esc(datos.fecha || todayISO())}"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
      <div>
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Categoría</div>
        <select id="g-cat"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
          ${Repo.CATEGORIAS.map((c) => `<option value="${esc(c)}" ${datos.categoria === c ? 'selected' : ''}>${Repo.ICONOS[c] || '📌'} ${c}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="g-normal" style="display:grid;gap:12px;margin-top:14px;grid-template-columns:1fr 1fr">
      <div style="grid-column:1/-1">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Concepto *</div>
        <input id="g-concepto" type="text" value="${esc(datos.concepto || '')}" placeholder="Ej: Energía eléctrica, Sueldo Ana, Arriendo local..."
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
      <div style="grid-column:1/-1">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Monto *</div>
        <input id="g-monto" data-miles type="text" inputmode="numeric" value="${datos.monto || ''}" placeholder="Ej: 120.000"
          style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:8px;font-size:18px;font-weight:700;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
      <div style="grid-column:1/-1">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nota (opcional)</div>
        <input id="g-nota" type="text" value="${esc(datos.nota || '')}" placeholder="Detalle o referencia"
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
    </div>

    <div id="g-productos" style="display:none;margin-top:14px">
      <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:10px;padding:12px">
        <div style="font-weight:700;font-size:13.5px;color:#92400e">Baja de productos del inventario</div>
        <div style="color:#92400e;font-size:12px;margin-top:3px">Selecciona los productos que se dañaron, vencieron o vas a usar internamente. <b>El stock se descontará automáticamente</b> y el costo total se registrará como gasto.</div>
      </div>

      <div style="margin-top:12px">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Buscar producto</div>
        <input id="g-buscar-prod" type="text" placeholder="Nombre, código o barras..." autocomplete="off"
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        <div id="g-resultados" style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto;margin-top:8px"></div>
      </div>

      <div style="margin-top:14px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#0f172a">Productos a dar de baja</div>
        <div id="g-items" style="display:flex;flex-direction:column;gap:8px"></div>
        <div id="g-total" style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:10px"></div>
      </div>

      <div style="margin-top:12px">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nota (opcional)</div>
        <input id="g-nota-p" type="text" value="${esc(datos.nota || '')}" placeholder="Detalle o referencia"
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="g-btn-cancelar"
        style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="g-btn-guardar"
        style="flex:1;padding:12px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">Guardar</button>
    </div>
  `;

  _formModal = Modal.abrir({
    titulo: id ? 'Editar gasto' : 'Registrar gasto',
    contenido,
    ancho: 'md',
    onClose: () => { _formModal = null; _bajaItems = []; },
  });

  const body = _formModal.body;
  bindMilesInputs(body);
  const selectCat = body.querySelector('#g-cat');

  selectCat.addEventListener('change', () => actualizarVistaCategoria(selectCat.value));
  body.querySelector('#g-btn-cancelar').onclick = () => _formModal?.cerrar();
  body.querySelector('#g-btn-guardar').onclick = () => guardarFormulario(id);

  // Enter en monto/concepto guarda
  body.querySelector('#g-monto')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); guardarFormulario(id); }
  });

  // Buscador de productos (solo se usa cuando cat=Productos)
  const inpBuscar = body.querySelector('#g-buscar-prod');
  inpBuscar.addEventListener('input', (e) => renderResultadosProductos(e.target.value));

  actualizarVistaCategoria(selectCat.value);
  setTimeout(() => {
    if (selectCat.value === 'Productos') {
      inpBuscar.focus();
      pintarBajaItems();
      renderResultadosProductos('');
    } else {
      body.querySelector('#g-concepto')?.focus();
    }
  }, 100);
}

function actualizarVistaCategoria(cat) {
  if (!_formModal) return;
  const body = _formModal.body;
  const normal = body.querySelector('#g-normal');
  const prod = body.querySelector('#g-productos');
  if (cat === 'Productos') {
    normal.style.display = 'none';
    prod.style.display = 'block';
    pintarBajaItems();
    renderResultadosProductos('');
  } else {
    normal.style.display = 'grid';
    prod.style.display = 'none';
  }
}

function renderResultadosProductos(query) {
  if (!_formModal) return;
  const box = _formModal.body.querySelector('#g-resultados');
  if (!box) return;

  const q = (query || '').trim().toLowerCase();
  let list = _productos;
  if (q) {
    list = _productos.filter((p) => {
      return [p.nombre, p.codigo, p.barras, p.categoria].filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q));
    });
  }

  if (list.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:14px;color:#94a3b8;font-size:13px">Sin resultados</div>`;
    return;
  }

  box.innerHTML = list.slice(0, 30).map((p) => {
    const yaEn = _bajaItems.find((x) => x.producto_id === p.id);
    return `
      <button class="g-add-prod" data-id="${esc(p.id)}" ${yaEn ? 'disabled' : ''}
        style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;background:${yaEn ? '#f8fafc' : 'white'};border-radius:8px;cursor:${yaEn ? 'default' : 'pointer'};font-family:inherit;text-align:left;${yaEn ? 'opacity:.55' : ''}">
        <div style="min-width:0;flex:1">
          <b style="font-size:13px;color:#0f172a;display:block">${esc(p.nombre)}</b>
          <span style="color:#64748b;font-size:11.5px">${esc(p.codigo || '')} · Stock: ${fmt(p.stock || 0)} · Costo: ${money(p.costo || 0)}</span>
        </div>
        <span style="background:${yaEn ? '#e0e7ff' : '#dcfce7'};color:${yaEn ? '#1d4ed8' : '#166534'};font-size:11px;font-weight:700;padding:4px 9px;border-radius:6px;flex-shrink:0">${yaEn ? 'Ya agregado' : '＋ Añadir'}</span>
      </button>
    `;
  }).join('');

  box.querySelectorAll('.g-add-prod').forEach((btn) => {
    btn.addEventListener('click', () => agregarBajaItem(btn.dataset.id));
  });
}

function agregarBajaItem(prodId) {
  const p = _productos.find((x) => x.id === prodId);
  if (!p) return;
  if (_bajaItems.find((x) => x.producto_id === prodId)) {
    Toast.info('Ya está en la lista');
    return;
  }
  if (Number(p.stock) <= 0) {
    Toast.warn('Este producto no tiene stock');
    return;
  }
  _bajaItems.push({
    producto_id: p.id,
    nombre: p.nombre,
    codigo: p.codigo || '',
    cantidad: 1,
    costo: Number(p.costo) || 0,
    motivo: 'Dañado',
  });
  pintarBajaItems();
  const q = _formModal?.body.querySelector('#g-buscar-prod')?.value || '';
  renderResultadosProductos(q);
}

function quitarBajaItem(prodId) {
  _bajaItems = _bajaItems.filter((x) => x.producto_id !== prodId);
  pintarBajaItems();
  const q = _formModal?.body.querySelector('#g-buscar-prod')?.value || '';
  renderResultadosProductos(q);
}

function setBajaItemCampo(prodId, campo, valor) {
  const it = _bajaItems.find((x) => x.producto_id === prodId);
  if (!it) return;
  if (campo === 'cantidad') {
    const p = _productos.find((x) => x.id === prodId);
    const max = p ? Number(p.stock) || 0 : 999999;
    it.cantidad = Math.min(Math.max(0, num(valor)), max);
  } else if (campo === 'motivo') {
    it.motivo = valor;
  }
  pintarBajaItems();
}

function pintarBajaItems() {
  if (!_formModal) return;
  const box = _formModal.body.querySelector('#g-items');
  const tot = _formModal.body.querySelector('#g-total');
  if (!box) return;

  if (_bajaItems.length === 0) {
    box.innerHTML = `
      <div style="text-align:center;padding:18px 12px;color:#64748b;background:#f8fafc;border-radius:10px;border:1px dashed #cbd5e1">
        <div style="font-size:32px;opacity:.5">📦</div>
        <div style="margin-top:4px;font-size:13px">Aún no has agregado productos</div>
      </div>
    `;
    if (tot) tot.innerHTML = '';
    return;
  }

  box.innerHTML = _bajaItems.map((it) => {
    const p = _productos.find((x) => x.id === it.producto_id);
    const stock = p ? Number(p.stock) : 0;
    const subtotal = (Number(it.cantidad) || 0) * (Number(it.costo) || 0);
    return `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px">
          <div style="min-width:0;flex:1">
            <b style="font-size:13px;color:#0f172a">${esc(it.nombre)}</b>
            <div style="color:#64748b;font-size:11.5px">${esc(it.codigo || '')} · Stock: ${fmt(stock)} · Costo: ${money(it.costo)}</div>
          </div>
          <button class="g-quitar" data-id="${esc(it.producto_id)}" style="background:none;border:0;color:#dc2626;font-size:16px;cursor:pointer;padding:4px 8px">✕</button>
        </div>
        <div style="display:grid;gap:8px;grid-template-columns:1fr 1.3fr 1fr;align-items:end">
          <div>
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Cantidad</div>
            <input class="g-cant" data-id="${esc(it.producto_id)}" type="number" min="1" max="${stock}" value="${it.cantidad}"
              style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Motivo</div>
            <select class="g-motivo" data-id="${esc(it.producto_id)}"
              style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
              ${Repo.MOTIVOS_BAJA.map((m) => `<option ${it.motivo === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">Subtotal</div>
            <div style="font-weight:700;color:#dc2626;font-size:14px;font-family:inherit">${money(subtotal)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Cablear handlers
  box.querySelectorAll('.g-quitar').forEach((b) => b.onclick = () => quitarBajaItem(b.dataset.id));
  box.querySelectorAll('.g-cant').forEach((inp) => {
    inp.addEventListener('change', () => setBajaItemCampo(inp.dataset.id, 'cantidad', inp.value));
  });
  box.querySelectorAll('.g-motivo').forEach((sel) => {
    sel.addEventListener('change', () => setBajaItemCampo(sel.dataset.id, 'motivo', sel.value));
  });

  if (tot) {
    const total = _bajaItems.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.costo) || 0), 0);
    const totalU = _bajaItems.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
    tot.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px">
        <span style="color:#64748b">${fmt(_bajaItems.length)} producto(s) · ${fmt(totalU)} unidad(es)</span>
        <b style="color:#dc2626;font-size:18px;font-family:inherit">Gasto total: ${money(total)}</b>
      </div>
    `;
  }
}

async function guardarFormulario(id) {
  if (!_formModal) return;
  const body = _formModal.body;
  const fecha = body.querySelector('#g-fecha').value || todayISO();
  const categoria = body.querySelector('#g-cat').value;

  // Candado anti-doble-registro (doble clic / doble Enter)
  const btnG = body.querySelector('#g-btn-guardar');
  if (btnG?.disabled) return;
  if (btnG) { btnG.disabled = true; btnG.style.opacity = '0.6'; btnG.style.cursor = 'wait'; }

  try {
    if (categoria === 'Productos') {
      if (_bajaItems.length === 0) { Toast.warn('Agrega al menos un producto'); return; }
      if (_bajaItems.some((it) => Number(it.cantidad) <= 0)) { Toast.warn('Hay productos con cantidad en cero'); return; }

      const nota = body.querySelector('#g-nota-p').value.trim();
      const guardado = await Repo.guardarBajaProductos({
        id, fecha, items: _bajaItems, nota,
      });

      Toast.ok(`Baja registrada: ${fmt(_bajaItems.length)} producto(s) · ${money(guardado.monto)}`);
    } else {
      const concepto = body.querySelector('#g-concepto').value.trim();
      const monto = num(body.querySelector('#g-monto').value);
      const nota = body.querySelector('#g-nota').value.trim();
      if (!concepto) { Toast.warn('Escribe el concepto del gasto'); return; }
      if (monto <= 0) { Toast.warn('Escribe un monto mayor a cero'); return; }

      // Si se está editando y antes era de categoría Productos, revertir stock
      if (id) {
        const original = _gastos.find((x) => x.id === id);
        if (original && original.categoria === 'Productos' && Array.isArray(original.items)) {
          // Para revertir el stock: marcamos un id ficticio en items vacíos no funciona.
          // Mejor: usar el método de baja con items vacíos NO. Hacemos eliminar+insertar.
          // Más simple: eliminar el original (devuelve stock) y crear nuevo.
          await Repo.eliminar(id);
          await Repo.guardar({ fecha, categoria, concepto, monto, nota });
          Toast.ok('Gasto guardado');
          finalizarGuardado();
          return;
        }
      }

      await Repo.guardar({ id, fecha, categoria, concepto, monto, nota });
      Toast.ok('Gasto guardado');
    }

    finalizarGuardado();
  } catch (err) {
    console.error('Error guardando gasto:', err);
    Toast.error('No se pudo guardar el gasto');
  } finally {
    // Reactivar el botón si la operación falló y el modal sigue abierto
    if (btnG && btnG.isConnected) { btnG.disabled = false; btnG.style.opacity = '1'; btnG.style.cursor = 'pointer'; }
  }
}

async function finalizarGuardado() {
  _formModal?.cerrar();
  _bajaItems = [];
  _gastos = await Repo.listar();
  _productos = await ProductosRepo.listar();

  // Actualizar KPIs y lista
  if (_contenedor) {
    const kpiBox = _contenedor.querySelector('#gasto-kpis');
    if (kpiBox) {
      kpiBox.innerHTML = htmlKPIs(calcularKPIs());
      refrescarIconos(_contenedor);
    }
  }
  pintarLista();
}

// ============================================================
//  BORRAR
// ============================================================

async function borrarGasto(id) {
  const g = _gastos.find((x) => x.id === id);
  if (!g) return;

  const esProducto = g.categoria === 'Productos' && Array.isArray(g.items) && g.items.length;
  const msg = esProducto
    ? `Esta es una baja de ${fmt(g.items.length)} producto(s) del inventario. Al eliminarla, el stock se DEVOLVERÁ al inventario. ¿Continuar?`
    : '¿Eliminar este gasto?';

  const ok = await Confirm.peligro(msg, {
    titulo: 'Eliminar gasto',
    textoConfirmar: 'Sí, eliminar',
  });
  if (!ok) return;

  try {
    await Repo.eliminar(id);
    Toast.ok(esProducto ? 'Gasto eliminado · Stock devuelto al inventario' : 'Gasto eliminado');
    _gastos = await Repo.listar();
    _productos = await ProductosRepo.listar();
    if (_contenedor) {
      const kpiBox = _contenedor.querySelector('#gasto-kpis');
      if (kpiBox) {
        kpiBox.innerHTML = htmlKPIs(calcularKPIs());
        refrescarIconos(_contenedor);
      }
    }
    pintarLista();
  } catch (err) {
    console.error('Error eliminando gasto:', err);
    Toast.error('No se pudo eliminar el gasto');
  }
}

// ============================================================
//  HTML BASE
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando gastos…</div>`;
}

function htmlKPIs(k) {
  return `
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border-radius:12px;padding:18px 20px;position:relative;overflow:hidden">
      <div style="font-size:12.5px;color:rgba(255,255,255,.85);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Gastos del mes</div>
      <div style="font-size:24px;font-weight:800;font-family:inherit;letter-spacing:-0.02em">${money(k.mesTotal)}</div>
      <div style="font-weight:600;margin-top:6px;font-size:12.5px;opacity:.9">${k.mesN} registro${k.mesN === 1 ? '' : 's'}</div>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px">
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Gastos del año</div>
      <div style="font-size:22px;font-weight:700;color:#a16207;font-family:inherit;letter-spacing:-0.02em">${money(k.anioTotal)}</div>
      <div style="font-weight:500;margin-top:6px;font-size:12.5px;color:#64748b">${k.anioN} registro${k.anioN === 1 ? '' : 's'}</div>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px">
      <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Mayor categoría (mes)</div>
      <div style="font-size:20px;font-weight:700;color:#2563eb">${Repo.ICONOS[k.topCat] || '📌'} ${esc(k.topCat)}</div>
      <div style="font-weight:500;margin-top:6px;font-size:12.5px;color:#64748b;font-family:inherit">${money(k.topVal)}</div>
    </div>
  `;
}

function htmlLayout(k) {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="wallet" style="width:30px;height:30px;color:#dc2626;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Gastos</h1>
      </div>

      <div id="gasto-kpis" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:18px">
        ${htmlKPIs(k)}
      </div>

      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:18px">
        <div style="display:grid;gap:14px;grid-template-columns:2fr 1fr 1fr auto;align-items:end">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Buscar (concepto, categoría o nota)</div>
            <input id="gasto-q" type="text" placeholder="Escribe aquí..." autocomplete="off"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Desde</div>
            <input id="gasto-desde" type="date"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Hasta</div>
            <input id="gasto-hasta" type="date"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <button id="gasto-btn-nuevo"
              style="white-space:nowrap;padding:11px 16px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">
              Registrar gasto
            </button>
          </div>
        </div>
      </div>

      <div id="gasto-lista" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px"></div>
    </div>
  `;
}

function htmlVacio() {
  return `
    <div style="text-align:center;padding:48px 16px;color:#64748b">
      <div style="font-size:48px;margin-bottom:8px">💸</div>
      <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:4px">No hay gastos registrados</div>
      <div style="font-size:13.5px;color:#94a3b8">Registra servicios, nómina, arriendo y más para ver tu utilidad real.</div>
    </div>
  `;
}
