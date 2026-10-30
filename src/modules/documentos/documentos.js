/**
 * modules/documentos/documentos.js — Controlador del módulo Documentos
 *
 * Punto de entrada del módulo. El router lo llama al navegar a #documentos.
 */

import * as View from './documentos.view.js';
import { getContenido } from '../../app/shell.js';
import * as Auth from '../../services/auth.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Documentos: shell no montado, no se puede renderizar');
    return;
  }
  if (!Auth.esAdmin()) {
    contenido.innerHTML = `<div style="padding:40px 48px;color:#7D6858;font-size:15px">Los documentos solo los maneja el administrador.</div>`;
    return;
  }
  await View.render(contenido);
}
