/**
 * modules/config/import-export.js — Lógica de import/export Excel
 *
 * Define las columnas para productos y clientes + funciones que
 * exportan, descargan plantilla e importan archivos Excel/CSV.
 *
 * Al importar, usa Sync.guardar() para que cada fila se suba a Supabase
 * y se propague vía Realtime a las demás terminales.
 */

import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import { exportarExcel, descargarPlantilla, leerArchivo, mapearFilas, coerce, detectarFormatoNumerico, normalizarClave } from '../../core/excel.js';
import { uid } from '../../core/strings.js';

// ============================================================
//  COLUMNAS — PRODUCTOS
// ============================================================

const COLS_PRODUCTOS = [
  { clave: 'nombre',       etiqueta: 'Nombre',          ejemplo: 'Concentrado Perro 15kg' },
  { clave: 'codigo',       etiqueta: 'Código',          ejemplo: 'P001' },
  { clave: 'barras',       etiqueta: 'Código de barras', ejemplo: '7702002000001' },
  { clave: 'categoria',    etiqueta: 'Categoría',       ejemplo: 'Alimentos' },
  { clave: 'precio',       etiqueta: 'Precio venta',    ejemplo: 85000 },
  { clave: 'costo',        etiqueta: 'Costo',           ejemplo: 60000 },
  { clave: 'stock',        etiqueta: 'Stock actual',    ejemplo: 10 },
  { clave: 'stock_min',    etiqueta: 'Stock mínimo',    ejemplo: 3 },
  { clave: 'unidad',       etiqueta: 'Unidad',          ejemplo: 'unidad' },
  { clave: 'proveedor',    etiqueta: 'Proveedor',       ejemplo: 'Distribuidora ABC' },
  { clave: 'impuesto_pct', etiqueta: 'Impuesto %',      ejemplo: 0 },
];

// Aliases para mapeo flexible al importar (acepta variantes en español)
const ALIASES_PRODUCTOS = {
  nombre:       ['nombre', 'producto', 'descripcion'],
  codigo:       ['codigo', 'sku', 'ref', 'referencia'],
  barras:       ['barras', 'codigodebarras', 'codigobarras', 'ean'],
  categoria:    ['categoria', 'cat', 'grupo'],
  precio:       ['precio', 'precioventa', 'pvp', 'venta'],
  costo:        ['costo', 'preciocosto', 'compra'],
  stock:        ['stock', 'existencia', 'cantidad', 'stockactual'],
  stock_min:    ['stockmin', 'minimo', 'stockminimo'],
  unidad:       ['unidad', 'um'],
  proveedor:    ['proveedor', 'distribuidor'],
  impuesto_pct: ['impuesto', 'impuestopct', 'iva', 'ivapct'],
};

// ============================================================
//  COLUMNAS — CLIENTES
// ============================================================

const COLS_CLIENTES = [
  { clave: 'nombre',    etiqueta: 'Nombre',     ejemplo: 'Juan Pérez' },
  { clave: 'negocio',   etiqueta: 'Negocio',    ejemplo: 'Tienda La Esquina' },
  { clave: 'telefono',  etiqueta: 'Teléfono',   ejemplo: '3001234567' },
  { clave: 'direccion', etiqueta: 'Dirección',  ejemplo: 'Cra 14 # 22-30' },
  { clave: 'ciudad',    etiqueta: 'Ciudad',     ejemplo: 'Armenia' },
  { clave: 'email',     etiqueta: 'Email',      ejemplo: 'juan@correo.com' },
  { clave: 'documento', etiqueta: 'Documento',  ejemplo: '1094948361' },
  { clave: 'obs',       etiqueta: 'Observaciones', ejemplo: 'Cliente frecuente' },
];

const ALIASES_CLIENTES = {
  nombre:    ['nombre', 'cliente', 'nombrecompleto'],
  negocio:   ['negocio', 'empresa', 'razonsocial'],
  telefono:  ['telefono', 'tel', 'celular', 'movil'],
  direccion: ['direccion', 'dir'],
  ciudad:    ['ciudad', 'municipio'],
  email:     ['email', 'correo', 'mail'],
  documento: ['documento', 'cedula', 'cc', 'nit', 'identificacion'],
  obs:       ['obs', 'observaciones', 'notas', 'nota', 'comentarios'],
};

