/**
 * modules/clientes/clientes.view.js — Vista de lista de clientes
 *
 * Versión completa: lista + búsqueda + acciones + atajos.
 * Estructura paralela a productos.view.js.
 */

import * as Repo from './clientes.repo.js';
import * as Form from './clientes.form.js';
import * as Realtime from '../../services/realtime.js';
import { esc } from '../../core/strings.js';
import { Toast, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';

// ============================================================
//  ESTADO DEL MÓDULO
// ============================================================

let _contenedor = null;
let _clientes = [];
let _filtro = '';
let _atajosRegistrados = false;
let _offRealtime = null;

// ============================================================
//  HELPERS DE FILTRADO
// ============================================================

function normalizar(texto) {
  if (texto == null) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function aplicarFiltro(clientes, filtro) {
  if (!filtro || !filtro.trim()) return clientes;
  const q = normalizar(filtro);
  return clientes.filter((c) => {
    const campos = [c.nombre, c.negocio, c.telefono, c.direccion, c.ciudad, c.email, c.documento].map(normalizar);
    return campos.some((v) => v.includes(q));
  });
}

// ============================================================
//  RENDERIZADO
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;

  // Cerrar suscripción anterior
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = htmlLayout('cargando', [], '', 0);

  try {
    _clientes = await Repo.listar();
  } catch (err) {
    console.error('Error listando clientes:', err);
    Toast.error('No se pudieron cargar los clientes');
    _clientes = [];
  }

  renderizarLista();

  // Suscripción en vivo
  _offRealtime = Realtime.escuchar('clientes', async () => {
    try {
      _clientes = await Repo.listar();
      renderizarLista();
    } catch (err) { console.warn('Realtime clientes:', err); }
  });

  if (!_atajosRegistrados) {
    registrarAtajos();
    _atajosRegistrados = true;
  }
}

function renderizarLista() {
  if (!_contenedor) return;

  const visibles = aplicarFiltro(_clientes, _filtro);
  const totalGeneral = _clientes.length;
  const totalVisible = visibles.length;

  let estado;
  if (totalGeneral === 0) estado = 'vacio';
  else if (totalVisible === 0) estado = 'sin-resultados';
  else estado = 'lista';

  _contenedor.innerHTML = htmlLayout(estado, visibles, _filtro, totalGeneral);
  refrescarIconos(_contenedor);
  adjuntarEventos(_contenedor);

  if (_filtro) {
    const inp = _contenedor.querySelector('#cli-buscar');
    if (inp) {
      inp.focus();
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }
  }
}

// ============================================================
//  HTML BUILDERS
// ============================================================

function htmlLayout(estado, clientes, filtro, totalGeneral) {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      ${htmlHeader(totalGeneral, clientes.length, filtro)}
      ${totalGeneral > 0 ? htmlBuscador(filtro) : ''}
      ${estado === 'cargando' ? htmlCargando() : ''}
      ${estado === 'vacio' ? htmlVacio() : ''}
      ${estado === 'sin-resultados' ? htmlSinResultados(filtro) : ''}
      ${estado === 'lista' ? htmlTabla(clientes) : ''}
    </div>
  `;
}

function htmlHeader(totalGeneral, totalVisible, filtro) {
  const subtitulo = totalGeneral === 0
    ? 'Comencemos registrando tu primer cliente'
    : filtro
      ? `${totalVisible} de ${totalGeneral} cliente${totalGeneral === 1 ? '' : 's'}`
      : `${totalGeneral} cliente${totalGeneral === 1 ? '' : 's'} registrado${totalGeneral === 1 ? '' : 's'}`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <i data-lucide="users" style="width:28px;height:28px;color:#4f46e5;stroke-width:1.75"></i>
          <h1 style="font-size:26px;font-weight:700;letter-spacing:-0.025em;margin:0;color:#0f172a">
            Clientes
          </h1>
        </div>
        <div style="color:#64748b;font-size:14px">${subtitulo}</div>
      </div>

      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:11px;color:#94a3b8;font-family:'JetBrains Mono',monospace;background:#f1f5f9;padding:4px 8px;border-radius:6px">
          atajo: <kbd style="font-weight:600;color:#475569">N</kbd>
        </span>
        <button
          id="btn-nuevo-cliente"
          style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;box-shadow:0 4px 8px -2px #4f46e540"
        >
          <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i>
          Nuevo cliente
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
        id="cli-buscar"
        type="text"
        value="${esc(filtro || '')}"
        placeholder="Buscar por nombre, teléfono, email o documento..."
        autocomplete="off"
        style="width:100%;padding:10px 38px 10px 38px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;font-family:inherit;background:white;color:#0f172a;box-sizing:border-box"
      />
      ${filtro ? `
        <button
          id="cli-limpiar-busqueda"
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
      <div style="font-size:14px">Cargando clientes…</div>
    </div>
  `;
}

function htmlVacio() {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:64px 24px;text-align:center">
      <div style="width:72px;height:72px;margin:0 auto 18px;border-radius:18px;background:#eef2ff;display:flex;align-items:center;justify-content:center">
        <i data-lucide="users" style="width:36px;height:36px;color:#4f46e5;stroke-width:1.5"></i>
      </div>
      <h2 style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 8px;letter-spacing:-0.01em">
        No hay clientes registrados
      </h2>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;max-width:380px;margin-left:auto;margin-right:auto">
        Registrá a tus clientes para llevar un historial de ventas
        y mantenerlos informados.
      </p>
      <button
        id="btn-nuevo-cliente-vacio"
        style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit"
      >
        <i data-lucide="plus" style="width:18px;height:18px;stroke-width:2.25"></i>
        Agregar primer cliente
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

function htmlTabla(clientes) {
  const filas = clientes.map((c) => htmlFila(c)).join('');
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Nombre</th>
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Negocio</th>
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Teléfono</th>
              <th style="text-align:left;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Ciudad</th>
              <th style="text-align:center;padding:12px 16px;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;width:90px">💎 PE</th>
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

function htmlFila(c) {
  const nPE = c.preciosEspeciales ? Object.keys(c.preciosEspeciales).filter((k) => Number(c.preciosEspeciales[k]) > 0).length : 0;
  return `
    <tr data-id="${esc(c.id)}" style="border-bottom:1px solid #f1f5f9">
      <td style="padding:14px 16px;color:#0f172a;font-weight:500">
        ${esc(c.nombre || '(sin nombre)')}
      </td>
      <td style="padding:14px 16px;color:#475569">
        ${esc(c.negocio || '—')}
      </td>
      <td style="padding:14px 16px;color:#475569;font-family:'JetBrains Mono',monospace;font-size:13px">
        ${esc(c.telefono || '—')}
      </td>
      <td style="padding:14px 16px;color:#475569">
        ${esc(c.ciudad || '—')}
      </td>
      <td style="padding:14px 16px;text-align:center">
        ${nPE > 0
          ? `<span style="background:#eef2ff;color:#4338ca;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:6px">💎 ${nPE}</span>`
          : '<span style="color:#cbd5e1">—</span>'}
      </td>
      <td style="padding:10px 16px;text-align:right;white-space:nowrap">
        <button
          class="btn-editar-cli"
          data-id="${esc(c.id)}"
          title="Editar cliente"
          style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;background:#f1f5f9;border:0;border-radius:7px;cursor:pointer;color:#475569;margin-right:4px"
        >
          <i data-lucide="pencil" style="width:15px;height:15px;stroke-width:2"></i>
        </button>
        <button
          class="btn-borrar-cli"
          data-id="${esc(c.id)}"
          title="Eliminar cliente"
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
  const btnNuevo = contenedor.querySelector('#btn-nuevo-cliente');
  const btnNuevoVacio = contenedor.querySelector('#btn-nuevo-cliente-vacio');
  if (btnNuevo) btnNuevo.addEventListener('click', abrirFormNuevo);
  if (btnNuevoVacio) btnNuevoVacio.addEventListener('click', abrirFormNuevo);

  const inputBuscar = contenedor.querySelector('#cli-buscar');
  if (inputBuscar) {
    inputBuscar.addEventListener('input', (e) => {
      _filtro = e.target.value;
      renderizarLista();
    });
  }

  const btnLimpiar = contenedor.querySelector('#cli-limpiar-busqueda');
  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', () => {
      _filtro = '';
      renderizarLista();
    });
  }

  contenedor.querySelectorAll('.btn-editar-cli').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormEdicion(btn.dataset.id));
  });
  contenedor.querySelectorAll('.btn-borrar-cli').forEach((btn) => {
    btn.addEventListener('click', () => borrarCliente(btn.dataset.id));
  });

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
      _clientes = await Repo.listar();
      renderizarLista();
    },
  });
}

