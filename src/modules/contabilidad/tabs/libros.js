/**
 * Pestaña Libros: libro mayor / auxiliar de una cuenta (o grupo de
 * cuentas por prefijo), con saldo corrido, filtro por tercero y los
 * saldos por tercero de la cuenta (cartera, proveedores…).
 */

import * as Motor from '../../../services/motor-contable.js';
import { money } from '../../../core/format.js';
import { esc } from '../../../core/strings.js';
import { todayISO, fmtDate, startOfMonth } from '../../../core/dates.js';
import { refrescarIconos } from '../../../app/shell.js';
import { tarjeta, th, td, tabla, vacio, saldo, datalistCuentas, codigoDe, imprimir, exportar } from '../ui.js';

let _f = { cuenta: '110505', desde: startOfMonth(), hasta: todayISO(), tercero: '' };

export async function render(el) {
  const cuenta = codigoDe(_f.cuenta);
  const [lista, mayor, terceros] = await Promise.all([
    datalistCuentas('lb-cuentas', false),
    cuenta ? Motor.libroMayor(cuenta, { desde: _f.desde || '0000', hasta: _f.hasta || '9999', tercero_id: _f.tercero || null }) : null,
    cuenta ? Motor.saldosPorTercero(cuenta, { hasta: _f.hasta || '9999' }) : [],
  ]);

  const titulo = mayor ? `${mayor.cuenta} ${mayor.nombre}` : '';
  const conTerceros = terceros.some((t) => t.tercero_id);
  const nombreTercero = terceros.find((t) => t.tercero_id === _f.tercero)?.tercero_nombre || '';

  el.innerHTML = `
    ${lista}
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <div style="flex:1;min-width:240px"><label class="lbl">Cuenta (o grupo: 1105, 13…)</label>
        <input id="lb-cuenta" list="lb-cuentas" class="input" value="${esc(_f.cuenta)}" placeholder="Código o nombre"></div>
      <div><label class="lbl">Desde</label><input id="lb-desde" type="date" class="input" value="${_f.desde}"></div>
      <div><label class="lbl">Hasta</label><input id="lb-hasta" type="date" class="input" value="${_f.hasta}"></div>
      ${conTerceros ? `<div style="min-width:200px"><label class="lbl">Tercero</label>
        <select id="lb-tercero" class="input"><option value="">Todos</option>
          ${terceros.filter((t) => t.tercero_id).map((t) => `<option value="${esc(t.tercero_id)}" ${t.tercero_id === _f.tercero ? 'selected' : ''}>${esc(t.tercero_nombre)}</option>`).join('')}
        </select></div>` : ''}
    </div>
    ${!mayor ? tarjeta('', vacio('Escribe una cuenta para ver su libro.')) : tarjeta(`Libro ${cuenta.length >= 6 ? 'auxiliar' : 'mayor'} · ${esc(titulo)}${nombreTercero ? ` · ${esc(nombreTercero)}` : ''}`, `
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">
        ${[['Saldo inicial', mayor.saldoInicial], ['Débitos', mayor.debitos], ['Créditos', mayor.creditos], ['Saldo final', mayor.saldoFinal]].map(([l, v]) => `
          <div style="background:#FBF7F1;border-radius:12px;padding:10px 14px"><div style="font-size:12px;color:#7D6858">${l}</div><div style="font-weight:700;font-size:17px">${saldo(v)}</div></div>`).join('')}
      </div>
      ${mayor.movimientos.length === 0 ? vacio('Sin movimientos en este rango.') : tabla(
        th('Fecha') + th('Número') + th('Cuenta') + th('Tercero') + th('Detalle') + th('Débito', true) + th('Crédito', true) + th('Saldo', true),
        mayor.movimientos.map((m) => `<tr>${td(fmtDate(m.fecha), false, 'white-space:nowrap')}${td(esc(m.numero), false, 'white-space:nowrap')}${td(esc(m.cuenta))}${td(esc(m.tercero_nombre || ''))}
          ${td(`${esc(m.detalle)} <span style="color:#A8957F">· ${esc(m.descripcion)}</span>`)}
          ${td(m.debito ? money(m.debito) : '', true)}${td(m.credito ? money(m.credito) : '', true)}${td(saldo(m.saldo), true)}</tr>`).join(''))}
      <p style="font-size:12px;color:#A8957F;margin:10px 0 0">Saldos en la naturaleza de la cuenta (${mayor.naturaleza === 'D' ? 'débito' : 'crédito'}). Entre paréntesis, saldo contrario.</p>
    `, `<div style="display:flex;gap:8px">
        <button id="lb-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>
        <button id="lb-print" class="btn btn-ghost"><i data-lucide="printer"></i>Imprimir</button></div>`)}
    ${conTerceros ? tarjeta(`Saldos por tercero al ${fmtDate(_f.hasta || todayISO())}`, tabla(
      th('Tercero') + th('Saldo', true),
      terceros.map((t) => `<tr>${td(esc(t.tercero_nombre))}${td(saldo(t.saldo), true)}</tr>`).join('')
      + `<tr>${td('<b>Total</b>')}${td(`<b>${saldo(terceros.reduce((s, t) => s + t.saldo, 0))}</b>`, true)}</tr>`)) : ''}
  `;

  const recargar = () => {
    const nuevaCuenta = el.querySelector('#lb-cuenta').value;
    _f = {
      cuenta: nuevaCuenta, desde: el.querySelector('#lb-desde').value, hasta: el.querySelector('#lb-hasta').value,
      tercero: codigoDe(nuevaCuenta) === cuenta ? (el.querySelector('#lb-tercero')?.value || '') : '',
    };
    render(el).then(() => refrescarIconos(el));
  };
  el.querySelector('#lb-cuenta').addEventListener('change', recargar);
  el.querySelector('#lb-desde').addEventListener('change', recargar);
  el.querySelector('#lb-hasta').addEventListener('change', recargar);
  el.querySelector('#lb-tercero')?.addEventListener('change', recargar);

  if (!mayor) return;
  const rango = `Del ${fmtDate(_f.desde || '0000-01-01')} al ${fmtDate(_f.hasta || todayISO())}`;
  el.querySelector('#lb-xls').addEventListener('click', () => exportar(
    [{ fecha: '', numero: '', cuenta: '', tercero: '', detalle: 'Saldo inicial', debito: '', credito: '', saldo: mayor.saldoInicial },
     ...mayor.movimientos.map((m) => ({ fecha: m.fecha, numero: m.numero, cuenta: m.cuenta, tercero: m.tercero_nombre || '', detalle: `${m.detalle} · ${m.descripcion}`, debito: m.debito, credito: m.credito, saldo: m.saldo }))],
    [{ clave: 'fecha', etiqueta: 'Fecha' }, { clave: 'numero', etiqueta: 'Número' }, { clave: 'cuenta', etiqueta: 'Cuenta' }, { clave: 'tercero', etiqueta: 'Tercero' },
     { clave: 'detalle', etiqueta: 'Detalle' }, { clave: 'debito', etiqueta: 'Débito' }, { clave: 'credito', etiqueta: 'Crédito' }, { clave: 'saldo', etiqueta: 'Saldo' }],
    `libro-${cuenta}-${_f.desde}-${_f.hasta}`,
  ));
  el.querySelector('#lb-print').addEventListener('click', () => imprimir(`Libro auxiliar ${titulo}`, `${rango}${nombreTercero ? ` · ${nombreTercero}` : ''}`, `
    <table style="width:100%;border-collapse:collapse;font-size:10.5px" cellpadding="4">
      <tr style="border-bottom:1px solid #000"><th align="left">Fecha</th><th align="left">Número</th><th align="left">Tercero</th><th align="left">Detalle</th><th align="right">Débito</th><th align="right">Crédito</th><th align="right">Saldo</th></tr>
      <tr><td colspan="6"><b>Saldo inicial</b></td><td align="right"><b>${money(mayor.saldoInicial)}</b></td></tr>
      ${mayor.movimientos.map((m) => `<tr><td>${fmtDate(m.fecha)}</td><td>${esc(m.numero)}</td><td>${esc(m.tercero_nombre || '')}</td><td>${esc(m.detalle)}</td>
        <td align="right">${m.debito ? money(m.debito) : ''}</td><td align="right">${m.credito ? money(m.credito) : ''}</td><td align="right">${money(m.saldo)}</td></tr>`).join('')}
      <tr style="border-top:1px solid #000"><td colspan="4"><b>Totales</b></td><td align="right"><b>${money(mayor.debitos)}</b></td><td align="right"><b>${money(mayor.creditos)}</b></td><td align="right"><b>${money(mayor.saldoFinal)}</b></td></tr>
    </table>`));
}
