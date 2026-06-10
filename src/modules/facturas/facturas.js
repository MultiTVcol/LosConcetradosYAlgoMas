/**
 * modules/facturas/facturas.js — Controlador del módulo Facturas
 *
 * Las "facturas" son las ventas registradas. Reutilizamos ventas.repo.js
 * para leer/manipular los registros.
 */

import * as Repo from '../ventas/ventas.repo.js';
import * as View from './facturas.view.js';
import { getContenido } from '../../app/shell.js';

export async function montar() {
  const contenido = getContenido();
  if (!contenido) {
    console.error('Facturas: shell no montado, no se puede renderizar');
    return;
  }

  // Si la BD local está vacía, intentar bajar de la nube
  try {
    const cuantas = await Repo.contar();
    if (cuantas === 0) {
      const descargadas = await Repo.descargarDeNube();
      if (descargadas > 0) {
        console.log(`✅ ${descargadas} facturas descargadas`);
      }
    }
  } catch (err) {
    console.warn('No se pudo verificar sync inicial:', err);
  }

  await View.render(contenido);
}
