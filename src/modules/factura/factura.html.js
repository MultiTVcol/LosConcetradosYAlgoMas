/**
 * modules/factura/factura.html.js — Generador HTML de factura POS 80mm
 *
 * Diseño basado en el legacy: encabezado del negocio, título del documento,
 * datos en columna alineada, tabla de productos (Cant | Producto | Vr/Unit | Valor),
 * totales con TOTAL grande, recibido/cambio, pie con mensajes y línea final.
 */

import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';

/**
 * Formato de fecha estilo "09 de jun de 2026, 10:34 p. m."
 */
function fechaLarga(venta) {
  let d;
  if (venta?.data?.timestamp) d = new Date(venta.data.timestamp);
  else if (venta?.fecha) d = new Date(venta.fecha + 'T12:00:00');
  else d = new Date();

  try {
    return d.toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (e) {
    return d.toISOString();
  }
}

/**
 * @param {Object} venta    - { numero, fecha, cliente_nombre, cliente, items, subtotal, impuesto, descuento, total, metodo_pago, data: { recibido, cambio } }
 * @param {Object} plantilla - de plantilla.repo.leer()
 * @param {Object} negocio   - de config.repo.leer() → .negocio + .mensajes
 * @returns {string} HTML del ticket
 */
export function html(venta, plantilla, negocio) {
  const p = plantilla;
  const cp = (s) => p.mayusculas ? String(s || '').toUpperCase() : String(s || '');

  // Estilos derivados de la plantilla
  const base = Number(p.tamBase) || 13;
  const lineH = Number(p.interlineado) || 1.4;
  const col = p.color || '#000';
  const fuente = p.fuente || "'Courier New','Roboto Mono',monospace";

  const sep = p.separador === 'none'
    ? '<div style="height:6px"></div>'
    : `<div style="border-top:1px ${p.separador || 'dashed'} ${col};margin:5px 0"></div>`;
  const dblSep = p.separador === 'none'
    ? '<div style="height:8px"></div>'
    : `<div style="border-top:3px double ${col};margin:6px 0"></div>`;

  const wrap = (rows) => `<table style="width:100%;border-collapse:collapse;table-layout:auto"><tbody>${rows}</tbody></table>`;

  // Fila etiqueta-valor con etiqueta alineada en columna fija
  const dato = (label, valor) => `
    <tr>
      <td style="text-align:left;padding:1px 0;vertical-align:baseline;white-space:nowrap;width:25%">${esc(cp(label))}:</td>
      <td style="text-align:left;padding:1px 0;vertical-align:baseline"><b>${esc(cp(valor))}</b></td>
    </tr>
  `;

  // Fila etiqueta-valor con valor alineado a la derecha (para totales)
  const kv = (k, v, opts = {}) => `
    <tr ${opts.bold ? 'style="font-weight:bold"' : ''}>
      <td style="text-align:left;padding:1px 0;vertical-align:baseline${opts.bigK ? `;font-size:${base + 4}px` : ''}">${esc(cp(k))}${opts.noColon ? '' : ':'}</td>
      <td style="text-align:right;padding:1px 0;white-space:nowrap;vertical-align:baseline${opts.bigV ? `;font-size:${base + 4}px` : ''}${opts.color ? `;color:${opts.color}` : ''}">${typeof v === 'string' ? v : money(v)}</td>
    </tr>
  `;

  // ============================================================
  //  ARMADO DEL TICKET
  // ============================================================

  const partes = [];

  // ─── ENCABEZADO DEL NEGOCIO ───────────────────────────────────
  const encabezadoBlock = [];
  if (p.mostrarLogo && p.logoUrl) {
    encabezadoBlock.push(`<div style="text-align:center;margin-bottom:6px"><img src="${esc(p.logoUrl)}" style="max-height:60px;max-width:100%"/></div>`);
  }
  if (p.mostrarNombre && negocio?.negocio?.nombre) {
    encabezadoBlock.push(`<div style="text-align:center;font-weight:bold;font-size:${base + 4}px;letter-spacing:.02em">${esc(cp(negocio.negocio.nombre))}</div>`);
  }
  if (p.mostrarDireccion && negocio?.negocio?.direccion) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 1}px;margin-top:2px">${esc(cp(negocio.negocio.direccion))}</div>`);
  }
  if (p.mostrarCiudad && negocio?.negocio?.ciudad) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 1}px">${esc(cp(negocio.negocio.ciudad))}</div>`);
  }
  // Teléfonos: si hay 2, mostrarlos juntos
  const tels = [];
  if (p.mostrarTelefono && negocio?.negocio?.telefono) tels.push(negocio.negocio.telefono);
  if (p.mostrarTelefono && negocio?.negocio?.telefono2) tels.push(negocio.negocio.telefono2);
  if (tels.length) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 1}px">Tel: ${esc(cp(tels.join(' · ')))}</div>`);
  }
  if (p.mostrarNit && negocio?.negocio?.nit) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 1}px">NIT/CC: ${esc(cp(negocio.negocio.nit))}</div>`);
  }
  if (encabezadoBlock.length) {
    partes.push(encabezadoBlock.join(''));
  }

  // ─── TÍTULO DEL DOCUMENTO ─────────────────────────────────────
  partes.push(dblSep);
  const titDoc = p.tituloDocumento || 'FACTURA';
  partes.push(`<div style="text-align:center;font-weight:bold;font-size:${base + 3}px;letter-spacing:.08em;padding:2px 0">${esc(cp(titDoc))}</div>`);
  partes.push(dblSep);

  // ─── DATOS DE LA FACTURA (columna alineada) ──────────────────
  const datosBlock = [];
  if (p.mostrarFolio) {
    datosBlock.push(dato('Número', venta.numero || '—'));
  }
  if (p.mostrarFecha) {
    datosBlock.push(dato('Fecha', fechaLarga(venta)));
  }
  // Cliente
  if (p.mostrarCliente) {
    const nombreCli = venta.cliente_nombre || 'Cliente Ocasional';
    datosBlock.push(dato('Cliente', nombreCli));
    // Negocio del cliente — viene del objeto cliente si está
    if (p.mostrarNegocioCliente && venta.cliente?.negocio) {
      datosBlock.push(dato('Negocio', venta.cliente.negocio));
    }
    if (p.mostrarTelefonoCliente && venta.cliente?.telefono) {
      datosBlock.push(dato('Tel', venta.cliente.telefono));
    }
  }
  if (datosBlock.length) {
    partes.push(wrap(datosBlock.join('')));
  }

  // ─── TABLA DE PRODUCTOS ───────────────────────────────────────
  if (p.mostrarItems && Array.isArray(venta.items) && venta.items.length) {
    partes.push(sep);

    // Header de la tabla
    const header = `
      <tr style="font-weight:bold;border-bottom:1px solid ${col}">
        <td style="text-align:left;padding:3px 4px 3px 0;width:36px">Cant</td>
        <td style="text-align:left;padding:3px 4px">Producto</td>
        <td style="text-align:right;padding:3px 4px;white-space:nowrap">Vr/Unit</td>
        <td style="text-align:right;padding:3px 0 3px 4px;white-space:nowrap">Valor</td>
      </tr>
    `;

    const filas = [];
    for (const it of venta.items) {
      const cant = Number(it.cantidad) || 0;
      const precio = Number(it.precio) || 0;
      const desc = Number(it.descuento) || 0;
      const valorTotal = (precio - desc) * cant;

      filas.push(`
        <tr style="vertical-align:top">
          <td style="text-align:left;padding:4px 4px 0 0;font-weight:bold">${fmt(cant)}</td>
          <td style="text-align:left;padding:4px 4px 0 4px;word-break:break-word">${esc(cp(it.nombre))}</td>
          <td style="text-align:right;padding:4px 4px 0 4px;white-space:nowrap">${money(precio)}</td>
          <td style="text-align:right;padding:4px 0 0 4px;white-space:nowrap;font-weight:bold">${money(valorTotal)}</td>
        </tr>
      `);

      if (desc > 0) {
        filas.push(`
          <tr>
            <td></td>
            <td colspan="3" style="text-align:left;padding:0 0 3px 4px;font-size:${base - 1}px;color:${col}">(desc. ${money(desc)})</td>
          </tr>
        `);
      }
    }

    partes.push(`
      <table style="width:100%;border-collapse:collapse;font-size:${base - 1}px"><tbody>
        ${header}${filas.join('')}
      </tbody></table>
    `);
  }

  // ─── TOTALES ──────────────────────────────────────────────────
  partes.push(dblSep);

  const totalRows = [];
  if (p.mostrarSubtotal) totalRows.push(kv('Subtotal', money(venta.subtotal)));
  if (p.mostrarImpuestos && Number(venta.impuesto) > 0) totalRows.push(kv('Impuesto', money(venta.impuesto)));
  // Descuento total: descuento global o suma de descuentos por línea
  const descTotal = num(venta.descuento) + num(venta.descuentoLineas);
  if (p.mostrarDescuento && descTotal > 0) {
    totalRows.push(kv('Descuento', `- ${money(descTotal)}`));
  }
  if (totalRows.length) partes.push(wrap(totalRows.join('')));

  // TOTAL en negrita grande
  if (p.mostrarTotal) {
    partes.push(wrap(kv(
      'TOTAL',
      money(venta.total),
      { bold: true, bigK: true, bigV: true },
    )));
  }

  // ─── EFECTIVO / CAMBIO ────────────────────────────────────────
  if (p.mostrarRecibidoCambio && venta.data) {
    const recibido = Number(venta.data.recibido) || 0;
    const cambio = Number(venta.data.cambio) || 0;
    const filas = [];
    if (recibido > 0) {
      const labelRec = (venta.metodo_pago || '').toLowerCase().includes('efectivo') ? 'Efectivo' : 'Recibido';
      filas.push(kv(labelRec, money(recibido)));
    }
    if (cambio > 0) {
      filas.push(kv('Cambio', money(cambio)));
    }
    if (filas.length) {
      partes.push(wrap(filas.join('')));
    }
  }

  // ─── MÉTODO DE PAGO (si no es efectivo, mostrarlo aparte) ────
  if (p.mostrarMetodoPago && venta.metodo_pago) {
    const m = venta.metodo_pago.toLowerCase();
    if (!m.includes('efectivo') || !venta.data?.recibido) {
      partes.push(`<div style="text-align:center;font-size:${base - 1}px;margin-top:4px"><b>${esc(cp(venta.metodo_pago))}</b></div>`);
    }
  }

  // ─── PIE DE FACTURA ───────────────────────────────────────────
  const piePartes = [];
  if (p.mensaje1) piePartes.push(`<div style="text-align:center;font-size:${base}px;margin-top:2px">${esc(cp(p.mensaje1))}</div>`);
  if (p.mensaje2) piePartes.push(`<div style="text-align:center;font-size:${base - 1}px">${esc(cp(p.mensaje2))}</div>`);
  if (piePartes.length) {
    partes.push(`<div style="margin-top:8px"></div>`);
    partes.push(piePartes.join(''));
  }

  // ─── LÍNEA FINAL CON FOLIO + NEGOCIO ──────────────────────────
  if (p.mostrarPieRepetido !== false) {
    partes.push(sep);
    const tituloFinal = (p.tituloDocumento || 'FACTURA');
    const folioStr = venta.numero || '';
    const nombreNeg = negocio?.negocio?.nombre || '';
    partes.push(`<div style="text-align:center;font-size:${base - 2}px">${esc(cp(tituloFinal))} ${esc(cp(folioStr))}${nombreNeg ? ' · ' + esc(cp(nombreNeg)) : ''}</div>`);
  }

  // Espacio final para corte de papel
  partes.push('<div style="height:20px"></div>');

  // ============================================================
  //  ARMADO FINAL
  // ============================================================
  return `
    <div style="font-family:${fuente};color:${col};font-size:${base}px;line-height:${lineH};padding:6px 4px 8px;width:100%;box-sizing:border-box">
      ${partes.join('')}
    </div>
  `;
}
