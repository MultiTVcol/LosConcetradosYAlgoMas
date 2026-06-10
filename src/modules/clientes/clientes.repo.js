/**
 * modules/clientes/clientes.repo.js — Acceso a datos de Clientes
 *
 * Es la ÚNICA capa que conoce cómo se guardan los clientes.
 * Todo el resto del módulo (view, form, controlador) habla con este repo.
 *
 * Misma estrategia que productos.repo.js:
 *   - Lectura: IndexedDB local (rápida, sin red)
 *   - Escritura: Sync.guardar (local + nube)
 *   - Sincronización inicial: al arrancar baja todo de la nube
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import { uid } from '../../core/strings.js';

// ============================================================
//  CONSTANTES
// ============================================================

/** Nombre de la tabla en IndexedDB y Supabase */
const TABLA = 'clientes';

// ============================================================
//  VALIDACIÓN
// ============================================================

/**
 * Valida que un cliente tenga los campos mínimos.
 * Devuelve un array de errores (vacío = válido).
 *
 * @param {Object} c - Cliente a validar
 * @returns {Array<string>}
 */
export function validar(c) {
  const errores = [];

  if (!c || typeof c !== 'object') {
    errores.push('Cliente inválido');
    return errores;
  }

  if (!c.nombre || String(c.nombre).trim() === '') {
    errores.push('El nombre es obligatorio');
  }

  if (c.email && c.email.trim() !== '') {
    // Validación básica de email
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(c.email.trim())) {
      errores.push('El email no tiene un formato válido');
    }
  }

  return errores;
}

// ============================================================
//  NORMALIZACIÓN
// ============================================================

/**
 * Normaliza un cliente antes de guardarlo.
 *
 * @param {Object} c
 * @returns {Object}
 */
export function normalizar(c) {
  // Limpiar precios especiales: solo numéricos > 0
  const peLimpio = {};
  const peEntrada = c.preciosEspeciales || {};
  for (const k of Object.keys(peEntrada)) {
    const v = Number(peEntrada[k]);
    if (!isNaN(v) && v > 0) peLimpio[k] = v;
  }

  return {
    id: c.id || uid(),
    nombre: String(c.nombre || '').trim(),
    negocio: String(c.negocio || '').trim(),
    telefono: String(c.telefono || '').trim(),
    direccion: String(c.direccion || '').trim(),
    ciudad: String(c.ciudad || '').trim(),
    obs: String(c.obs || c.notas || '').trim(),
    // Campos opcionales heredados (por si ya existían)
    email: String(c.email || '').trim().toLowerCase(),
    documento: String(c.documento || '').trim(),
    // Precios especiales: mapa { [productoId]: precio }
    preciosEspeciales: peLimpio,
    data: c.data || null,
  };
}

// ============================================================
//  PRECIOS ESPECIALES POR CLIENTE
// ============================================================

/**
 * Devuelve el precio que aplica para un producto según el cliente:
 *   - Si el cliente tiene precio especial para ese producto, lo devuelve
 *   - Si no, devuelve el precio estándar del producto
 *
 * @param {Object|null} cliente
 * @param {Object} producto
 * @returns {number}
 */
export function getPrecioPara(cliente, producto) {
  if (!producto) return 0;
  const std = Number(producto.precio) || 0;
  if (!cliente || !cliente.preciosEspeciales) return std;
  const pe = cliente.preciosEspeciales[producto.id];
  return (pe != null && pe !== '' && Number(pe) > 0) ? Number(pe) : std;
}

/**
 * Indica si el cliente tiene un precio especial para ese producto.
 */
export function tienePrecioEspecial(cliente, producto) {
  if (!cliente || !producto || !cliente.preciosEspeciales) return false;
  const v = cliente.preciosEspeciales[producto.id];
  return v != null && v !== '' && Number(v) > 0;
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Lista todos los clientes almacenados localmente.
 * Devuelve array ordenado alfabéticamente por nombre.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => {
    const na = (a.nombre || '').toLowerCase();
    const nb = (b.nombre || '').toLowerCase();
    return na.localeCompare(nb, 'es');
  });
  return items;
}

/**
 * Obtiene UN cliente por su ID.
 */
export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

/**
 * Cuenta cuántos clientes hay almacenados.
 */
export async function contar() {
  return await db.count(TABLA);
}

/**
 * Guarda un cliente (alta o edición).
 * Valida, normaliza y sincroniza local + nube.
 *
 * @param {Object} cliente
 * @returns {Promise<Object>}
 * @throws {Error} - Si la validación falla
 */
export async function guardar(cliente) {
  const errores = validar(cliente);
  if (errores.length > 0) {
    throw new Error('Validación: ' + errores.join(', '));
  }

  const normalizado = normalizar(cliente);
  await Sync.guardar(TABLA, normalizado);
  return normalizado;
}

/**
 * Borra un cliente (local + nube).
 */
export async function borrar(id) {
  if (!id) throw new Error('Repo.borrar: falta el id');
  return await Sync.borrar(TABLA, id);
}

/**
 * Sincroniza desde la nube: baja todos los clientes del tenant
 * actual y los guarda en local.
 *
 * @returns {Promise<number>}
 */
export async function descargarDeNube() {
  if (!Supa.isReady()) {
    console.warn('Supabase no disponible, no se puede descargar');
    return 0;
  }
  return await Sync.descargar(TABLA);
}