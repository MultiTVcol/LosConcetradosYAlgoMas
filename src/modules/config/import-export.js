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
import { exportarExcel, descargarPlantilla, leerArchivo, mapearFilas, coerce } from '../../core/excel.js';
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
//  IMPORTAR
// ============================================================

/**
 * Lee el archivo y devuelve la vista previa de las filas mapeadas
 * (no guarda nada todavía).
 *
 * @returns {Promise<{ filas: Array, ignoradas: number }>}
 */
export async function previewImportProductos(file) {
  const filasRaw = await leerArchivo(file);
  const filas = mapearFilas(filasRaw, ALIASES_PRODUCTOS);
  // Coercionar tipos
  const tipos = { precio: 'number', costo: 'number', stock: 'number', stock_min: 'number', impuesto_pct: 'number' };
  const limpias = [];
  let ignoradas = 0;
  for (const f of filas) {
    if (!f.nombre || String(f.nombre).trim() === '') { ignoradas++; continue; }
    const limpia = { ...f };
    for (const [k, tipo] of Object.entries(tipos)) {
      limpia[k] = coerce(limpia[k], tipo);
    }
    limpia.nombre = String(limpia.nombre).trim();
    limpia.codigo = String(limpia.codigo || '').trim();
    limpias.push(limpia);
  }
  return { filas: limpias, ignoradas };
}

export async function previewImportClientes(file) {
  const filasRaw = await leerArchivo(file);
  const filas = mapearFilas(filasRaw, ALIASES_CLIENTES);
  const limpias = [];
  let ignoradas = 0;
  for (const f of filas) {
    if (!f.nombre || String(f.nombre).trim() === '') { ignoradas++; continue; }
    const limpia = { ...f };
    for (const k of Object.keys(limpia)) {
      limpia[k] = String(limpia[k] || '').trim();
    }
    limpias.push(limpia);
  }
  return { filas: limpias, ignoradas };
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
