/**
 * Pestaña Resumen: interruptor, fecha de inicio, revisión general,
 * pendientes y balance de prueba (que SIEMPRE debe cuadrar).
 */

import * as db from '../../../services/db.js';
import * as Sync from '../../../services/sync.js';
import * as Motor from '../../../services/motor-contable.js';
import * as Servicio from '../contabilidad.service.js';
import { money } from '../../../core/format.js';
import { esc } from '../../../core/strings.js';
import { fmtDate, todayISO } from '../../../core/dates.js';
import { Toast, Confirm } from '../../../components/index.js';
import { kpiGrid } from '../../../app/ui-kit.js';
import { tarjeta, th, td, tabla, vacio, aviso, saldo, imprimir, exportar } from '../ui.js';

export async function render(el, ctx) {
  const cfg = ctx.cfg;
  const hasta = todayISO();
  const [asientos, errores, bp, tablaNube] = await Promise.all([
    db.getAll(Motor.TABLA), Servicio.errores(), Motor.balancePrueba({ hasta }), Servicio.verificarTablaNube(),
  ]);
  const faltaTabla = tablaNube === 'falta' && !Sync.esSoloLectura();

  const estado = `
    <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:end">
      <div>
        <label class="lbl">Fecha de inicio contable</label>
        <input id="ct-inicio" type="date" class="input" value="${esc(cfg.fecha_inicio)}" ${cfg.activa ? 'disabled' : ''}>
        <div style="font-size:12px;color:#A8957F;margin-top:6px">Lo anterior a esta fecha no se contabiliza; entra como saldo inicial.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${cfg.activa
          ? `<button id="ct-apagar" class="btn btn-ghost"><i data-lucide="power"></i>Apagar contabilidad</button>`
          : `<button id="ct-activar" class="btn btn-primary" ${faltaTabla ? 'disabled' : ''}><i data-lucide="power"></i>Activar contabilidad</button>`}
      </div>
    </div>
    ${faltaTabla ? `<div style="margin-top:16px">${aviso('Falta la tabla <b>asientos</b> en Supabase. Corre el archivo <code>supabase-contabilidad.sql</code> en el SQL Editor y vuelve a esta pantalla.', 'error')}</div>` : ''}
  `;

  const kpis = kpiGrid([
    { label: 'Asientos', valor: String(asientos.length), sub: 'causaciones registradas', icono: 'list', color: '#4A2E1A' },
    { label: 'Pendientes por revisar', valor: String(errores.length), sub: errores.length ? 'documentos sin asiento' : 'todo contabilizado', icono: 'alert-triangle', color: errores.length ? '#B45309' : '#15803D' },
    { label: 'Débitos = Créditos', valor: bp.cuadrado ? 'Cuadra' : 'Descuadre', sub: `${money(bp.totalDebitos)} / ${money(bp.totalCreditos)}`, icono: 'scale', color: bp.cuadrado ? '#15803D' : '#B91C1C' },
  ]);

  const pendientes = errores.length === 0 ? '' : tarjeta('Pendientes por revisar', tabla(
    th('Documento') + th('Número') + th('Motivo'),
    errores.map((e) => `<tr>${td(esc(e.tabla))}${td(esc(e.numero || e.id))}${td(esc(e.error), false, 'color:#8A1C1C')}</tr>`).join(''),
  ), `<button id="ct-reintentar" class="btn btn-ghost"><i data-lucide="rotate-cw"></i>Reintentar</button>`);

  const balance = tarjeta(`Balance de prueba al ${fmtDate(hasta)}`, bp.filas.length === 0
    ? vacio('Todavía no hay asientos.')
    : tabla(
      th('Cuenta') + th('Nombre') + th('Débitos', true) + th('Créditos', true) + th('Saldo', true),
      bp.filas.map((f) => `<tr>${td(esc(f.cuenta))}${td(esc(f.nombre))}${td(money(f.debitos), true)}${td(money(f.creditos), true)}${td(saldo(f.saldoFinal), true)}</tr>`).join('')
      + `<tr>${td('<b>Totales</b>')}${td('')}${td(`<b>${money(bp.totalDebitos)}</b>`, true)}${td(`<b>${money(bp.totalCreditos)}</b>`, true)}${td('')}</tr>`,
    ), `<div style="display:flex;gap:8px;flex-wrap:wrap">
      ${bp.filas.length ? `<button id="ct-bp-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>
      <button id="ct-bp-print" class="btn btn-ghost"><i data-lucide="printer"></i>Imprimir</button>` : ''}
      ${cfg.activa ? `<button id="ct-revisar" class="btn btn-ghost"><i data-lucide="refresh-ccw"></i>Revisar y contabilizar todo</button>` : ''}
    </div>`);

  el.innerHTML = tarjeta('Estado', estado) + kpis + `<div id="ct-progreso"></div>` + pendientes + balance;

  el.querySelector('#ct-activar')?.addEventListener('click', () => activar(el, ctx));
  el.querySelector('#ct-apagar')?.addEventListener('click', async () => {
    if (!(await Confirm.preguntar('Las ventas nuevas dejarán de contabilizarse hasta que la vuelvas a activar. Los asientos que ya existen se conservan.', { titulo: 'Apagar contabilidad', textoConfirmar: 'Apagar' }))) return;
    await Motor.guardarConfig({ activa: false });
    Toast.ok('Contabilidad apagada');
    ctx.repintar();
  });
  el.querySelector('#ct-revisar')?.addEventListener('click', () => revisarTodo(el, ctx));
  el.querySelector('#ct-reintentar')?.addEventListener('click', async () => {
    const r = await Servicio.reintentarPendientes();
    if (r.fallan) Toast.warn(`${r.ok} corregidos, ${r.fallan} siguen pendientes`);
    else Toast.ok('Pendientes contabilizados');
    ctx.repintar();
  });
  el.querySelector('#ct-bp-xls')?.addEventListener('click', () => exportar(
    bp.filas.map((f) => ({ cuenta: f.cuenta, nombre: f.nombre, anterior: f.saldoAnterior, debitos: f.debitos, creditos: f.creditos, saldo: f.saldoFinal })),
    [{ clave: 'cuenta', etiqueta: 'Cuenta' }, { clave: 'nombre', etiqueta: 'Nombre' }, { clave: 'debitos', etiqueta: 'Débitos' }, { clave: 'creditos', etiqueta: 'Créditos' }, { clave: 'saldo', etiqueta: 'Saldo' }],
    `balance-prueba-${hasta}`,
  ));
  el.querySelector('#ct-bp-print')?.addEventListener('click', () => imprimir('Balance de prueba', `Al ${fmtDate(hasta)}`, `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <tr><th align="left">Cuenta</th><th align="left">Nombre</th><th align="right">Débitos</th><th align="right">Créditos</th><th align="right">Saldo</th></tr>
      ${bp.filas.map((f) => `<tr><td>${f.cuenta}</td><td>${esc(f.nombre)}</td><td align="right">${money(f.debitos)}</td><td align="right">${money(f.creditos)}</td><td align="right">${money(f.saldoFinal)}</td></tr>`).join('')}
      <tr><td colspan="2"><b>Totales</b></td><td align="right"><b>${money(bp.totalDebitos)}</b></td><td align="right"><b>${money(bp.totalCreditos)}</b></td><td></td></tr>
    </table>`));
}

