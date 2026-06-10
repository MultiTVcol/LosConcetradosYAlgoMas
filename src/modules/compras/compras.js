/**
 * modules/compras/compras.js — Controlador del módulo Compras
 */

import * as View from './compras.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Compras: shell no montado');
    return;
  }
  await View.render(contenido);
}
