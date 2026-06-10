/**
 * modules/gastos/gastos.js — Controlador del módulo Gastos
 */

import * as View from './gastos.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Gastos: shell no montado');
    return;
  }
  await View.render(contenido);
}
