/**
 * modules/compras/proveedores.repo.js — Acceso a datos de proveedores
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { uid } from '../../core/strings.js';

const TABLA = 'proveedores';

export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
  return items;
}

export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

export async function contar() {
  return await db.count(TABLA);
}

export async function guardar(datos) {
  const item = {
    id: datos.id || uid(),
    nombre: String(datos.nombre || '').trim(),
    nit: String(datos.nit || '').trim(),
    telefono: String(datos.telefono || '').trim(),
    contacto: String(datos.contacto || '').trim(),
    ciudad: String(datos.ciudad || '').trim(),
    direccion: String(datos.direccion || '').trim(),
    email: String(datos.email || '').trim(),
    nota: String(datos.nota || '').trim(),
  };
  if (!item.nombre) throw new Error('El proveedor debe tener un nombre');
  await Sync.guardar(TABLA, item);
  return item;
}

export async function eliminar(id) {
  await Sync.borrar(TABLA, id);
}
