/**
 * modules/compras/facturas-compra.js — Controlador de Facturas de compra
 */

import * as View from './facturas-compra.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) { console.error('Facturas de compra: shell no montado'); return; }
  await View.render(contenido);
}
