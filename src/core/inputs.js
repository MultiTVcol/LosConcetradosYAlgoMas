/**
 * core/inputs.js — Helpers para inputs numéricos con formato es-CO
 *
 * Aplica formato de separador de miles "1.500.000" mientras el usuario
 * escribe, preservando la posición del cursor. El valor crudo se obtiene
 * con `num(input.value)` (tolerante a puntos/comas).
 *
 * Uso:
 *   import { bindMilesInput, bindMilesInputs } from '../core/inputs.js';
 *
 *   bindMilesInput(document.querySelector('#precio'));
 *   bindMilesInputs(document);  // todos los [data-miles] del contenedor
 */

/**
 * Cuenta dígitos antes del cursor para luego restaurarlo a la posición
 * equivalente en el texto re-formateado.
 */
function digitosAntesDelCursor(texto, cursorPos) {
  let n = 0;
  for (let i = 0; i < cursorPos && i < texto.length; i++) {
    if (/\d/.test(texto[i])) n++;
  }
  return n;
}

/**
 * Calcula la posición del cursor en el texto formateado después de
 * `n` dígitos. Útil para preservar UX al re-formatear.
 */
function posicionTrasDigitos(texto, n) {
  if (n <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) {
    if (/\d/.test(texto[i])) {
      vistos++;
      if (vistos >= n) return i + 1;
    }
  }
  return texto.length;
}

/**
 * Activa formato de miles en un input. En cada tecla:
 *   1. Extrae solo los dígitos del valor (descarta puntos/comas/letras)
 *   2. Parsea como entero
 *   3. Re-formatea con separador de miles "1.500.000"
 *   4. Restaura el cursor preservando dígitos a la izquierda
 *
 * @param {HTMLInputElement} inp
 */
export function bindMilesInput(inp) {
  if (!inp || inp.dataset._milesBound === '1') return;
  inp.dataset._milesBound = '1';

  // Asegurar tipo text + inputmode numérico
  if (inp.type !== 'text') inp.type = 'text';
  if (!inp.inputMode) inp.inputMode = 'numeric';

  const reformatear = () => {
    const valorCrudo = inp.value || '';
    const cursor = inp.selectionStart ?? valorCrudo.length;

    // Dígitos antes del cursor (para restaurar posición después)
    const digitosAntes = digitosAntesDelCursor(valorCrudo, cursor);

    // Extraer solo dígitos
    const soloDigitos = valorCrudo.replace(/\D/g, '');

    if (soloDigitos === '') {
      inp.value = '';
      return;
    }

    // Parsear como entero (descarta ceros a la izquierda como "09" → 9)
    const n = parseInt(soloDigitos, 10);
    if (isNaN(n)) {
      inp.value = '';
      return;
    }

    const formateado = n.toLocaleString('es-CO');
    inp.value = formateado;

    // Restaurar cursor en la posición equivalente
    const nuevaPos = posicionTrasDigitos(formateado, digitosAntes);
    try { inp.setSelectionRange(nuevaPos, nuevaPos); } catch (e) { /**/ }
  };

  inp.addEventListener('input', reformatear);

  // Al hacer focus, seleccionar todo el contenido — mucho más cómodo en POS
  // (el cajero escribe el monto y reemplaza el valor anterior de una vez).
  inp.addEventListener('focus', () => {
    setTimeout(() => {
      try { inp.select(); } catch (e) { /**/ }
    }, 0);
  });

  // Formato inicial si ya viene con valor
  if (inp.value) {
    const soloDigitos = String(inp.value).replace(/\D/g, '');
    if (soloDigitos) {
      const n = parseInt(soloDigitos, 10);
      inp.value = isNaN(n) ? '' : n.toLocaleString('es-CO');
    } else {
      inp.value = '';
    }
  }
}

/**
 * Aplica `bindMilesInput` a todos los inputs marcados con `data-miles`
 * dentro de un contenedor.
 *
 * @param {ParentNode} contenedor
 */
export function bindMilesInputs(contenedor) {
  if (!contenedor || !contenedor.querySelectorAll) return;
  contenedor.querySelectorAll('input[data-miles]').forEach(bindMilesInput);
}