// ============================================================
//  EXPORTAR
// ============================================================

export async function exportarProductos() {
  const productos = await ProductosRepo.listar();
  exportarExcel(productos, COLS_PRODUCTOS, `productos-${hoy()}`, 'Productos');
  return productos.length;
}

export async function exportarClientes() {
  const clientes = await ClientesRepo.listar();
  exportarExcel(clientes, COLS_CLIENTES, `clientes-${hoy()}`, 'Clientes');
  return clientes.length;
}

// ============================================================
//  PLANTILLAS (archivos vacíos para llenar)
// ============================================================

export function plantillaProductos() {
  descargarPlantilla(COLS_PRODUCTOS, 'plantilla-productos', 'Productos');
}

export function plantillaClientes() {
  descargarPlantilla(COLS_CLIENTES, 'plantilla-clientes', 'Clientes');
}

// ============================================================
//  IMPORTAR — flujo en dos pasos
//  1) leerArchivoRaw(file) → devuelve filas crudas + lista de columnas
//  2) procesarFilas(...)   → aplica el mapeo elegido y devuelve filas listas
// ============================================================

/**
 * Lee el archivo y devuelve sus filas crudas + lista de columnas detectadas
 * + un mapeo sugerido inicial.
 *
 * @param {File} file
 * @param {'productos'|'clientes'} tipo
 * @returns {Promise<{
 *   filasRaw: Array<Object>,
 *   columnas: Array<string>,
 *   mapeoSugerido: Object,
 *   formatoDetectado: 'es-CO'|'en-US'|'auto'
 * }>}
 */
export async function analizarArchivo(file, tipo) {
  const filasRaw = await leerArchivo(file);
  if (filasRaw.length === 0) {
    return { filasRaw: [], columnas: [], mapeoSugerido: {}, formatoDetectado: 'auto' };
  }

  // Detectar columnas únicas (juntar todas las claves de las primeras 50 filas)
  const colsSet = new Set();
  for (const f of filasRaw.slice(0, 50)) {
    for (const k of Object.keys(f)) colsSet.add(k);
  }
  const columnas = Array.from(colsSet);

  // Mapeo sugerido por aliases
  const aliases = tipo === 'productos' ? ALIASES_PRODUCTOS : ALIASES_CLIENTES;
  const mapeoSugerido = {};
  for (const campo of Object.keys(aliases)) {
    const aliasesNorm = aliases[campo].map(normalizarClave);
    const match = columnas.find((c) => aliasesNorm.includes(normalizarClave(c)));
    if (match) mapeoSugerido[campo] = match;
  }

  // Detectar formato numérico (solo para productos, donde hay precios/costos)
  let formatoDetectado = 'auto';
  if (tipo === 'productos') {
    const camposNum = ['precio', 'costo'];
    const muestra = [];
    for (const campo of camposNum) {
      const col = mapeoSugerido[campo];
      if (!col) continue;
      for (const f of filasRaw.slice(0, 30)) {
        const v = f[col];
        if (v != null && v !== '') muestra.push(String(v));
      }
    }
    if (muestra.length > 0) formatoDetectado = detectarFormatoNumerico(muestra);
  }

  return { filasRaw, columnas, mapeoSugerido, formatoDetectado };
}

/**
 * Aplica el mapeo elegido por el usuario y devuelve las filas listas
 * para importar (con tipos coercionados según el formato elegido).
 *
 * @param {Array<Object>} filasRaw
 * @param {Object} mapeo - { campoModelo: 'columnaExcel' }
 * @param {'productos'|'clientes'} tipo
 * @param {'es-CO'|'en-US'|'auto'} formato
 * @returns {{ filas: Array, ignoradas: number, errores: Array }}
 */
