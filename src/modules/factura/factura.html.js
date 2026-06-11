/**
 * modules/factura/factura.html.js — Generador HTML de factura POS 80mm
 *
 * Diseño premium para impresora térmica:
 *   - Encabezado con jerarquía tipográfica (nombre grande, datos compactos)
 *   - Título del documento enmarcado (los bordes SÍ imprimen siempre,
 *     a diferencia de los fondos que el navegador puede omitir)
 *   - Datos del cliente completos (incluida dirección)
 *   - Items estilo moderno: nombre en su línea + "cant x unit" debajo
 *   - TOTAL en recuadro destacado
 *   - Pie con mensajes y folio
 *
 * Respeta TODOS los ajustes de la plantilla (fuente, tamaño, secciones,
 * separador, mayúsculas, mensajes).
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
    : `<div style="border-top:1px ${p.separador || 'dashed'} ${col};margin:6px 0"></div>`;
  const sepSolido = `<div style="border-top:1px solid ${col};margin:5px 0"></div>`;

  const wrap = (rows) => `<table style="width:100%;border-collapse:collapse;table-layout:auto"><tbody>${rows}</tbody></table>`;

  // Etiqueta pequeña en mayúsculas (estilo profesional) + valor en negrita
  const dato = (label, valor) => `
    <tr>
      <td style="text-align:left;padding:1.5px 6px 1.5px 0;vertical-align:baseline;white-space:nowrap;font-size:${base - 2}px;letter-spacing:.04em">${esc(String(label).toUpperCase())}</td>
      <td style="text-align:right;padding:1.5px 0;vertical-align:baseline;font-weight:bold;word-break:break-word">${esc(cp(valor))}</td>
    </tr>
  `;

  // Fila clave-valor para totales
  const kv = (k, v, opts = {}) => `
    <tr ${opts.bold ? 'style="font-weight:bold"' : ''}>
      <td style="text-align:left;padding:1.5px 0;vertical-align:baseline">${esc(cp(k))}</td>
      <td style="text-align:right;padding:1.5px 0;white-space:nowrap;vertical-align:baseline">${typeof v === 'string' ? v : money(v)}</td>
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
    encabezadoBlock.push(`<div style="text-align:center;font-weight:800;font-size:${base + 5}px;letter-spacing:.02em;line-height:1.2">${esc(cp(negocio.negocio.nombre))}</div>`);
  }
  if (p.mostrarNit && negocio?.negocio?.nit) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 2}px;margin-top:3px;letter-spacing:.03em">NIT ${esc(cp(negocio.negocio.nit))}</div>`);
  }
  if (negocio?.negocio?.regimen) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 2.5}px">${esc(cp(negocio.negocio.regimen))}</div>`);
  }
  if (p.mostrarDireccion && negocio?.negocio?.direccion) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 2}px;margin-top:2px">${esc(cp(negocio.negocio.direccion))}</div>`);
  }
  if (p.mostrarCiudad && negocio?.negocio?.ciudad) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 2}px">${esc(cp(negocio.negocio.ciudad))}</div>`);
  }
  // Teléfonos: si hay 2, mostrarlos juntos
  const tels = [];
  if (p.mostrarTelefono && negocio?.negocio?.telefono) tels.push(negocio.negocio.telefono);
  if (p.mostrarTelefono && negocio?.negocio?.telefono2) tels.push(negocio.negocio.telefono2);
  if (tels.length) {
    encabezadoBlock.push(`<div style="text-align:center;font-size:${base - 2}px">Tel: ${esc(cp(tels.join(' · ')))}</div>`);
  }
  if (encabezadoBlock.length) {
    partes.push(`<div style="margin-bottom:8px">${encabezadoBlock.join('')}</div>`);
  }

  // ─── TÍTULO DEL DOCUMENTO (recuadro enmarcado) ────────────────
  const titDoc = p.tituloDocumento || 'FACTURA';
  partes.push(`
    <div style="border:1.5px solid ${col};border-radius:1px;padding:5px 4px;margin:4px 0 8px;text-align:center;font-weight:800;font-size:${base + 2}px;letter-spacing:.3em;text-indent:.3em">
      ${esc(String(titDoc).toUpperCase())}
    </div>
  `);

  // ─── DATOS DE LA FACTURA ──────────────────────────────────────
  const datosBlock = [];
  if (p.mostrarFolio) {
    datosBlock.push(dato('Nº Documento', venta.numero || '—'));
  }
  if (p.mostrarFecha) {
    datosBlock.push(dato('Fecha', fechaLarga(venta)));
  }
  if (datosBlock.length) {
    partes.push(wrap(datosBlock.join('')));
  }

  // ─── CLIENTE (bloque propio con todos sus datos) ──────────────
  if (p.mostrarCliente) {
    const cliBlock = [];
    const nombreCli = venta.cliente_nombre || 'Cliente Ocasional';
    cliBlock.push(dato('Cliente', nombreCli));
    if (p.mostrarNegocioCliente && venta.cliente?.negocio) {
      cliBlock.push(dato('Negocio', venta.cliente.negocio));
    }
    // Dirección del cliente (con ciudad si la tiene)
    if (p.mostrarDireccionCliente !== false && venta.cliente?.direccion) {
      const dirCompleta = venta.cliente.ciudad
        ? `${venta.cliente.direccion}, ${venta.cliente.ciudad}`
        : venta.cliente.direccion;
      cliBlock.push(dato('Dirección', dirCompleta));
    }
    if (p.mostrarTelefonoCliente && venta.cliente?.telefono) {
      cliBlock.push(dato('Teléfono', venta.cliente.telefono));
    }
    partes.push(sep);
    partes.push(wrap(cliBlock.join('')));
  }

  // ─── TABLA DE PRODUCTOS (estilo moderno) ──────────────────────
  if (p.mostrarItems && Array.isArray(venta.items) && venta.items.length) {
    const filas = [];

    // Encabezado de la sección
    filas.push(`
      <tr>
        <td style="text-align:left;padding:4px 0 3px;font-size:${base - 2.5}px;font-weight:bold;letter-spacing:.08em;border-bottom:1px solid ${col}">DESCRIPCIÓN</td>
        <td style="text-align:right;padding:4px 0 3px;font-size:${base - 2.5}px;font-weight:bold;letter-spacing:.08em;border-bottom:1px solid ${col}">VALOR</td>
      </tr>
    `);

    for (const it of venta.items) {
      const cant = Number(it.cantidad) || 0;
      const precio = Number(it.precio) || 0;
      const desc = Number(it.descuento) || 0;
      const valorTotal = (precio - desc) * cant;

      // Línea 1: nombre del producto (negrita, ocupa todo el ancho)
      filas.push(`
        <tr>
          <td colspan="2" style="text-align:left;padding:5px 0 0;font-weight:bold;word-break:break-word;line-height:1.25">${esc(cp(it.nombre))}</td>
        </tr>
      `);
      // Línea 2: cantidad x precio unitario | valor total
      filas.push(`
        <tr>
          <td style="text-align:left;padding:1px 0 4px;font-size:${base - 1.5}px">${fmt(cant)} x ${money(precio - desc)}${desc > 0 ? ` <span style="font-size:${base - 2.5}px">(desc ${money(desc)})</span>` : ''}</td>
          <td style="text-align:right;padding:1px 0 4px;white-space:nowrap;font-weight:bold;vertical-align:bottom">${money(valorTotal)}</td>
        </tr>
      `);
    }

    partes.push(`<div style="margin-top:6px"></div>`);
    partes.push(`
      <table style="width:100%;border-collapse:collapse;font-size:${base}px"><tbody>
        ${filas.join('')}
      </tbody></table>
    `);
    partes.push(sepSolido);

    // Resumen de unidades
    const totUnidades = venta.items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
    partes.push(`<div style="text-align:right;font-size:${base - 2.5}px;margin-top:-2px">${venta.items.length} producto(s) · ${fmt(totUnidades)} unidad(es)</div>`);
  }

  // ─── TOTALES ──────────────────────────────────────────────────
  const totalRows = [];
  if (p.mostrarSubtotal) totalRows.push(kv('Subtotal', money(venta.subtotal)));
  if (p.mostrarImpuestos && Number(venta.impuesto) > 0) totalRows.push(kv('Impuesto', money(venta.impuesto)));
  const descTotal = num(venta.descuento) + num(venta.descuentoLineas);
  if (p.mostrarDescuento && descTotal > 0) {
    totalRows.push(kv('Descuento', `- ${money(descTotal)}`));
  }
  if (totalRows.length) {
    partes.push(`<div style="margin-top:4px">${wrap(totalRows.join(''))}</div>`);
  }

  // TOTAL en recuadro destacado (los bordes siempre imprimen)
  if (p.mostrarTotal) {
    partes.push(`
      <div style="border:2px solid ${col};border-radius:1px;padding:6px 8px;margin:6px 0 4px">
        <table style="width:100%;border-collapse:collapse"><tbody>
          <tr>
            <td style="text-align:left;font-weight:800;font-size:${base + 2}px;letter-spacing:.08em;vertical-align:middle">TOTAL</td>
            <td style="text-align:right;font-weight:800;font-size:${base + 6}px;white-space:nowrap;vertical-align:middle">${money(venta.total)}</td>
          </tr>
        </tbody></table>
      </div>
    `);
  }

  // ─── PAGO: MÉTODO + RECIBIDO / CAMBIO ─────────────────────────
  const pagoRows = [];
  if (p.mostrarMetodoPago && venta.metodo_pago) {
    pagoRows.push(dato('Forma de pago', venta.metodo_pago));
  }
  if (p.mostrarRecibidoCambio && venta.data) {
    const recibido = Number(venta.data.recibido) || 0;
    const cambio = Number(venta.data.cambio) || 0;
    if (recibido > 0) pagoRows.push(dato('Recibido', money(recibido)));
    if (cambio > 0) pagoRows.push(dato('Cambio', money(cambio)));
  }
  if (pagoRows.length) {
    partes.push(wrap(pagoRows.join('')));
  }

  // ─── PIE DE FACTURA ───────────────────────────────────────────
  const piePartes = [];
  if (p.mensaje1) piePartes.push(`<div style="text-align:center;font-size:${base}px;font-weight:bold;margin-top:2px">${esc(cp(p.mensaje1))}</div>`);
  if (p.mensaje2) piePartes.push(`<div style="text-align:center;font-size:${base - 1.5}px;margin-top:1px">${esc(cp(p.mensaje2))}</div>`);
  if (piePartes.length) {
    partes.push(sep);
    partes.push(piePartes.join(''));
  }

  // ─── LÍNEA FINAL CON FOLIO + NEGOCIO ──────────────────────────
  if (p.mostrarPieRepetido !== false) {
    partes.push(sep);
    const tituloFinal = (p.tituloDocumento || 'FACTURA');
    const folioStr = venta.numero || '';
    const nombreNeg = negocio?.negocio?.nombre || '';
    partes.push(`
      <div style="text-align:center;font-size:${base - 2.5}px;letter-spacing:.06em">${esc(String(tituloFinal).toUpperCase())} ${esc(cp(folioStr))}</div>
      ${nombreNeg ? `<div style="text-align:center;font-size:${base - 3}px;margin-top:1px">${esc(cp(nombreNeg))}</div>` : ''}
      <div style="text-align:center;font-size:${base - 2}px;margin-top:3px;letter-spacing:.2em">··•··</div>
    `);
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
