/**
 * modules/ventas/cuentas-cobrar.js — Controlador de Cuentas por cobrar
 */

import * as View from './cuentas-cobrar.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) { console.error('Cuentas por cobrar: shell no montado'); return; }
  await View.render(contenido);
}
