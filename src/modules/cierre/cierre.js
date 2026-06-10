/**
 * modules/cierre/cierre.js — Controlador del módulo Cierre de Caja
 */

import * as View from './cierre.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Cierre: shell no montado');
    return;
  }
  await View.render(contenido);
}
