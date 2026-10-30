/**
 * Pestaña Asientos: el libro diario con sus líneas, comprobantes
 * manuales (ajustes del contador), anulación e impresión.
 */

import * as db from '../../../services/db.js';
import * as Motor from '../../../services/motor-contable.js';
import * as PUC from '../puc.repo.js';
import * as Auth from '../../../services/auth.js';
import { money, num, round } from '../../../core/format.js';
import { esc } from '../../../core/strings.js';
import { todayISO, fmtDate, startOfMonth } from '../../../core/dates.js';
import { Toast, Confirm, Modal } from '../../../components/index.js';
import { refrescarIconos } from '../../../app/shell.js';
import { badge } from '../../../app/ui-kit.js';
import { tarjeta, th, td, tabla, vacio, datalistCuentas, codigoDe, imprimir, exportar } from '../ui.js';

export const ORIGENES = {
  venta: 'Venta', recaudo: 'Recaudo', compra: 'Compra', pago: 'Pago a proveedor',
  gasto: 'Gasto', baja: 'Baja de productos', ajuste_inventario: 'Ajuste de inventario',
  apertura: 'Saldos iniciales', reversion: 'Reversión', manual: 'Comprobante manual',
  cierre: 'Cierre de año', depreciacion: 'Depreciación', activo_compra: 'Compra de activo',
};

const ANULABLES = new Set(['manual', 'apertura', 'cierre', 'depreciacion', 'activo_compra']);
const TOPE = 300;

let _filtro = { desde: startOfMonth(), hasta: todayISO(), q: '', tipo: '' };
let _cuentas = new Map();

