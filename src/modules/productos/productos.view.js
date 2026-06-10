/**
 * modules/productos/productos.view.js — Vista de lista de productos
 *
 * Renderiza la tabla principal del módulo Productos con:
 *   - Lista de productos con búsqueda en vivo
 *   - Empty state si no hay nada
 *   - Botones Editar / Borrar en cada fila
 *   - Confirmación antes de borrar
 *   - Atajos: N (nuevo), / (enfocar búsqueda), Esc (limpiar)
 *   - Al guardar/borrar, refresca automáticamente
 */

import * as Repo from './productos.repo.js';
import * as Form from './productos.form.js';
import * as ConfigRepo from '../config/config.repo.js';
import { htmlInventarioPOS, htmlInventarioCarta, htmlHojaAuditoria } from './inventario.html.js';
import { imprimirPOS, imprimirCarta } from '../../services/printer.js';
import * as Realtime from '../../services/realtime.js';
import { money, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { Toast, Confirm, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';

// ============================================================
//  ESTADO DEL MÓDULO (vive mientras la vista está montada)
// ============================================================

let _contenedor = null;
let _productos = [];          // lista cargada del repo (todos)
let _filtro = '';             // texto de búsqueda actual
let _atajosRegistrados = false;
let _offRealtime = null;       // función para desuscribir realtime

// ============================================================
//  HELPERS DE FILTRADO
// ============================================================

/**
 * Normaliza texto para búsqueda flexible (sin acentos, minúsculas).
 */
function normalizar(texto) {
  if (texto == null) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Aplica el filtro actual a la lista de productos.
 */
function aplicarFiltro(productos, filtro) {
  if (!filtro || !filtro.trim()) return productos;
  const q = normalizar(filtro);
  return productos.filter((p) => {
    const campos = [p.nombre, p.codigo, p.categoria].map(normalizar);
    return campos.some((c) => c.includes(q));
  });
}

// ============================================================
//  RENDERIZADO
// ============================================================

/**
 * Renderiza la vista completa.
 *
 * @param {HTMLElement} contenedor - Elemento donde montar la vista
 */
export async function render(contenedor) {
  _contenedor = contenedor;

  // Cerrar suscripción realtime anterior (si veníamos de otro módulo)
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  // Estado de carga inmediato
  contenedor.innerHTML = htmlLayout('cargando', [], '', 0);

  // Traer productos
  try {
    _productos = await Repo.listar();
  } catch (err) {
    console.error('Error listando productos:', err);
    Toast.error('No se pudieron cargar los productos');
    _productos = [];
  }

  // Renderizar con el filtro vigente
  renderizarLista();

  // Suscribirse a cambios remotos en productos (sync en vivo)
  _offRealtime = Realtime.escuchar('productos', async () => {
    try {
      _productos = await Repo.listar();
      renderizarLista();
    } catch (err) { console.warn('Realtime productos:', err); }
  });

  // Registrar atajos de teclado (solo una vez)
  if (!_atajosRegistrados) {
    registrarAtajos();
    _atajosRegistrados = true;
  }
}

/**
 * Re-renderiza solo la lista (sin volver a leer del repo).
 * Útil cuando cambia el filtro de búsqueda.
 */
function renderizarLista() {
  if (!_contenedor) return;

  const visibles = aplicarFiltro(_productos, _filtro);
  const totalGeneral = _productos.length;
  const totalVisible = visibles.length;

  let estado;
  if (totalGeneral === 0) estado = 'vacio';
  else if (totalVisible === 0) estado = 'sin-resultados';
  else estado = 'lista';

  _contenedor.innerHTML = htmlLayout(estado, visibles, _filtro, totalGeneral);
  refrescarIconos(_contenedor);
  adjuntarEventos(_contenedor);

  // Restaurar foco del input de búsqueda si tenía texto
  if (_filtro) {
    const inp = _contenedor.querySelector('#prod-buscar');
    if (inp) {
      inp.focus();
      // Posicionar cursor al final
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }
  }
}

// ============================================================
//  HTML BUILDERS
// ============================================================

function htmlLayout(estado, productos, filtro, totalGeneral) {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      ${htmlHeader(totalGeneral, productos.length, filtro)}
      ${totalGeneral > 0 ? htmlBuscador(filtro) : ''}
      ${estado === 'cargando' ? htmlCargando() : ''}
      ${estado === 'vacio' ? htmlVacio() : ''}
      ${estado === 'sin-resultados' ? htmlSinResultados(filtro) : ''}
      ${estado === 'lista' ? htmlTabla(productos) : ''}
    </div>
  `;
}

function htmlHeader(totalGeneral, totalVisible, filtro) {
  const subtitulo = totalGeneral === 0
    ? 'Comencemos agregando tu primer producto'
    : filtro
      ? `${totalVisible} de ${totalGeneral} producto${totalGeneral === 1 ? '' : 's'}`
      : `${totalGeneral} producto${totalGeneral === 1 ? '' : 's'} en el catálogo`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <i data-lucide="package" style="width:28px;height:28px;color:#4f46e5;stroke-width:1.75"></i>
          <h1 style="font-size:26px;font-weight:700;letter-spacing:-0.025em;margin:0;color:#0f172a">
            Productos
          </h1>
        </div>
        <div style="color:#64748b;font-size:14px">
          ${subtitulo}
        </div>
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button
          id="btn-inventario"
          title="Imprimir inventario / hoja de auditoría"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:white;color:#4338ca;border:1px solid #c7d2fe;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit"
        >
          <i data-lucide="clipboard-list" style="width:17px;height:17px;stroke-width:2"></i>
          📦 Inventario
        </button>
        <span style="font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;background:#f1f5f9;padding:4px 8px;border-radius:6px">
          atajo: <kbd style="font-weight:600;color:#475569">N</kbd>
        </span>
        <button
          id="btn-nuevo-producto"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #4f46e540"
        >
          <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i>
          Nuevo producto
        </button>
      </div>
    </div>
  `;
}

function htmlBuscador(filtro) {
  return `
    <div style="position:relative;margin-bottom:16px;max-width:480px">
      <i data-lucide="search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:18px;height:18px;color:#94a3b8;pointer-events:none"></i>
      <input
        id="prod-buscar"
        type="text"
        value="${esc(filtro || '')}"
        placeholder="Buscar por nombre, código o categoría..."
        autocomplete="off"
        style="width:100%;padding:10px 38px 10px 38px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;font-family:inherit;background:white;color:#0f172a;box-sizing:border-box"
      />
      ${filtro ? `
        <button
          id="prod-limpiar-busqueda"
          title="Limpiar búsqueda (Esc)"
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:24px;height:24px;background:#f1f5f9;border:0;border-radius:6px;cursor:pointer;color:#64748b;display:flex;align-items:center;justify-content:center"
        >
          <i data-lucide="x" style="width:14px;height:14px"></i>
        </button>
      ` : `
        <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;background:#f1f5f9;padding:3px 6px;border-radius:5px">/</span>
      `}
    </div>
  `;
}

function htmlCargando() {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:48px;text-align:center;color:#94a3b8">
      <div style="font-size:14px">Cargando productos…</div>
    </div>
  `;
}

function htmlVacio() {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:64px 24px;text-align:center">
      <div style="width:72px;height:72px;margin:0 auto 18px;border-radius:18px;background:#eef2ff;display:flex;align-items:center;justify-content:center">
        <i data-lucide="package" style="width:36px;height:36px;color:#4f46e5;stroke-width:1.5"></i>
      </div>
      <h2 style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 8px;letter-spacing:-0.01em">
        Tu catálogo está vacío
      </h2>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;max-width:380px;margin-left:auto;margin-right:auto">
        Empezá agregando los productos que vendés en tu tienda.
        Podés escribirlos uno por uno o importar una lista más tarde.
      </p>
      <button
        id="btn-nuevo-producto-vacio"
        style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit"
      >
        <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i>
        Agregar primer producto
      </button>
    </div>
  `;
}

function htmlSinResultados(filtro) {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:48px 24px;text-align:center">
      <div style="width:60px;height:60px;margin:0 auto 16px;border-radius:14px;background:#f1f5f9;display:flex;align-items:center;justify-content:center">
        <i data-lucide="search-x" style="width:28px;height:28px;color:#64748b;stroke-width:1.5"></i>
      </div>
      <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:4px">
        Sin resultados para "${esc(filtro)}"
      </div>
      <div style="color:#64748b;font-size:13.5px">
        Probá con otro término o revisá la ortografía
      </div>
    </div>
  `;
}

function htmlTabla(productos) {
  const filas = productos.map((p) => htmlFila(p)).join('');
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Producto</th>
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Código</th>
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Categoría</th>
              <th style="text-align:right;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Precio</th>
              <th style="text-align:right;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Stock</th>
              <th style="text-align:right;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;width:120px">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${filas}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function htmlFila(p) {
  const stockBajo = Number(p.stock) < 5;
  return `
    <tr data-id="${esc(p.id)}" style="border-bottom:1px solid #f1f5f9">
      <td style="padding:14px 16px;color:#0f172a;font-weight:500">
        ${esc(p.nombre || '(sin nombre)')}
      </td>
      <td style="padding:14px 16px;color:#64748b;font-family:'JetBrains Mono',monospace;font-size:13px">
        ${esc(p.codigo || '—')}
      </td>
      <td style="padding:14px 16px;color:#475569">
        ${esc(p.categoria || '—')}
      </td>
      <td style="padding:14px 16px;text-align:right;color:#0f172a;font-weight:600;font-family:'JetBrains Mono',monospace">
        ${money(p.precio)}
      </td>
      <td style="padding:14px 16px;text-align:right;color:${stockBajo ? '#dc2626' : '#0f172a'};font-weight:${stockBajo ? '600' : '500'};font-family:'JetBrains Mono',monospace">
        ${Number(p.stock) || 0}
        ${stockBajo ? '<i data-lucide="alert-triangle" style="width:14px;height:14px;color:#dc2626;margin-left:4px;vertical-align:middle"></i>' : ''}
      </td>
      <td style="padding:10px 16px;text-align:right;white-space:nowrap">
        <button
          class="btn-editar"
          data-id="${esc(p.id)}"
          title="Editar producto"
          style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;background:#f1f5f9;border:0;border-radius:7px;cursor:pointer;color:#475569;margin-right:4px"
        >
          <i data-lucide="pencil" style="width:15px;height:15px;stroke-width:2"></i>
        </button>
        <button
          class="btn-borrar"
          data-id="${esc(p.id)}"
          title="Eliminar producto"
          style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;background:#fef2f2;border:0;border-radius:7px;cursor:pointer;color:#dc2626"
        >
          <i data-lucide="trash-2" style="width:15px;height:15px;stroke-width:2"></i>
        </button>
      </td>
    </tr>
  `;
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  // Botón "Nuevo producto" (header + empty state)
  const btnNuevo = contenedor.querySelector('#btn-nuevo-producto');
  const btnNuevoVacio = contenedor.querySelector('#btn-nuevo-producto-vacio');
  if (btnNuevo) btnNuevo.addEventListener('click', abrirFormNuevo);
  if (btnNuevoVacio) btnNuevoVacio.addEventListener('click', abrirFormNuevo);

  // Botón "Inventario" — abre selector de tipo de impresión
  const btnInv = contenedor.querySelector('#btn-inventario');
  if (btnInv) btnInv.addEventListener('click', abrirModalInventario);

  // Búsqueda en vivo
  const inputBuscar = contenedor.querySelector('#prod-buscar');
  if (inputBuscar) {
    inputBuscar.addEventListener('input', (e) => {
      _filtro = e.target.value;
      renderizarLista();
    });
  }

  // Botón limpiar búsqueda
  const btnLimpiar = contenedor.querySelector('#prod-limpiar-busqueda');
  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', () => {
      _filtro = '';
      renderizarLista();
    });
  }

  // Botones Editar / Borrar en cada fila
  contenedor.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormEdicion(btn.dataset.id));
  });
  contenedor.querySelectorAll('.btn-borrar').forEach((btn) => {
    btn.addEventListener('click', () => borrarProducto(btn.dataset.id));
  });

  // Hover sutil en las filas
  contenedor.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('mouseenter', () => { tr.style.background = '#fafafa'; });
    tr.addEventListener('mouseleave', () => { tr.style.background = 'transparent'; });
  });
}

// ============================================================
//  ACCIONES
// ============================================================

function abrirFormNuevo() {
  Form.abrir({
    onGuardado: async () => {
      _productos = await Repo.listar();
      renderizarLista();
    },
  });
}

function abrirFormEdicion(id) {
  const producto = _productos.find((p) => p.id === id);
  if (!producto) {
    Toast.error('Producto no encontrado');
    return;
  }
  Form.abrir({
    producto,
    onGuardado: async () => {
      _productos = await Repo.listar();
      renderizarLista();
    },
  });
}

async function borrarProducto(id) {
  const producto = _productos.find((p) => p.id === id);
  if (!producto) {
    Toast.error('Producto no encontrado');
    return;
  }

  const ok = await Confirm.peligro(
    `¿Eliminar "${producto.nombre}"? Esta acción no se puede deshacer.`,
    { textoConfirmar: 'Sí, eliminar' }
  );
  if (!ok) return;

  try {
    await Repo.borrar(id);
    Toast.ok('Producto eliminado');
    _productos = await Repo.listar();
    renderizarLista();
  } catch (err) {
    console.error('Error borrando producto:', err);
    Toast.error('No se pudo eliminar el producto');
  }
}

// ============================================================
//  ATAJOS DE TECLADO
// ============================================================

function registrarAtajos() {
  document.addEventListener('keydown', (e) => {
    // Solo activar atajos si la ruta activa es Productos
    if (!window.location.hash.startsWith('#productos')) return;

    // Ignorar si el foco está dentro de un input/textarea (excepto Esc)
    const enInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    // Esc → limpiar búsqueda
    if (e.key === 'Escape') {
      if (_filtro) {
        _filtro = '';
        renderizarLista();
      } else if (enInput && e.target.id === 'prod-buscar') {
        e.target.blur();
      }
      return;
    }

    // Si está escribiendo en un input, ignorar los otros atajos
    if (enInput) return;

    // N → nuevo producto
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      abrirFormNuevo();
      return;
    }

    // / → enfocar búsqueda
    if (e.key === '/') {
      e.preventDefault();
      const inp = _contenedor?.querySelector('#prod-buscar');
      if (inp) inp.focus();
      return;
    }
  });
}

// ============================================================
//  MODAL DE INVENTARIO (selector de tipo de impresión)
// ============================================================

async function abrirModalInventario() {
  if (!_productos || _productos.length === 0) {
    Toast.warn('No hay productos para imprimir');
    return;
  }

  const bajos = _productos.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.stock_min || 0));
  const agotados = _productos.filter((p) => Number(p.stock) <= 0);

  const opcion = (id, icono, titulo, sub, color) => `
    <button id="${id}"
      style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:white;border:1.5px solid #e2e8f0;border-radius:11px;cursor:pointer;font-family:inherit;text-align:left;transition:all .15s ease;width:100%">
      <div style="width:42px;height:42px;border-radius:10px;background:${color}15;color:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:22px">${icono}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14.5px;color:#0f172a">${esc(titulo)}</div>
        <div style="font-size:12.5px;color:#64748b;margin-top:3px;line-height:1.4">${esc(sub)}</div>
      </div>
      <i data-lucide="chevron-right" style="width:18px;height:18px;color:#94a3b8;flex-shrink:0;align-self:center"></i>
    </button>
  `;

  const contenido = `
    <div style="color:#64748b;font-size:13px;margin-bottom:14px">
      ${fmt(_productos.length)} productos en inventario · ${bajos.length} con stock bajo · ${agotados.length} agotados
    </div>

    <div style="display:flex;flex-direction:column;gap:10px">
      ${opcion('inv-opt-pos', '🧾', 'Imprimir inventario en POS 80mm', 'Listado compacto agrupado por categoría con valor a costo y venta. Ideal para revisión rápida en impresora térmica.', '#4f46e5')}
      ${opcion('inv-opt-pdf', '📄', 'Generar informe PDF (Carta)', 'Inventario completo con tabla por categoría, subtotales, totales y resumen financiero. Optimizado para guardar como PDF o imprimir en carta.', '#15803d')}
      ${opcion('inv-opt-audit', '📋', 'Hoja de auditoría para conteo físico', 'Hoja con columnas vacías para anotar el conteo real durante una auditoría de inventario. Incluye firmas y diferencia.', '#a16207')}
      ${bajos.length > 0 ? opcion('inv-opt-bajos', '⚠️', `Solo productos con stock bajo (${bajos.length})`, 'Imprime solo el listado de productos que están por debajo del stock mínimo. Útil para órdenes de compra.', '#dc2626') : ''}
    </div>

    <div style="display:flex;margin-top:18px">
      <button id="inv-cerrar"
        style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
    </div>
  `;

  const m = Modal.abrir({
    titulo: '📦 Imprimir inventario',
    contenido,
    ancho: 'md',
  });

  refrescarIconos(m.body);

  // Hover effect en las opciones
  m.body.querySelectorAll('button[id^="inv-opt"]').forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = '#4f46e5';
      btn.style.background = '#f8fafc';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = '#e2e8f0';
      btn.style.background = 'white';
    });
  });

  m.body.querySelector('#inv-cerrar').onclick = () => m.cerrar();

  m.body.querySelector('#inv-opt-pos').onclick = async () => {
    m.cerrar();
    await imprimirInventarioPOS(_productos);
  };
  m.body.querySelector('#inv-opt-pdf').onclick = async () => {
    m.cerrar();
    await imprimirInventarioCarta(_productos);
  };
  m.body.querySelector('#inv-opt-audit').onclick = async () => {
    m.cerrar();
    await imprimirHojaAuditoria(_productos);
  };
  const btnBajos = m.body.querySelector('#inv-opt-bajos');
  if (btnBajos) {
    btnBajos.onclick = async () => {
      m.cerrar();
      await imprimirInventarioPOS(bajos, { soloBajos: true });
    };
  }
}

async function imprimirInventarioPOS(productos, opts = {}) {
  try {
    const cfg = await ConfigRepo.leer();
    const html = htmlInventarioPOS(productos, cfg, opts);
    const fecha = new Date().toISOString().slice(0, 10);
    imprimirPOS(html, { anchoMm: 80, titulo: `Inventario ${fecha}` });
    Toast.ok('Enviando inventario a la impresora…');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo imprimir el inventario');
  }
}

async function imprimirInventarioCarta(productos) {
  try {
    const cfg = await ConfigRepo.leer();
    const html = htmlInventarioCarta(productos, cfg);
    const fecha = new Date().toISOString().slice(0, 10);
    imprimirCarta(html, { titulo: `Inventario ${fecha}` });
    Toast.info('Selecciona "Guardar como PDF" en el diálogo de impresión');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo generar el informe');
  }
}

async function imprimirHojaAuditoria(productos) {
  try {
    const cfg = await ConfigRepo.leer();
    const html = htmlHojaAuditoria(productos, cfg);
    const fecha = new Date().toISOString().slice(0, 10);
    imprimirCarta(html, { titulo: `Hoja auditoria ${fecha}` });
    Toast.ok('Imprime la hoja para usarla en el conteo físico');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo generar la hoja de auditoría');
  }
}