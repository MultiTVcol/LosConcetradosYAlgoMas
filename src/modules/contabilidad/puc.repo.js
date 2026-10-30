/**
 * modules/contabilidad/puc.repo.js — Plan Único de Cuentas
 *
 * El catálogo base vive en el código (data/puc.js), así que no hace
 * falta una tabla nueva en la nube. Las cuentas que agregue el negocio
 * se guardan en kvs ('puc_personalizado') y se suman al catálogo base.
 *
 * El motor contable consulta aquí para validar que las cuentas existan,
 * permitan movimiento y exijan tercero cuando aplica.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { PUC_PYME, NATURALEZA_CLASE, expandirPUC } from '../../data/puc.js';

const KEY_PERSONALIZADO = 'puc_personalizado';

/** Cache en memoria (el PUC se consulta MUCHO y casi nunca cambia). */
let _cache = null;
let _porCodigo = null;

export function invalidarCache() {
  _cache = null;
  _porCodigo = null;
}

async function cuentasPersonalizadas() {
  try {
    const row = await db.get('kvs', KEY_PERSONALIZADO);
    return Array.isArray(row?.datos) ? row.datos : [];
  } catch (e) {
    return [];
  }
}

async function cargar() {
  if (_cache) return;
  const base = expandirPUC();
  const extra = (await cuentasPersonalizadas()).map((c) => normalizar(c));
  const mapa = new Map(base.map((c) => [c.codigo, c]));
  for (const c of extra) mapa.set(c.codigo, { ...mapa.get(c.codigo), ...c, sistema: mapa.get(c.codigo)?.sistema || false });
  _cache = [...mapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  _porCodigo = mapa;
}

function normalizar(c) {
  const codigo = String(c.codigo || '').trim();
  const clase = Number(codigo.charAt(0));
  return {
    id: codigo,
    codigo,
    nombre: String(c.nombre || '').trim(),
    nivel: codigo.length,
    naturaleza: c.naturaleza === 'C' || c.naturaleza === 'D' ? c.naturaleza : (NATURALEZA_CLASE[clase] || 'D'),
    permite_movimiento: codigo.length === 6,
    requiere_tercero: !!c.requiere_tercero,
    es_efectivo: !!c.es_efectivo,
    sistema: false,
  };
}

/** Todas las cuentas ordenadas por código. */
export async function listar() {
  await cargar();
  return _cache;
}

export async function obtener(codigo) {
  if (!codigo) return null;
  await cargar();
  return _porCodigo.get(String(codigo)) || null;
}

/** Solo las cuentas que aceptan movimiento (subcuentas, nivel 6). */
export async function cuentasMovimiento() {
  return (await listar()).filter((c) => c.permite_movimiento);
}

/**
 * Agrega o edita una subcuenta del negocio (6 dígitos, con su cuenta
 * padre de 4 dígitos ya existente).
 */
export async function guardarSubcuenta(datos) {
  const codigo = String(datos.codigo || '').trim();
  if (!/^\d{6}$/.test(codigo)) throw new Error('La subcuenta debe tener 6 dígitos');
  if (!String(datos.nombre || '').trim()) throw new Error('El nombre es obligatorio');
  if (!(await obtener(codigo.slice(0, 4)))) throw new Error(`No existe la cuenta padre ${codigo.slice(0, 4)}`);

  const extra = (await cuentasPersonalizadas()).filter((c) => c.codigo !== codigo);
  extra.push(normalizar(datos));
  await Sync.guardar('kvs', { id: KEY_PERSONALIZADO, valor: null, datos: extra });
  invalidarCache();
}

/**
 * Validación usada por el motor contable antes de aceptar una línea.
 * Devuelve la cuenta si es válida para movimiento; lanza error si no.
 */
export async function validarParaMovimiento(codigo) {
  const c = await obtener(codigo);
  if (!c) throw new Error(`La cuenta ${codigo} no existe en el PUC`);
  if (!c.permite_movimiento) throw new Error(`La cuenta ${codigo} (${c.nombre}) no permite movimiento — usa una subcuenta`);
  return c;
}

export { PUC_PYME };
