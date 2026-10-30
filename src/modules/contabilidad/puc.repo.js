/**
 * modules/contabilidad/puc.repo.js — Plan Único de Cuentas
 *
 * El catálogo base vive en el código (data/puc.js), así que no hace
 * falta una tabla nueva en la nube. Lo que cambie el negocio (cuentas
 * nuevas, auxiliares de 8 dígitos, nombres editados) se guarda en kvs
 * ('puc_personalizado') y se superpone al catálogo base.
 *
 * Niveles: 1 clase · 2 grupo · 4 cuenta · 6 subcuenta · 8 auxiliar.
 * Reciben movimiento las subcuentas y los auxiliares (6 u 8 dígitos).
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
  const mapa = new Map(expandirPUC().map((c) => [c.codigo, { ...c, base: true }]));
  for (const c of await cuentasPersonalizadas()) {
    const previa = mapa.get(c.codigo);
    mapa.set(c.codigo, { ...normalizar(c), base: !!previa, sistema: previa?.sistema || false });
  }
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
    permite_movimiento: codigo.length >= 6,
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

/** Solo las cuentas que aceptan movimiento (subcuentas y auxiliares). */
export async function cuentasMovimiento() {
  return (await listar()).filter((c) => c.permite_movimiento);
}

/** Padre directo de un código (8→6, 6→4, 4→2, 2→1). */
export function codigoPadre(codigo) {
  const c = String(codigo);
  if (c.length === 8) return c.slice(0, 6);
  if (c.length === 6) return c.slice(0, 4);
  if (c.length === 4) return c.slice(0, 2);
  if (c.length === 2) return c.slice(0, 1);
  return null;
}

/**
 * Crea o edita una cuenta del negocio. Reglas:
 *  - código de 4, 6 u 8 dígitos con su cuenta padre ya existente
 *  - a las cuentas base solo se les cambia el nombre y el tercero
 */
export async function guardarCuenta(datos) {
  const codigo = String(datos.codigo || '').trim();
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(codigo)) throw new Error('El código debe tener 4, 6 u 8 dígitos');
  if (!String(datos.nombre || '').trim()) throw new Error('El nombre es obligatorio');
  const padre = codigoPadre(codigo);
  if (!(await obtener(padre))) throw new Error(`No existe la cuenta padre ${padre}`);

  const previa = await obtener(codigo);
  const nueva = normalizar({
    ...datos,
    naturaleza: datos.naturaleza || previa?.naturaleza || (await obtener(padre))?.naturaleza,
  });
  const extra = (await cuentasPersonalizadas()).filter((c) => c.codigo !== codigo);
  extra.push(nueva);
  await Sync.guardar('kvs', { id: KEY_PERSONALIZADO, valor: null, datos: extra });
  invalidarCache();
  return nueva;
}

/**
 * Borra una cuenta creada por el negocio (o deshace el cambio de nombre
 * de una base). No se puede si tiene subcuentas o movimientos.
 * @param {(codigo: string) => Promise<boolean>} tieneMovimientos
 */
export async function eliminarCuenta(codigo, tieneMovimientos) {
  const c = await obtener(codigo);
  if (!c) throw new Error('Cuenta no encontrada');
  const extra = await cuentasPersonalizadas();
  if (!extra.some((x) => x.codigo === codigo)) throw new Error('Las cuentas del PUC base no se borran');
  if (!c.base) {
    if ((await listar()).some((x) => x.codigo !== codigo && x.codigo.startsWith(codigo))) {
      throw new Error('La cuenta tiene subcuentas: bórralas primero');
    }
    if (await tieneMovimientos(codigo)) throw new Error('La cuenta ya tiene movimientos: no se puede borrar');
  }
  await Sync.guardar('kvs', { id: KEY_PERSONALIZADO, valor: null, datos: extra.filter((x) => x.codigo !== codigo) });
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
