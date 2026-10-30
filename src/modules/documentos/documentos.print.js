/**
 * modules/documentos/documentos.print.js — Impresión en carta de los
 * documentos (recibo, egreso, notas, cotización, remisión, orden de
 * compra, traslado), con encabezado del negocio y firmas.
 */

import * as Repo from './documentos.repo.js';
import * as TercerosRepo from '../terceros/terceros.repo.js';
import * as Motor from '../../services/motor-contable.js';
import * as PUC from '../contabilidad/puc.repo.js';
import { money } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { fmtDate, addDays } from '../../core/dates.js';
import { imprimir } from '../contabilidad/ui.js';

const celda = 'style="border:1px solid #999;padding:5px 6px"';

export async function imprimirDocumento(d) {
  const t = d.tercero_id ? await TercerosRepo.obtener(d.tercero_id) : null;
  const cuentas = new Map((await PUC.listar()).map((c) => [c.codigo, c.nombre]));
  const x = d.data || {};
  const tipo = Repo.TIPOS[d.tipo];

  const tercero = d.tipo === 'traslado' ? '' : `
    <table style="width:100%;font-size:11.5px;margin-bottom:14px"><tr>
      <td><b>${d.tipo === 'orden_compra' || d.tipo === 'egreso' ? 'Proveedor / beneficiario' : 'Cliente'}:</b> ${esc(d.tercero_nombre || '')}</td>
      <td><b>Documento:</b> ${esc(TercerosRepo.documentoTexto(t) || t?.numero_doc || '—')}</td></tr>
      <tr><td><b>Dirección:</b> ${esc(t?.direccion || '')} ${esc(t?.ciudad || '')}</td><td><b>Teléfono:</b> ${esc(t?.telefono || '')}</td></tr>
    </table>`;

  let cuerpo = '';
  if (d.items?.length) {
    const compra = d.tipo === 'orden_compra';
    cuerpo += `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <tr><th ${celda} align="left">Código</th><th ${celda} align="left">Descripción</th><th ${celda} align="right">Cant.</th>
        <th ${celda} align="right">${compra ? 'Costo' : 'Precio'}</th>${compra ? '' : `<th ${celda} align="right">IVA</th>`}<th ${celda} align="right">Total</th></tr>
      ${d.items.map((it) => `<tr><td ${celda}>${esc(it.codigo || '')}</td><td ${celda}>${esc(it.nombre)}</td><td ${celda} align="right">${it.cantidad}</td>
        <td ${celda} align="right">${money(compra ? it.costo : it.precio)}</td>${compra ? '' : `<td ${celda} align="right">${it.impuesto_pct}%</td>`}<td ${celda} align="right">${money(it.total)}</td></tr>`).join('')}
    </table>
    <table style="margin-left:auto;margin-top:8px;font-size:12px">
      ${x.subtotal != null ? `<tr><td>Subtotal</td><td align="right" style="padding-left:24px">${money(x.subtotal)}</td></tr>` : ''}
      ${x.impuesto ? `<tr><td>IVA</td><td align="right" style="padding-left:24px">${money(x.impuesto)}</td></tr>` : ''}
      <tr><td><b>Total</b></td><td align="right" style="padding-left:24px"><b>${money(d.total)}</b></td></tr>
    </table>`;
  }
  if (d.tipo === 'recibo_caja' || d.tipo === 'egreso') {
    const filas = [
      ...(x.aplicaciones || []).map((a) => [`Abono a ${d.tipo === 'recibo_caja' ? 'la venta' : 'la compra'} ${a.numero || ''}`, a.monto]),
      ...(x.conceptos || []).map((c) => [`${c.cuenta} ${cuentas.get(c.cuenta) || ''}${c.detalle ? ` — ${c.detalle}` : ''}`, c.valor]),
    ];
    cuerpo += `<table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <tr><th ${celda} align="left">Concepto</th><th ${celda} align="right">Valor</th></tr>
      ${filas.map(([c, v]) => `<tr><td ${celda}>${esc(c)}</td><td ${celda} align="right">${money(v)}</td></tr>`).join('')}
      <tr><td ${celda}><b>Total</b></td><td ${celda} align="right"><b>${money(d.total)}</b></td></tr>
    </table>
    <p style="font-size:11.5px"><b>Medio de pago:</b> ${esc(Motor.ETIQUETAS_MEDIOS[x.medio] || x.medio || '')}</p>`;
  }
  if ((d.tipo === 'nota_credito' || d.tipo === 'nota_debito') && !d.items?.length) {
    cuerpo += `<table style="margin-left:auto;font-size:12px">
      <tr><td>Valor antes de IVA</td><td align="right" style="padding-left:24px">${money(x.subtotal)}</td></tr>
      <tr><td>IVA</td><td align="right" style="padding-left:24px">${money(x.impuesto)}</td></tr>
      <tr><td><b>Total</b></td><td align="right" style="padding-left:24px"><b>${money(d.total)}</b></td></tr></table>`;
  }
  if (d.tipo === 'nota_credito' || d.tipo === 'nota_debito') {
    cuerpo = `<p style="font-size:11.5px"><b>Venta afectada:</b> ${esc(x.venta_numero || '')} · <b>Motivo:</b> ${esc(x.motivo || '')}</p>` + cuerpo;
  }
  if (d.tipo === 'traslado') {
    cuerpo += `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr><td ${celda}><b>Sale de</b></td><td ${celda}>${esc(x.origen)} ${esc(cuentas.get(x.origen) || '')}</td></tr>
      <tr><td ${celda}><b>Llega a</b></td><td ${celda}>${esc(x.destino)} ${esc(cuentas.get(x.destino) || '')}</td></tr>
      <tr><td ${celda}><b>Valor</b></td><td ${celda}><b>${money(d.total)}</b></td></tr></table>`;
  }
  const nota = x.nota ? `<p style="font-size:11.5px;margin-top:12px"><b>Observaciones:</b> ${esc(x.nota)}</p>` : '';
  const validez = d.tipo === 'cotizacion' && x.validez ? `<p style="font-size:11.5px">Válida hasta el ${fmtDate(addDays(d.fecha, x.validez))}.</p>` : '';
  const firmas = ['recibo_caja', 'egreso', 'traslado'].includes(d.tipo)
    ? ['Elaboró', 'Aprobó', d.tipo === 'egreso' ? 'Recibí conforme (C.C. / NIT)' : 'Firma']
    : d.tipo === 'remision' ? ['Entregó', 'Recibí conforme'] : ['Elaboró'];

  imprimir(`${tipo.nombre} ${d.numero}`, `${fmtDate(d.fecha)}${d.estado === 'anulado' ? ' · ANULADO' : ''}`, `
    ${tercero}${cuerpo}${validez}${nota}
    <div style="display:flex;gap:40px;margin-top:56px;font-size:11px">
      ${firmas.map((f) => `<div style="flex:1;border-top:1px solid #000;padding-top:4px">${f}${f === 'Elaboró' && d.creado_por ? `: ${esc(d.creado_por)}` : ''}</div>`).join('')}
    </div>`);
}
