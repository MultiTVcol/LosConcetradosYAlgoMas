/**
 * modules/productos/productos.form.js — Formulario de alta y edición
 */

import * as Repo from './productos.repo.js';
import { Modal, Toast } from '../../components/index.js';
import { esc } from '../../core/strings.js';
import { refrescarIconos } from '../../app/shell.js';

export function abrir(opciones = {}) {
  const esEdicion = !!opciones.producto;
  const datos = esEdicion ? { ...opciones.producto } : {
    nombre: '',
    codigo: '',
    barras: '',
    categoria: '',
    proveedor: '',
    precio: 0,
    costo: 0,
    stock: 0,
    stock_min: 0,
    impuesto_pct: 0,
    unidad: '',
  };

  const formEl = construirFormulario(datos);

  const modal = Modal.abrir({
    titulo: esEdicion ? 'Editar producto' : 'Nuevo producto',
    ancho: 'lg',
    contenido: formEl,
    cerrarAlClicarFondo: false,
    onClose: () => {
      if (typeof opciones.onCancelado === 'function') {
        try { opciones.onCancelado(); } catch (e) { console.error(e); }
      }
    },
  });

  refrescarIconos(formEl);
  configurarEventos(formEl, datos, modal, opciones);

  setTimeout(() => {
    const inputNombre = formEl.querySelector('#prod-nombre');
    if (inputNombre) inputNombre.focus();
  }, 250);
}

function construirFormulario(datos) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      ${campo('prod-nombre', 'Nombre', 'text', datos.nombre, 'Ej: Croquetas Premium 10kg', true)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo('prod-codigo', 'Código / SKU', 'text', datos.codigo, 'CRO-001')}
        ${campo('prod-barras', 'Código de barras', 'text', datos.barras, '7702123456789')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo('prod-categoria', 'Categoría', 'text', datos.categoria, 'Alimento')}
        ${campo('prod-proveedor', 'Proveedor', 'text', datos.proveedor, 'Distribuidora XYZ')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo('prod-precio', 'Precio de venta', 'number', datos.precio, '0', true)}
        ${campo('prod-costo', 'Costo', 'number', datos.costo, '0')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        ${campo('prod-stock', 'Stock actual', 'number', datos.stock, '0')}
        ${campo('prod-stock-min', 'Stock mínimo (alerta)', 'number', datos.stock_min, '0')}
        ${campo('prod-impuesto', 'IVA %', 'number', datos.impuesto_pct, '0')}
      </div>

      ${campo('prod-unidad', 'Unidad (opcional)', 'text', datos.unidad, 'kg, unidad, litro, etc.')}

      <div id="prod-errores" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;color:#991b1b;font-size:13px"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #e2e8f0;padding-top:14px;margin-top:4px">
        <button id="prod-cancelar" type="button" style="padding:10px 18px;background:white;border:1px solid #cbd5e1;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500;font-family:inherit;color:#475569">Cancelar</button>
        <button id="prod-guardar" type="button" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #4f46e540">
          <i data-lucide="check" style="width:16px;height:16px;stroke-width:2.25"></i>
          Guardar producto
        </button>
      </div>
    </div>
  `;
  return wrapper;
}

function campo(id, label, tipo, valor, placeholder, requerido = false) {
  return `
    <label style="display:flex;flex-direction:column;gap:6px">
      <span style="font-size:13px;color:#475569;font-weight:500">
        ${esc(label)}
        ${requerido ? '<span style="color:#dc2626">*</span>' : ''}
      </span>
      <input
        id="${id}"
        type="${tipo}"
        value="${esc(String(valor != null ? valor : ''))}"
        placeholder="${esc(placeholder || '')}"
        ${tipo === 'number' ? 'step="any" min="0"' : ''}
        autocomplete="off"
        style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;font-family:inherit;background:white;color:#0f172a"
      />
    </label>
  `;
}

function configurarEventos(formEl, datosIniciales, modal, opciones) {
  const inputs = {
    nombre: formEl.querySelector('#prod-nombre'),
    codigo: formEl.querySelector('#prod-codigo'),
    barras: formEl.querySelector('#prod-barras'),
    categoria: formEl.querySelector('#prod-categoria'),
    proveedor: formEl.querySelector('#prod-proveedor'),
    precio: formEl.querySelector('#prod-precio'),
    costo: formEl.querySelector('#prod-costo'),
    stock: formEl.querySelector('#prod-stock'),
    stock_min: formEl.querySelector('#prod-stock-min'),
    impuesto_pct: formEl.querySelector('#prod-impuesto'),
    unidad: formEl.querySelector('#prod-unidad'),
  };
  const btnGuardar = formEl.querySelector('#prod-guardar');
  const btnCancelar = formEl.querySelector('#prod-cancelar');
  const errBox = formEl.querySelector('#prod-errores');

  function validarUI() {
    const datos = leerFormulario(inputs);
    const errores = Repo.validar(datos);
    if (errores.length > 0) {
      btnGuardar.disabled = true;
      btnGuardar.style.opacity = '0.5';
      btnGuardar.style.cursor = 'not-allowed';
    } else {
      btnGuardar.disabled = false;
      btnGuardar.style.opacity = '1';
      btnGuardar.style.cursor = 'pointer';
    }
  }

  Object.values(inputs).forEach((inp) => {
    if (inp) inp.addEventListener('input', validarUI);
  });
  validarUI();

  Object.values(inputs).forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btnGuardar.disabled) {
        e.preventDefault();
        btnGuardar.click();
      }
    });
  });

  btnCancelar.addEventListener('click', () => modal.cerrar());

  btnGuardar.addEventListener('click', async () => {
    const datos = leerFormulario(inputs);
    if (datosIniciales.id) datos.id = datosIniciales.id;

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
      Toast.ok(datosIniciales.id ? 'Producto actualizado' : 'Producto creado');
      if (typeof opciones.onGuardado === 'function') {
        try { opciones.onGuardado(guardado); } catch (e) { console.error(e); }
      }
    } catch (err) {
      console.error('Error guardando producto:', err);
      mostrarErrores(errBox, [err.message || 'Error al guardar']);
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = '<i data-lucide="check" style="width:16px;height:16px;stroke-width:2.25"></i> Guardar producto';
      refrescarIconos(btnGuardar);
    }
  });
}

function leerFormulario(inputs) {
  return {
    nombre: inputs.nombre.value,
    codigo: inputs.codigo.value,
    barras: inputs.barras.value,
    categoria: inputs.categoria.value,
    proveedor: inputs.proveedor.value,
    precio: inputs.precio.value,
    costo: inputs.costo.value,
    stock: inputs.stock.value,
    stock_min: inputs.stock_min.value,
    impuesto_pct: inputs.impuesto_pct.value,
    unidad: inputs.unidad.value,
  };
}

function mostrarErrores(errBox, errores) {
  if (!errores || errores.length === 0) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
    return;
  }
  errBox.style.display = 'block';
  errBox.innerHTML = errores.map(e => `<div>• ${esc(e)}</div>`).join('');
}