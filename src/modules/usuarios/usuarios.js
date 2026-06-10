/**
 * modules/usuarios/usuarios.js — Controlador del módulo Usuarios
 */

import * as View from './usuarios.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Usuarios: shell no montado');
    return;
  }
  await View.render(contenido);
}
