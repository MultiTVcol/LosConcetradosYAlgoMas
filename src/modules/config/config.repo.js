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
  const fe = datos.fe || {};
  return {
    negocio: { ...defaultConfig.negocio, ...(datos.negocio || {}) },
    mensajes: { mensaje1: '', mensaje2: '', ...(datos.mensajes || {}) },
    sonido: datos.sonido !== false,
    mostrarUtilidad: datos.mostrarUtilidad !== false,   // default ahora ES true
    lector: datos.lector || 'pistola',
    impresoraDefault: datos.impresoraDefault || 'preguntar',
    cajon: {
      activo: (datos.cajon && datos.cajon.activo) === true,
      baud: (datos.cajon && Number(datos.cajon.baud)) || 9600,
    },
    // ── Facturación electrónica (DIAN / Factus) ──
    // Apagada por defecto: hasta que el comercio la active y configure,
    // NADA cambia en Punto de Venta.
    fe: {
      activa: fe.activa === true,
      ambiente: fe.ambiente === 'produccion' ? 'produccion' : 'sandbox',
      emisor: { ...FE_EMISOR_DEFAULT, ...(fe.emisor || {}) },
      resolucion: { ...FE_RESOLUCION_DEFAULT, ...(fe.resolucion || {}) },
    },
  };
}

/** Datos fiscales del emisor (tu empresa) para la factura electrónica. */
export const FE_EMISOR_DEFAULT = {
  razonSocial: '',
  nit: '',
  dv: '',                 // dígito de verificación del NIT
  tipoPersona: 'juridica',   // 'juridica' | 'natural'
  regimen: 'no_responsable_iva', // 'responsable_iva' | 'no_responsable_iva'
  responsabilidades: '',  // ej: O-13, O-15, R-99-PN
  actividadCIIU: '',      // código actividad económica
  direccion: '',
  municipio: '',          // nombre del municipio
  municipioDane: '',      // código DANE del municipio (lo pide la DIAN)
  departamento: '',
  email: '',
  telefono: '',
};

/** Resolución de numeración autorizada por la DIAN. */
export const FE_RESOLUCION_DEFAULT = {
  prefijo: '',
  numeroResolucion: '',
  rangoDesde: '',
  rangoHasta: '',
  fechaResolucion: '',
  vigenciaHasta: '',
};

/**
 * Guarda la configuración del usuario.
 */
export async function guardar(cfg) {
  await db.put(TABLA, { id: KEY_CFG, datos: cfg });
  return cfg;
}
