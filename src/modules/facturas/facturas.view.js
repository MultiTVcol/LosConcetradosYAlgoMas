/**
 * modules/facturas/facturas.view.js — Vista del módulo Facturas
 *
 * Replica del renderFacturas del legacy:
 *   - Filtros: búsqueda por texto + rango desde/hasta
 *   - Tabla con N°, Fecha, Cliente, Pago, Total y acciones
 *   - Total agregado (suma de las facturas visibles)
 *   - Modal "Ver factura" con detalle de items + totales + historial
 *   - Modal "Editar factura" con ajuste de stock y trazabilidad
 *   - Eliminar venta con confirmación (devuelve stock al inventario)
 */

import * as Repo from '../ventas/ventas.repo.js';
import * as PlantillaRepo from '../factura/plantilla.repo.js';
import * as ConfigRepo from '../config/config.repo.js';
import { html as facturaHTML } from '../factura/factura.html.js';
import { imprimirPOS } from '../../services/printer.js';
import * as Auth from '../../services/auth.js';
import * as Realtime from '../../services/realtime.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { pageHeader, kpiGrid, badge } from '../../app/ui-kit.js';

// ============================================================
//  ESTADO DEL MÓDULO
// ============================================================

let _contenedor = null;
let _facturas = [];
let _filtro = { q: '', desde: '', hasta: '' };
let _offRealtime = null;

// ============================================================
//  RENDERIZADO
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;
  _filtro = { q: '', desde: '', hasta: '' };

  // Cerrar suscripción anterior
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlCargando();

  try {
    _facturas = await Repo.listar();
  } catch (err) {
    console.error('Error listando facturas:', err);
    _facturas = [];
    Toast.error('No se pudieron cargar las facturas');
  }

  // Suscripción en vivo: ventas cambian aquí también
  _offRealtime = Realtime.escuchar('ventas', async () => {
    try {
      _facturas = await Repo.listar();
      pintarLista();
    } catch (err) { console.warn('Realtime facturas:', err); }
  });

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  pintarLista();
}

