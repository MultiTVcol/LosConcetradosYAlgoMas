/**
 * components/dropdown.js — Menú desplegable
 *
 * Un dropdown abre una lista de opciones al hacer clic en un trigger
 * (botón, ícono, lo que sea). Al elegir una opción, ejecuta un callback
 * y se cierra automáticamente.
 *
 * Casos de uso típicos:
 *   - Selector de método de pago (Efectivo, Tarjeta, etc.)
 *   - Filtro de fechas (Hoy, Semana, Mes)
 *   - Acciones en una fila (Editar, Duplicar, Borrar)
 *
 * Uso:
 *   import { Dropdown } from '../components/index.js';
 *
 *   Dropdown.crear({
 *     trigger: document.getElementById('btn-pago'),
 *     opciones: [
 *       { label: 'Efectivo',     value: 'efectivo', icono: '💵' },
 *       { label: 'Tarjeta',      value: 'tarjeta',  icono: '💳' },
 *       { label: 'Transferencia',value: 'transfer', icono: '🏦' },
 *       { separador: true },
 *       { label: 'Otro',         value: 'otro' },
 *     ],
 *     onSelect: (opcion) => {
 *       console.log('Elegido:', opcion.value);
 *     },
 *   });
 *
 * Cada opción puede tener:
 *   - label    (string, requerido): texto a mostrar
 *   - value    (any, requerido):    valor que se devuelve al seleccionar
 *   - icono    (string, opcional):  emoji o texto a mostrar a la izquierda
 *   - color    (string, opcional):  color del texto (útil para "Borrar" en rojo)
 *   - disabled (boolean, opcional): opción deshabilitada
 *   - separador (boolean, opcional): renderiza una línea divisoria en vez de opción
 */

// ============================================================
//  ESTADO INTERNO
// ============================================================

/** El dropdown abierto actualmente (solo puede haber uno a la vez) */
let _abierto = null;

// ============================================================
//  HELPERS
// ============================================================

/**
 * Cierra el dropdown abierto (si hay).
 */
function cerrarActivo() {
  if (!_abierto) return;
  const { dropdown, cleanup } = _abierto;
  dropdown.style.opacity = '0';
  dropdown.style.transform = 'translateY(-4px)';
  setTimeout(() => {
    if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    cleanup();
  }, 150);
  _abierto = null;
}

/**
 * Listener global para cerrar al hacer clic fuera o Esc.
 * Se registra una sola vez.
 */
