/**
 * modules/ventas/ventas.js — Controlador del módulo Ventas
 *
 * Punto de entrada del módulo. Se llama desde el router cuando
 * el usuario navega a #ventas.
 */

import * as Repo from './ventas.repo.js';
import * as View from './ventas.view.js';
import { getContenido } from '../../app/shell.js';

/**
 * Monta el módulo Ventas en el área principal.
 */
export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Ventas: shell no montado, no se puede renderizar');
    return;
  }

  // Si la BD local está vacía, intentar bajar de la nube
  try {
    const cuantas = await Repo.contar();
    if (cuantas === 0) {
      console.log('🔄 BD local vacía, intentando bajar ventas de la nube…');
      const descargadas = await Repo.descargarDeNube();
      if (descargadas > 0) {
        console.log(`✅ ${descargadas} ventas descargadas`);
      }
    }
  } catch (err) {
    console.warn('No se pudo verificar sync inicial:', err);
  }

  await View.render(contenido);
}