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
 * Parser numérico FLEXIBLE — entiende cualquier formato de Excel.
 *
 * Acepta:
 *   - Números nativos: 1500.5  ✓
 *   - Formato es-CO (Colombia/España): "1.500" → 1500 · "1.500,50" → 1500.5 · "1.500.000" → 1500000
 *   - Formato en-US (USA/UK):           "1,500" → 1500 · "1,500.50" → 1500.5 · "1,500,000" → 1500000
 *   - Mezcla: "$1.500,50" → 1500.5 · "-2.500,75" → -2500.75
 *   - Vacíos: "" / null / undefined → 0
 *
 * @param {string|number} valor
 * @param {'auto'|'es-CO'|'en-US'} formato - formato preferido (default 'auto')
 */
export function parseNumeroFlex(valor, formato = 'auto') {
  if (typeof valor === 'number' && !isNaN(valor)) return valor;
  if (valor == null) return 0;

  let s = String(valor).trim();
  if (!s) return 0;

  // Limpiar símbolos comunes ($, COP, USD, espacios)
  s = s.replace(/[\s$]/g, '').replace(/(cop|usd|eur|mxn|ars)/gi, '');
  if (!s) return 0;

  // Capturar y limpiar signo
  let signo = 1;
  if (s.startsWith('-') || s.startsWith('−')) { signo = -1; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }

  // Solo dígitos, puntos y comas
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;

  const hayPunto = s.includes('.');
  const hayComa  = s.includes(',');

  if (hayPunto && hayComa) {
    // Ambos: el más a la DERECHA es el decimal
    const ultPunto = s.lastIndexOf('.');
    const ultComa  = s.lastIndexOf(',');
    if (ultPunto > ultComa) {
      // "1,500.50" → en-US: punto decimal, coma miles
      s = s.replace(/,/g, '');
    } else {
      // "1.500,50" → es-CO: coma decimal, punto miles
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (hayPunto) {
    // Solo punto: ambiguo. Resolver según contexto.
    const partes = s.split('.');
    if (formato === 'en-US') {
      // En en-US el punto SIEMPRE es decimal (aunque puede haber varios → tratar el último)
      if (partes.length > 2) s = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
    } else if (formato === 'es-CO') {
      // En es-CO el punto SIEMPRE es separador de miles
      s = s.replace(/\./g, '');
    } else {
      // Auto: heurística
      if (partes.length > 2) {
        // "1.500.000" → claramente miles
        s = s.replace(/\./g, '');
      } else if (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3) {
        // "1.500" → ambiguo; en POS Colombia favorecer miles
        s = s.replace('.', '');
      }
      // Resto ("12.50", "1500.5") → queda como decimal
    }
  } else if (hayComa) {
    // Solo coma: ambiguo
    const partes = s.split(',');
    if (formato === 'es-CO') {
      // En es-CO la coma SIEMPRE es decimal
      if (partes.length > 2) s = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
      else s = s.replace(',', '.');
    } else if (formato === 'en-US') {
      // En en-US la coma SIEMPRE es miles
      s = s.replace(/,/g, '');
    } else {
      // Auto
      if (partes.length > 2) {
        // "1,500,000" → miles
        s = s.replace(/,/g, '');
      } else if (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3) {
        // "1,500" → ambiguo; favorecer miles
        s = s.replace(',', '');
      } else {
        // "12,50" → decimal es-CO
        s = s.replace(',', '.');
      }
    }
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : signo * n;
}

/**
 * Mira una muestra de strings y detecta el formato numérico predominante.
 * Devuelve 'es-CO' o 'en-US' o 'auto' (si no hay evidencia clara).
 *
 * @param {Array<string>} muestra
 * @returns {'es-CO'|'en-US'|'auto'}
 */
export function detectarFormatoNumerico(muestra) {
  let esCO = 0, enUS = 0;
  for (const raw of muestra) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const hayPunto = s.includes('.');
    const hayComa  = s.includes(',');

    if (hayPunto && hayComa) {
      const ultPunto = s.lastIndexOf('.');
      const ultComa  = s.lastIndexOf(',');
      if (ultPunto > ultComa) enUS++; else esCO++;
    } else if (hayPunto) {
      const partes = s.split('.');
      if (partes.length > 2) esCO++;            // múltiples puntos = miles es-CO
      else if (partes[1] && partes[1].length === 3) esCO++; // "1.500"
      else enUS++;                              // "12.50" decimal en-US
    } else if (hayComa) {
      const partes = s.split(',');
      if (partes.length > 2) enUS++;            // múltiples comas = miles en-US
      else if (partes[1] && partes[1].length === 3) enUS++; // "1,500"
      else esCO++;                              // "12,50" decimal es-CO
    }
  }
  // Necesitamos al menos 3 muestras de diferencia para estar seguros
  if (esCO > enUS + 2) return 'es-CO';
  if (enUS > esCO + 2) return 'en-US';
  return 'auto';
}

/**
 * Coerciona valores: si la columna espera number, usa el parser flexible.
 */
export function coerce(valor, tipo, formato = 'auto') {
  if (tipo === 'number') return parseNumeroFlex(valor, formato);
  if (tipo === 'boolean') {
    const v = String(valor || '').toLowerCase().trim();
    return v === 'true' || v === 'si' || v === 'sí' || v === '1' || v === 'x';
  }
  return String(valor == null ? '' : valor).trim();
}