let _listenerGlobalRegistrado = false;
function asegurarListenerGlobal() {
  if (_listenerGlobalRegistrado) return;
  document.addEventListener('click', (e) => {
    if (!_abierto) return;
    const { dropdown, trigger } = _abierto;
    if (e.target !== trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
      cerrarActivo();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _abierto) {
      cerrarActivo();
    }
  });
  _listenerGlobalRegistrado = true;
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Crea un dropdown que se abre al hacer clic en el trigger.
 *
 * @param {Object} opciones
 * @param {HTMLElement} opciones.trigger - Elemento que activa el dropdown
 * @param {Array<Object>} opciones.opciones - Lista de opciones
 * @param {Function} opciones.onSelect - Callback al elegir: (opcion) => void
 * @param {string} [opciones.alineacion='left'] - 'left' | 'right' (alineación del menú)
 * @param {number} [opciones.ancho] - Ancho fijo en px (default: ancho del trigger)
 * @param {number} [opciones.anchoMinimo=180] - Ancho mínimo en px
 * @returns {{ destruir: Function, abrir: Function }} - Controlador
 *
 * @example
 *   const dd = Dropdown.crear({
 *     trigger: document.getElementById('miBoton'),
 *     opciones: [
 *       { label: 'Editar',  value: 'edit',   icono: '✏️' },
 *       { label: 'Borrar',  value: 'delete', icono: '🗑️', color: '#dc2626' },
 *     ],
 *     onSelect: (op) => console.log(op.value),
 *   });
 */
export function crear(config) {
  asegurarListenerGlobal();

  const trigger = config.trigger;
  if (!trigger || !(trigger instanceof HTMLElement)) {
    throw new Error('Dropdown.crear: se requiere un elemento trigger válido');
  }

  const opciones = config.opciones || [];
  const alineacion = config.alineacion || 'left';
  const anchoMinimo = config.anchoMinimo || 180;

  // Manejador del clic en el trigger
  function onTriggerClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Si ya está abierto este mismo dropdown, lo cerramos
    if (_abierto && _abierto.trigger === trigger) {
      cerrarActivo();
      return;
    }

    // Si hay otro dropdown abierto, lo cerramos primero
    cerrarActivo();

    abrirDropdown();
  }

  function abrirDropdown() {
    // Crear el contenedor del dropdown
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 12px 24px -8px rgba(0,0,0,.15), 0 4px 8px -4px rgba(0,0,0,.08);
      min-width: ${anchoMinimo}px;
      max-height: 360px;
      overflow-y: auto;
      z-index: 9997;
      padding: 6px;
      font-family: Inter, system-ui, sans-serif;
      font-size: 14px;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity .15s ease, transform .15s ease;
    `;

    // Renderizar opciones
    opciones.forEach((opcion, idx) => {
      if (opcion.separador) {
        const sep = document.createElement('div');
        sep.style.cssText = `
          height: 1px;
          background: #e2e8f0;
          margin: 6px 4px;
        `;
        dropdown.appendChild(sep);
        return;
      }

      const item = document.createElement('div');
      const disabled = opcion.disabled === true;
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 7px;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        opacity: ${disabled ? '0.5' : '1'};
        color: ${opcion.color || '#0f172a'};
        transition: background .1s;
        user-select: none;
        font-size: 14px;
      `;

      // Ícono (si hay)
      if (opcion.icono) {
        const iconoEl = document.createElement('span');
        iconoEl.textContent = opcion.icono;
        iconoEl.style.cssText = `font-size: 16px; line-height: 1; min-width: 18px;`;
        item.appendChild(iconoEl);
      }

      // Texto
      const texto = document.createElement('span');
      texto.textContent = opcion.label;
      texto.style.cssText = `flex: 1;`;
      item.appendChild(texto);

      // Hover
      if (!disabled) {
        item.addEventListener('mouseenter', () => {
          item.style.background = '#f1f5f9';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });

        item.addEventListener('click', () => {
          if (typeof config.onSelect === 'function') {
            try {
              config.onSelect(opcion);
            } catch (e) {
              console.error('Dropdown onSelect error:', e);
            }
          }
          cerrarActivo();
        });
      }

      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    // Posicionar
    const rect = trigger.getBoundingClientRect();
    const ancho = config.ancho || Math.max(rect.width, anchoMinimo);
    dropdown.style.width = `${ancho}px`;
    dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;

    if (alineacion === 'right') {
      dropdown.style.left = `${rect.right - ancho + window.scrollX}px`;
    } else {
      dropdown.style.left = `${rect.left + window.scrollX}px`;
    }

    // Animar entrada
    requestAnimationFrame(() => {
      dropdown.style.opacity = '1';
      dropdown.style.transform = 'translateY(0)';
    });

    // Función de limpieza al cerrar
    const cleanup = () => { /* nada por ahora */ };

    _abierto = { dropdown, trigger, cleanup };
  }

  // Registrar listener en el trigger
  trigger.addEventListener('click', onTriggerClick);

  return {
    /**
     * Abre el dropdown programáticamente (sin necesidad de clic).
     */
    abrir() {
      if (_abierto && _abierto.trigger === trigger) return;
      cerrarActivo();
      abrirDropdown();
    },

    /**
     * Cierra el dropdown si está abierto.
     */
    cerrar() {
      if (_abierto && _abierto.trigger === trigger) {
        cerrarActivo();
      }
    },

    /**
     * Limpia el listener del trigger. Llamala cuando el componente ya no se necesite.
     */
    destruir() {
      trigger.removeEventListener('click', onTriggerClick);
      if (_abierto && _abierto.trigger === trigger) {
        cerrarActivo();
      }
    },
  };
}