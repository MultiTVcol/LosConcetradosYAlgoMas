/**
 * Pestaña Plan de cuentas: el PUC completo en árbol, con búsqueda.
 * Se pueden crear cuentas, subcuentas y auxiliares (4, 6 u 8 dígitos)
 * y cambiar el nombre de las existentes.
 */

import * as db from '../../../services/db.js';
import * as Motor from '../../../services/motor-contable.js';
import * as PUC from '../puc.repo.js';
import { esc } from '../../../core/strings.js';
import { Toast, Confirm, Modal } from '../../../components/index.js';
import { refrescarIconos } from '../../../app/shell.js';
import { tarjeta, th, td, tabla, vacio } from '../ui.js';

const CLASES = { 1: 'Activo', 2: 'Pasivo', 3: 'Patrimonio', 4: 'Ingresos', 5: 'Gastos', 6: 'Costos', 7: 'Costos de producción' };
let _q = '';
let _clase = '';

const chip = (t, color) => `<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:${color}1A;color:${color};white-space:nowrap">${t}</span>`;

export async function render(el, ctx) {
  const cuentas = await PUC.listar();
  const q = _q.trim().toLowerCase();
  const filtradas = cuentas.filter((c) =>
    (!_clase || c.codigo.charAt(0) === _clase)
    && (!q || c.codigo.startsWith(q) || c.nombre.toLowerCase().includes(q)));

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <div style="flex:1;min-width:220px"><label class="lbl">Buscar</label><input id="pc-q" class="input" placeholder="Código o nombre" value="${esc(_q)}"></div>
      <div><label class="lbl">Clase</label><select id="pc-clase" class="input"><option value="">Todas</option>
        ${Object.entries(CLASES).map(([k, v]) => `<option value="${k}" ${_clase === k ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></div>
      <button id="pc-nueva" class="btn btn-primary"><i data-lucide="plus"></i>Nueva cuenta</button>
    </div>
    ${tarjeta(`${filtradas.length} cuenta(s)`, filtradas.length === 0 ? vacio('Ninguna cuenta coincide.') : tabla(
      th('Código') + th('Nombre') + th('Naturaleza') + th('') + th(''),
      filtradas.map((c) => {
        const peso = c.nivel <= 2 ? 'font-weight:700;' : c.nivel === 4 ? 'font-weight:600;' : '';
        const sangria = { 1: 0, 2: 10, 4: 20, 6: 30, 8: 40 }[c.nivel] || 0;
        const marcas = [
          c.permite_movimiento ? chip('Movimiento', '#15803D') : '',
          c.requiere_tercero ? chip('Tercero', '#1D4ED8') : '',
          c.sistema ? chip('La usa el POS', '#B45309') : '',
          !c.base ? chip('Propia', '#7C3AED') : '',
        ].join(' ');
        return `<tr>
          ${td(`<span style="padding-left:${sangria}px;${peso}">${esc(c.codigo)}</span>`)}
          ${td(`<span style="${peso}">${esc(c.nombre)}</span>`)}
          ${td(c.naturaleza === 'D' ? 'Débito' : 'Crédito')}
          ${td(marcas)}
          ${td(c.nivel >= 4 ? `<button class="btn btn-ghost" data-editar="${c.codigo}" style="padding:5px 8px" title="Editar"><i data-lucide="pencil"></i></button>` : '', true)}
        </tr>`;
      }).join('')))}
  `;

  let t;
  el.querySelector('#pc-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { _q = e.target.value; render(el, ctx).then(() => { refrescarIconos(el); const i = el.querySelector('#pc-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250);
  });
  el.querySelector('#pc-clase').addEventListener('change', (e) => { _clase = e.target.value; render(el, ctx).then(() => refrescarIconos(el)); });
  el.querySelector('#pc-nueva').addEventListener('click', () => formulario(null, el, ctx));
  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => formulario(await PUC.obtener(b.dataset.editar), el, ctx)));
}

async function tieneMovimientos(codigo) {
  return (await db.getAll(Motor.TABLA)).some((a) => (a.lineas || []).some((l) => String(l.cuenta).startsWith(codigo)));
}

function formulario(cuenta, el, ctx) {
  const editando = !!cuenta;
  const contenido = `
    <div style="display:grid;gap:12px;padding:4px">
      <div><label class="lbl">Código</label>
        <input id="pf-codigo" class="input" inputmode="numeric" maxlength="8" value="${esc(cuenta?.codigo || '')}" ${editando ? 'disabled' : ''} placeholder="Ej: 11100501">
        <div style="font-size:12px;color:#A8957F;margin-top:6px">4 dígitos = cuenta · 6 = subcuenta · 8 = auxiliar. La cuenta padre debe existir.</div></div>
      <div><label class="lbl">Nombre</label><input id="pf-nombre" class="input" value="${esc(cuenta?.nombre || '')}"></div>
      <div><label class="lbl">Naturaleza</label><select id="pf-nat" class="input">
        <option value="">La de su cuenta padre</option>
        <option value="D" ${cuenta?.naturaleza === 'D' ? 'selected' : ''}>Débito</option>
        <option value="C" ${cuenta?.naturaleza === 'C' ? 'selected' : ''}>Crédito</option></select></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;color:#5C4636">
        <input id="pf-tercero" type="checkbox" ${cuenta?.requiere_tercero ? 'checked' : ''}> Exige tercero (clientes, proveedores, empleados…)</label>
      <div style="display:flex;justify-content:space-between;gap:10px;margin-top:6px">
        ${editando && !cuenta.base ? `<button id="pf-borrar" class="btn btn-ghost" style="color:#B91C1C"><i data-lucide="trash-2"></i>Borrar</button>` : '<span></span>'}
        <button id="pf-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar</button>
      </div>
    </div>`;
  const m = Modal.abrir({ titulo: editando ? `Cuenta ${cuenta.codigo}` : 'Nueva cuenta', contenido, ancho: 'sm' });
  refrescarIconos(m.body);
  m.body.querySelector('#pf-guardar').addEventListener('click', async () => {
    try {
      await PUC.guardarCuenta({
        codigo: m.body.querySelector('#pf-codigo').value.trim(),
        nombre: m.body.querySelector('#pf-nombre').value,
        naturaleza: m.body.querySelector('#pf-nat').value,
        requiere_tercero: m.body.querySelector('#pf-tercero').checked,
      });
      Toast.ok('Cuenta guardada');
      m.cerrar();
      render(el, ctx).then(() => refrescarIconos(el));
    } catch (e) { Toast.error(e.message); }
  });
  m.body.querySelector('#pf-borrar')?.addEventListener('click', async () => {
    if (!(await Confirm.peligro(`Se borra la cuenta ${cuenta.codigo}.`, { titulo: 'Borrar cuenta' }))) return;
    try {
      await PUC.eliminarCuenta(cuenta.codigo, tieneMovimientos);
      Toast.ok('Cuenta borrada');
      m.cerrar();
      render(el, ctx).then(() => refrescarIconos(el));
    } catch (e) { Toast.error(e.message); }
  });
}
