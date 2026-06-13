/**
 * modules/clientes/clientes.form.js — Formulario de alta y edición
 *
 * Modal con formulario para crear o editar clientes — réplica del legacy.
 * Campos: nombre, negocio, teléfono, dirección, ciudad, observaciones.
 *
 * Incluye sección "Precios especiales" con sub-modal para configurar
 * precios distintos al estándar por producto para este cliente.
 */

import * as Repo from './clientes.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import { Modal, Toast } from '../../components/index.js';
import { esc } from '../../core/strings.js';
import { money, num, fmt } from '../../core/format.js';
import { bindMilesInput } from '../../core/inputs.js';
import { refrescarIconos } from '../../app/shell.js';

// Estado temporal de edición de precios especiales — vive solo mientras
// el form de cliente está abierto. Se resetea al abrir y se aplica al guardar.
let _peEdit = {};        // { [productoId]: precio }
let _peSoloAsignados = false;

/**
 * Abre el formulario en modo alta o edición.
 *
 * @param {Object} opciones
 * @param {Object} [opciones.cliente] - Cliente a editar (omitir para alta)
 * @param {Function} [opciones.onGuardado] - Callback al guardar
 * @param {Function} [opciones.onCancelado] - Callback al cancelar
 */
export function abrir(opciones = {}) {
  const esEdicion = !!opciones.cliente;
  const datos = esEdicion ? { ...opciones.cliente } : {
    nombre: '', negocio: '', telefono: '', direccion: '', ciudad: '', obs: '',
    preciosEspeciales: {},
  };

  // Reset del estado de precios especiales
  _peEdit = { ...(datos.preciosEspeciales || {}) };
  _peSoloAsignados = false;

  abrirFormCliente(datos, esEdicion, opciones);
}

/**
 * Renderiza el modal del form de cliente. Se vuelve a llamar al regresar
 * del sub-modal de precios especiales (preservando los valores del form).
 */
function abrirFormCliente(datos, esEdicion, opciones) {
  const formEl = construirFormulario(datos);

  const modal = Modal.abrir({
    titulo: esEdicion ? 'Editar cliente' : 'Nuevo cliente',
    ancho: 'md',
    contenido: formEl,
    cerrarAlClicarFondo: false,
    onClose: () => {
      if (typeof opciones.onCancelado === 'function') {
        try { opciones.onCancelado(); } catch (e) { console.error(e); }
      }
    },
  });

  refrescarIconos(formEl);
  configurarEventos(formEl, datos, modal, opciones, esEdicion);
  pintarResumenPreciosEspeciales(formEl);

  setTimeout(() => {
    const inputNombre = formEl.querySelector('#cli-nombre');
    if (inputNombre) inputNombre.focus();
  }, 200);
}