function pintarLista() {
  if (!_contenedor) return;
  const cont = _contenedor.querySelector('#fac-lista');
  if (!cont) return;

  const visibles = aplicarFiltros(_facturas, _filtro);
  const total = visibles.reduce((s, f) => s + (Number(f.total) || 0), 0);

  if (visibles.length === 0) {
    cont.innerHTML = htmlVacio();
    refrescarIconos(_contenedor);
    return;
  }

  cont.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <b style="font-size:15px;color:#0f172a">${fmt(visibles.length)} factura${visibles.length === 1 ? '' : 's'}</b>
      <span style="background:#dcfce7;color:#166534;font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:8px">
        Total: ${money(total)}
      </span>
    </div>
    <div class="ui-table-card" style="overflow-x:auto">
      <table class="ui-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Pago</th>
            <th>Estado</th>
            <th style="text-align:right">Total</th>
            <th style="width:120px"></th>
          </tr>
        </thead>
        <tbody>
          ${visibles.map((f) => filaFactura(f)).join('')}
        </tbody>
      </table>
    </div>
  `;

  refrescarIconos(_contenedor);
  cablearAccionesFila(_contenedor);
}

function filaFactura(f) {
  const ediciones = Array.isArray(f.ediciones) ? f.ediciones.length : 0;
  const fecha = (f.fecha || '').slice(0, 10);
  const hora = f.data?.timestamp ? new Date(f.data.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
  const cliente = f.cliente_nombre || 'Cliente ocasional';
  const metodo = (f.metodo_pago || '').split(' ')[0] || '—';
  const anulada = f.estado === 'anulada';

  return `
    <tr data-fac-id="${esc(f.id)}">
      <td>
        <b style="color:#111827">${esc(f.numero || '—')}</b>
        ${ediciones > 0 ? badge('Editada', 'warn') : ''}
      </td>
      <td style="color:#6b7280;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px">
        ${esc(fecha)}${hora ? ' ' + esc(hora) : ''}
      </td>
      <td style="color:#111827">${esc(cliente)}</td>
      <td>${badge(metodo, 'info')}</td>
      <td>${anulada ? badge('Anulada', 'danger') : badge('Pagada', 'success')}</td>
      <td style="text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;color:#111827">
        ${money(f.total)}
      </td>
      <td>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button
            class="fac-btn-ver"
            data-id="${esc(f.id)}"
            title="Ver detalle"
            style="width:32px;height:32px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center"
          ><i data-lucide="eye" style="width:15px;height:15px;color:#475569"></i></button>
          <button
            class="fac-btn-imprimir"
            data-id="${esc(f.id)}"
            title="Imprimir POS 80mm"
            style="width:32px;height:32px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center"
          ><i data-lucide="printer" style="width:15px;height:15px;color:#1d4ed8"></i></button>
          <button
            class="fac-btn-editar"
            data-id="${esc(f.id)}"
            title="Editar venta"
            style="width:32px;height:32px;border:1px solid #fde68a;background:#fef9c3;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center"
          ><i data-lucide="pencil" style="width:15px;height:15px;color:#a16207"></i></button>
          <button
            class="fac-btn-borrar"
            data-id="${esc(f.id)}"
            title="Eliminar"
            style="width:32px;height:32px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center"
          ><i data-lucide="trash-2" style="width:15px;height:15px;color:#dc2626"></i></button>
        </div>
      </td>
    </tr>
  `;
}

// ============================================================
//  HELPERS DE FILTRADO
// ============================================================

function aplicarFiltros(lista, filtro) {
  let r = [...lista];
  const q = (filtro.q || '').toLowerCase().trim();
  if (q) {
    r = r.filter((f) => {
      const text = [
        f.numero,
        f.cliente_nombre,
        f.metodo_pago,
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }
  if (filtro.desde) {
    r = r.filter((f) => (f.fecha || '').slice(0, 10) >= filtro.desde);
  }
  if (filtro.hasta) {
    r = r.filter((f) => (f.fecha || '').slice(0, 10) <= filtro.hasta);
  }
  return r;
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  const inpQ = contenedor.querySelector('#fac-q');
  const inpDesde = contenedor.querySelector('#fac-desde');
  const inpHasta = contenedor.querySelector('#fac-hasta');

  let debounce;
  if (inpQ) {
    inpQ.addEventListener('input', (e) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        _filtro.q = e.target.value;
        pintarLista();
      }, 120);
    });
  }
  if (inpDesde) {
    inpDesde.addEventListener('change', (e) => {
      _filtro.desde = e.target.value;
      pintarLista();
    });
  }
  if (inpHasta) {
    inpHasta.addEventListener('change', (e) => {
      _filtro.hasta = e.target.value;
      pintarLista();
    });
  }
}

function cablearAccionesFila(contenedor) {
  contenedor.querySelectorAll('.fac-btn-ver').forEach((btn) => {
    btn.onclick = () => verFactura(btn.dataset.id);
  });
  contenedor.querySelectorAll('.fac-btn-imprimir').forEach((btn) => {
    btn.onclick = () => imprimirFactura(btn.dataset.id);
  });
  contenedor.querySelectorAll('.fac-btn-editar').forEach((btn) => {
    btn.onclick = () => editarFactura(btn.dataset.id);
  });
  contenedor.querySelectorAll('.fac-btn-borrar').forEach((btn) => {
    btn.onclick = () => borrarFactura(btn.dataset.id);
  });
}

async function imprimirFactura(id) {
  const f = _facturas.find((x) => x.id === id);
  if (!f) return;
  try {
    const [plantilla, cfg] = await Promise.all([
      PlantillaRepo.leer(),
      ConfigRepo.leer(),
    ]);
    const ticket = facturaHTML(f, plantilla, cfg);
    imprimirPOS(ticket, { anchoMm: plantilla.anchoMm || 80, titulo: `Factura ${f.numero || ''}` });
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo imprimir el ticket');
  }
}

// ============================================================
//  ACCIONES
// ============================================================

async function verFactura(id) {
  const f = _facturas.find((x) => x.id === id);
  if (!f) return;

  const ediciones = Array.isArray(f.ediciones) ? f.ediciones : [];
  const tieneEd = ediciones.length > 0;

  const contenido = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-weight:700;color:#0f172a;font-size:15px">${esc(f.cliente_nombre || 'Cliente ocasional')}</div>
      <div style="color:#64748b;font-size:13px;margin-top:3px;font-family:'JetBrains Mono',ui-monospace,monospace">
        ${esc((f.fecha || '').slice(0, 10))} · ${esc(f.metodo_pago || '—')}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:14px">
      <thead>
        <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left">
          <th style="padding:8px 10px">Producto</th>
          <th style="padding:8px 10px;text-align:center">Cant</th>
          <th style="padding:8px 10px;text-align:right">Precio</th>
          <th style="padding:8px 10px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${f.items.map((i) => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px 10px;color:#0f172a">${esc(i.nombre)}</td>
            <td style="padding:8px 10px;text-align:center;font-family:'JetBrains Mono',ui-monospace,monospace">${fmt(i.cantidad)}</td>
            <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace">${money(i.precio)}</td>
            <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700">${money((i.precio - (i.descuento || 0)) * i.cantidad)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="border-top:2px dashed #cbd5e1;padding-top:10px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#64748b;margin-bottom:4px">
        <span>Subtotal</span>
        <b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(f.subtotal)}</b>
      </div>
      ${f.impuesto > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#64748b;margin-bottom:4px">
          <span>Impuesto</span>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(f.impuesto)}</b>
        </div>
      ` : ''}
      ${f.descuento > 0 ? `
        <div style="display:flex;justify-content:space-between;color:#dc2626;font-size:13.5px;margin-bottom:4px">
          <span>Descuento</span>
          <b style="font-family:'JetBrains Mono',ui-monospace,monospace">-${money(f.descuento)}</b>
        </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
        <b style="font-size:15px;color:#0f172a">TOTAL</b>
        <b style="font-size:22px;color:#1d4ed8;font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:-0.02em">${money(f.total)}</b>
      </div>
    </div>

    ${tieneEd ? htmlHistorialEdiciones(ediciones) : ''}

    <div style="display:grid;gap:8px;margin-top:18px">
      <button
        id="fac-modal-imprimir"
        data-id="${esc(f.id)}"
        style="padding:12px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)"
      >🧾 Imprimir POS 80mm</button>
      <button
        id="fac-modal-borrar"
        data-id="${esc(f.id)}"
        style="padding:11px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit"
      >🗑️ Eliminar factura</button>
    </div>
  `;

  const m = Modal.abrir({
    titulo: `Factura ${f.numero || ''}${tieneEd ? '  ✏ Editada (' + ediciones.length + ')' : ''}`,
    contenido,
    ancho: tieneEd ? 'lg' : 'md',
  });

  m.body.querySelector('#fac-modal-imprimir').onclick = async () => {
    try {
      const [plantilla, cfg] = await Promise.all([
        PlantillaRepo.leer(),
        ConfigRepo.leer(),
      ]);
      const ticket = facturaHTML(f, plantilla, cfg);
      imprimirPOS(ticket, { anchoMm: plantilla.anchoMm || 80, titulo: `Factura ${f.numero || ''}` });
    } catch (err) {
      console.error(err);
      Toast.error('No se pudo imprimir el ticket');
    }
  };

  m.body.querySelector('#fac-modal-borrar').onclick = async () => {
    m.cerrar();
    setTimeout(() => borrarFactura(f.id), 220);
  };
}

