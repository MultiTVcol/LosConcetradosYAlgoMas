/**
 * components/autocomplete.js — Buscador con sugerencias en tiempo real
 *
 * Convierte cualquier <input> en un buscador inteligente:
 *   - Filtra una lista de items mientras el usuario escribe
 *   - Búsqueda flexible (ignora mayúsculas/minúsculas y acentos)
 *   - Navegación con teclado: ↑ ↓ Enter Esc
 *   - Plantilla custom para cada item
 *   - Devuelve el item completo al seleccionarse
 *
 * Uso típico:
 *   import { Autocomplete } from '../components/index.js';
 *
 *   const productos = [
 *     { id: '1', nombre: 'Croquetas Premium', precio: 50000 },
 *     { id: '2', nombre: 'Vacuna múltiple', precio: 35000 },
 *   ];
 *
 *   const auto = Autocomplete.crear({
 *     input: document.getElementById('miInput'),
 *     items: productos,
 *     campoTexto: 'nombre',              // qué campo mostrar
 *     campos: ['nombre', 'codigo'],      // por qué campos buscar
 *     onSelect: (item) => {
 *       console.log('Elegido:', item);
 *     },
 *   });
 *
 *   // Cambiar la lista de items dinámicamente:
 *   auto.actualizarItems(nuevaLista);
 *
 *   // Destruir el autocomplete cuando ya no se necesita:
 *   auto.destruir();
 */

// ============================================================
//  HELPERS DE TEXTO
// ============================================================

/**
 * Normaliza texto para búsqueda: minúsculas, sin acentos, trim.
 * "Águila José" → "aguila jose"
 */
