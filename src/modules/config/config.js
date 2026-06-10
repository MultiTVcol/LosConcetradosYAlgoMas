/**
 * modules/config/config.js — Controlador del módulo Configuración
 */

import * as View from './config.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Config: shell no montado');
    return;
  }
  await View.render(contenido);
}