function htmlHistorialEdiciones(ediciones) {
  return `
    <div style="background:rgba(245,158,11,.08);border:1px solid #f59e0b;border-radius:10px;padding:14px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <b style="font-size:14px;color:#92400e">📋 Historial de ediciones (${fmt(ediciones.length)})</b>
        <span style="background:#fde68a;color:#92400e;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px">Modificada</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${ediciones.map((ed, ix) => {
          const fechaTxt = new Date(ed.fecha).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
          const diff = num(ed.totalNuevo) - num(ed.totalAnterior);
          const signo = diff > 0 ? '+' : '';
          const color = diff > 0 ? '#15803d' : (diff < 0 ? '#dc2626' : '#64748b');
          return `
            <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">
              <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
                <div>
                  <b style="font-size:13px;color:#92400e">Edición #${ix + 1}</b>
                  <span style="font-size:12px;color:#64748b;margin-left:6px">${esc(fechaTxt)}</span>
                </div>
                <div style="font-size:12px">
                  <span style="color:#64748b">Total:</span>
                  <b style="font-family:'JetBrains Mono',ui-monospace,monospace">${money(ed.totalAnterior)} → ${money(ed.totalNuevo)}</b>
                  <span style="color:${color};font-weight:700;margin-left:4px">(${signo}${money(diff)})</span>
                </div>
              </div>
              ${ed.motivo ? `
                <div style="font-size:12.5px;color:#0f172a;margin-bottom:6px;padding:5px 9px;background:#f8fafc;border-radius:6px">
                  <b>Motivo:</b> ${esc(ed.motivo)}
                </div>` : ''}
              <ul style="margin:4px 0 0 18px;padding:0;font-size:12.5px;color:#475569">
                ${(ed.cambios || []).map((c) => `<li style="margin-bottom:2px">${esc(c)}</li>`).join('')}
              </ul>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function editarFactura(id) {
  const f = _facturas.find((x) => x.id === id);
  if (!f) return;

  // Validar permiso. Si el cajero no lo tiene, pedir código de autorización.
  if (!Auth.puede('ventas.editar')) {
    const ok = await Auth.solicitarAutorizacion(`Para editar la factura ${f.numero || ''} se requiere autorización del administrador.`);
    if (!ok) return;
  }

  const contenido = `
    <div style="color:#64748b;font-size:13.5px;margin-bottom:14px">
      Si subes la cantidad se descuenta del inventario; si la bajas, se devuelve.
      Cada cambio quedará registrado en el historial.
    </div>

    <div id="fac-edit-items" style="display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow:auto;margin-bottom:14px">
      ${f.items.map((i, ix) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b style="font-size:13.5px;color:#0f172a">${esc(i.nombre)}</b>
          </div>
          <div style="display:flex;gap:8px">
            <div style="flex:1">
              <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Cant</div>
              <input class="fac-edit-input" data-ei="${ix}" data-ef="cantidad" type="number" inputmode="numeric" min="0"
                value="${i.cantidad}"
                style="width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box"
              />
            </div>
            <div style="flex:1.3">
              <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Precio</div>
              <input class="fac-edit-input" data-ei="${ix}" data-ef="precio" type="text" inputmode="numeric"
                value="${i.precio}"
                style="width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box"
              />
            </div>
            <div style="flex:1">
              <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Desc</div>
              <input class="fac-edit-input" data-ei="${ix}" data-ef="descuento" type="text" inputmode="numeric"
                value="${i.descuento || 0}"
                style="width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box"
              />
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Motivo de la edición (opcional)</div>
      <input id="fac-edit-motivo" type="text" placeholder="Ej: corrección de precio, descuento adicional..."
        style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit"
      />
    </div>

    <div style="display:flex;gap:10px">
      <button id="fac-edit-cancelar"
        style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569"
      >Cancelar</button>
      <button id="fac-edit-guardar"
        style="flex:1;padding:12px;border:0;background:#2563eb;color:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)"
      >💾 Guardar cambios</button>
    </div>
  `;

  const m = Modal.abrir({
    titulo: `✏️ Editar venta ${f.numero || ''}`,
    contenido,
    ancho: 'md',
  });

  m.body.querySelector('#fac-edit-cancelar').onclick = () => m.cerrar();
  m.body.querySelector('#fac-edit-guardar').onclick = async () => {
    const itemsNuevos = f.items.map((i, ix) => ({
      producto_id: i.producto_id,
      nombre: i.nombre,
      cantidad: i.cantidad,
      precio: i.precio,
      descuento: i.descuento || 0,
    }));

    m.body.querySelectorAll('.fac-edit-input').forEach((inp) => {
      const ix = Number(inp.dataset.ei);
      const campo = inp.dataset.ef;
      if (itemsNuevos[ix] != null) {
        itemsNuevos[ix][campo] = num(inp.value);
      }
    });

    const motivo = (m.body.querySelector('#fac-edit-motivo')?.value || '').trim();

    try {
      await Repo.actualizar(f.id, itemsNuevos, motivo);
      Toast.ok('Venta actualizada · Cambios registrados');
      m.cerrar();
      _facturas = await Repo.listar();
      pintarLista();
    } catch (err) {
      console.error('Error actualizando venta:', err);
      Toast.error('No se pudo actualizar la venta');
    }
  };
}

async function borrarFactura(id) {
  const f = _facturas.find((x) => x.id === id);
  if (!f) return;

  // Validar permiso. Si el cajero no lo tiene, pedir código de autorización.
  if (!Auth.puede('ventas.eliminar')) {
    const autorizado = await Auth.solicitarAutorizacion(`Para eliminar la factura ${f.numero || ''} se requiere autorización del administrador.`);
    if (!autorizado) return;
  }

  const ok = await Confirm.peligro(
    `¿Eliminar la venta ${f.numero || ''}? Se devolverá el stock de los productos al inventario. Esta acción no se puede deshacer.`,
    {
      titulo: 'Eliminar venta',
      textoConfirmar: '🗑️ Eliminar',
    },
  );
  if (!ok) return;

  try {
    const r = await Repo.eliminar(id);
    Toast.ok(`Venta eliminada · ${fmt(r.devueltas)} uds devueltas al inventario`);
    _facturas = await Repo.listar();
    pintarLista();
  } catch (err) {
    console.error('Error eliminando venta:', err);
    Toast.error('No se pudo eliminar la venta');
  }
}

// ============================================================
//  HTML BASE
// ============================================================

function htmlCargando() {
  return `
    <div style="padding:40px 48px;color:#64748b;font-size:14px">
      Cargando facturas…
    </div>
  `;
}

function htmlKpis() {
  const vigentes = _facturas.filter((f) => f.estado !== 'anulada');
  const n = vigentes.length;
  const ingresos = vigentes.reduce((s, f) => s + (Number(f.total) || 0), 0);
  const ticket = n > 0 ? ingresos / n : 0;
  const clientes = new Set(vigentes.map((f) => f.cliente_id || (f.cliente_nombre || '').toLowerCase()).filter(Boolean)).size;
  return kpiGrid([
    { label: 'Facturas emitidas', valor: fmt(n), sub: 'Documentos vigentes', icono: 'receipt', color: '#2563eb' },
    { label: 'Ingresos', valor: money(ingresos), sub: 'Total facturado', icono: 'trending-up', color: '#16a34a' },
    { label: 'Ticket promedio', valor: money(ticket), sub: 'Por factura', icono: 'calculator', color: '#7c3aed' },
    { label: 'Clientes atendidos', valor: fmt(clientes), sub: 'Distintos', icono: 'users', color: '#d97706' },
  ]);
}

function htmlLayout() {
  return `
    <div style="padding:32px 40px;max-width:1200px">
      ${pageHeader({
        icono: 'receipt',
        titulo: 'Facturación',
        descripcion: 'Administra las ventas y documentos emitidos por el sistema.',
      })}

      ${_facturas.length > 0 ? htmlKpis() : ''}

      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:18px">
        <div style="display:grid;gap:14px;grid-template-columns:2fr 1fr 1fr">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">
              🔎 Buscar (cliente, N° factura o método)
            </div>
            <input id="fac-q" type="text" placeholder="Escribe aquí..." autocomplete="off"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit"
            />
          </div>
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Desde</div>
            <input id="fac-desde" type="date"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit"
            />
          </div>
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Hasta</div>
            <input id="fac-hasta" type="date"
              style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit"
            />
          </div>
        </div>
      </div>

      <div id="fac-lista" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px"></div>
    </div>
  `;
}

function htmlVacio() {
  return `
    <div style="text-align:center;padding:48px 16px;color:#64748b">
      <div style="font-size:48px;margin-bottom:8px">🧾</div>
      <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:4px">No hay facturas que mostrar</div>
      <div style="font-size:13.5px;color:#94a3b8">Cuando registres ventas aparecerán aquí.</div>
    </div>
  `;
}