function construirFormulario(datos) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      ${campo('cli-nombre', 'Nombre del cliente', 'text', datos.nombre, 'Ej: Juan Pérez', true)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo('cli-negocio', 'Nombre del negocio', 'text', datos.negocio, 'Ej: Tienda La Esquina')}
        ${campo('cli-telefono', 'Teléfono', 'tel', datos.telefono, '300 123 4567')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo('cli-direccion', 'Dirección', 'text', datos.direccion, 'Cra 14 # 22-30')}
        ${campo('cli-ciudad', 'Ciudad', 'text', datos.ciudad, 'Armenia')}
      </div>

      ${campo('cli-obs', 'Observaciones', 'text', datos.obs, 'Notas internas sobre el cliente')}

      <!-- Sección Precios Especiales -->
      <div style="background:#f8fafc;border:2px dashed #2563eb;border-radius:12px;padding:14px;margin-top:4px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-weight:800;font-size:15px;color:#0f172a">Precios especiales</div>
            <div style="color:#64748b;font-size:12.5px;margin-top:3px">
              Opcional · Solo los productos que listes aquí tendrán precio especial. El resto usa el precio estándar.
            </div>
          </div>
          <button
            id="cli-btn-pe"
            type="button"
            style="padding:10px 14px;background:#2563eb;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;white-space:nowrap;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)"
          >Configurar precios especiales</button>
        </div>
        <div id="cli-pe-resumen" style="margin-top:10px;font-size:13px;color:#64748b"></div>
      </div>

      <div id="cli-errores" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;color:#991b1b;font-size:13px"></div>

      <div style="display:flex;gap:10px;border-top:1px solid #e2e8f0;padding-top:14px;margin-top:4px">
        <button
          id="cli-cancelar"
          type="button"
          style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569"
        >Cancelar</button>
        <button
          id="cli-guardar"
          type="button"
          style="flex:1.2;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)"
        >Guardar</button>
      </div>
    </div>
  `;
  return wrapper;
}

function campo(id, label, tipo, valor, placeholder, requerido = false) {
  return `
    <label class="ui-field" style="gap:5px">
      <span class="ui-label">
        ${esc(label)}${requerido ? ' <span class="req">*</span>' : ''}
      </span>
      <input
        id="${id}"
        class="ui-input"
        type="${tipo}"
        value="${esc(String(valor || ''))}"
        placeholder="${esc(placeholder || '')}"
        autocomplete="off"
      />
    </label>
  `;
}

function leerFormulario(formEl) {
  return {
    nombre: formEl.querySelector('#cli-nombre').value.trim(),
    negocio: formEl.querySelector('#cli-negocio').value.trim(),
    telefono: formEl.querySelector('#cli-telefono').value.trim(),
    direccion: formEl.querySelector('#cli-direccion').value.trim(),
    ciudad: formEl.querySelector('#cli-ciudad').value.trim(),
    obs: formEl.querySelector('#cli-obs').value.trim(),
  };
}

function pintarResumenPreciosEspeciales(formEl) {
  const el = formEl.querySelector('#cli-pe-resumen');
  if (!el) return;
  const ids = Object.keys(_peEdit || {}).filter((k) => _peEdit[k] != null && _peEdit[k] !== '' && Number(_peEdit[k]) > 0);
  if (ids.length === 0) {
    el.innerHTML = 'Sin precios especiales asignados. Este cliente comprará al precio estándar.';
  } else {
    el.innerHTML = `<b style="color:#1d4ed8">${fmt(ids.length)} producto(s)</b> con precio especial asignado.`;
  }
}

function configurarEventos(formEl, datosIniciales, modal, opciones, esEdicion) {
  const btnGuardar = formEl.querySelector('#cli-guardar');
  const btnCancelar = formEl.querySelector('#cli-cancelar');
  const btnPE = formEl.querySelector('#cli-btn-pe');
  const errBox = formEl.querySelector('#cli-errores');

  // Enter dispara guardar en cualquier input de texto
  formEl.querySelectorAll('input[type="text"], input[type="tel"]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnGuardar.click(); }
    });
  });

  btnCancelar.addEventListener('click', () => modal.cerrar());

  btnPE.addEventListener('click', () => {
    // Capturar lo que el usuario haya escrito antes de cerrar
    const formSnapshot = leerFormulario(formEl);
    const datosActualizados = { ...datosIniciales, ...formSnapshot };
    modal.cerrar();
    setTimeout(() => abrirPreciosEspeciales(datosActualizados, esEdicion, opciones), 220);
  });

  btnGuardar.addEventListener('click', async () => {
    const datos = leerFormulario(formEl);
    if (datosIniciales.id) datos.id = datosIniciales.id;
    datos.preciosEspeciales = { ..._peEdit };

    const errores = Repo.validar(datos);
    if (errores.length > 0) {
      mostrarErrores(errBox, errores);
      return;
    }

    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando…';

    try {
      const guardado = await Repo.guardar(datos);
      modal.cerrar();
      Toast.ok(datosIniciales.id ? 'Cliente actualizado' : 'Cliente creado');
      if (typeof opciones.onGuardado === 'function') {
        try { opciones.onGuardado(guardado); } catch (e) { console.error(e); }
      }
    } catch (err) {
      console.error('Error guardando cliente:', err);
      mostrarErrores(errBox, [err.message || 'Error al guardar']);
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = 'Guardar';
    }
  });
}

function mostrarErrores(errBox, errores) {
  if (!errores || errores.length === 0) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
    return;
  }
  errBox.style.display = 'block';
  errBox.innerHTML = errores.map((e) => `<div>• ${esc(e)}</div>`).join('');
}

// ============================================================
//  SUB-MODAL: CONFIGURAR PRECIOS ESPECIALES
// ============================================================

async function abrirPreciosEspeciales(datosCliente, esEdicion, opciones) {
  let productos = [];
  try { productos = await ProductosRepo.listar(); } catch (e) { productos = []; }

  const contenido = `
    <div style="color:#64748b;font-size:13px;margin-bottom:12px">
      Busca el producto y escribe el precio especial. Deja en blanco para quitarlo.
    </div>

    <!-- Buscador unificado estilo Ventas/Compras -->
    <div style="background:#f8fafc;border:2px dashed #60a5fa;border-radius:12px;padding:12px;margin-bottom:8px">
      <input id="pe-buscar" type="text" placeholder="Buscar por código, barras, nombre o categoría..." autocomplete="off"
        style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
      <div style="color:#64748b;font-size:11.5px;margin-top:6px">los códigos salen primero</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 8px">
      <div style="font-weight:700;font-size:13.5px;color:#0f172a" id="pe-title">Productos</div>
      <button id="pe-toggle-asignados"
        style="padding:6px 12px;border:1px solid #e2e8f0;background:white;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:#475569;font-family:inherit">
        ${_peSoloAsignados ? 'Mostrar todos' : 'Mostrar solo asignados'}
      </button>
    </div>

    <div id="pe-list" style="max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:6px"></div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button id="pe-cancelar"
        style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cerrar sin aplicar</button>
      <button id="pe-aplicar"
        style="flex:1.2;padding:11px;background:#15803d;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(21,128,61,.35)">Aplicar al cliente</button>
    </div>
  `;

  // Snapshot del estado antes de abrir (para descartar si elige "Cerrar sin aplicar")
  const peEditSnapshot = { ..._peEdit };

  const modalPE = Modal.abrir({
    titulo: 'Precios especiales',
    ancho: 'md',
    contenido,
    cerrarAlClicarFondo: false,
  });

  const body = modalPE.body;
  const inpBuscar = body.querySelector('#pe-buscar');
  const listBox = body.querySelector('#pe-list');
  const btnToggle = body.querySelector('#pe-toggle-asignados');
  const titleEl = body.querySelector('#pe-title');

  const pintar = () => pintarListaPE(listBox, productos, inpBuscar.value, body, titleEl);

  let debounce;
  inpBuscar.addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(pintar, 80);
  });

  btnToggle.addEventListener('click', () => {
    _peSoloAsignados = !_peSoloAsignados;
    btnToggle.textContent = _peSoloAsignados ? 'Mostrar todos' : 'Mostrar solo asignados';
    pintar();
  });

  body.querySelector('#pe-cancelar').onclick = () => {
    // Restaurar snapshot — descartar cambios
    _peEdit = peEditSnapshot;
    modalPE.cerrar();
    setTimeout(() => abrirFormCliente(datosCliente, esEdicion, opciones), 220);
  };
  body.querySelector('#pe-aplicar').onclick = () => {
    // Mantener _peEdit como está (ya tiene los cambios)
    modalPE.cerrar();
    Toast.ok('Precios especiales aplicados — recuerda guardar el cliente');
    setTimeout(() => abrirFormCliente(datosCliente, esEdicion, opciones), 220);
  };

  pintar();
  setTimeout(() => inpBuscar.focus(), 60);
}

function pintarListaPE(box, productos, query, body, titleEl) {
  // Usar la misma lógica de prioridad que Ventas/Compras:
  // Código → Barras → Nombre → Categoría → Proveedor
  let lista = ProductosRepo.filtrarConPrioridad(productos, query);

  if (_peSoloAsignados) {
    lista = lista.filter((p) => _peEdit[p.id] != null && _peEdit[p.id] !== '' && Number(_peEdit[p.id]) > 0);
  }

  if (titleEl) {
    const q = (query || '').trim();
    titleEl.textContent = q
      ? `${fmt(lista.length)} resultado(s) para "${q}"`
      : (_peSoloAsignados ? 'Productos con precio especial' : 'Productos');
  }

  if (lista.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13.5px">Sin resultados</div>`;
    return;
  }

  box.innerHTML = lista.slice(0, 60).map((p) => {
    const std = Number(p.precio) || 0;
    const pe = _peEdit[p.id];
    const tiene = pe != null && pe !== '' && Number(pe) > 0;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${tiene ? '#eff6ff' : '#f8fafc'};border:1px solid ${tiene ? '#bfdbfe' : '#e2e8f0'};border-radius:9px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13.5px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nombre)}</div>
          <div style="color:#64748b;font-size:11.5px">${esc(p.codigo || '—')} · Estándar: <b style="color:#0f172a">${money(std)}</b></div>
        </div>
        <input
          class="pe-input"
          data-id="${esc(p.id)}"
          data-miles
          type="text"
          inputmode="numeric"
          placeholder="${fmt(std)}"
          value="${tiene ? pe : ''}"
          style="width:120px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:14px;font-family:'JetBrains Mono',ui-monospace,monospace;text-align:right;outline:none;font-weight:700"
        />
        <button class="pe-quitar" data-id="${esc(p.id)}" title="Quitar precio especial"
          style="width:32px;height:32px;border:1px solid #fecaca;background:#fef2f2;border-radius:7px;cursor:pointer;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:14px">🗑️</button>
      </div>
    `;
  }).join('');

  // Bindear inputs con formato de miles + handlers
  box.querySelectorAll('.pe-input').forEach((inp) => {
    bindMilesInput(inp);
    inp.addEventListener('input', () => {
      const id = inp.dataset.id;
      const v = num(inp.value);
      if (v <= 0) delete _peEdit[id];
      else _peEdit[id] = v;
    });
  });
  box.querySelectorAll('.pe-quitar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      delete _peEdit[id];
      // Re-renderizar para reflejar
      const inpBuscar = body.querySelector('#pe-buscar');
      pintarListaPE(box, productos, inpBuscar.value, body, titleEl);
    });
  });
}
