/**
 * Pestaña Cierres: cierre de mes (bloquea el periodo para que nadie
 * contabilice en él) y cierre de año (cancela ingresos, costos y gastos
 * contra la utilidad o pérdida del ejercicio).
 */

import * as db from '../../../services/db.js';
import * as Motor from '../../../services/motor-contable.js';
import * as Auth from '../../../services/auth.js';
import { esc } from '../../../core/strings.js';
import { money } from '../../../core/format.js';
import { todayISO, fmtDateTime } from '../../../core/dates.js';
import { Toast, Confirm } from '../../../components/index.js';
import { badge } from '../../../app/ui-kit.js';
import { tarjeta, th, td, tabla, vacio, aviso } from '../ui.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const usuario = () => Auth.usuarioActual()?.nombre || '';

export async function render(el, ctx) {
  const [periodos, asientos] = await Promise.all([Motor.periodos(), db.getAll(Motor.TABLA)]);

  // Meses con movimiento (más el actual), del más reciente al más viejo
  const conMov = new Map();
  for (const a of asientos) {
    const p = a.fecha.slice(0, 7);
    const prev = conMov.get(p) || { n: 0, debitos: 0 };
    prev.n++;
    prev.debitos += a.total_debito || 0;
    conMov.set(p, prev);
  }
  conMov.set(todayISO().slice(0, 7), conMov.get(todayISO().slice(0, 7)) || { n: 0, debitos: 0 });
  const meses = [...new Set([...conMov.keys(), ...Object.keys(periodos)])].sort().reverse();

  const anios = [...new Set(asientos.map((a) => a.fecha.slice(0, 4)))].sort().reverse();
  const cierres = new Map(asientos.filter((a) => a.origen_tipo === 'cierre' && a.estado === 'activo').map((a) => [a.doc_id.replace('cierre_', ''), a]));

  el.innerHTML = `
    ${aviso('Un mes <b>cerrado</b> no admite asientos nuevos. Si se edita una venta de ese mes, la corrección queda con fecha de hoy. Ciérralo cuando el contador haya revisado el mes.')}
    ${tarjeta('Cierre de mes', meses.length === 0 ? vacio('Todavía no hay movimientos.') : tabla(
      th('Mes') + th('Asientos', true) + th('Movimiento', true) + th('Estado') + th(''),
      meses.map((p) => {
        const info = conMov.get(p) || { n: 0, debitos: 0 };
        const cerrado = periodos[p]?.estado === 'cerrado';
        return `<tr>
          ${td(`<b style="text-transform:capitalize">${nombreMes(p)}</b>`)}${td(String(info.n), true)}${td(money(info.debitos), true)}
          ${td(cerrado ? `${badge('Cerrado', 'warn')} <span style="font-size:12px;color:#A8957F">${esc(periodos[p].por || '')} · ${fmtDateTime(periodos[p].fecha)}</span>` : badge('Abierto', 'success'))}
          ${td(cerrado
            ? `<button class="btn btn-ghost" data-reabrir="${p}"><i data-lucide="lock-open"></i>Reabrir</button>`
            : `<button class="btn btn-ghost" data-cerrar="${p}"><i data-lucide="lock"></i>Cerrar mes</button>`, true)}
        </tr>`;
      }).join('')))}
    ${tarjeta('Cierre de año', `
      <p style="margin:0 0 12px;font-size:13.5px;color:#5C4636;line-height:1.5">Pasa la utilidad (o pérdida) del año a la cuenta 3605 (o 3610) con un asiento al 31 de diciembre que deja en cero ingresos, costos y gastos. El estado de resultados lo sigue mostrando igual.</p>
      ${anios.length === 0 ? vacio('Todavía no hay movimientos.') : tabla(th('Año') + th('Estado') + th(''),
        anios.map((y) => {
          const c = cierres.get(y);
          return `<tr>${td(`<b>${y}</b>`)}
            ${td(c ? `${badge('Cerrado', 'warn')} <span style="font-size:12px;color:#A8957F">${esc(c.numero)}</span>` : badge('Abierto', 'success'))}
            ${td(c
              ? `<button class="btn btn-ghost" data-anular-cierre="${c.id}"><i data-lucide="undo-2"></i>Anular cierre</button>`
              : `<button class="btn btn-ghost" data-cerrar-anio="${y}"><i data-lucide="calendar-check"></i>Cerrar ${y}</button>`, true)}</tr>`;
        }).join(''))}`)}
  `;

  el.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', async () => {
    const p = b.dataset.cerrar;
    if (!(await Confirm.preguntar(`Nadie podrá contabilizar en ${nombreMes(p)} mientras esté cerrado.`, { titulo: 'Cerrar mes', textoConfirmar: 'Cerrar' }))) return;
    await Motor.cerrarPeriodo(p, usuario());
    Toast.ok(`Mes ${nombreMes(p)} cerrado`);
    ctx.repintar();
  }));
  el.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
    const p = b.dataset.reabrir;
    if (!(await Confirm.preguntar(`${nombreMes(p)} vuelve a aceptar asientos. Hazlo solo si el contador lo pide.`, { titulo: 'Reabrir mes', textoConfirmar: 'Reabrir' }))) return;
    await Motor.reabrirPeriodo(p, usuario());
    Toast.ok(`Mes ${nombreMes(p)} reabierto`);
    ctx.repintar();
  }));
  el.querySelectorAll('[data-cerrar-anio]').forEach((b) => b.addEventListener('click', async () => {
    const y = b.dataset.cerrarAnio;
    const er = await Motor.estadoResultados({ desde: `${y}-01-01`, hasta: `${y}-12-31` });
    if (!(await Confirm.preguntar(`El ${er.utilidad >= 0 ? 'resultado es una utilidad' : 'resultado es una pérdida'} de ${money(Math.abs(er.utilidad))}. Se registra el asiento de cierre al 31/12/${y}.`, { titulo: `Cerrar el año ${y}`, textoConfirmar: 'Cerrar año' }))) return;
    try {
      await Motor.cerrarEjercicio({ anio: y, usuario: usuario() });
      Toast.ok(`Año ${y} cerrado`);
      ctx.repintar();
    } catch (e) { Toast.error(e.message); }
  }));
  el.querySelectorAll('[data-anular-cierre]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await Confirm.peligro('Se reversa el asiento de cierre del año.', { titulo: 'Anular cierre de año', textoConfirmar: 'Anular' }))) return;
    try {
      await Motor.anularAsiento(b.dataset.anularCierre, 'cierre anulado', usuario());
      Toast.ok('Cierre anulado');
      ctx.repintar();
    } catch (e) { Toast.error(e.message); }
  }));
}
