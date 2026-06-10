/**
 * modules/factura/plantilla.repo.js — Plantilla configurable de factura POS
 *
 * Persiste en el store `kvs` la configuración de impresión POS 80mm:
 *   tipografía, tamaño base, secciones visibles, encabezado y pie.
 */

import * as db from '../../services/db.js';

const TABLA = 'kvs';
const KEY = 'plantilla_factura_pos';

/** Plantilla por defecto (estilo legacy). */
export const DEFAULT = {
  // Tipografía
  fuente: "'Courier New', 'Roboto Mono', monospace",
  tamBase: 13,           // px del texto normal
  interlineado: 1.4,
  color: '#000',
  mayusculas: false,     // forzar UPPERCASE
  encNegrita: true,      // títulos en negrita

  // Título del documento (REMISIÓN, FACTURA DE VENTA, RECIBO, etc.)
  tituloDocumento: 'FACTURA',

  // Encabezado del negocio (campos opcionales — si vacíos no se imprimen)
  mostrarLogo: false,
  logoUrl: '',
  mostrarNombre: true,
  mostrarNit: true,
  mostrarTelefono: true,
  mostrarDireccion: true,
  mostrarCiudad: true,

  // Secciones visibles
  mostrarFolio: true,
  mostrarFecha: true,
  mostrarCliente: true,
  mostrarNegocioCliente: true,
  mostrarTelefonoCliente: true,
  mostrarItems: true,
  mostrarSubtotal: true,
  mostrarImpuestos: true,
  mostrarDescuento: true,
  mostrarTotal: true,
  mostrarMetodoPago: true,
  mostrarRecibidoCambio: true,
  mostrarPieRepetido: true,   // pie final "FACTURA 0001 · Nombre negocio"

  // Pie de factura
  mensaje1: '¡Gracias por su compra! 🐾',
  mensaje2: 'Síguenos en redes · @petpos',

  // Separadores entre secciones: 'dashed' | 'solid' | 'none'
  separador: 'dashed',

  // Ancho del papel (mm): 58, 76, 80
  anchoMm: 80,
};

/**
 * Lee la plantilla (mezcla defaults + overrides guardados).
 */
export async function leer() {
  let stored = null;
  try { stored = await db.get(TABLA, KEY); } catch (e) { stored = null; }
  const override = stored?.datos || {};
  return { ...DEFAULT, ...override };
}

/**
 * Guarda la plantilla.
 */
export async function guardar(plantilla) {
  await db.put(TABLA, { id: KEY, datos: plantilla });
  return plantilla;
}

/**
 * Restablece la plantilla por defecto.
 */
export async function restablecer() {
  try { await db.remove(TABLA, KEY); } catch (e) { /**/ }
  return { ...DEFAULT };
}