export function procesarFilas(filasRaw, mapeo, tipo, formato = 'auto') {
  const tipos = tipo === 'productos'
    ? { precio: 'number', costo: 'number', stock: 'number', stock_min: 'number', impuesto_pct: 'number' }
    : {};

  const limpias = [];
  const errores = [];
  let ignoradas = 0;

  filasRaw.forEach((raw, idx) => {
    // Aplicar el mapeo elegido por el usuario
    const fila = {};
    for (const [campo, col] of Object.entries(mapeo)) {
      if (!col) continue;
      fila[campo] = raw[col];
    }

    // Validar mínimo: nombre obligatorio
    if (!fila.nombre || String(fila.nombre).trim() === '') {
      ignoradas++;
      return;
    }

    // Coercionar tipos
    for (const [k, t] of Object.entries(tipos)) {
      fila[k] = coerce(fila[k], t, formato);
    }
    // Strings: trim
    for (const k of Object.keys(fila)) {
      if (typeof fila[k] === 'string') fila[k] = fila[k].trim();
    }

    // Validaciones por campo (solo producir advertencias, no bloquear)
    if (tipo === 'productos') {
      if (fila.precio < 0) errores.push({ fila: idx + 2, msg: `Precio negativo en "${fila.nombre}"` });
      if (fila.costo < 0) errores.push({ fila: idx + 2, msg: `Costo negativo en "${fila.nombre}"` });
    }

    limpias.push(fila);
  });

  return { filas: limpias, ignoradas, errores };
}

/**
 * Importa las filas: para cada una, busca un producto existente por
 * código (si no hay, por nombre exacto). Si existe → actualiza.
 * Si no existe → crea nuevo. Usa Sync.guardar para subir a la nube.
 *
 * @param {Array} filas - resultado de previewImportProductos
 * @returns {Promise<{ creados: number, actualizados: number, errores: number }>}
 */
export async function importarProductos(filas, onProgress) {
  const existentes = await ProductosRepo.listar();
  let creados = 0, actualizados = 0, errores = 0;
  let procesados = 0;

  for (const f of filas) {
    try {
      // Buscar match por código o por nombre
      const match = existentes.find((p) => {
        if (f.codigo && p.codigo && String(p.codigo).toLowerCase() === String(f.codigo).toLowerCase()) return true;
        return String(p.nombre || '').toLowerCase() === String(f.nombre || '').toLowerCase();
      });

      const datos = {
        id: match?.id || uid(),
        nombre: f.nombre,
        codigo: f.codigo || match?.codigo || '',
        barras: f.barras || match?.barras || '',
        categoria: f.categoria || match?.categoria || '',
        precio: f.precio,
        costo: f.costo,
        stock: f.stock,
        stock_min: f.stock_min,
        unidad: f.unidad || match?.unidad || '',
        proveedor: f.proveedor || match?.proveedor || '',
        impuesto_pct: f.impuesto_pct,
      };

      await ProductosRepo.guardar(datos);
      if (match) actualizados++;
      else creados++;
    } catch (err) {
      console.warn('Error importando producto:', f, err);
      errores++;
    }
    procesados++;
    if (onProgress) onProgress(procesados, filas.length);
  }

  return { creados, actualizados, errores };
}

export async function importarClientes(filas, onProgress) {
  const existentes = await ClientesRepo.listar();
  let creados = 0, actualizados = 0, errores = 0;
  let procesados = 0;

  for (const f of filas) {
    try {
      const match = existentes.find((c) => {
        if (f.documento && c.documento && String(c.documento) === String(f.documento)) return true;
        return String(c.nombre || '').toLowerCase() === String(f.nombre || '').toLowerCase();
      });

      const datos = {
        id: match?.id || uid(),
        nombre: f.nombre,
        negocio: f.negocio || match?.negocio || '',
        telefono: f.telefono || match?.telefono || '',
        direccion: f.direccion || match?.direccion || '',
        ciudad: f.ciudad || match?.ciudad || '',
        email: f.email || match?.email || '',
        documento: f.documento || match?.documento || '',
        obs: f.obs || match?.obs || '',
        preciosEspeciales: match?.preciosEspeciales || {},
      };

      await ClientesRepo.guardar(datos);
      if (match) actualizados++;
      else creados++;
    } catch (err) {
      console.warn('Error importando cliente:', f, err);
      errores++;
    }
    procesados++;
    if (onProgress) onProgress(procesados, filas.length);
  }

  return { creados, actualizados, errores };
}

// ============================================================
//  HELPERS
// ============================================================

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

// Para usar en la UI (los nombres de columnas para mostrar en la vista previa)
export const COLUMNAS_PRODUCTOS = COLS_PRODUCTOS;
export const COLUMNAS_CLIENTES = COLS_CLIENTES;
