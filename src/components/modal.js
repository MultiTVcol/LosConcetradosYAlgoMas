/**
 * components/modal.js — Sistema centralizado de modales
 *
 * Un modal es una ventana que se superpone sobre el resto de la app,
 * bloqueando la interacción hasta que el usuario la cierre.
 *
 * Características:
 *   - Backdrop oscuro con blur detrás
 *   - Cierre con tecla Esc, clic en el fondo, o clic en la X
 *   - Animación suave al abrir/cerrar
 *   - Soporta cualquier contenido HTML
 *   - Se puede apilar (varios modales abiertos a la vez)
 *
 * Uso típico:
 *   import { Modal } from '../components/index.js';
 *
 *   const m = Modal.abrir({
 *     titulo: 'Nuevo producto',
 *     contenido: '<form>...</form>',
 *     ancho: 'md',
 *     onClose: () => console.log('Modal cerrado'),
 *   });
 *
 *   // luego, programáticamente:
 *   m.cerrar();
 *
 * Niveles de ancho disponibles:
 *   - 'sm'  → 360px
 *   - 'md'  → 520px (default)
 *   - 'lg'  → 720px
 *   - 'xl'  → 960px
 *   - 'full'→ 95vw
 */

// ============================================================
//  CONSTANTES
// ============================================================

/** ID del contenedor donde viven los modales */
const ROOT_ID = 'modal-root';

/** Anchos predefinidos (en píxeles, o vw para 'full') */
const ANCHOS = {
  sm: '360px',
  md: '520px',
  lg: '720px',
  xl: '960px',
  full: '95vw',
};

/** Stack de modales abiertos (para manejar Esc correctamente) */
const _modales = [];

// ============================================================
//  HELPERS INTERNOS
// ============================================================

/**
 * Garantiza que exista el contenedor raíz de modales.
 */