function normalizar(texto) {
  if (texto == null) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Devuelve true si `item` matchea con `query` en alguno de los campos dados.
 */
function itemMatch(item, query, campos) {
  if (!query) return true;
  const q = normalizar(query);
  for (const campo of campos) {
    const valor = item[campo];
    if (valor != null && normalizar(valor).includes(q)) {
      return true;
    }
  }
  return false;
}

/**
 * Resalta las coincidencias de `query` en `texto` con <mark>.
 * Para mostrar visualmente qué letras matchearon.
 */
function resaltar(texto, query) {
  if (!query || !texto) return texto || '';
  const q = normalizar(query);
  const t = String(texto);
  const tNorm = normalizar(t);
  const idx = tNorm.indexOf(q);
  if (idx < 0) return t;
  const antes = t.slice(0, idx);
  const match = t.slice(idx, idx + q.length);
  const despues = t.slice(idx + q.length);
  return `${antes}<mark style="background:#fef08a;color:#0f172a;padding:0 2px;border-radius:3px">${match}</mark>${despues}`;
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Crea un autocomplete asociado a un <input> existente.
 *
 * @param {Object} opciones
 * @param {HTMLInputElement} opciones.input - El input donde escribe el usuario
 * @param {Array} opciones.items - Lista de items para sugerir
 * @param {string} opciones.campoTexto - Campo a mostrar (ej: 'nombre')
 * @param {Array<string>} [opciones.campos] - Campos por los que buscar (default: [campoTexto])
 * @param {Function} opciones.onSelect - Callback al seleccionar: (item) => void
 * @param {Function} [opciones.plantilla] - HTML custom para cada item: (item, query) => string
 * @param {number} [opciones.maxResultados=8] - Máximo de sugerencias mostradas
 * @param {number} [opciones.minCaracteres=1] - Mínimo de caracteres para empezar a buscar
 * @param {string} [opciones.placeholder] - Texto cuando no hay resultados
 * @returns {{ actualizarItems, destruir, cerrar, abrir }} - Controlador
 */
export function crear(opciones) {
  const input = opciones.input;
  if (!input || !(input instanceof HTMLInputElement)) {
    throw new Error('Autocomplete.crear: se requiere un input válido');
  }

  let items = opciones.items || [];
  const campoTexto = opciones.campoTexto || 'nombre';
  const campos = opciones.campos || [campoTexto];
  const maxResultados = opciones.maxResultados || 8;
  const minCaracteres = opciones.minCaracteres ?? 1;
  const plantilla = opciones.plantilla;
  const placeholder = opciones.placeholder || 'Sin resultados';

  let resultadosVisibles = [];
  let indiceActivo = -1;
  let abierto = false;

  // ============================================================
  //  Crear el dropdown
  // ============================================================
  const dropdown = document.createElement('div');
  dropdown.style.cssText = `
    position: absolute;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 12px 24px -8px rgba(0,0,0,.15), 0 4px 8px -4px rgba(0,0,0,.08);
    max-height: 320px;
    overflow-y: auto;
    z-index: 10500;
    display: none;
    font-family: Inter, system-ui, sans-serif;
    font-size: 14px;
    min-width: 240px;
  `;
  document.body.appendChild(dropdown);

  // ============================================================
  //  Posicionar el dropdown debajo del input
  // ============================================================
  function posicionar() {
    const rect = input.getBoundingClientRect();
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  // ============================================================
  //  Buscar y renderizar resultados
  // ============================================================
  function buscar() {
    const query = input.value;

    if (query.length < minCaracteres) {
      cerrar();
      return;
    }

    // Filtrar items que matchean
    resultadosVisibles = items
      .filter((item) => itemMatch(item, query, campos))
      .slice(0, maxResultados);

    indiceActivo = -1;
    renderizar(query);

    if (resultadosVisibles.length === 0 && query.length >= minCaracteres) {
      dropdown.innerHTML = `
        <div style="padding:14px 16px;color:#94a3b8;text-align:center;font-size:13px">
          ${placeholder}
        </div>
      `;
      abrir();
    } else if (resultadosVisibles.length > 0) {
      abrir();
    } else {
      cerrar();
    }
  }

  function renderizar(query) {
    if (resultadosVisibles.length === 0) return;

    dropdown.innerHTML = resultadosVisibles.map((item, idx) => {
      const contenido = plantilla
        ? plantilla(item, query)
        : resaltar(item[campoTexto], query);

      return `
        <div
          data-idx="${idx}"
          class="ac-item"
          style="
            padding: 10px 14px;
            cursor: pointer;
            border-bottom: 1px solid #f1f5f9;
            transition: background .1s;
          "
        >${contenido}</div>
      `;
    }).join('');

    // Adjuntar eventos a cada item
    dropdown.querySelectorAll('.ac-item').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        indiceActivo = parseInt(el.dataset.idx, 10);
        actualizarActivo();
      });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Evita que el input pierda foco antes del click
        const idx = parseInt(el.dataset.idx, 10);
        seleccionar(idx);
      });
    });
  }

  function actualizarActivo() {
    dropdown.querySelectorAll('.ac-item').forEach((el, idx) => {
      if (idx === indiceActivo) {
        el.style.background = '#eff6ff';
      } else {
        el.style.background = 'white';
      }
    });
  }

  function seleccionar(idx) {
    const item = resultadosVisibles[idx];
    if (!item) return;
    input.value = item[campoTexto] || '';
    cerrar();
    if (typeof opciones.onSelect === 'function') {
      try {
        opciones.onSelect(item);
      } catch (e) {
        console.error('Autocomplete onSelect error:', e);
      }
    }
  }

  function abrir() {
    if (abierto) return;
    posicionar();
    dropdown.style.display = 'block';
    abierto = true;
  }

  function cerrar() {
    if (!abierto) return;
    dropdown.style.display = 'none';
    abierto = false;
    indiceActivo = -1;
  }

  // ============================================================
  //  Eventos del input
  // ============================================================
  function onInput() {
    buscar();
  }

  function onFocus() {
    if (input.value.length >= minCaracteres) {
      buscar();
    }
  }

  function onKeyDown(e) {
    if (!abierto || resultadosVisibles.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceActivo = Math.min(indiceActivo + 1, resultadosVisibles.length - 1);
      actualizarActivo();
      scrollAlActivo();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceActivo = Math.max(indiceActivo - 1, 0);
      actualizarActivo();
      scrollAlActivo();
    } else if (e.key === 'Enter') {
      if (indiceActivo >= 0) {
        e.preventDefault();
        seleccionar(indiceActivo);
      }
    } else if (e.key === 'Escape') {
      cerrar();
    }
  }

  function scrollAlActivo() {
    const items = dropdown.querySelectorAll('.ac-item');
    const activo = items[indiceActivo];
    if (activo) {
      activo.scrollIntoView({ block: 'nearest' });
    }
  }

  // Cerrar al hacer clic fuera
  function onClickFuera(e) {
    if (e.target !== input && !dropdown.contains(e.target)) {
      cerrar();
    }
  }

  // Reposicionar al hacer scroll/resize
  function onScroll() {
    if (abierto) posicionar();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onClickFuera);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  // ============================================================
  //  Controlador (lo que devuelve la función)
  // ============================================================
  return {
    /**
     * Reemplaza la lista de items disponibles.
     * Útil cuando los productos cambian (se agregan, se sincronizan, etc.)
     */
    actualizarItems(nuevosItems) {
      items = nuevosItems || [];
      if (abierto) buscar();
    },

    /**
     * Cierra el dropdown manualmente.
     */
    cerrar,

    /**
     * Abre el dropdown manualmente (con el query actual del input).
     */
    abrir() {
      buscar();
    },

    /**
     * Limpia los listeners y remueve el dropdown del DOM.
     * Llamala cuando el componente ya no se necesite (ej: al cerrar un modal).
     */
    destruir() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickFuera);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (dropdown.parentNode) {
        dropdown.parentNode.removeChild(dropdown);
      }
    },
  };
}