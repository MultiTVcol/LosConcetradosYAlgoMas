/**
 * modules/contabilidad/contabilidad.js — Controlador del módulo Contabilidad
 *
 * Punto de entrada del módulo. El router lo llama al navegar a #contabilidad.
 */

import * as View from './contabilidad.view.js';
import { getContenido } from '../../app/shell.js';
import * as Auth from '../../services/auth.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Contabilidad: shell no montado, no se puede renderizar');
    return;
  }
  if (!Auth.esAdmin()) {
    contenido.innerHTML = `<div style="padding:40px 48px;color:#7D6858;font-size:15px">La contabilidad solo la ve el administrador.</div>`;
    return;
  }
  await View.render(contenido);
}
