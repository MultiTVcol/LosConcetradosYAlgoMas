/**
 * Pestaña Activos fijos: registro de muebles, equipos y vehículos con
 * su depreciación en línea recta. Cada mes se corre "Depreciar mes",
 * que crea (o actualiza) un solo asiento con la cuota de cada activo.
 */

import * as Motor from '../../../services/motor-contable.js';
import * as PUC from '../puc.repo.js';
import * as Auth from '../../../services/auth.js';
import { money, num } from '../../../core/format.js';
import { esc } from '../../../core/strings.js';
import { todayISO, fmtDate } from '../../../core/dates.js';
import { Toast, Confirm, Modal } from '../../../components/index.js';
import { tarjeta, th, td, tabla, vacio, aviso, datalistCuentas, codigoDe, exportar } from '../ui.js';

const usuario = () => Auth.usuarioActual()?.nombre || '';

/** Mes anterior al actual (el que normalmente toca depreciar). */
function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export async function render(el, ctx) {
  const [activos, acumulada, cuentas] = await Promise.all([Motor.activosFijos(), Motor.depreciacionAcumulada(), PUC.listar()]);
  const nombre = new Map(cuentas.map((c) => [c.codigo, c.nombre]));
  const filas = activos.sort((a, b) => a.fecha_compra.localeCompare(b.fecha_compra)).map((af) => {
    const dep = acumulada.get(af.id) || 0;
    return { ...af, cuota: Motor.cuotaMensual(af), dep, libros: af.costo - dep };
  });
  const tot = (k) => filas.reduce((s, f) => s + num(f[k]), 0);

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <button id="af-nuevo" class="btn btn-primary"><i data-lucide="plus"></i>Nuevo activo</button>
      <div style="flex:1"></div>
      <div><label class="lbl">Mes a depreciar</label><input id="af-mes" type="month" class="input" value="${mesAnterior()}"></div>
      <button id="af-depreciar" class="btn btn-ghost" ${filas.length ? '' : 'disabled'}><i data-lucide="calculator"></i>Depreciar mes</button>
    </div>
    ${aviso('La depreciación empieza el mes siguiente a la compra. Correr el mismo mes dos veces no duplica: si algo cambió, el asiento se rehace.')}
    ${tarjeta(`${filas.length} activo(s)`, filas.length === 0 ? vacio('Todavía no hay activos fijos registrados.') : tabla(
      th('Activo') + th('Cuenta') + th('Compra') + th('Costo', true) + th('Vida', true) + th('Cuota mes', true) + th('Depreciado', true) + th('Valor en libros', true) + th(''),
      filas.map((f) => `<tr>
        ${td(`<b>${esc(f.nombre)}</b>`)}${td(`<span title="${esc(nombre.get(f.cuenta_activo) || '')}">${f.cuenta_activo}</span>`)}
        ${td(fmtDate(f.fecha_compra), false, 'white-space:nowrap')}${td(money(f.costo), true)}${td(`${f.vida_meses} m`, true)}${td(money(f.cuota), true)}
        ${td(money(f.dep), true)}${td(`<b>${money(f.libros)}</b>`, true)}
        ${td(`<button class="btn btn-ghost" data-editar="${f.id}" style="padding:6px 8px" title="Editar"><i data-lucide="pencil"></i></button>
             <button class="btn btn-ghost" data-borrar="${f.id}" style="padding:6px 8px;color:#B91C1C" title="Eliminar"><i data-lucide="trash-2"></i></button>`, true)}
      </tr>`).join('')
      + `<tr style="background:#FBF7F1">${td('<b>Totales</b>')}${td('')}${td('')}${td(`<b>${money(tot('costo'))}</b>`, true)}${td('')}${td(`<b>${money(tot('cuota'))}</b>`, true)}${td(`<b>${money(tot('dep'))}</b>`, true)}${td(`<b>${money(tot('libros'))}</b>`, true)}${td('')}</tr>`),
      filas.length ? `<button id="af-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>` : '')}
  `;

  el.querySelector('#af-nuevo').addEventListener('click', () => abrirFormulario(null, ctx));
  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirFormulario(activos.find((a) => a.id === b.dataset.editar), ctx)));
  el.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await Confirm.peligro('Se elimina el activo y se reversa el asiento de su compra (si lo tenía). Las depreciaciones ya corridas se conservan hasta que vuelvas a correr esos meses.', { titulo: 'Eliminar activo', textoConfirmar: 'Eliminar' }))) return;
    try {
      await Motor.eliminarActivo(b.dataset.borrar, { usuario: usuario() });
      Toast.ok('Activo eliminado');
      ctx.repintar();
    } catch (e) { Toast.error(e.message); }
  }));
  el.querySelector('#af-depreciar').addEventListener('click', async () => {
    const mes = el.querySelector('#af-mes').value;
    try {
      const r = await Motor.depreciarMes(mes, { usuario: usuario() });
      if (r.activos === 0) Toast.info('Ningún activo se deprecia ese mes');
      else Toast.ok(r.escritos ? `Depreciación de ${mes} registrada (${r.activos} activo(s))` : 'Esa depreciación ya estaba al día');
      ctx.repintar();
    } catch (e) { Toast.error(e.message); }
  });
  el.querySelector('#af-xls')?.addEventListener('click', () => exportar(
    filas.map((f) => ({ nombre: f.nombre, cuenta: f.cuenta_activo, compra: f.fecha_compra, costo: f.costo, residual: f.residual, vida: f.vida_meses, cuota: f.cuota, depreciado: f.dep, libros: f.libros })),
    [{ clave: 'nombre', etiqueta: 'Activo' }, { clave: 'cuenta', etiqueta: 'Cuenta' }, { clave: 'compra', etiqueta: 'Fecha compra' }, { clave: 'costo', etiqueta: 'Costo' },
     { clave: 'residual', etiqueta: 'Residual' }, { clave: 'vida', etiqueta: 'Vida (meses)' }, { clave: 'cuota', etiqueta: 'Cuota mensual' },
     { clave: 'depreciado', etiqueta: 'Depreciación acumulada' }, { clave: 'libros', etiqueta: 'Valor en libros' }],
    `activos-fijos-${todayISO()}`,
  ));
}

async function abrirFormulario(af, ctx) {
  const C = ctx.cfg.cuentas;
  const v = af || { fecha_compra: todayISO(), vida_meses: 60, residual: 0, cuenta_activo: '152805', cuenta_acumulada: '159220', cuenta_gasto: '516020', contrapartida: '' };
  const contenido = `
    ${await datalistCuentas('af-cuentas')}
    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:4px">
      <div style="grid-column:1/-1"><label class="lbl">Nombre del activo</label><input id="f-nombre" class="input" value="${esc(v.nombre || '')}" placeholder="Ej: Computador de la caja"></div>
      <div><label class="lbl">Cuenta del activo</label><input id="f-activo" list="af-cuentas" class="input" value="${esc(v.cuenta_activo)}"></div>
      <div><label class="lbl">Fecha de compra</label><input id="f-fecha" type="date" class="input" value="${v.fecha_compra}"></div>
      <div><label class="lbl">Costo</label><input id="f-costo" class="input" inputmode="numeric" value="${v.costo ? Math.round(v.costo) : ''}"></div>
      <div><label class="lbl">Vida útil (meses)</label><input id="f-vida" class="input" inputmode="numeric" value="${v.vida_meses}"></div>
      <div><label class="lbl">Valor residual</label><input id="f-residual" class="input" inputmode="numeric" value="${Math.round(v.residual || 0)}"></div>
      <div><label class="lbl">Depreciación acumulada (cuenta)</label><input id="f-acum" list="af-cuentas" class="input" value="${esc(v.cuenta_acumulada)}"></div>
      <div><label class="lbl">Gasto por depreciación (cuenta)</label><input id="f-gasto" list="af-cuentas" class="input" value="${esc(v.cuenta_gasto)}"></div>
      <div style="grid-column:1/-1"><label class="lbl">¿Registrar también la compra? Se pagó con…</label>
        <select id="f-contra" class="input">
          <option value="">No, ya estaba en los saldos iniciales o se registró aparte</option>
          <option value="${C.medios.efectivo}" ${v.contrapartida === C.medios.efectivo ? 'selected' : ''}>Efectivo (${C.medios.efectivo})</option>
          <option value="${C.medios.transferencia}" ${v.contrapartida === C.medios.transferencia ? 'selected' : ''}>Banco (${C.medios.transferencia})</option>
          <option value="233595" ${v.contrapartida === '233595' ? 'selected' : ''}>Quedó debiendo (233595 cuentas por pagar)</option>
        </select></div>
      <div style="grid-column:1/-1"><label class="lbl">Proveedor (si quedó debiendo)</label><input id="f-tercero" class="input" value="${esc(v.tercero_nombre || '')}"></div>
      <div id="f-cuota" style="grid-column:1/-1;font-size:13.5px;color:#5C4636"></div>
      <div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button id="f-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar activo</button></div>
    </div>`;
  const m = Modal.abrir({ titulo: af ? 'Editar activo fijo' : 'Nuevo activo fijo', contenido, ancho: 'lg' });
  const b = m.body;
  const val = (id) => b.querySelector(id).value;
  const n = (id) => num(String(val(id)).replace(/[^\d.]/g, ''));
  const cuota = () => {
    const c = Motor.cuotaMensual({ costo: n('#f-costo'), residual: n('#f-residual'), vida_meses: n('#f-vida') });
    b.querySelector('#f-cuota').innerHTML = c > 0 ? `Cuota mensual de depreciación: <b>${money(c)}</b>` : '';
  };
  ['#f-costo', '#f-residual', '#f-vida'].forEach((id) => b.querySelector(id).addEventListener('input', cuota));
  cuota();
  // Al cambiar la cuenta del activo, sugerir las de depreciación y la vida útil
  b.querySelector('#f-activo').addEventListener('change', () => {
    const s = Motor.DEPRECIACION_SUGERIDA[codigoDe(val('#f-activo')).slice(0, 4)];
    if (!s) return;
    b.querySelector('#f-acum').value = s.acumulada;
    b.querySelector('#f-gasto').value = s.gasto;
    b.querySelector('#f-vida').value = s.vida;
    cuota();
  });
  b.querySelector('#f-guardar').addEventListener('click', async () => {
    const contra = val('#f-contra');
    const ter = val('#f-tercero').trim();
    if (contra === '233595' && !ter) { Toast.warn('Escribe a quién se le quedó debiendo'); return; }
    try {
      await Motor.guardarActivo({
        id: af?.id, nombre: val('#f-nombre'),
        cuenta_activo: codigoDe(val('#f-activo')), cuenta_acumulada: codigoDe(val('#f-acum')), cuenta_gasto: codigoDe(val('#f-gasto')),
        fecha_compra: val('#f-fecha'), costo: n('#f-costo'), residual: n('#f-residual'), vida_meses: n('#f-vida'),
        contrapartida: contra,
        tercero_id: contra === '233595' ? `ter:${ter}` : null,
        tercero_nombre: contra === '233595' ? ter : '',
      }, { usuario: usuario() });
      Toast.ok('Activo guardado');
      m.cerrar();
      ctx.repintar();
    } catch (e) { Toast.error(e.message); }
  });
}
