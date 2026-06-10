/**
 * services/printer.js — Servicio de impresión POS
 *
 * Maneja la impresión de tickets POS (80mm térmico) y documentos
 * formales (carta/A4). El cliente configura su impresora térmica
 * como predeterminada en su sistema operativo, y este servicio
 * dispara la impresión con el formato correcto.
 *
 * Modos soportados:
 *   - 'pos'   → Ticket térmico 80mm (default), 76mm o 58mm
 *   - 'carta' → Documento formal tamaño carta/A4 (facturas, reportes)
 *
 * Uso típico:
 *   import { imprimirPOS, imprimirCarta } from '../services/printer.js';
 *
 *   imprimirPOS('<div>Mi ticket</div>');
 *   imprimirCarta('<div>Mi factura formal</div>');
 *
 * NOTA: este servicio NO arma el HTML del ticket. Eso lo hace el módulo
 * que lo necesite (Ventas, Cierre, Compras). Acá solo lo recibimos y
 * lo imprimimos con el formato correcto.
 */

import { config } from './config.js';

// ============================================================
//  CONSTANTES
// ============================================================

/** Ancho por defecto del ticket térmico (en milímetros) */
const ANCHO_POS_DEFAULT = 80;

/** ID del contenedor que vive en el DOM y aloja el HTML a imprimir */
const PRINT_AREA_ID = 'printArea';

// ============================================================
//  HELPERS INTERNOS
// ============================================================

/**
 * Garantiza que exista el contenedor #printArea en el DOM.
 * Lo crea si no existe. Lo necesitamos para inyectar el HTML
 * y que el CSS de impresión lo reconozca.
 */
function ensurePrintArea() {
  let area = document.getElementById(PRINT_AREA_ID);
  if (!area) {
    area = document.createElement('div');
    area.id = PRINT_AREA_ID;
    area.style.display = 'none'; // Oculto en pantalla, visible solo al imprimir
    document.body.appendChild(area);
  }
  return area;
}

/**
 * Inyecta una <style> en el <head> con el ancho del papel para POS.
 * Se necesita porque @page no puede leer variables CSS dinámicamente.
 *
 * @param {number} anchoMm - Ancho del papel en mm (58, 76, 80, etc.)
 */
function aplicarAnchoImpresion(anchoMm) {
  const ID = 'print-pos-width';
  let style = document.getElementById(ID);
  if (!style) {
    style = document.createElement('style');
    style.id = ID;
    document.head.appendChild(style);
  }
  // Forzar tamaño exacto del papel + cero márgenes + body/html con ancho fijo
  // para que el contenido se imprima en 80mm aunque el destino sea "Guardar
  // como PDF" (que tiende a usar carta por defecto).
  style.textContent = `
    @media print {
      @page {
        size: ${anchoMm}mm auto;
        margin: 0 !important;
      }
      html, body {
        width: ${anchoMm}mm !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body.print-pos #printArea {
        width: ${anchoMm}mm !important;
        max-width: ${anchoMm}mm !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    }
  `;
}

/**
 * Restablece el @page a tamaño carta/A4 con márgenes razonables.
 * Necesario cuando antes se imprimió POS (que dejó @page en 80mm).
 */
