/**
 * modules/inventario/inventario.js — Controlador del módulo Inventario
 *
 * Punto de entrada del módulo. El router lo llama al navegar a #inventario.
 * Muestra la valorización del inventario, el kardex de cada producto y el
 * conteo físico (ajuste de stock por sobrante/faltante).
 */

import * as View from './inventario.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Inventario: shell no montado, no se puede renderizar');
    return;
  }
  await View.render(contenido);
}
