/**
 * modules/factura/plantilla.repo.js — Plantillas configurables de tickets POS
 *
 * Persiste en el store `kvs` la configuracion de impresion POS 80mm.
 * Soporta 3 tipos de plantilla independientes:
 *
 *   - 'venta'   → ticket de factura de venta   (key: plantilla_factura_pos)
 *   - 'cierre'  → ticket de cierre de caja     (key: plantilla_cierre_pos)
 *   - 'reporte' → ticket de reporte financiero (key: plantilla_reporte_pos)
 *
 * El default es el mismo para todos pero el `tituloDocumento` y los
 * `mensajes` se ajustan por tipo. Cada usuario puede personalizar
 * cada ticket por separado.
 */

import * as db from '../../services/db.js';

const TABLA = 'kvs';

/** Keys de almacenamiento por tipo. */
const KEYS = {
  venta:   'plantilla_factura_pos',
  cierre:  'plantilla_cierre_pos',
  reporte: 'plantilla_reporte_pos',
};

/** Titulos por defecto segun el tipo. */
const TITULO_POR_TIPO = {
  venta:   'FACTURA',
  cierre:  'CIERRE DE CAJA',
  reporte: 'REPORTE',
};

/** Mensajes por defecto segun el tipo. */
const MENSAJES_POR_TIPO = {
  venta:   { mensaje1: '¡Gracias por su compra! 🐾', mensaje2: 'Síguenos en redes' },
  cierre:  { mensaje1: 'Cierre generado automáticamente', mensaje2: '' },
  reporte: { mensaje1: 'Reporte generado automáticamente', mensaje2: '' },
};

/** Plantilla por defecto comun. */
const DEFAULT_BASE = {
  fuente: "'Courier New', 'Roboto Mono', monospace",
  tamBase: 13,
  interlineado: 1.4,
  color: '#000',
  mayusculas: false,
  encNegrita: true,

  tituloDocumento: 'FACTURA',

  mostrarLogo: false,
  logoUrl: '',
  mostrarNombre: true,
  mostrarNit: true,
  mostrarTelefono: true,
  mostrarDireccion: true,
  mostrarCiudad: true,

  mostrarFolio: true,
  mostrarFecha: true,
  mostrarCliente: true,
  mostrarNegocioCliente: true,
  mostrarTelefonoCliente: true,
  mostrarDireccionCliente: true,
  mostrarItems: true,
  mostrarSubtotal: true,
  mostrarImpuestos: true,
  mostrarDescuento: true,
  mostrarTotal: true,
  mostrarMetodoPago: true,
  mostrarRecibidoCambio: true,
  mostrarPieRepetido: true,

  mensaje1: '¡Gracias por su compra! 🐾',
  mensaje2: 'Síguenos en redes',

  separador: 'dashed',
  anchoMm: 80,
};

/** Default por tipo (combina base + titulo + mensajes especificos). */
export function defaultPara(tipo = 'venta') {
  return {
    ...DEFAULT_BASE,
    tituloDocumento: TITULO_POR_TIPO[tipo] || 'FACTURA',
    ...(MENSAJES_POR_TIPO[tipo] || {}),
  };
}

/** Mantenemos `DEFAULT` exportado para compatibilidad con codigo previo. */
export const DEFAULT = DEFAULT_BASE;

function keyPara(tipo) {
  return KEYS[tipo] || KEYS.venta;
}

/**
 * Lee la plantilla de un tipo (venta | cierre | reporte).
 * Si no hay nada guardado, retorna el default para ese tipo.
 */
export async function leer(tipo = 'venta') {
  const key = keyPara(tipo);
  let stored = null;
  try { stored = await db.get(TABLA, key); } catch (e) { stored = null; }
  const override = stored?.datos || {};
  return { ...defaultPara(tipo), ...override };
}

/**
 * Guarda la plantilla de un tipo.
 */
export async function guardar(plantilla, tipo = 'venta') {
  const key = keyPara(tipo);
  await db.put(TABLA, { id: key, datos: plantilla });
  return plantilla;
}

/**
 * Restablece la plantilla de un tipo al default.
 */
export async function restablecer(tipo = 'venta') {
  const key = keyPara(tipo);
  try { await db.remove(TABLA, key); } catch (e) { /**/ }
  return defaultPara(tipo);
}