export async function render(el, ctx) {
  _cuentas = new Map((await PUC.listar()).map((c) => [c.codigo, c.nombre]));
  const lista = (await Motor.libroDiario({ desde: _filtro.desde || '0000', hasta: _filtro.hasta || '9999' })).reverse();
  const q = _filtro.q.trim().toLowerCase();
  const filtrados = lista.filter((a) =>
    (!_filtro.tipo || a.origen_tipo === _filtro.tipo)
    && (!q || `${a.numero} ${a.descripcion}`.toLowerCase().includes(q)
      || (a.lineas || []).some((l) => l.cuenta.startsWith(q) || String(l.tercero_nombre || '').toLowerCase().includes(q))));

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <div><label class="lbl">Desde</label><input id="as-desde" type="date" class="input" value="${_filtro.desde}"></div>
      <div><label class="lbl">Hasta</label><input id="as-hasta" type="date" class="input" value="${_filtro.hasta}"></div>
      <div><label class="lbl">Tipo</label>
        <select id="as-tipo" class="input"><option value="">Todos</option>
          ${Object.entries(ORIGENES).map(([k, v]) => `<option value="${k}" ${_filtro.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <div style="flex:1;min-width:200px"><label class="lbl">Buscar</label><input id="as-q" class="input" placeholder="Número, descripción, cuenta o tercero" value="${esc(_filtro.q)}"></div>
      <button id="as-nuevo" class="btn btn-primary"><i data-lucide="plus"></i>Nuevo comprobante</button>
    </div>
    ${tarjeta(`${filtrados.length} asiento(s)`, filtrados.length === 0
      ? vacio('No hay asientos con estos filtros.')
      : filtrados.slice(0, TOPE).map(htmlAsiento).join('')
        + (filtrados.length > TOPE ? `<div style="color:#7D6858;font-size:13px;margin-top:10px">Se muestran los ${TOPE} más recientes. Acota el rango para ver más.</div>` : ''),
      filtrados.length ? `<button id="as-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>` : '')}
  `;

  const recargar = () => {
    _filtro = {
      desde: el.querySelector('#as-desde').value, hasta: el.querySelector('#as-hasta').value,
      q: el.querySelector('#as-q').value, tipo: el.querySelector('#as-tipo').value,
    };
    render(el, ctx).then(() => refrescarIconos(el));
  };
  el.querySelector('#as-desde').addEventListener('change', recargar);
  el.querySelector('#as-hasta').addEventListener('change', recargar);
  el.querySelector('#as-tipo').addEventListener('change', recargar);
  let t;
  el.querySelector('#as-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(recargar, 300); });
  el.querySelector('#as-nuevo').addEventListener('click', () => abrirComprobante(() => recargar()));
  el.querySelector('#as-xls')?.addEventListener('click', () => exportar(
    filtrados.flatMap((a) => (a.lineas || []).map((l) => ({
      fecha: a.fecha, numero: a.numero, tipo: ORIGENES[a.origen_tipo] || a.origen_tipo, descripcion: a.descripcion,
      cuenta: l.cuenta, nombre: _cuentas.get(l.cuenta) || '', tercero: l.tercero_nombre || '', detalle: l.detalle,
      debito: l.debito, credito: l.credito,
    }))),
    [{ clave: 'fecha', etiqueta: 'Fecha' }, { clave: 'numero', etiqueta: 'Número' }, { clave: 'tipo', etiqueta: 'Tipo' },
     { clave: 'descripcion', etiqueta: 'Descripción' }, { clave: 'cuenta', etiqueta: 'Cuenta' }, { clave: 'nombre', etiqueta: 'Nombre cuenta' },
     { clave: 'tercero', etiqueta: 'Tercero' }, { clave: 'detalle', etiqueta: 'Detalle' }, { clave: 'debito', etiqueta: 'Débito' }, { clave: 'credito', etiqueta: 'Crédito' }],
    `libro-diario-${_filtro.desde}-${_filtro.hasta}`,
  ));
  el.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await Confirm.peligro('Se crea un asiento inverso con fecha de hoy. El original queda marcado como reversado.', { titulo: 'Anular asiento', textoConfirmar: 'Anular' }))) return;
    try {
      await Motor.anularAsiento(b.dataset.anular, 'anulado por el usuario', Auth.usuarioActual()?.nombre || '');
      Toast.ok('Asiento anulado');
      recargar();
    } catch (e) { Toast.error(e.message); }
  }));
  el.querySelectorAll('[data-imprimir]').forEach((b) => b.addEventListener('click', async () => {
    const a = await db.get(Motor.TABLA, b.dataset.imprimir);
    if (a) imprimirComprobante(a);
  }));
}

function htmlAsiento(a) {
  const estado = a.estado === 'reversado' ? badge('Reversado', 'warn') : a.origen_tipo === 'reversion' ? badge('Reversión', 'info') : '';
  const anulable = ANULABLES.has(a.origen_tipo) && a.estado === 'activo';
  return `
    <details style="border:1px solid #F3ECE3;border-radius:12px;margin-bottom:8px;${a.estado === 'reversado' ? 'opacity:.7' : ''}">
      <summary style="display:flex;gap:12px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none;flex-wrap:wrap">
        <span style="font-size:12.5px;color:#7D6858;min-width:84px">${fmtDate(a.fecha)}</span>
        <span style="font-weight:700;font-size:13px;min-width:110px">${esc(a.numero)}</span>
        <span style="flex:1;font-size:13px;min-width:180px">${esc(a.descripcion)} <span style="color:#A8957F">· ${ORIGENES[a.origen_tipo] || a.origen_tipo}</span></span>
        ${estado}
        <span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${money(a.total_debito)}</span>
      </summary>
      <div style="padding:0 14px 12px">
        ${tabla(th('Cuenta') + th('Tercero') + th('Detalle') + th('Débito', true) + th('Crédito', true),
          (a.lineas || []).map((l) => `<tr>
            ${td(`<b>${esc(l.cuenta)}</b> ${esc(_cuentas.get(l.cuenta) || '')}`)}
            ${td(esc(l.tercero_nombre || ''))}${td(esc(l.detalle))}
            ${td(l.debito ? money(l.debito) : '', true)}${td(l.credito ? money(l.credito) : '', true)}</tr>`).join(''))}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button class="btn btn-ghost" data-imprimir="${a.id}"><i data-lucide="printer"></i>Imprimir</button>
          ${anulable ? `<button class="btn btn-ghost" data-anular="${a.id}" style="color:#B91C1C"><i data-lucide="undo-2"></i>Anular</button>` : ''}
        </div>
      </div>
    </details>`;
}

function imprimirComprobante(a) {
  const totD = round((a.lineas || []).reduce((s, l) => s + num(l.debito), 0), 2);
  const totC = round((a.lineas || []).reduce((s, l) => s + num(l.credito), 0), 2);
  imprimir(`Comprobante ${a.numero}`, `${fmtDate(a.fecha)} · ${ORIGENES[a.origen_tipo] || a.origen_tipo}`, `
    <p style="margin:0 0 12px"><b>Concepto:</b> ${esc(a.descripcion)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:11px" border="1" cellpadding="5">
      <tr><th align="left">Cuenta</th><th align="left">Tercero</th><th align="left">Detalle</th><th align="right">Débito</th><th align="right">Crédito</th></tr>
      ${(a.lineas || []).map((l) => `<tr><td>${l.cuenta} ${esc(_cuentas.get(l.cuenta) || '')}</td><td>${esc(l.tercero_nombre || '')}</td><td>${esc(l.detalle)}</td>
        <td align="right">${l.debito ? money(l.debito) : ''}</td><td align="right">${l.credito ? money(l.credito) : ''}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Sumas iguales</b></td><td align="right"><b>${money(totD)}</b></td><td align="right"><b>${money(totC)}</b></td></tr>
    </table>
    <div style="display:flex;gap:40px;margin-top:50px;font-size:11px">
      <div style="flex:1;border-top:1px solid #000;padding-top:4px">Elaboró${a.creado_por ? `: ${esc(a.creado_por)}` : ''}</div>
      <div style="flex:1;border-top:1px solid #000;padding-top:4px">Revisó</div>
      <div style="flex:1;border-top:1px solid #000;padding-top:4px">Aprobó</div>
    </div>`);
}

// ============================================================
//  COMPROBANTE MANUAL
// ============================================================

/** Terceros conocidos (clientes y proveedores) para elegir en las líneas. */
async function terceros() {
  const [clientes, proveedores] = await Promise.all([db.getAll('clientes'), db.getAll('proveedores')]);
  return [
    ...clientes.map((c) => ({ id: c.id, nombre: c.nombre || '', tipo: 'Cliente' })),
    ...proveedores.map((p) => ({ id: p.id, nombre: p.nombre || '', tipo: 'Proveedor' })),
  ].filter((t) => t.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function abrirComprobante(alGuardar) {
  const lista = await terceros();
  const lineas = [{}, {}];
  const contenido = `
    ${await datalistCuentas('cc-cuentas')}
    <datalist id="cc-terceros">${lista.map((t) => `<option value="${esc(t.nombre)}">${t.tipo}</option>`).join('')}</datalist>
    <div style="padding:4px 4px 0">
      <div style="display:grid;grid-template-columns:170px 1fr;gap:12px;margin-bottom:14px">
        <div><label class="lbl">Fecha</label><input id="cc-fecha" type="date" class="input" value="${todayISO()}"></div>
        <div><label class="lbl">Concepto</label><input id="cc-desc" class="input" placeholder="Ej: Ajuste por diferencia en caja"></div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:760px">
          <thead><tr>${th('Cuenta')}${th('Tercero')}${th('Detalle')}${th('Débito', true)}${th('Crédito', true)}${th('')}</tr></thead>
          <tbody id="cc-lineas"></tbody>
        </table>
      </div>
      <button id="cc-mas" class="btn btn-ghost" style="margin-top:8px"><i data-lucide="plus"></i>Agregar línea</button>
      <div id="cc-total" style="margin-top:14px;padding:12px 16px;border-radius:12px;background:#FBF7F1;border:1px solid #EADFD0;font-size:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
        <button id="cc-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar comprobante</button>
      </div>
    </div>`;
  const m = Modal.abrir({ titulo: 'Nuevo comprobante contable', contenido, ancho: 'xl' });
  const body = m.body;
  const tbody = body.querySelector('#cc-lineas');
  const inp = 'class="input" style="padding:8px 10px;font-size:13px"';
  const inpNum = 'class="input" inputmode="numeric" style="padding:8px 10px;font-size:13px;text-align:right"';

  const leer = () => {
    tbody.querySelectorAll('tr').forEach((tr, i) => {
      lineas[i] = {
        cuentaTexto: tr.querySelector('[data-k=cuenta]').value,
        terceroTexto: tr.querySelector('[data-k=tercero]').value,
        detalle: tr.querySelector('[data-k=detalle]').value,
        debito: tr.querySelector('[data-k=debito]').value,
        credito: tr.querySelector('[data-k=credito]').value,
      };
    });
  };
  const totales = () => {
    leer();
    const d = round(lineas.reduce((s, l) => s + num(String(l.debito || '').replace(/[^\d.]/g, '')), 0), 2);
    const c = round(lineas.reduce((s, l) => s + num(String(l.credito || '').replace(/[^\d.]/g, '')), 0), 2);
    const dif = round(d - c, 2);
    body.querySelector('#cc-total').innerHTML = `Débitos <b>${money(d)}</b> · Créditos <b>${money(c)}</b> · ${dif === 0 && d > 0
      ? '<span style="color:#15803D;font-weight:700">Cuadra</span>'
      : `<span style="color:#B91C1C;font-weight:700">Diferencia ${money(Math.abs(dif))}</span>`}`;
  };
  const pintarLineas = () => {
    tbody.innerHTML = lineas.map((l, i) => `
      <tr>
        <td style="padding:4px"><input data-k="cuenta" list="cc-cuentas" ${inp} placeholder="Código o nombre" value="${esc(l.cuentaTexto || '')}"></td>
        <td style="padding:4px"><input data-k="tercero" list="cc-terceros" ${inp} placeholder="Si la cuenta lo pide" value="${esc(l.terceroTexto || '')}"></td>
        <td style="padding:4px"><input data-k="detalle" ${inp} value="${esc(l.detalle || '')}"></td>
        <td style="padding:4px;width:130px"><input data-k="debito" ${inpNum} value="${esc(l.debito || '')}"></td>
        <td style="padding:4px;width:130px"><input data-k="credito" ${inpNum} value="${esc(l.credito || '')}"></td>
        <td style="padding:4px;width:36px"><button data-quitar="${i}" class="btn btn-ghost" style="padding:6px" title="Quitar"><i data-lucide="x"></i></button></td>
      </tr>`).join('');
    tbody.querySelectorAll('input').forEach((x) => x.addEventListener('input', totales));
    tbody.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
      leer();
      if (lineas.length > 2) { lineas.splice(Number(b.dataset.quitar), 1); pintarLineas(); }
    }));
    refrescarIconos(body);
    totales();
  };
  pintarLineas();
  body.querySelector('#cc-mas').addEventListener('click', () => { leer(); lineas.push({}); pintarLineas(); });

  body.querySelector('#cc-guardar').addEventListener('click', async () => {
    leer();
    const porNombre = new Map(lista.map((t) => [t.nombre.toLowerCase(), t]));
    const ls = [];
    for (const l of lineas) {
      const cuenta = codigoDe(l.cuentaTexto);
      const deb = num(String(l.debito || '').replace(/[^\d.]/g, ''));
      const cre = num(String(l.credito || '').replace(/[^\d.]/g, ''));
      if (!cuenta && !deb && !cre) continue;
      if (!cuenta) { Toast.warn('Hay una línea sin cuenta'); return; }
      const nombreTer = String(l.terceroTexto || '').trim();
      const ter = porNombre.get(nombreTer.toLowerCase());
      ls.push({
        cuenta, detalle: l.detalle, debito: deb, credito: cre,
        tercero_id: ter?.id || (nombreTer ? `ter:${nombreTer}` : null),
        tercero_nombre: ter?.nombre || nombreTer,
      });
    }
    try {
      const a = await Motor.guardarComprobante({
        fecha: body.querySelector('#cc-fecha').value,
        descripcion: body.querySelector('#cc-desc').value,
        lineas: ls,
        usuario: Auth.usuarioActual()?.nombre || '',
      });
      Toast.ok(`Comprobante ${a.numero} guardado`);
      m.cerrar();
      alGuardar();
    } catch (e) {
      Toast.error(e.message);
    }
  });
}
