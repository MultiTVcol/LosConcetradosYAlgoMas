/**
 * modules/productos/productos.repo.js — Acceso a datos de Productos
 *
 * Es la ÚNICA capa que conoce cómo se guardan los productos.
 * Todo el resto del módulo habla con este repo.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import { uid } from '../../core/strings.js';

const TABLA = 'productos';

// ============================================================
//  VALIDACIÓN
// ============================================================

export function validar(p) {
  const errores = [];

  if (!p || typeof p !== 'object') {
    errores.push('Producto inválido');
    return errores;
  }

  if (!p.nombre || String(p.nombre).trim() === '') {
    errores.push('El nombre es obligatorio');
  }

  if (p.precio == null || isNaN(Number(p.precio)) || Number(p.precio) < 0) {
    errores.push('El precio debe ser un número mayor o igual a 0');
  }

  if (p.costo != null && p.costo !== '' && (isNaN(Number(p.costo)) || Number(p.costo) < 0)) {
    errores.push('El costo debe ser un número mayor o igual a 0');
  }

  if (p.stock != null && p.stock !== '' && (isNaN(Number(p.stock)))) {
    errores.push('El stock debe ser un número');
  }

  if (p.stock_min != null && p.stock_min !== '' && (isNaN(Number(p.stock_min)) || Number(p.stock_min) < 0)) {
    errores.push('El stock mínimo debe ser un número mayor o igual a 0');
  }

  return errores;
}

// ============================================================
//  NORMALIZACIÓN
// ============================================================

export function normalizar(p) {
  return {
    id: p.id || uid(),
    nombre: String(p.nombre || '').trim(),
    precio: Number(p.precio) || 0,
    costo: Number(p.costo) || 0,
    stock: Number(p.stock) || 0,
    codigo: String(p.codigo || '').trim(),
    categoria: String(p.categoria || '').trim(),
    barras: String(p.barras || '').trim(),
    stock_min: Number(p.stock_min) || 0,
    proveedor: String(p.proveedor || '').trim(),
    impuesto_pct: Number(p.impuesto_pct) || 0,
    unidad: String(p.unidad || '').trim(),
    data: p.data || null,
  };
}

// ============================================================
//  HELPERS DE BÚSQUEDA (lógica de prioridad, copiada del legacy)
// ============================================================

/**
 * Devuelve productos filtrados ordenados por prioridad:
 *   1. Código exacto
 *   2. Código empieza con
 *   3. Barras exacto
 *   4. Barras empieza con
 *   5. Código contiene
 *   6. Barras contiene
 *   7. Nombre empieza con
 *   8. Nombre contiene
 *   9. Categoría empieza con
 *  10. Categoría contiene
 *  11. Proveedor empieza con
 *  12. Proveedor contiene
 *
 * @param {Array} productos - lista completa
 * @param {string} q - texto a buscar (puede estar vacío)
 * @returns {Array} productos ordenados por relevancia
 */
/**
 * Normaliza un texto para búsqueda: sin acentos, en minúsculas y sin
 * espacios sobrantes. Así "alimon" encuentra "Alimón" y viceversa.
 */
function normalizarBusqueda(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function filtrarConPrioridad(productos, q) {
  const query = normalizarBusqueda(q);
  if (!query) return productos.slice();

  function rank(p) {
    const cod = normalizarBusqueda(p.codigo);
    const bar = normalizarBusqueda(p.barras);
    const nom = normalizarBusqueda(p.nombre);
    const cat = normalizarBusqueda(p.categoria);
    const prv = normalizarBusqueda(p.proveedor);

    if (cod === query)            return 0;
    if (cod.startsWith(query))    return 1;
    if (bar === query)            return 2;
    if (bar.startsWith(query))    return 3;
    if (cod.includes(query))      return 4;
    if (bar.includes(query))      return 5;
    if (nom.startsWith(query))    return 6;
    if (nom.includes(query))      return 7;
    if (cat.startsWith(query))    return 8;
    if (cat.includes(query))      return 9;
    if (prv.startsWith(query))    return 10;
    if (prv.includes(query))      return 11;
    return 999; // no matchea
  }

  return productos
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 999)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

/**
 * Busca un producto que matchee EXACTAMENTE por código o por barras.
 * Útil para el escáner (USB o cámara): el código viene completo.
 *
 * @param {Array} productos - lista completa
 * @param {string} codigo - texto exacto a buscar
 * @returns {Object|null}
 */
export function buscarExacto(productos, codigo) {
  if (!codigo) return null;
  const q = String(codigo).trim().toLowerCase();
  if (!q) return null;
  return productos.find((p) => {
    const cod = String(p.codigo || '').toLowerCase();
    const bar = String(p.barras || '').toLowerCase();
    return cod === q || bar === q;
  }) || null;
}

// ============================================================
//  API PÚBLICA
// ============================================================

export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => {
    const na = (a.nombre || '').toLowerCase();
    const nb = (b.nombre || '').toLowerCase();
    return na.localeCompare(nb, 'es');
  });
  return items;
}

export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

export async function contar() {
  return await db.count(TABLA);
}

/**
 * Calcula el siguiente código consecutivo a partir de los productos
 * existentes. Toma el número MÁS ALTO encontrado en los códigos y suma 1,
 * conservando el formato del código que lo tiene (prefijo y ceros).
 *
 *   "100" → "101"   ·   "CRO-001"…"CRO-100" → "CRO-101"   ·   sin códigos → "1"
 *
 * Es best-effort (el código no es la clave única; el id sí). El usuario
 * puede editarlo a mano.
 *
 * @returns {Promise<string>}
 */
export async function siguienteCodigo() {
  const items = await db.getAll(TABLA);
  let maxNum = -1;
  let prefijo = '';
  let pad = 1;
  let encontrado = false;

  for (const p of items) {
    const cod = String(p.codigo || '').trim();
    const m = cod.match(/^(.*?)(\d+)$/); // prefijo (lo que sea) + dígitos finales
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (n > maxNum) {
      maxNum = n;
      prefijo = m[1];
      pad = m[2].length;
      encontrado = true;
    }
  }

  if (!encontrado) return '1';
  return prefijo + String(maxNum + 1).padStart(pad, '0');
}

export async function guardar(producto) {
  const errores = validar(producto);
  if (errores.length > 0) {
    throw new Error('Validación: ' + errores.join(', '));
  }
  const normalizado = normalizar(producto);
  await Sync.guardar(TABLA, normalizado);
  return normalizado;
}

export async function borrar(id) {
  if (!id) throw new Error('Repo.borrar: falta el id');
  return await Sync.borrar(TABLA, id);
}

export async function descargarDeNube() {
  if (!Supa.isReady()) {
    console.warn('Supabase no disponible, no se puede descargar');
    return 0;
  }
  return await Sync.descargar(TABLA);
}

export async function listarCategorias() {
  const items = await db.getAll(TABLA);
  const cats = new Set();
  for (const p of items) {
    if (p.categoria) cats.add(p.categoria);
  }
  return Array.from(cats).sort((a, b) => a.localeCompare(b, 'es'));
}

export async function listarStockBajo(umbral = null) {
  const items = await db.getAll(TABLA);
  return items.filter((p) => {
    const min = umbral != null ? umbral : (Number(p.stock_min) || 5);
    return Number(p.stock) < min;
  });
}