function aplicarTamanoCarta() {
  const ID = 'print-pos-width';
  let style = document.getElementById(ID);
  if (!style) {
    style = document.createElement('style');
    style.id = ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    @media print {
      @page {
        size: letter;
        margin: 12mm 10mm;
      }
    }
  `;
}

/** Título original de la pestaña — se restaura tras imprimir. */
let _tituloOriginal = null;

/**
 * Cambia temporalmente el title del documento al imprimir.
 * El navegador usa el title como header del print (ej: "Informe Financiero")
 * y como nombre sugerido al "Guardar como PDF". Sin esto, sale el title
 * de la app/pestaña (ej: "npm run dev") y queda feo en el papel.
 */
function aplicarTituloImpresion(titulo) {
  if (!titulo) return;
  if (_tituloOriginal == null) _tituloOriginal = document.title;
  document.title = titulo;
}

function restaurarTituloImpresion() {
  if (_tituloOriginal != null) {
    document.title = _tituloOriginal;
    _tituloOriginal = null;
  }
}

/**
 * Limpia el #printArea y las clases del <body> después de imprimir.
 * Esto es importante para que la siguiente impresión empiece limpia.
 */
function limpiarDespuesDeImprimir() {
  document.body.classList.remove('print-pos', 'print-carta');
  const area = document.getElementById(PRINT_AREA_ID);
  if (area) area.innerHTML = '';
  restaurarTituloImpresion();
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Imprime un ticket en formato POS térmico.
 *
 * @param {string} html - El HTML del ticket a imprimir
 * @param {Object} [opts] - Opciones
 * @param {number} [opts.anchoMm=80] - Ancho del papel en mm (58, 76, 80)
 *
 * @example
 *   imprimirPOS(`
 *     <div>
 *       <h2>Mi Tienda</h2>
 *       <p>Producto X — $5.000</p>
 *       <p>Total: $5.000</p>
 *     </div>
 *   `);
 */
export function imprimirPOS(html, opts = {}) {
  if (!config.features.impresionTermica) {
    console.warn('⚠️ Impresión térmica deshabilitada en config');
    return;
  }

  const ancho = opts.anchoMm || ANCHO_POS_DEFAULT;

  // 1. Cambiar título PRIMERO para que el navegador lo lea cuando capture
  //    el header del print (algunos navegadores lo cachean al instante).
  aplicarTituloImpresion(opts.titulo || 'Ticket');

  // 2. Aplicar el ancho de papel (inyecta @page con tamaño fijo)
  aplicarAnchoImpresion(ancho);

  // 3. Activar el modo de impresión POS en el body
  document.body.classList.add('print-pos');

  // 4. Inyectar el HTML — envuelto para forzar ancho fijo a 80mm aunque
  //    el navegador elija un papel mayor (carta/A4).
  const area = ensurePrintArea();
  area.innerHTML = `<div style="width:${ancho}mm;max-width:${ancho}mm;margin:0;padding:0;box-sizing:border-box">${html}</div>`;

  // 5. Esperar más tiempo para que el navegador procese:
  //    - El cambio de @page
  //    - El cambio de document.title
  //    - El render del nuevo HTML
  //    Sin este delay, Chrome captura un snapshot estale.
  setTimeout(() => {
    window.print();
    // 6. Limpieza después de que el diálogo se cierre
    setTimeout(limpiarDespuesDeImprimir, 100);
  }, 220);
}

/**
 * Imprime un documento en formato carta/A4.
 *
 * @param {string} html - El HTML del documento
 *
 * @example
 *   imprimirCarta(`
 *     <h1>Factura electrónica</h1>
 *     <p>Cliente: ...</p>
 *   `);
 */
export function imprimirCarta(html, opts = {}) {
  // 1. Cambiar título PRIMERO
  aplicarTituloImpresion(opts.titulo || 'Documento');

  // 2. Aplicar el tamaño de papel carta (sobrescribe cualquier @page POS previo)
  aplicarTamanoCarta();

  // 3. Activar el modo de impresión carta en el body
  document.body.classList.add('print-carta');

  // 4. Inyectar el HTML
  const area = ensurePrintArea();
  area.innerHTML = html;

  // 5. Imprimir con delay suficiente para que el navegador procese cambios
  setTimeout(() => {
    window.print();
    setTimeout(limpiarDespuesDeImprimir, 100);
  }, 220);
}

/**
 * Imprime contenido genérico sin formato especial.
 * El cliente verá el diálogo "Imprimir" estándar del navegador.
 *
 * @param {string} html - HTML a imprimir
 *
 * @example
 *   imprimirGenerico('<h1>Hola</h1>');
 */
export function imprimirGenerico(html) {
  const area = ensurePrintArea();
  area.innerHTML = html;

  setTimeout(() => {
    window.print();
    setTimeout(limpiarDespuesDeImprimir, 100);
  }, 50);
}

/**
 * Verifica si el navegador soporta impresión.
 * (Sí, todos los navegadores modernos lo soportan, pero por las dudas.)
 *
 * @returns {boolean}
 */
export function puedeImprimir() {
  return typeof window.print === 'function';
}