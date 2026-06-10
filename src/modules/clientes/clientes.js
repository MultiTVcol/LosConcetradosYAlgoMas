/**
 * modules/clientes/clientes.js — Controlador del módulo Clientes
 *
 * Punto de entrada del módulo. Se llama desde el router cuando
 * el usuario navega a #clientes.
 */

import * as Repo from './clientes.repo.js';
import * as View from './clientes.view.js';
import { getContenido } from '../../app/shell.js';

/**
 * Monta el módulo Clientes en el área principal.
 */
export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Clientes: shell no montado, no se puede renderizar');
    return;
  }

  // Si la BD local está vacía, intentar bajar de la nube
  try {
    const cuantos = await Repo.contar();
    if (cuantos === 0) {
      console.log('🔄 BD local vacía, intentando bajar clientes de la nube…');
      const descargados = await Repo.descargarDeNube();
      if (descargados > 0) {
        console.log(`✅ ${descargados} clientes descargados`);
      }
    }
  } catch (err) {
    console.warn('No se pudo verificar sync inicial:', err);
  }

  await View.render(contenido);
}