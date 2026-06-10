/**
 * modules/config/config.repo.js — Configuración personalizable del usuario
 *
 * Combina los defaults inmutables de `services/config.js` con preferencias
 * editables persistidas en el store `kvs` de IndexedDB.
 */

import * as db from '../../services/db.js';
import { config as defaultConfig } from '../../services/config.js';

const TABLA = 'kvs';
const KEY_CFG = 'user_config';

/**
 * Lee la configuración del usuario, mezclando defaults + override.
 */
export async function leer() {
  let stored = null;
  try { stored = await db.get(TABLA, KEY_CFG); } catch (e) { stored = null; }
  const datos = stored?.datos || {};
  return {
    negocio: { ...defaultConfig.negocio, ...(datos.negocio || {}) },
    mensajes: { mensaje1: '', mensaje2: '', ...(datos.mensajes || {}) },
    sonido: datos.sonido !== false,
    mostrarUtilidad: datos.mostrarUtilidad !== false,   // default ahora ES true
    lector: datos.lector || 'pistola',
    impresoraDefault: datos.impresoraDefault || 'preguntar',
  };
}

/**
 * Guarda la configuración del usuario.
 */
export async function guardar(cfg) {
  await db.put(TABLA, { id: KEY_CFG, datos: cfg });
  return cfg;
}
