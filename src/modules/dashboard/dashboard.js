/**
 * modules/dashboard/dashboard.js — Controlador del Dashboard
 */

import * as View from './dashboard.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Dashboard: shell no montado');
    return;
  }
  await View.render(contenido);
}
