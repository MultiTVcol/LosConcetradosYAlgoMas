/**
 * modules/terceros/terceros.view.js — Terceros
 *
 * Una sola lista con clientes, proveedores, empleados y otros, con su
 * ficha tributaria (documento con DV, persona natural o jurídica,
 * responsabilidades del RUT) y el saldo que tienen en la contabilidad.
 */

import * as Repo from './terceros.repo.js';
import * as Motor from '../../services/motor-contable.js';
import { money } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { Toast, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { pageHeader, kpiGrid } from '../../app/ui-kit.js';
import { tarjeta, th, td, tabla, vacio, exportar } from '../contabilidad/ui.js';

let _c = null;
let _q = '';
let _rol = '';
const TOPE = 300;

const chip = (t, color) => `<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:${color}1A;color:${color};white-space:nowrap">${t}</span>`;
const COLOR_ROL = { cliente: '#15803D', proveedor: '#1D4ED8', empleado: '#7C3AED', otro: '#7D6858' };

export async function render(contenedor) {
  _c = contenedor;
  await pintar();
}

async function pintar() {
  const cfg = await Motor.config();
  const [todos, cartera, deudas] = await Promise.all([
    Repo.listar(),
    Motor.saldosPorTercero(cfg.cuentas.clientes),
    Motor.saldosPorTercero(cfg.cuentas.proveedores),
  ]);
  const saldoCli = new Map(cartera.map((x) => [x.tercero_id, x.saldo]));
  const saldoPro = new Map(deudas.map((x) => [x.tercero_id, x.saldo]));
  const lista = todos.filter((t) => (!_rol || t.roles.includes(_rol)) && Repo.coincide(t, _q));
  const sinDoc = todos.filter((t) => !t.numero_doc).length;

  _c.innerHTML = `
    <div style="padding:32px 40px;max-width:1280px">
      ${pageHeader({
        icono: 'contact',
        titulo: 'Terceros',
        descripcion: 'Clientes, proveedores, empleados y otros, con su documento y su saldo contable.',
        acciones: `<button id="tc-nuevo" class="btn btn-primary"><i data-lucide="user-plus"></i>Nuevo tercero</button>`,
      })}
      ${kpiGrid([
        { label: 'Terceros', valor: String(todos.length), sub: `${todos.filter((t) => t.roles.includes('cliente')).length} clientes · ${todos.filter((t) => t.roles.includes('proveedor')).length} proveedores`, icono: 'users', color: '#4A2E1A' },
        { label: 'Sin documento', valor: String(sinDoc), sub: sinDoc ? 'completa su NIT o cédula para la DIAN' : 'todos tienen documento', icono: 'id-card', color: sinDoc ? '#B45309' : '#15803D' },
        { label: 'Nos deben (cartera)', valor: money(cartera.reduce((s, x) => s + x.saldo, 0)), sub: 'según la contabilidad', icono: 'hand-coins', color: '#15803D' },
        { label: 'Debemos (proveedores)', valor: money(deudas.reduce((s, x) => s + x.saldo, 0)), sub: 'según la contabilidad', icono: 'truck', color: '#B91C1C' },
      ])}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
        <div style="flex:1;min-width:220px"><label class="lbl">Buscar</label><input id="tc-q" class="input" placeholder="Nombre, documento o teléfono" value="${esc(_q)}"></div>
        <div><label class="lbl">Tipo</label><select id="tc-rol" class="input"><option value="">Todos</option>
          ${Object.entries(Repo.ROLES).map(([k, v]) => `<option value="${k}" ${_rol === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <button id="tc-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>
      </div>
      ${tarjeta(`${lista.length} tercero(s)`, lista.length === 0 ? vacio('Ningún tercero coincide.') : tabla(
        th('Nombre') + th('Documento') + th('Tipo') + th('Contacto') + th('Nos debe', true) + th('Le debemos', true) + th(''),
        lista.slice(0, TOPE).map((t) => `<tr>
          ${td(`<b>${esc(t.nombre)}</b>${t.nombre_comercial ? `<div style="font-size:12px;color:#A8957F">${esc(t.nombre_comercial)}</div>` : ''}`)}
          ${td(t.numero_doc ? esc(Repo.documentoTexto(t) || t.numero_doc) : '<span style="color:#B45309">Sin documento</span>', false, 'white-space:nowrap')}
          ${td(t.roles.map((r) => chip(Repo.ROLES[r] || r, COLOR_ROL[r] || '#7D6858')).join(' '))}
          ${td(`<div style="font-size:12.5px">${esc(t.telefono || '')}</div><div style="font-size:12px;color:#A8957F">${esc(t.ciudad || '')}</div>`)}
          ${td(saldoCli.get(t.id) ? money(saldoCli.get(t.id)) : '', true)}
          ${td(saldoPro.get(t.id) ? money(saldoPro.get(t.id)) : '', true)}
          ${td(`<button class="btn btn-ghost" data-editar="${esc(t.id)}" style="padding:6px 8px" title="Editar ficha"><i data-lucide="pencil"></i></button>`, true)}
        </tr>`).join('')
        + (lista.length > TOPE ? `<tr><td colspan="7" style="padding:10px;color:#7D6858;font-size:13px">Se muestran ${TOPE} de ${lista.length}. Usa la búsqueda.</td></tr>` : ''),
      ))}
    </div>`;
  refrescarIconos(_c);

  let t;
  _c.querySelector('#tc-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      _q = e.target.value;
      await pintar();
      const i = _c.querySelector('#tc-q');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }, 250);
  });
  _c.querySelector('#tc-rol').addEventListener('change', (e) => { _rol = e.target.value; pintar(); });
  _c.querySelector('#tc-nuevo').addEventListener('click', () => abrirFicha(null));
  _c.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirFicha(todos.find((x) => x.id === b.dataset.editar))));
  _c.querySelector('#tc-xls').addEventListener('click', () => exportar(
    lista.map((x) => ({
      nombre: x.nombre, tipo_doc: x.tipo_doc, numero: x.numero_doc, dv: x.dv, persona: x.tipo_persona,
      roles: x.roles.map((r) => Repo.ROLES[r]).join(', '), telefono: x.telefono, email: x.email, direccion: x.direccion, ciudad: x.ciudad,
      nos_debe: saldoCli.get(x.id) || 0, le_debemos: saldoPro.get(x.id) || 0,
    })),
    [{ clave: 'nombre', etiqueta: 'Nombre' }, { clave: 'tipo_doc', etiqueta: 'Tipo doc.' }, { clave: 'numero', etiqueta: 'Número' }, { clave: 'dv', etiqueta: 'DV' },
     { clave: 'persona', etiqueta: 'Persona' }, { clave: 'roles', etiqueta: 'Tipo' }, { clave: 'telefono', etiqueta: 'Teléfono' }, { clave: 'email', etiqueta: 'Correo' },
     { clave: 'direccion', etiqueta: 'Dirección' }, { clave: 'ciudad', etiqueta: 'Ciudad' }, { clave: 'nos_debe', etiqueta: 'Nos debe' }, { clave: 'le_debemos', etiqueta: 'Le debemos' }],
    'terceros',
  ));
}

/**
 * Formulario de la ficha. Se exporta para crear terceros desde otros
 * módulos (por ejemplo, al hacer un recibo de caja). Devuelve el tercero
 * guardado o null si se cancela.
 */
export function abrirFicha(t, { rolInicial = null } = {}) {
  return new Promise((resolve) => {
    const v = t || { tipo_doc: 'CC', tipo_persona: 'natural', roles: rolInicial ? [rolInicial] : ['cliente'], responsabilidades: [] };
    let guardado = null;
    const contenido = `
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));padding:4px">
        <div><label class="lbl">Persona</label><select id="tf-persona" class="input">
          <option value="natural" ${v.tipo_persona !== 'juridica' ? 'selected' : ''}>Natural</option>
          <option value="juridica" ${v.tipo_persona === 'juridica' ? 'selected' : ''}>Jurídica (empresa)</option></select></div>
        <div><label class="lbl">Tipo de documento</label><select id="tf-tipo" class="input">
          ${Object.entries(Repo.TIPOS_DOC).map(([k, l]) => `<option value="${k}" ${v.tipo_doc === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="lbl">Número</label>
          <div style="display:flex;gap:6px;align-items:center"><input id="tf-num" class="input" inputmode="numeric" value="${esc(v.numero_doc || '')}" style="flex:1">
          <span id="tf-dv" style="font-weight:700;color:#4A2E1A;min-width:34px"></span></div></div>
        <div style="grid-column:1/-1"><label class="lbl">Nombre completo o razón social</label><input id="tf-nombre" class="input" value="${esc(v.nombre || '')}"></div>
        <div style="grid-column:1/-1"><label class="lbl">Nombre comercial (opcional)</label><input id="tf-comercial" class="input" value="${esc(v.nombre_comercial || '')}"></div>
        <div><label class="lbl">Teléfono</label><input id="tf-tel" class="input" value="${esc(v.telefono || '')}"></div>
        <div><label class="lbl">Correo (para facturas)</label><input id="tf-email" class="input" value="${esc(v.email || '')}"></div>
        <div><label class="lbl">Dirección</label><input id="tf-dir" class="input" value="${esc(v.direccion || '')}"></div>
        <div><label class="lbl">Ciudad</label><input id="tf-ciudad" class="input" value="${esc(v.ciudad || '')}"></div>
        <div><label class="lbl">Departamento</label><input id="tf-depto" class="input" value="${esc(v.departamento || '')}"></div>
        <div style="grid-column:1/-1"><label class="lbl">Es…</label><div style="display:flex;gap:14px;flex-wrap:wrap">
          ${Object.entries(Repo.ROLES).map(([k, l]) => `<label style="display:flex;gap:6px;align-items:center;font-size:13.5px">
            <input type="checkbox" data-rol="${k}" ${v.roles?.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div style="grid-column:1/-1"><label class="lbl">Información tributaria (RUT)</label><div style="display:flex;gap:14px;flex-wrap:wrap">
          <label style="display:flex;gap:6px;align-items:center;font-size:13.5px"><input type="checkbox" id="tf-iva" ${v.responsable_iva ? 'checked' : ''}> Responsable de IVA</label>
          ${Object.entries(Repo.RESPONSABILIDADES).map(([k, l]) => `<label style="display:flex;gap:6px;align-items:center;font-size:13.5px">
            <input type="checkbox" data-resp="${k}" ${v.responsabilidades?.includes(k) ? 'checked' : ''}> ${k} ${l}</label>`).join('')}</div></div>
        <div id="tf-aviso" style="grid-column:1/-1;font-size:13px"></div>
        <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button id="tf-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar</button></div>
      </div>`;
    const m = Modal.abrir({ titulo: t ? `Ficha de ${t.nombre}` : 'Nuevo tercero', contenido, ancho: 'lg', onClose: () => resolve(guardado) });
    const b = m.body;
    refrescarIconos(b);
    const leer = () => ({
      ...(t || {}),
      tipo_persona: b.querySelector('#tf-persona').value,
      tipo_doc: b.querySelector('#tf-tipo').value,
      numero_doc: b.querySelector('#tf-num').value,
      nombre: b.querySelector('#tf-nombre').value,
      nombre_comercial: b.querySelector('#tf-comercial').value,
      telefono: b.querySelector('#tf-tel').value,
      email: b.querySelector('#tf-email').value,
      direccion: b.querySelector('#tf-dir').value,
      ciudad: b.querySelector('#tf-ciudad').value,
      departamento: b.querySelector('#tf-depto').value,
      roles: [...b.querySelectorAll('[data-rol]:checked')].map((x) => x.dataset.rol),
      responsable_iva: b.querySelector('#tf-iva').checked,
      responsabilidades: [...b.querySelectorAll('[data-resp]:checked')].map((x) => x.dataset.resp),
    });
    const verDV = async () => {
      const d = leer();
      const num = d.numero_doc.replace(/\D/g, '');
      b.querySelector('#tf-dv').textContent = d.tipo_doc === 'NIT' && num ? `- ${Repo.calcularDV(num)}` : '';
      const dup = await Repo.duplicadoDe(d);
      b.querySelector('#tf-aviso').innerHTML = dup ? `<span style="color:#B45309">Ese documento ya lo tiene <b>${esc(dup.nombre)}</b> (${dup.roles.map((r) => Repo.ROLES[r]).join(', ')}).</span>` : '';
    };
    b.querySelector('#tf-num').addEventListener('input', verDV);
    b.querySelector('#tf-tipo').addEventListener('change', () => {
      if (b.querySelector('#tf-tipo').value === 'NIT') b.querySelector('#tf-persona').value = 'juridica';
      verDV();
    });
    verDV();
    b.querySelector('#tf-guardar').addEventListener('click', async () => {
      const d = leer();
      if (!d.roles.length) { Toast.warn('Marca si es cliente, proveedor, empleado u otro'); return; }
      try {
        guardado = await Repo.guardar(d);
        Toast.ok('Tercero guardado');
        m.cerrar();
        if (_c?.isConnected && _c.querySelector('#tc-q')) pintar();
      } catch (e) { Toast.error(e.message); }
    });
  });
}
