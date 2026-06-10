/**
 * modules/productos/productos.js — Controlador del módulo Productos
 *
 * Es el punto de entrada del módulo. Se llama desde el router cuando
 * el usuario navega a #productos.
 *
 * Su trabajo es:
 *   1. Sincronizar con la nube si el local está vacío
 *   2. Pasar el área de contenido a la vista para que se renderice
 */

import * as Repo from './productos.repo.js';
import * as View from './productos.view.js';
import { getContenido } from '../../app/shell.js';

/**
 * Monta el módulo Productos en el área principal.
 *
 * @example
 *   // Desde el router en main.js:
 *   Core.Router.registrar('productos', async () => {
 *     const mod = await import('./modules/productos/productos.js');
 *     await mod.montar();
 *   });
 */
export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Productos: shell no montado, no se puede renderizar');
    return;
  }

  // Si la BD local está vacía pero la nube tiene cosas, traerlas
  try {
    const cuantos = await Repo.contar();
    if (cuantos === 0) {
      console.log('🔄 BD local vacía, intentando bajar productos de la nube…');
      const descargados = await Repo.descargarDeNube();
      if (descargados > 0) {
        console.log(`✅ ${descargados} productos descargados`);
      }
    }
  } catch (err) {
    console.warn('No se pudo verificar sync inicial:', err);
  }

  // Renderizar la vista
  await View.render(contenido);
}