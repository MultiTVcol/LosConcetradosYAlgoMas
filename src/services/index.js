/**
 * services/index.js — Archivo "barril" de los servicios
 *
 * Re-exporta todos los servicios desde un único punto, para que el
 * resto del sistema los importe con una sola línea:
 *
 *   import { config, db, printer, Supa, Sync } from '../services/index.js';
 *
 * Beneficios:
 *   - Imports más limpios en los módulos que usan servicios
 *   - Si reorganizamos los archivos internos, solo tocamos este barril
 *   - Documentación clara de qué servicios están disponibles
 *
 * Servicios actuales:
 *   - config   → Configuración white-label (negocio, branding, features)
 *   - db       → IndexedDB (almacenamiento local, siempre disponible)
 *   - printer  → Impresión POS térmica y carta
 *   - Supa     → Cliente Supabase (operaciones directas con la nube)
 *   - Sync     → Sincronización automática local ⇄ nube (lo que más usás)
 */

// ============================================================
//  CONFIG — Configuración del cliente (white-label)
// ============================================================
export {
  config,
  isSupabaseConfigured,
  isFeatureEnabled,
  getNegocioInfo,
  getBranding,
} from './config.js';

// ============================================================
//  DB — Base de datos local (IndexedDB)
//  Se re-exporta como objeto `db` para usar: db.put(), db.get(), etc.
// ============================================================
export * as db from './db.js';

// ============================================================
//  PRINTER — Impresión POS térmica + carta
//  Se re-exporta como objeto `printer` para usar: printer.imprimirPOS()
// ============================================================
export * as printer from './printer.js';

// ============================================================
//  SUPA — Cliente Supabase + helpers (acceso directo a la nube)
//  Se re-exporta como objeto `Supa` para usar: Supa.upsert(), Supa.selectAll()
// ============================================================
export * as Supa from './supabase.js';

// ============================================================
//  SYNC — Sincronización local ⇄ nube (ESTE ES EL QUE MÁS VAS A USAR)
//  Se re-exporta como objeto `Sync` para usar: Sync.guardar(), Sync.descargar()
// ============================================================
export * as Sync from './sync.js';