function abrirFormEdicion(id) {
  const cliente = _clientes.find((c) => c.id === id);
  if (!cliente) {
    Toast.error('Cliente no encontrado');
    return;
  }
  Form.abrir({
    cliente,
    onGuardado: async () => {
      _clientes = await Repo.listar();
      renderizarLista();
    },
  });
}

async function borrarCliente(id) {
  const cliente = _clientes.find((c) => c.id === id);
  if (!cliente) {
    Toast.error('Cliente no encontrado');
    return;
  }

  const ok = await Confirm.peligro(
    `¿Eliminar a "${cliente.nombre}"? Esta acción no se puede deshacer.`,
    { textoConfirmar: 'Sí, eliminar' }
  );
  if (!ok) return;

  try {
    await Repo.borrar(id);
    Toast.ok('Cliente eliminado');
    _clientes = await Repo.listar();
    renderizarLista();
  } catch (err) {
    console.error('Error borrando cliente:', err);
    Toast.error('No se pudo eliminar el cliente');
  }
}

// ============================================================
//  ATAJOS DE TECLADO
// ============================================================

function registrarAtajos() {
  document.addEventListener('keydown', (e) => {
    if (!window.location.hash.startsWith('#clientes')) return;

    const enInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (_filtro) {
        _filtro = '';
        renderizarLista();
      } else if (enInput && e.target.id === 'cli-buscar') {
        e.target.blur();
      }
      return;
    }

    if (enInput) return;

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      abrirFormNuevo();
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      const inp = _contenedor?.querySelector('#cli-buscar');
      if (inp) inp.focus();
      return;
    }
  });
}