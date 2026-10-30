/**
 * modules/documentos/documentos.view.js — Documentos
 *
 * Una pestaña por tipo de documento (recibos de caja, egresos, notas,
 * cotizaciones, remisiones, órdenes de compra, traslados) con su lista,
 * filtros y acciones: ver/imprimir, editar (pendientes), facturar,
 * convertir, recibir y anular.
 */

import * as Repo from './documentos.repo.js';
import * as Forms from './documentos.forms.js';
import * as Motor from '../../services/motor-contable.js';
import { imprimirDocumento } from './documentos.print.js';
import { money } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { fmtDate, startOfMonth, todayISO } from '../../core/dates.js';
import { Toast, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { pageHeader, badge } from '../../app/ui-kit.js';
import { tarjeta, th, td, tabla, vacio, exportar } from '../contabilidad/ui.js';

const ORDEN = ['recibo_caja', 'egreso', 'nota_credito', 'nota_debito', 'cotizacion', 'remision', 'orden_compra', 'traslado'];
const ICONOS = {
  recibo_caja: 'hand-coins', egreso: 'banknote', nota_credito: 'receipt-text', nota_debito: 'file-plus-2',
  cotizacion: 'file-text', remision: 'package-check', orden_compra: 'clipboard-list', traslado: 'arrow-left-right',
};
const COLOR_ESTADO = { activo: 'success', pendiente: 'warn', facturada: 'info', convertida: 'info', recibida: 'info', anulado: 'neutral' };

let _c = null;
let _tipo = 'recibo_caja';
let _f = { desde: startOfMonth(), hasta: todayISO(), q: '', estado: '' };

export async function render(contenedor) {
  _c = contenedor;
  await pintar();
}

async function pintar() {
  const cfg = await Motor.config();
  const todos = await Repo.listar(_tipo);
  const q = _f.q.trim().toLowerCase();
  const lista = todos.filter((d) =>
    (!_f.desde || d.fecha >= _f.desde) && (!_f.hasta || d.fecha <= _f.hasta)
    && (!_f.estado || d.estado === _f.estado)
    && (!q || `${d.numero} ${d.tercero_nombre} ${d.data?.venta_numero || ''} ${d.data?.nota || ''} ${d.data?.motivo || ''}`.toLowerCase().includes(q)));
  const vigentes = lista.filter((d) => d.estado !== 'anulado');
  const info = Repo.TIPOS[_tipo];
  const conPendientes = ['cotizacion', 'remision', 'orden_compra'].includes(_tipo);

  _c.innerHTML = `
    <div style="padding:32px 40px;max-width:1280px">
      ${pageHeader({
        icono: 'files',
        titulo: 'Documentos',
        descripcion: 'Recibos de caja, egresos, notas, cotizaciones, remisiones, órdenes de compra y traslados.',
        acciones: `<button id="dc-nuevo" class="btn btn-primary"><i data-lucide="plus"></i>Nuevo ${info.nombre.toLowerCase()}</button>`,
      })}
      ${!cfg.activa ? `<div style="background:#FEF3C7;border:1px solid #F5D78A;color:#7A4B00;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px">
        La contabilidad está apagada: los documentos se guardan, pero sus asientos se crearán cuando la actives.</div>` : ''}
      <div style="display:flex;gap:2px;border-bottom:1px solid #EADFD0;margin-bottom:18px;flex-wrap:wrap">
        ${ORDEN.map((t) => `
          <button data-tipo="${t}" style="display:flex;align-items:center;gap:7px;padding:10px 12px;border:0;background:none;cursor:pointer;font:inherit;font-size:13.5px;font-weight:600;
            color:${_tipo === t ? '#2A1A10' : '#7D6858'};border-bottom:2px solid ${_tipo === t ? '#EE7623' : 'transparent'};margin-bottom:-1px">
            <i data-lucide="${ICONOS[t]}" style="width:15px;height:15px"></i>${Repo.TIPOS[t].plural}
          </button>`).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
        <div><label class="lbl">Desde</label><input id="dc-desde" type="date" class="input" value="${_f.desde}"></div>
        <div><label class="lbl">Hasta</label><input id="dc-hasta" type="date" class="input" value="${_f.hasta}"></div>
        <div><label class="lbl">Estado</label><select id="dc-estado" class="input"><option value="">Todos</option>
          ${[...new Set(todos.map((d) => d.estado))].map((e) => `<option value="${e}" ${_f.estado === e ? 'selected' : ''}>${Repo.ESTADOS[e] || e}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:200px"><label class="lbl">Buscar</label><input id="dc-q" class="input" placeholder="Número, tercero o nota" value="${esc(_f.q)}"></div>
        ${lista.length ? `<button id="dc-xls" class="btn btn-ghost"><i data-lucide="file-spreadsheet"></i>Excel</button>` : ''}
      </div>
      ${tarjeta(`${lista.length} ${info.plural.toLowerCase()} · ${money(vigentes.reduce((s, d) => s + (d.total || 0), 0))}${conPendientes ? ` · ${lista.filter((d) => d.estado === 'pendiente').length} pendiente(s)` : ''}`,
        lista.length === 0 ? vacio(`No hay ${info.plural.toLowerCase()} en este rango.`) : tabla(
          th('Número') + th('Fecha') + th(_tipo === 'traslado' ? 'Detalle' : 'Tercero') + th('Referencia') + th('Total', true) + th('Estado') + th(''),
          lista.map((d) => `<tr style="${d.estado === 'anulado' ? 'opacity:.6' : ''}">
            ${td(`<b>${esc(d.numero)}</b>`, false, 'white-space:nowrap')}${td(fmtDate(d.fecha), false, 'white-space:nowrap')}
            ${td(esc(_tipo === 'traslado' ? `${d.data?.origen} → ${d.data?.destino}` : d.tercero_nombre))}
            ${td(esc(referencia(d)), false, 'font-size:12.5px;color:#7D6858')}
            ${td(money(d.total), true)}${td(badge(Repo.ESTADOS[d.estado] || d.estado, COLOR_ESTADO[d.estado] || 'neutral'))}
            ${td(acciones(d), true, 'white-space:nowrap')}
          </tr>`).join('')))}
    </div>`;
  refrescarIconos(_c);
  adjuntar(lista, cfg);
}

function referencia(d) {
  const x = d.data || {};
  if (d.tipo === 'recibo_caja' || d.tipo === 'egreso') {
    const partes = (x.aplicaciones || []).map((a) => a.numero).filter(Boolean);
    if ((x.conceptos || []).length) partes.push(`${x.conceptos.length} concepto(s)`);
    return partes.join(', ');
  }
  if (d.tipo === 'nota_credito' || d.tipo === 'nota_debito') return `Venta ${x.venta_numero || ''} · ${x.motivo || ''}`;
  if (x.venta_numero) return `Venta ${x.venta_numero}`;
  if (x.remision_numero) return `Remisión ${x.remision_numero}`;
  if (x.origen_numero) return `De ${x.origen_numero}`;
  return x.nota || '';
}

function acciones(d) {
  const btn = (accion, icono, titulo, extra = '') => `<button class="btn btn-ghost" data-accion="${accion}" data-id="${d.id}" title="${titulo}" style="padding:6px 8px;${extra}"><i data-lucide="${icono}"></i></button>`;
  const out = [btn('imprimir', 'printer', 'Ver e imprimir')];
  if (d.estado === 'pendiente') {
    out.push(btn('editar', 'pencil', 'Editar'));
    if (d.tipo === 'cotizacion') out.push(btn('remision', 'package-check', 'Convertir en remisión'));
    if (d.tipo === 'cotizacion' || d.tipo === 'remision') out.push(btn('facturar', 'shopping-cart', 'Facturar (registrar la venta)'));
    if (d.tipo === 'orden_compra') out.push(btn('recibir', 'truck', 'Recibir mercancía (registrar la compra)'));
  }
  if (['activo', 'pendiente'].includes(d.estado)) out.push(btn('anular', 'ban', 'Anular', 'color:#B91C1C'));
  return out.join('');
}

function adjuntar(lista, cfg) {
  const c = _c;
  c.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => { _tipo = b.dataset.tipo; _f.estado = ''; pintar(); }));
  const filtrar = () => {
    _f = { desde: c.querySelector('#dc-desde').value, hasta: c.querySelector('#dc-hasta').value, estado: c.querySelector('#dc-estado').value, q: c.querySelector('#dc-q').value };
    pintar();
  };
  ['#dc-desde', '#dc-hasta', '#dc-estado'].forEach((id) => c.querySelector(id).addEventListener('change', filtrar));
  let t;
  c.querySelector('#dc-q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      filtrar();
    }, 300);
  });

  c.querySelector('#dc-nuevo').addEventListener('click', async () => {
    let ok = false;
    if (_tipo === 'recibo_caja' || _tipo === 'egreso') ok = await Forms.formMovimiento(_tipo);
    else if (_tipo === 'nota_credito' || _tipo === 'nota_debito') ok = await Forms.formNota(_tipo);
    else if (_tipo === 'traslado') ok = await Forms.formTraslado(cfg);
    else ok = await Forms.formPedido(_tipo);
    if (ok) pintar();
  });

  c.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', async () => {
    const d = lista.find((x) => x.id === b.dataset.id);
    if (!d) return;
    try {
      switch (b.dataset.accion) {
        case 'imprimir': await imprimirDocumento(d); return;
        case 'editar': if (await Forms.formPedido(d.tipo, d)) pintar(); return;
        case 'facturar':
        case 'recibir': if (await Forms.formConvertir(d)) pintar(); return;
        case 'remision':
          if (!(await Confirm.preguntar(`Se crea una remisión con los productos de ${d.numero}.`, { titulo: 'Convertir en remisión', textoConfirmar: 'Convertir' }))) return;
          Toast.ok(`Remisión ${(await Repo.convertirEnRemision(d.id)).numero} creada`);
          pintar();
          return;
        case 'anular':
          if (!(await Confirm.peligro(efectoAnular(d), { titulo: `Anular ${d.numero}`, textoConfirmar: 'Anular' }))) return;
          await Repo.anular(d.id);
          Toast.ok(`${d.numero} anulado`);
          pintar();
          return;
        default:
      }
    } catch (e) { Toast.error(e.message); }
  }));

  c.querySelector('#dc-xls')?.addEventListener('click', () => exportar(
    lista.map((d) => ({ numero: d.numero, fecha: d.fecha, tercero: d.tercero_nombre, referencia: referencia(d), total: d.total, estado: Repo.ESTADOS[d.estado] || d.estado })),
    [{ clave: 'numero', etiqueta: 'Número' }, { clave: 'fecha', etiqueta: 'Fecha' }, { clave: 'tercero', etiqueta: 'Tercero' },
     { clave: 'referencia', etiqueta: 'Referencia' }, { clave: 'total', etiqueta: 'Total' }, { clave: 'estado', etiqueta: 'Estado' }],
    `${Repo.TIPOS[_tipo].plural.toLowerCase().replace(/\s+/g, '-')}-${_f.desde}-${_f.hasta}`,
  ));
}

function efectoAnular(d) {
  switch (d.tipo) {
    case 'recibo_caja': return 'Los abonos que hizo este recibo se quitan de las ventas y el saldo del cliente vuelve a subir. Su asiento se reversa.';
    case 'egreso': return 'Los pagos que hizo este egreso se quitan de las compras y el saldo con el proveedor vuelve a subir. Su asiento se reversa.';
    case 'nota_credito': return `La venta ${d.data?.venta_numero || ''} recupera su saldo${d.data?.devolver_inventario ? ' y los productos devueltos salen otra vez del inventario' : ''}. El asiento se reversa.`;
    case 'nota_debito': return `El saldo de la venta ${d.data?.venta_numero || ''} vuelve a bajar. El asiento se reversa.`;
    case 'traslado': return 'El traslado se reversa en la contabilidad.';
    default: return 'El documento queda anulado.';
  }
}
