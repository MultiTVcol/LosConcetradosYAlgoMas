/**
 * modules/reportes/reportes.js — Controlador del módulo Reportes
 */

import * as View from './reportes.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Reportes: shell no montado');
    return;
  }
  await View.render(contenido);
}
