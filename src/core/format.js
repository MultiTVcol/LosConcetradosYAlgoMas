/**
 * core/format.js — Helpers de formato numérico y monetario (es-CO)
 *
 * Estas funciones manejan el formato colombiano por defecto:
 *   - Punto como separador de miles:    1.500.000
 *   - Coma como separador decimal:      1.500,50
 *   - Símbolo de peso:                  $1.500.000
 *
 * Todas son funciones PURAS: entrada → salida, sin efectos colaterales.
 *
 * Uso típico:
 *   import { num, money, fmt, pct } from '../core/format.js';
 *
 *   const total = num($('#input').value);     // parseado tolerante
 *   $('#total').textContent = money(total);   // "$1.500.000"
 */

/**
 * Parsea un valor a número entendiendo el formato colombiano.
 *
 * Es TOLERANTE: acepta strings con símbolo de peso, espacios, separadores
 * de miles, comas decimales, etc. Si algo no se puede parsear, devuelve 0
 * (no devuelve NaN, para que las operaciones aritméticas no exploten).
 *
 * Reglas que aplica:
 *   - Quita símbolos: $, espacios, COP, letras
 *   - Si encuentra coma como decimal (formato es-CO), la convierte a punto
 *   - Si solo hay puntos, los trata como separadores de miles
 *
 * @param {string | number} v - El valor a convertir
 * @returns {number} - Número válido, o 0 si no se pudo parsear
 *
 * @example
 *   num("1500")          → 1500
 *   num("$1.500")        → 1500
 *   num("1.500,50")      → 1500.5
 *   num("$ 12.345,67")   → 12345.67
 *   num("hola")          → 0
 *   num(null)            → 0
 *   num(2500)            → 2500   (si ya es número, lo devuelve tal cual)
 */
export function num(v) {
  // Si ya es número válido, devolverlo directamente
  if (typeof v === 'number' && !isNaN(v)) return v;

  // Si es null, undefined o vacío → 0
  if (v == null || v === '') return 0;

  // Convertir a string y limpiar
  let s = String(v).trim();

  // Quitar símbolos comunes: $, COP, espacios, letras al final
  s = s.replace(/[$\s]/g, '').replace(/cop/gi, '');

  // Si está vacío después de limpiar → 0
  if (!s) return 0;

  // Detectar formato:
  // - Si tiene coma: es formato es-CO con coma decimal → quitamos puntos (miles), cambiamos coma a punto
  // - Si solo tiene puntos: tratamos los puntos como separadores de miles → quitamos todos
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Solo puntos: si hay más de un punto, son separadores de miles
    // Si hay solo uno y tiene 1-2 dígitos después, podría ser decimal real
    const parts = s.split('.');
    if (parts.length > 2) {
      // Múltiples puntos → todos son separadores de miles
      s = s.replace(/\./g, '');
    } else if (parts.length === 2 && parts[1].length === 3) {
      // Un solo punto + 3 dígitos después → es separador de miles (ej: "1.500")
      s = s.replace('.', '');
    }
    // Caso restante: "12.50" se interpreta como decimal real
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Formatea un número con separador de miles (punto en es-CO).
 *
 * Para enteros usa formato "1.500.000" sin decimales.
 * Para decimales usa hasta 2 decimales: "1.500,50".
 *
 * @param {number} n - El número a formatear
 * @returns {string}
 *
 * @example
 *   fmt(1500)      → "1.500"
 *   fmt(1500.5)    → "1.500,5"
 *   fmt(0)         → "0"
 *   fmt(null)      → "0"
 */
export function fmt(n) {
  const v = num(n);

  // Si es entero exacto, no mostrar decimales
  if (Number.isInteger(v)) {
    return v.toLocaleString('es-CO');
  }

  // Si tiene decimales, mostrar hasta 2
  return v.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Formatea un número como moneda colombiana (pesos COP).
 *
 * Por defecto NO muestra decimales (porque los pesos colombianos no
 * suelen tener centavos en la práctica diaria).
 *
 * @param {number} n - El número a formatear
 * @param {boolean} [conDecimales=false] - Si true, muestra centavos
 * @returns {string}
 *
 * @example
 *   money(1500)             → "$1.500"
 *   money(1500.5, true)     → "$1.500,50"
 *   money(0)                → "$0"
 *   money(-2500)            → "-$2.500"
 */
export function money(n, conDecimales = false) {
  const v = num(n);
  const negativo = v < 0;
  const abs = Math.abs(v);

  const formateado = abs.toLocaleString('es-CO', {
    minimumFractionDigits: conDecimales ? 2 : 0,
    maximumFractionDigits: conDecimales ? 2 : 0,
  });

  return `${negativo ? '-' : ''}$${formateado}`;
}

/**
 * Formatea un número como porcentaje.
 *
 * Espera un número entre 0 y 1 (proporción): 0.15 → "15%".
 * Si querés pasar el porcentaje ya calculado, multiplicalo antes.
 *
 * @param {number} n - Proporción (0-1) o porcentaje según `yaEsPorcentaje`
 * @param {number} [decimales=0] - Cantidad de decimales a mostrar
 * @param {boolean} [yaEsPorcentaje=false] - Si true, n ya es el porcentaje (no se multiplica)
 * @returns {string}
 *
 * @example
 *   pct(0.15)         → "15%"
 *   pct(0.1567, 1)    → "15,7%"
 *   pct(15, 0, true)  → "15%"   (no multiplica)
 */
export function pct(n, decimales = 0, yaEsPorcentaje = false) {
  const v = num(n);
  const valor = yaEsPorcentaje ? v : v * 100;

  return `${valor.toLocaleString('es-CO', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}%`;
}

/**
 * Redondea a N decimales evitando errores de punto flotante.
 *
 * JavaScript tiene problemas conocidos con decimales:
 *   0.1 + 0.2 === 0.30000000000000004  (no es 0.3)
 *
 * Esta función soluciona eso para usos de POS (precios, totales, IVA).
 *
 * @param {number} n - El número a redondear
 * @param {number} [decimales=2] - Cantidad de decimales
 * @returns {number}
 *
 * @example
 *   round(0.1 + 0.2)        → 0.3
 *   round(1.005, 2)         → 1.01
 *   round(1234.567, 0)      → 1235
 */
export function round(n, decimales = 2) {
  const factor = Math.pow(10, decimales);
  return Math.round((num(n) + Number.EPSILON) * factor) / factor;
}