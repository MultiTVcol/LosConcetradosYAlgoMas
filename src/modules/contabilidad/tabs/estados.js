/**
 * Pestaña Estados financieros: estado de resultados (un rango) y
 * balance general (a una fecha), con el detalle que se escoja
 * (grupo, cuenta o subcuenta), Excel e impresión.
 */

import * as Motor from '../../../services/motor-contable.js';
import { esc } from '../../../core/strings.js';
import { money } from '../../../core/format.js';
import { todayISO, fmtDate } from '../../../core/dates.js';
import { refrescarIconos } from '../../../app/shell.js';
import { tarjeta, th, td, tabla, vacio, aviso, saldo, filasArbol, imprimir, exportar } from '../ui.js';

let _vista = 'resultados';
let _f = { desde: `${todayISO().slice(0, 4)}-01-01`, hasta: todayISO(), nivel: 4 };

const NIVELES = [[2, 'Grupos'], [4, 'Cuentas'], [6, 'Subcuentas'], [8, 'Auxiliares']];

export async function render(el) {
  const esER = _vista === 'resultados';
  const datos = esER ? await Motor.estadoResultados(_f) : await Motor.balanceGeneral({ hasta: _f.hasta });
  const totalFila = (label, v, fuerte = true) => `<tr style="background:#FBF7F1">${td(fuerte ? `<b>${label}</b>` : label)}${td(fuerte ? `<b>${saldo(v)}</b>` : saldo(v), true)}</tr>`;

  let cuerpo;
  if (esER) {
    const d = datos;
    const vacioER = !d.ingresos.length && !d.costos.length && !d.gastos.length;
    cuerpo = vacioER ? vacio('No hay movimientos de resultado en este rango.') : tabla(th('Cuenta') + th('Valor', true), `
      ${filasArbol(d.ingresos, { nivelMax: _f.nivel })}
      ${filasArbol(d.costos, { nivelMax: _f.nivel })}
      ${totalFila('Utilidad bruta', d.utilidadBruta)}
      ${filasArbol(d.gastos, { nivelMax: _f.nivel })}
      ${totalFila('Utilidad operacional', d.utilidadOperacional, false)}
      ${totalFila(d.utilidad >= 0 ? 'UTILIDAD DEL PERIODO' : 'PÉRDIDA DEL PERIODO', d.utilidad)}`);
  } else {
    const d = datos;
    cuerpo = `
      ${d.diferencia !== 0 ? aviso(`El balance no cuadra por ${money(d.diferencia)}. Revisa los pendientes en Resumen.`, 'error') : ''}
      <div style="display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
        <div>${tabla(th('Activo') + th('', true), `${filasArbol(d.activos, { nivelMax: _f.nivel })}${totalFila('TOTAL ACTIVO', d.totalActivo)}`)}</div>
        <div>${tabla(th('Pasivo y patrimonio') + th('', true), `
          ${filasArbol(d.pasivos, { nivelMax: _f.nivel })}${totalFila('Total pasivo', d.totalPasivo)}
          ${filasArbol(d.patrimonio, { nivelMax: _f.nivel })}
          <tr>${td('Resultado del ejercicio (sin cerrar)')}${td(saldo(d.resultado), true)}</tr>
          ${totalFila('Total patrimonio', d.totalPatrimonio)}
          ${totalFila('TOTAL PASIVO + PATRIMONIO', d.totalPasivo + d.totalPatrimonio)}`)}</div>
      </div>`;
  }

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <div style="display:flex;border:1px solid #EADFD0;border-radius:12px;overflow:hidden">
        ${[['resultados', 'Estado de resultados'], ['general', 'Balance general']].map(([k, l]) => `
          <button data-vista="${k}" style="padding:10px 14px;border:0;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;background:${_vista === k ? '#4A2E1A' : '#fff'};color:${_vista === k ? '#fff' : '#5C4636'}">${l}</button>`).join('')}
      </div>
      ${esER ? `<div><label class="lbl">Desde</label><input id="ef-desde" type="date" class="input" value="${_f.desde}"></div>` : ''}
      <div><label class="lbl">${esER ? 'Hasta' : 'Corte al'}</label><input id="ef-hasta" type="date" class="input" value="${_f.hasta}"></div>
      <div><label class="lbl">Detalle</label><select id="ef-nivel" class="input">
        ${NIVELES.map(([n, l]) => `<option value="${n}" ${_f.nivel === n ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div style="flex:1"></div>
      <button id="ef-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>
      <button id="ef-print" class="btn btn-ghost"><i data-lucide="printer"></i>Imprimir</button>
    </div>
    ${tarjeta(esER ? `Estado de resultados del ${fmtDate(_f.desde)} al ${fmtDate(_f.hasta)}` : `Balance general al ${fmtDate(_f.hasta)}`, cuerpo)}
  `;

  const recargar = () => render(el).then(() => refrescarIconos(el));
  el.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => { _vista = b.dataset.vista; recargar(); }));
  el.querySelector('#ef-desde')?.addEventListener('change', (e) => { _f.desde = e.target.value || '0000-01-01'; recargar(); });
  el.querySelector('#ef-hasta').addEventListener('change', (e) => { _f.hasta = e.target.value || todayISO(); recargar(); });
  el.querySelector('#ef-nivel').addEventListener('change', (e) => { _f.nivel = Number(e.target.value); recargar(); });

  const nodos = esER
    ? [...datos.ingresos, ...datos.costos, ...datos.gastos]
    : [...datos.activos, ...datos.pasivos, ...datos.patrimonio];
  const filasPlanas = [
    ...nodos.filter((n) => n.nivel <= _f.nivel).map((n) => ({ codigo: n.codigo, nombre: n.nombre, valor: n.valor })),
    ...(esER
      ? [{ codigo: '', nombre: 'Utilidad bruta', valor: datos.utilidadBruta }, { codigo: '', nombre: 'Utilidad operacional', valor: datos.utilidadOperacional }, { codigo: '', nombre: 'Utilidad del periodo', valor: datos.utilidad }]
      : [{ codigo: '', nombre: 'Resultado del ejercicio (sin cerrar)', valor: datos.resultado }, { codigo: '', nombre: 'Total activo', valor: datos.totalActivo }, { codigo: '', nombre: 'Total pasivo', valor: datos.totalPasivo }, { codigo: '', nombre: 'Total patrimonio', valor: datos.totalPatrimonio }]),
  ];
  const titulo = esER ? 'Estado de resultados' : 'Balance general';
  const sub = esER ? `Del ${fmtDate(_f.desde)} al ${fmtDate(_f.hasta)}` : `Al ${fmtDate(_f.hasta)}`;
  el.querySelector('#ef-xls').addEventListener('click', () => exportar(filasPlanas,
    [{ clave: 'codigo', etiqueta: 'Código' }, { clave: 'nombre', etiqueta: 'Cuenta' }, { clave: 'valor', etiqueta: 'Valor' }],
    `${esER ? 'estado-resultados' : 'balance-general'}-${_f.hasta}`));
  el.querySelector('#ef-print').addEventListener('click', () => imprimir(titulo, sub, `
    <table style="width:100%;border-collapse:collapse;font-size:11px" cellpadding="4">
      ${filasPlanas.map((f) => `<tr style="${f.codigo.length <= 2 ? 'font-weight:700;' : ''}${!f.codigo ? 'font-weight:700;border-top:1px solid #000;' : ''}">
        <td style="padding-left:${Math.max(0, f.codigo.length - 1) * 6}px">${esc(f.codigo)} ${esc(f.nombre)}</td><td align="right">${money(f.valor)}</td></tr>`).join('')}
    </table>
    <div style="display:flex;gap:40px;margin-top:60px;font-size:11px">
      <div style="flex:1;border-top:1px solid #000;padding-top:4px">Representante legal</div>
      <div style="flex:1;border-top:1px solid #000;padding-top:4px">Contador público · T.P.</div>
    </div>`));
}