async function activar(el, ctx) {
  const fecha = el.querySelector('#ct-inicio')?.value;
  if (!fecha) { Toast.warn('Escoge primero la fecha de inicio contable'); return; }
  const ok = await Confirm.preguntar(
    `Se van a contabilizar todas las ventas, compras, gastos y ajustes desde el ${fmtDate(fecha)}. Después, cada operación nueva crea su asiento sola.`,
    { titulo: 'Activar contabilidad', textoConfirmar: 'Activar' },
  );
  if (!ok) return;
  await Motor.guardarConfig({ activa: true, fecha_inicio: fecha });
  await revisarTodo(el, ctx);
}

async function revisarTodo(el, ctx) {
  if (ctx.ocupado) return;
  ctx.ocupado = true;
  const prog = el.querySelector('#ct-progreso');
  const mostrar = (t) => { if (prog) prog.innerHTML = aviso(`⏳ ${t}`); };
  mostrar('Revisando documentos…');
  try {
    const r = await Servicio.contabilizarTodo({
      onProgress: (p) => mostrar(p.fase === 'guardando'
        ? `Guardando asientos ${p.n} de ${p.total}…`
        : `Revisando documentos ${p.n} de ${p.total}…`),
    });
    if (r.errores.length) Toast.warn(`${r.escritos} asientos escritos · ${r.errores.length} documentos pendientes`);
    else Toast.ok(r.escritos ? `${r.escritos} asientos escritos` : 'Todo estaba al día');
  } catch (e) {
    Toast.error(e.message || 'No se pudo contabilizar');
  } finally {
    ctx.ocupado = false;
    ctx.repintar();
  }
}
