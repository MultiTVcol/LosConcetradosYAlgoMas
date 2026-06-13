/**
 * modules/productos/inventario.html.js — Generadores HTML de inventario
 *
 * Tres formatos para imprimir el inventario:
 *   1. POS 80mm — versión compacta para impresora térmica
 *   2. Carta (PDF) — informe profesional con desglose por categoría
 *   3. Auditoría — hoja con columnas en blanco para conteo físico
 */

import { money, fmt, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';

// ============================================================
//  HELPERS COMUNES
// ============================================================

function calcularTotales(productos) {
  let nSKUs = 0;
  let nUnidades = 0;
  let valorCosto = 0;
  let valorVenta = 0;
  let bajos = 0;
  let agotados = 0;

  for (const p of productos) {
    nSKUs++;
    const st = num(p.stock);
    if (st <= 0) {
      agotados++;
    } else {
      nUnidades += st;
      valorCosto += st * num(p.costo);
      valorVenta += st * num(p.precio);
      if (st <= num(p.stock_min || 0)) bajos++;
    }
  }
  return { nSKUs, nUnidades, valorCosto, valorVenta, bajos, agotados };
}

function agruparPorCategoria(productos) {
  const cats = {};
  for (const p of productos) {
    const cat = p.categoria || 'Sin categoría';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(p);
  }
  // Ordenar productos por nombre dentro de cada categoría
  for (const k of Object.keys(cats)) {
    cats[k].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  }
  // Devolver array ordenado por nombre de categoría
  return Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

function fechaCorta() {
  return new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

// ============================================================
//  FORMATO POS 80mm
// ============================================================

/**
 * Inventario en formato POS térmico 80mm.
 * Lista compacta con stock + valor por producto, agrupado por categoría.
 *
 * @param {Array} productos
 * @param {Object} cfg - de ConfigRepo.leer() (negocio)
 * @param {Object} opts - { soloBajos?: bool, soloAgotados?: bool }
 */
export function htmlInventarioPOS(productos, cfg, opts = {}) {
  const neg = cfg?.negocio || {};
  const t = calcularTotales(productos);
  const cats = agruparPorCategoria(productos);

  const sep = '<div style="border-top:1px dashed #000;margin:4px 0"></div>';
  const dblSep = '<div style="border-top:3px double #000;margin:5px 0"></div>';

  const titulo = (t) => `<div style="text-align:center;font-weight:bold;font-size:13.5px;margin:5px 0 3px;letter-spacing:.04em">${esc(t)}</div>`;
  const kv = (k, v, bold = false) => `
    <tr ${bold ? 'style="font-weight:bold"' : ''}>
      <td style="text-align:left;padding:1px 0;vertical-align:baseline">${esc(k)}</td>
      <td style="text-align:right;padding:1px 0;white-space:nowrap;vertical-align:baseline">${typeof v === 'string' ? v : money(v)}</td>
    </tr>
  `;
  const wrap = (rows) => `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rows}</tbody></table>`;
  const truncar = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const subtitulo = opts.soloBajos
    ? 'STOCK BAJO'
    : opts.soloAgotados
      ? 'AGOTADOS'
      : 'INVENTARIO COMPLETO';

  // Header del ticket
  const partes = [];
  if (neg.nombre) {
    partes.push(`<div style="text-align:center;font-weight:bold;font-size:14px">${esc(neg.nombre)}</div>`);
  }
  if (neg.direccion) partes.push(`<div style="text-align:center;font-size:11px">${esc(neg.direccion)}</div>`);
  if (neg.ciudad) partes.push(`<div style="text-align:center;font-size:11px">${esc(neg.ciudad)}</div>`);

  partes.push(dblSep);
  partes.push(`<div style="text-align:center;font-weight:bold;font-size:14px;letter-spacing:.05em">INVENTARIO</div>`);
  partes.push(`<div style="text-align:center;font-size:11px">${subtitulo}</div>`);
  partes.push(dblSep);

  partes.push(`<div style="text-align:center;font-size:11px;margin-bottom:3px">Generado: ${esc(fechaCorta())}</div>`);

  // Resumen
  partes.push(sep);
  partes.push(titulo('RESUMEN'));
  partes.push(wrap(
    kv('SKUs', fmt(t.nSKUs)) +
    kv('Unidades', fmt(t.nUnidades)) +
    kv('Valor costo', money(t.valorCosto), true) +
    kv('Valor venta', money(t.valorVenta)) +
    (t.bajos > 0 ? kv('Stock bajo', fmt(t.bajos)) : '') +
    (t.agotados > 0 ? kv('Agotados', fmt(t.agotados)) : '')
  ));

  // Listado por categoría
  partes.push(sep);
  for (const [cat, prods] of cats) {
    partes.push(`<div style="font-weight:bold;font-size:12px;margin:5px 0 2px;background:#000;color:#fff;padding:2px 4px;letter-spacing:.04em">${esc(cat.toUpperCase())}</div>`);
    const filas = prods.map((p) => {
      const st = num(p.stock);
      const valor = st * num(p.precio);
      const nombre = truncar(p.nombre, 22);
      const codigoLine = p.codigo ? `<div style="font-size:9.5px;color:#555;margin-left:0">${esc(p.codigo)}</div>` : '';
      return `
        <tr style="vertical-align:top">
          <td style="text-align:left;padding:3px 0 0 0">
            <div style="font-size:11.5px;font-weight:bold">${esc(nombre)}</div>
            ${codigoLine}
          </td>
          <td style="text-align:right;padding:3px 0 0 4px;white-space:nowrap;font-size:11px">
            <b>${fmt(st)}</b> × ${money(p.precio)}
          </td>
          <td style="text-align:right;padding:3px 0 0 4px;white-space:nowrap;font-size:11.5px">
            <b>${money(valor)}</b>
          </td>
        </tr>
      `;
    }).join('');
    partes.push(`<table style="width:100%;border-collapse:collapse"><tbody>${filas}</tbody></table>`);

    // Subtotal de la categoría
    const subVal = prods.reduce((s, p) => s + num(p.stock) * num(p.precio), 0);
    const subUds = prods.reduce((s, p) => s + num(p.stock), 0);
    partes.push(`<div style="display:flex;justify-content:space-between;font-size:10.5px;color:#555;padding:2px 0;border-top:1px dashed #999;margin-top:3px">
      <span>${prods.length} prods · ${fmt(subUds)} uds</span>
      <b style="color:#000">${money(subVal)}</b>
    </div>`);
  }

  // Pie
  partes.push(dblSep);
  partes.push(wrap(kv('TOTAL VENTA', money(t.valorVenta), true)));
  partes.push(dblSep);
  partes.push(`<div style="text-align:center;font-size:10px;color:#555;margin-top:4px">— Fin del inventario —</div>`);
  partes.push('<div style="height:14px"></div>');

  return `
    <div style="font-family:'Courier New',monospace;color:#000;font-size:12px;line-height:1.35;padding:4px;width:100%;box-sizing:border-box">
      ${partes.join('')}
    </div>
  `;
}

// ============================================================
//  FORMATO CARTA (PDF)
// ============================================================

/**
 * Inventario en formato Carta — informe profesional con tabla completa.
 */
export function htmlInventarioCarta(productos, cfg, opts = {}) {
  const neg = cfg?.negocio || {};
  const t = calcularTotales(productos);
  const cats = agruparPorCategoria(productos);

  const subtitulo = opts.soloBajos
    ? 'Productos con stock bajo'
    : opts.soloAgotados
      ? 'Productos agotados'
      : 'Inventario completo';

  return `
    <div style="font-family:'Helvetica','Arial',sans-serif;color:#0f172a;font-size:11.5px;line-height:1.45">

      <!-- ENCABEZADO -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #0f172a;padding-bottom:10px;margin-bottom:14px">
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">${esc(neg.nombre || 'PosPunto')}</div>
          ${neg.nit ? `<div style="font-size:11px;color:#475569;margin-top:1px">NIT/CC: ${esc(neg.nit)}</div>` : ''}
          ${neg.direccion ? `<div style="font-size:11px;color:#475569">${esc(neg.direccion)}${neg.ciudad ? ' · ' + esc(neg.ciudad) : ''}</div>` : ''}
          ${neg.telefono ? `<div style="font-size:11px;color:#475569">Tel: ${esc(neg.telefono)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Inventario</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Generado: ${esc(fechaCorta())}</div>
        </div>
      </div>

      <!-- BANNER PERIODO/TITULO -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;text-align:center;font-weight:700;color:#1d4ed8">
        📦 ${esc(subtitulo)}
      </div>

      <!-- RESUMEN EJECUTIVO -->
      <div style="display:grid;gap:8px;grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">SKUs</div>
          <div style="font-size:14px;font-weight:800;color:#1d4ed8;font-family:'Courier New',monospace">${fmt(t.nSKUs)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Unidades</div>
          <div style="font-size:14px;font-weight:800;color:#0369a1;font-family:'Courier New',monospace">${fmt(t.nUnidades)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Valor costo</div>
          <div style="font-size:14px;font-weight:800;color:#15803d;font-family:'Courier New',monospace">${money(t.valorCosto)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
          <div style="font-size:9.5px;color:#64748b;font-weight:700;text-transform:uppercase">Valor venta</div>
          <div style="font-size:14px;font-weight:800;color:#a16207;font-family:'Courier New',monospace">${money(t.valorVenta)}</div>
        </div>
      </div>

      ${t.bajos > 0 || t.agotados > 0 ? `
        <div style="display:flex;gap:10px;margin-bottom:14px">
          ${t.bajos > 0 ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;font-size:11px;color:#92400e;font-weight:600">⚠ ${fmt(t.bajos)} con stock bajo</div>` : ''}
          ${t.agotados > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;font-size:11px;color:#dc2626;font-weight:600">🚫 ${fmt(t.agotados)} agotados</div>` : ''}
        </div>
      ` : ''}

      <!-- LISTADO POR CATEGORÍA -->
      ${cats.map(([cat, prods]) => {
        const subVal = prods.reduce((s, p) => s + num(p.stock) * num(p.precio), 0);
        const subCosto = prods.reduce((s, p) => s + num(p.stock) * num(p.costo), 0);
        const subUds = prods.reduce((s, p) => s + num(p.stock), 0);
        return `
          <div style="margin-bottom:16px;page-break-inside:avoid">
            <h2 style="font-size:13px;font-weight:800;color:white;background:#0f172a;padding:5px 10px;margin:0 0 4px;letter-spacing:.04em">${esc(cat.toUpperCase())}</h2>
            <table style="width:100%;border-collapse:collapse;font-size:10.5px">
              <thead>
                <tr style="border-bottom:1px solid #cbd5e1;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;text-align:left">
                  <th style="padding:5px 4px;width:14%">Código</th>
                  <th style="padding:5px 4px">Producto</th>
                  <th style="padding:5px 4px;text-align:right;width:8%">Stock</th>
                  <th style="padding:5px 4px;text-align:right;width:11%">Costo</th>
                  <th style="padding:5px 4px;text-align:right;width:11%">Precio</th>
                  <th style="padding:5px 4px;text-align:right;width:12%">Val. costo</th>
                  <th style="padding:5px 4px;text-align:right;width:12%">Val. venta</th>
                </tr>
              </thead>
              <tbody>
                ${prods.map((p) => {
                  const st = num(p.stock);
                  const valCosto = st * num(p.costo);
                  const valVenta = st * num(p.precio);
                  const stockBajo = st > 0 && st <= num(p.stock_min || 0);
                  const agotado = st <= 0;
                  return `
                    <tr style="border-bottom:1px solid #f1f5f9">
                      <td style="padding:4px;font-family:'Courier New',monospace;font-size:10px;color:#475569">${esc(p.codigo || '—')}</td>
                      <td style="padding:4px">${esc(p.nombre)}</td>
                      <td style="padding:4px;text-align:right;font-family:'Courier New',monospace;font-weight:700;color:${agotado ? '#dc2626' : (stockBajo ? '#a16207' : '#0f172a')}">
                        ${fmt(st)}${stockBajo ? ' ⚠' : ''}${agotado ? ' 🚫' : ''}
                      </td>
                      <td style="padding:4px;text-align:right;font-family:'Courier New',monospace">${money(p.costo)}</td>
                      <td style="padding:4px;text-align:right;font-family:'Courier New',monospace">${money(p.precio)}</td>
                      <td style="padding:4px;text-align:right;font-family:'Courier New',monospace">${money(valCosto)}</td>
                      <td style="padding:4px;text-align:right;font-family:'Courier New',monospace;font-weight:700">${money(valVenta)}</td>
                    </tr>
                  `;
                }).join('')}
                <tr style="background:#f1f5f9;font-weight:700">
                  <td colspan="2" style="padding:5px 4px">${prods.length} producto(s) · ${fmt(subUds)} unidades</td>
                  <td style="padding:5px 4px;text-align:right;font-family:'Courier New',monospace">${fmt(subUds)}</td>
                  <td colspan="2"></td>
                  <td style="padding:5px 4px;text-align:right;font-family:'Courier New',monospace">${money(subCosto)}</td>
                  <td style="padding:5px 4px;text-align:right;font-family:'Courier New',monospace;color:#1d4ed8">${money(subVal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
      }).join('')}

      <!-- TOTAL GENERAL -->
      <div style="background:#0f172a;color:white;border-radius:8px;padding:14px 16px;margin-top:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;text-align:center">
          <div>
            <div style="font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Total unidades</div>
            <div style="font-size:18px;font-weight:800;font-family:'Courier New',monospace;margin-top:2px">${fmt(t.nUnidades)}</div>
          </div>
          <div>
            <div style="font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Valor a costo</div>
            <div style="font-size:18px;font-weight:800;font-family:'Courier New',monospace;margin-top:2px;color:#4ade80">${money(t.valorCosto)}</div>
          </div>
          <div>
            <div style="font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Valor a venta</div>
            <div style="font-size:18px;font-weight:800;font-family:'Courier New',monospace;margin-top:2px;color:#fbbf24">${money(t.valorVenta)}</div>
          </div>
        </div>
      </div>

      <!-- PIE -->
      <div style="border-top:1px solid #cbd5e1;margin-top:18px;padding-top:8px;font-size:9.5px;color:#94a3b8;font-style:italic;text-align:center">
        Inventario generado por PosPunto · ${esc(fechaCorta())}
      </div>
    </div>
  `;
}

// ============================================================
//  HOJA DE AUDITORÍA (conteo físico)
// ============================================================

/**
 * Hoja para imprimir y llenar a mano durante el conteo físico.
 * Tiene columna "Stock sistema" + columna VACÍA "Conteo físico" + diferencia.
 */
export function htmlHojaAuditoria(productos, cfg) {
  const neg = cfg?.negocio || {};
  const cats = agruparPorCategoria(productos);
  const t = calcularTotales(productos);

  return `
    <div style="font-family:'Helvetica','Arial',sans-serif;color:#0f172a;font-size:11px;line-height:1.45">

      <!-- ENCABEZADO -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px double #0f172a;padding-bottom:10px;margin-bottom:14px">
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">${esc(neg.nombre || 'PosPunto')}</div>
          ${neg.direccion ? `<div style="font-size:11px;color:#475569">${esc(neg.direccion)}${neg.ciudad ? ' · ' + esc(neg.ciudad) : ''}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:700">Hoja de auditoría</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Generada: ${esc(fechaCorta())}</div>
        </div>
      </div>

      <!-- INSTRUCCIONES -->
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#92400e">
        📋 <b>Instrucciones:</b> recorra el inventario y anote el conteo físico real en la columna correspondiente.
        La columna "Diferencia" se llena al final restando: <i>Conteo − Sistema</i>.
        Una vez completada, regrese a la app y ajuste el stock de los productos con diferencias.
      </div>

      <!-- DATOS DE LA AUDITORÍA -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px">
        <tr>
          <td style="padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;width:18%;font-weight:700">Auditor:</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;width:32%;border-left:0">&nbsp;</td>
          <td style="padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;width:18%;font-weight:700;border-left:0">Fecha:</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;width:32%;border-left:0">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;font-weight:700">Sucursal:</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;border-top:0;border-left:0">&nbsp;</td>
          <td style="padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-left:0;font-weight:700">Hora inicio:</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;border-top:0;border-left:0">&nbsp;</td>
        </tr>
      </table>

      <!-- RESUMEN DE LO QUE SE VA A CONTAR -->
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 12px;margin-bottom:14px;font-size:11px;color:#1d4ed8">
        🔢 Productos a auditar: <b>${fmt(t.nSKUs)}</b> SKUs · <b>${fmt(t.nUnidades)}</b> unidades esperadas
      </div>

      <!-- LISTADO POR CATEGORÍA -->
      ${cats.map(([cat, prods]) => `
        <div style="margin-bottom:14px;page-break-inside:avoid">
          <h2 style="font-size:13px;font-weight:800;color:white;background:#0f172a;padding:5px 10px;margin:0 0 4px;letter-spacing:.04em">${esc(cat.toUpperCase())}</h2>
          <table style="width:100%;border-collapse:collapse;font-size:10.5px">
            <thead>
              <tr style="background:#f1f5f9;color:#475569;font-size:10px;font-weight:700;text-transform:uppercase;text-align:left">
                <th style="padding:5px 4px;border:1px solid #cbd5e1;width:13%">Código</th>
                <th style="padding:5px 4px;border:1px solid #cbd5e1">Producto</th>
                <th style="padding:5px 4px;border:1px solid #cbd5e1;text-align:center;width:10%">Stock<br>sistema</th>
                <th style="padding:5px 4px;border:1px solid #cbd5e1;text-align:center;width:13%;background:#dcfce7;color:#15803d">Conteo<br>físico</th>
                <th style="padding:5px 4px;border:1px solid #cbd5e1;text-align:center;width:10%">Dif.</th>
                <th style="padding:5px 4px;border:1px solid #cbd5e1;width:20%">Observación</th>
              </tr>
            </thead>
            <tbody>
              ${prods.map((p) => {
                const st = num(p.stock);
                return `
                  <tr style="height:26px">
                    <td style="padding:4px;border:1px solid #cbd5e1;font-family:'Courier New',monospace;font-size:10px;color:#475569">${esc(p.codigo || '—')}</td>
                    <td style="padding:4px;border:1px solid #cbd5e1">${esc(p.nombre)}</td>
                    <td style="padding:4px;border:1px solid #cbd5e1;text-align:center;font-family:'Courier New',monospace;font-weight:700;background:#f8fafc">${fmt(st)}</td>
                    <td style="padding:4px;border:1px solid #cbd5e1;background:#f0fdf4">&nbsp;</td>
                    <td style="padding:4px;border:1px solid #cbd5e1">&nbsp;</td>
                    <td style="padding:4px;border:1px solid #cbd5e1">&nbsp;</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `).join('')}

      <!-- FIRMAS -->
      <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:30px;page-break-inside:avoid">
        <div style="text-align:center">
          <div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#475569">
            <b>Firma del auditor</b><br>
            <span style="font-size:10px;color:#94a3b8">Nombre + CC</span>
          </div>
        </div>
        <div style="text-align:center">
          <div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#475569">
            <b>Firma de aprobación</b><br>
            <span style="font-size:10px;color:#94a3b8">Administrador / Dueño</span>
          </div>
        </div>
      </div>

      <!-- PIE -->
      <div style="border-top:1px solid #cbd5e1;margin-top:18px;padding-top:8px;font-size:9.5px;color:#94a3b8;font-style:italic;text-align:center">
        Hoja de auditoría generada por PosPunto · ${esc(fechaCorta())}
      </div>
    </div>
  `;
}
