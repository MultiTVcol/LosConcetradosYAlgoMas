/**
 * core/excel.js — Helpers para exportar/importar Excel (.xlsx, .csv)
 *
 * Usa SheetJS (xlsx) cargado vía CDN en index.html.
 * Las funciones de export aceptan un array de objetos y los descargan
 * como archivo. Import lee el archivo del input y devuelve filas como
 * objetos con keys normalizados.
 */

import { num } from './format.js';

/** @returns {boolean} true si SheetJS está disponible */
function xlsxDisponible() {
  return typeof window !== 'undefined' && !!window.XLSX;
}

/**
 * Normaliza una clave de columna: minúsculas, sin acentos, sin espacios,
 * mantiene solo letras y números. Sirve para hacer el mapeo flexible
 * entre las columnas del Excel ("Nombre del producto") y las propiedades
 * del modelo ("nombre").
 */
export function normalizarClave(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Exporta un array de objetos a archivo .xlsx.
 * Si SheetJS no está disponible, hace fallback a CSV.
 *
 * @param {Array} datos - array de objetos
 * @param {Array} columnas - [{ clave, etiqueta, formato? }]
 * @param {string} nombreArchivo - sin extensión
 * @param {string} hoja - nombre de la hoja
 */
export function exportarExcel(datos, columnas, nombreArchivo, hoja = 'Datos') {
  // Construir filas con las etiquetas humanas
  const filas = datos.map((d) => {
    const fila = {};
    for (const col of columnas) {
      const valor = d[col.clave];
      fila[col.etiqueta] = col.formato ? col.formato(valor) : (valor ?? '');
    }
    return fila;
  });

  if (xlsxDisponible()) {
    const ws = window.XLSX.utils.json_to_sheet(filas, {
      header: columnas.map((c) => c.etiqueta),
    });
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, hoja);
    window.XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
  } else {
    // Fallback CSV
    const csv = generarCSV(filas, columnas.map((c) => c.etiqueta));
    descargarTexto(`${nombreArchivo}.csv`, csv);
  }
}

/**
 * Descarga una plantilla vacía con encabezados + 1 fila de ejemplo opcional.
 *
 * @param {Array} columnas - [{ clave, etiqueta, ejemplo? }]
 * @param {string} nombreArchivo
 * @param {string} hoja
 */
export function descargarPlantilla(columnas, nombreArchivo, hoja = 'Plantilla') {
  // 1 fila con valores de ejemplo (para que el usuario vea el formato)
  const ejemplo = {};
  for (const col of columnas) {
    ejemplo[col.etiqueta] = col.ejemplo != null ? col.ejemplo : '';
  }
  exportarExcel([ejemplo], columnas, nombreArchivo, hoja);
}

/**
 * Lee un File (input.files[0]) y devuelve las filas como objetos.
 * Soporta .xlsx, .xls, .csv.
 *
 * @param {File} file
 * @returns {Promise<Array<Object>>} - filas con keys normalizadas
 */
export function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No se recibió archivo'));

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = (e) => {
      try {
        const datos = e.target.result;

        if (xlsxDisponible()) {
          // Detectar si es CSV/TXT (binary string) o binario (xlsx)
          const ext = file.name.toLowerCase();
          const esCSV = ext.endsWith('.csv') || ext.endsWith('.txt');
          const wb = esCSV
            ? window.XLSX.read(datos, { type: 'string' })
            : window.XLSX.read(datos, { type: 'array' });
          const primeraHoja = wb.SheetNames[0];
          const ws = wb.Sheets[primeraHoja];
          const filas = window.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
          resolve(filas);
        } else {
          // Fallback: solo CSV manual
          if (file.name.toLowerCase().endsWith('.csv')) {
            resolve(parsearCSV(datos));
          } else {
            reject(new Error('SheetJS no disponible — solo se puede importar CSV'));
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    // Leer como ArrayBuffer si es xlsx, como texto si es CSV
    const ext = file.name.toLowerCase();
    if (ext.endsWith('.csv') || ext.endsWith('.txt')) {
      reader.readAsText(file, 'utf-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
}

/**
 * Mapea las filas leídas a los campos del modelo según el `mapeo`.
 *
 * @param {Array<Object>} filas - resultado de leerArchivo()
 * @param {Object} mapeo - { campoModelo: [alias1, alias2, ...] }
 * @returns {Array<Object>}
 */
export function mapearFilas(filas, mapeo) {
  // Pre-normalizar los aliases
  const aliasesNorm = {};
  for (const campo of Object.keys(mapeo)) {
    aliasesNorm[campo] = mapeo[campo].map(normalizarClave);
  }

  return filas.map((fila) => {
    // Normalizar las claves de la fila
    const filaNorm = {};
    for (const k of Object.keys(fila)) {
      filaNorm[normalizarClave(k)] = fila[k];
    }

    // Construir el objeto del modelo
    const out = {};
    for (const campo of Object.keys(mapeo)) {
      const aliases = aliasesNorm[campo];
      for (const alias of aliases) {
        if (filaNorm[alias] !== undefined && filaNorm[alias] !== '') {
          out[campo] = filaNorm[alias];
          break;
        }
      }
    }
    return out;
  });
}

// ============================================================
//  CSV (fallback sin SheetJS)
// ============================================================

function generarCSV(filas, columnas) {
  const escape = (v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? `"${s}"` : s;
  };
  const header = columnas.map(escape).join(',');
  const cuerpo = filas.map((f) => columnas.map((c) => escape(f[c])).join(',')).join('\n');
  return '﻿' + header + '\n' + cuerpo;
}

function parsearCSV(texto) {
  const lineas = String(texto).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length === 0) return [];
  const headers = lineas[0].split(',').map((h) => h.replace(/^﻿/, '').trim());
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const valores = lineas[i].split(',');
    const fila = {};
    for (let j = 0; j < headers.length; j++) {
      fila[headers[j]] = (valores[j] || '').replace(/^"(.*)"$/, '$1');
    }
    filas.push(fila);
  }
  return filas;
}

function descargarTexto(filename, contenido) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Coerciona valores: si la columna espera number, parsea con num().
 */
export function coerce(valor, tipo) {
  if (tipo === 'number') return num(valor);
  if (tipo === 'boolean') {
    const v = String(valor || '').toLowerCase().trim();
    return v === 'true' || v === 'si' || v === 'sí' || v === '1' || v === 'x';
  }
  return String(valor == null ? '' : valor).trim();
}
