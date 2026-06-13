/**
 * services/config.js — Configuración global del sistema (white-label)
 *
 * Este archivo es el "panel de control" de PosPunto. Acá vive TODA la
 * información que cambia entre clientes:
 *
 *   - Datos del negocio (nombre, NIT, dirección, teléfono)
 *   - Credenciales de Supabase (URL, anonKey, tenantId)
 *   - Branding (colores, nombre de la app que ve el cliente)
 *   - Features activas (qué módulos están habilitados para este cliente)
 *
 * REGLA DE ORO PARA EL FUTURO:
 *   Cuando vendas PosPunto a un cliente nuevo, este es el ÚNICO archivo
 *   que se modifica. El resto del código se reutiliza tal cual.
 *
 * En la Fase 7 vamos a hacer que este archivo lea desde un cliente.json
 * externo, para que ni siquiera necesites tocar código por cliente.
 * Por ahora, los valores están directamente acá como defaults.
 */

/**
 * Configuración por defecto del sistema.
 * Cambiá estos valores para personalizar PosPunto para un negocio específico.
 */
export const config = {
  // ============================================================
  // DATOS DEL NEGOCIO
  // Se muestran en facturas, tickets de impresión y encabezado
  // ============================================================
  negocio: {
    nombre: 'PosPunto Demo',
    nit: '',
    direccion: '',
    telefono: '',
    ciudad: 'Armenia, Quindío',
    pais: 'Colombia',
  },

  // ============================================================
  // SUPABASE — Conexión a la base de datos en la nube
  // ============================================================
  // En producción (Vercel) estas variables vienen del entorno.
  // En desarrollo, si no las definís en .env, usa los valores por defecto.
  supabase: {
    url: import.meta.env?.VITE_SUPABASE_URL || 'https://fogjieqitwhxqkjsyvit.supabase.co',
    anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_jKPXXSRhbwosFPg52ou_-w_92rMCD9A',
    tenantId: import.meta.env?.VITE_TENANT_ID || 'default',
  },

  // ============================================================
  // BRANDING — Apariencia personalizada por cliente
  // ============================================================
  branding: {
    appName: 'PosPunto',
    primary: '#2563eb',     // Color principal (azul corporativo)
    primaryDark: '#1d4ed8', // Versión más oscura para hovers
    logoUrl: null,          // URL del logo del cliente (opcional)
  },

  // ============================================================
  // FEATURES — Qué módulos están activos para este cliente
  // true  = funcionalidad habilitada
  // false = funcionalidad oculta/desactivada
  // ============================================================
  features: {
    dashboard: true,
    ventas: true,
    facturas: true,
    productos: true,
    clientes: true,
    compras: true,
    gastos: true,
    reportes: true,
    cierreCaja: true,
    configuracion: true,
    impresionTermica: true,
    sincronizacionNube: true,        // ✅ Activado: Supabase conectado
    facturacionElectronica: false,   // Para más adelante
  },

  // ============================================================
  // LOCALE — Formato de números, moneda y fechas
  // Cambiar a 'es-MX', 'es-AR', etc. para otros países
  // ============================================================
  locale: 'es-CO',
  moneda: 'COP',
};

// ============================================================
//  HELPERS — Funciones útiles para consultar la configuración
// ============================================================

/**
 * Indica si Supabase está configurado y listo para usar.
 * Mientras `url` o `anonKey` estén vacíos, el sistema trabaja
 * solo en modo local (IndexedDB) sin sincronización en la nube.
 */
export function isSupabaseConfigured() {
  return !!(config.supabase.url && config.supabase.anonKey);
}

/**
 * Indica si una feature está activa para este cliente.
 *
 * @param {string} featureName - Nombre de la feature (ej: 'cierreCaja')
 * @returns {boolean}
 *
 * @example
 *   if (isFeatureEnabled('cierreCaja')) { ... }
 */
export function isFeatureEnabled(featureName) {
  return config.features[featureName] === true;
}

/**
 * Devuelve los datos del negocio (nombre, NIT, dirección).
 * Usado por las facturas, tickets de impresión y encabezado.
 */
export function getNegocioInfo() {
  return { ...config.negocio };
}

/**
 * Devuelve la configuración de branding (colores, nombre app).
 */
export function getBranding() {
  return { ...config.branding };
}