function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: none;
      pointer-events: none;
    `;
    document.body.appendChild(root);

    // Listener global para tecla Esc + Enter (se registra una sola vez)
    document.addEventListener('keydown', (e) => {
      if (_modales.length === 0) return;
      const ultimo = _modales[_modales.length - 1];

      if (e.key === 'Escape') {
        if (ultimo.opciones.cerrarConEsc !== false) {
          ultimo.cerrar();
        }
        return;
      }

      // Enter global: dispara el botón principal del modal activo
      // SALVO que el foco esté en un textarea (allí Enter inserta salto de línea)
      // o si el modal lo deshabilita con cerrarConEnter: false
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        const target = e.target;
        if (target && target.tagName === 'TEXTAREA') return;
        if (ultimo.opciones.enterPrimario === false) return;

        // Buscar el botón "primario" del modal (clases conocidas o data-primary)
        const body = ultimo.body || ultimo.elemento;
        if (!body) return;

        // FIX: solo procesar Enter si el foco/origen del evento está
        // DENTRO del modal. Sin esto, un Enter en un buscador externo
        // que recién ABRE el modal (ej: buscador de productos en Ventas)
        // dispara el botón primario del modal antes de que el usuario
        // pueda ver nada — el modal se abre y cierra al instante.
        if (target && !body.contains(target)) return;

        const btn = body.querySelector(
          '[data-primary],' +
          '#mc-aceptar,#mc-confirmar,#cobro-btn-confirmar,' +
          '#comp-mc-aceptar,#comp-pago-confirmar,#comp-abono-save,' +
          '#uf-guardar,#perm-guardar,#codigo-guardar,' +
          '#g-btn-guardar,#fac-edit-guardar,#fac-modal-imprimir,' +
          '#prov-save,#cli-guardar,#pe-aplicar,#auth-aceptar,' +
          '#inv-opt-pos,#cfg-pl-guardar'
        );
        // Si encuentra un botón habilitado, lo dispara
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
    });
  }
  return root;
}

/**
 * Muestra/oculta el contenedor raíz según haya modales abiertos.
 */
function actualizarRoot() {
  const root = ensureRoot();
  if (_modales.length > 0) {
    root.style.display = 'block';
    root.style.pointerEvents = 'auto';
    document.body.style.overflow = 'hidden'; // bloquear scroll de fondo
  } else {
    root.style.display = 'none';
    root.style.pointerEvents = 'none';
    document.body.style.overflow = ''; // restaurar scroll
  }
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Abre un nuevo modal y devuelve un controlador con método .cerrar()
 *
 * @param {Object} opciones
 * @param {string} [opciones.titulo] - Título mostrado en el header
 * @param {string|HTMLElement} [opciones.contenido] - HTML string o nodo DOM
 * @param {string} [opciones.ancho='md'] - 'sm'|'md'|'lg'|'xl'|'full'
 * @param {boolean} [opciones.cerrarConEsc=true] - Permite cerrar con Esc
 * @param {boolean} [opciones.cerrarAlClicarFondo=true] - Permite cerrar clicando el backdrop
 * @param {boolean} [opciones.mostrarBotonCerrar=true] - Muestra la X arriba a la derecha
 * @param {Function} [opciones.onClose] - Callback que se ejecuta al cerrar
 * @returns {{ cerrar: Function, elemento: HTMLElement }}
 *
 * @example
 *   const m = Modal.abrir({
 *     titulo: 'Editar cliente',
 *     contenido: '<p>Hola</p>',
 *     ancho: 'lg',
 *     onClose: () => console.log('cerrado'),
 *   });
 */
export function abrir(opciones = {}) {
  const root = ensureRoot();

  // Backdrop (capa oscura semi-transparente con blur)
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    opacity: 0;
    transition: opacity .2s ease;
    z-index: ${10000 + _modales.length};
  `;

  // Caja del modal
  const ancho = ANCHOS[opciones.ancho] || ANCHOS.md;
  const box = document.createElement('div');
  box.style.cssText = `
    background: #ffffff;
    border-radius: 14px;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
    width: 100%;
    max-width: ${ancho};
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    font-family: Inter, system-ui, sans-serif;
    transform: scale(.95) translateY(10px);
    transition: transform .2s ease;
    overflow: hidden;
  `;

  // Header (título + botón cerrar) — solo si hay título o botón
  const hayHeader = opciones.titulo || opciones.mostrarBotonCerrar !== false;
  if (hayHeader) {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px 14px;
      border-bottom: 1px solid #e2e8f0;
    `;

    // Título
    const tituloEl = document.createElement('div');
    tituloEl.style.cssText = `
      font-size: 17px;
      font-weight: 600;
      color: #0f172a;
      letter-spacing: -0.01em;
    `;
    tituloEl.textContent = opciones.titulo || '';
    header.appendChild(tituloEl);

    // Botón cerrar (X)
    if (opciones.mostrarBotonCerrar !== false) {
      const btnCerrar = document.createElement('button');
      btnCerrar.innerHTML = '&times;';
      btnCerrar.style.cssText = `
        background: transparent;
        border: 0;
        font-size: 24px;
        color: #64748b;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      `;
      btnCerrar.onmouseenter = () => {
        btnCerrar.style.background = '#f1f5f9';
        btnCerrar.style.color = '#0f172a';
      };
      btnCerrar.onmouseleave = () => {
        btnCerrar.style.background = 'transparent';
        btnCerrar.style.color = '#64748b';
      };
      btnCerrar.onclick = () => controller.cerrar();
      header.appendChild(btnCerrar);
    }

    box.appendChild(header);
  }

  // Body (contenido principal con scroll si es muy alto)
  const body = document.createElement('div');
  body.style.cssText = `
    padding: 20px 24px 24px;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
  `;

  // Inyectar contenido (string o elemento DOM)
  if (typeof opciones.contenido === 'string') {
    body.innerHTML = opciones.contenido;
  } else if (opciones.contenido instanceof HTMLElement) {
    body.appendChild(opciones.contenido);
  }

  box.appendChild(body);
  backdrop.appendChild(box);
  root.appendChild(backdrop);

  // Cerrar al hacer clic en el fondo (no en la caja)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && opciones.cerrarAlClicarFondo !== false) {
      controller.cerrar();
    }
  });

  // Controlador devuelto al llamador
  const controller = {
    opciones,
    elemento: box,
    body, // Acceso al body para inyectar más contenido después
    cerrar() {
      // Animar salida
      backdrop.style.opacity = '0';
      box.style.transform = 'scale(.95) translateY(10px)';
      setTimeout(() => {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        const idx = _modales.indexOf(controller);
        if (idx >= 0) _modales.splice(idx, 1);
        actualizarRoot();
        if (typeof opciones.onClose === 'function') {
          try { opciones.onClose(); } catch (e) { console.error(e); }
        }
      }, 200);
    },
  };

  _modales.push(controller);
  actualizarRoot();

  // Animar entrada (esperamos un frame)
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    box.style.transform = 'scale(1) translateY(0)';
  });

  return controller;
}

/**
 * Cierra TODOS los modales abiertos.
 *
 * @example
 *   Modal.cerrarTodos();
 */
export function cerrarTodos() {
  // Iteramos sobre una copia porque cerrar() modifica el array
  const copia = [..._modales];
  for (const m of copia) {
    m.cerrar();
  }
}

/**
 * Cantidad de modales abiertos actualmente.
 *
 * @returns {number}
 */
export function cantidad() {
  return _modales.length;
}

/**
 * Devuelve el modal más arriba en el stack (el último abierto).
 *
 * @returns {Object|null}
 */
export function tope() {
  return _modales[_modales.length - 1] || null;
}