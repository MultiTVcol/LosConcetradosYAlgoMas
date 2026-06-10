/**
 * components/confirmBox.js — Diálogos de confirmación (sí/no)
 *
 * Componente que reutiliza modal.js para mostrar preguntas tipo
 * "¿Estás seguro?" con botones Confirmar/Cancelar.
 *
 * La función `preguntar()` devuelve una Promesa con true/false según
 * lo que el usuario decida. Esto permite escribir flujos lineales
 * muy legibles:
 *
 *   const ok = await Confirm.preguntar('¿Eliminar este producto?');
 *   if (ok) await db.remove('productos', id);
 *
 * Variantes disponibles:
 *   - preguntar()  → diálogo neutral (azul)
 *   - peligro()    → diálogo destructivo (rojo) — para borrar, cancelar venta, etc.
 *   - exito()      → diálogo de confirmación positiva (verde)
 */

import * as Modal from './modal.js';

// ============================================================
//  HELPER INTERNO
// ============================================================

/**
 * Crea un diálogo de confirmación y devuelve una Promesa.
 *
 * @param {Object} opciones
 * @param {string} opciones.titulo - Título del diálogo
 * @param {string} opciones.mensaje - Pregunta/mensaje principal
 * @param {string} [opciones.textoConfirmar='Confirmar'] - Texto del botón positivo
 * @param {string} [opciones.textoCancelar='Cancelar'] - Texto del botón negativo
 * @param {string} [opciones.colorConfirmar='#4f46e5'] - Color del botón positivo
 * @param {string} [opciones.icono='?'] - Ícono central
 * @param {string} [opciones.colorIcono='#4f46e5'] - Color del ícono
 * @returns {Promise<boolean>} - true si confirmó, false si canceló
 */
function crearDialog(opciones) {
  return new Promise((resolve) => {
    // Construir el HTML del contenido
    const contenido = document.createElement('div');
    contenido.style.cssText = `
      text-align: center;
      padding: 8px 0 4px;
    `;

    // Ícono central
    const iconoBox = document.createElement('div');
    iconoBox.style.cssText = `
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${opciones.colorIcono}15;
      color: ${opciones.colorIcono};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 28px;
      font-weight: 700;
    `;
    iconoBox.textContent = opciones.icono || '?';
    contenido.appendChild(iconoBox);

    // Mensaje principal
    const mensajeEl = document.createElement('div');
    mensajeEl.style.cssText = `
      font-size: 15px;
      color: #334155;
      line-height: 1.55;
      margin-bottom: 24px;
      max-width: 360px;
      margin-left: auto;
      margin-right: auto;
    `;
    mensajeEl.textContent = opciones.mensaje;
    contenido.appendChild(mensajeEl);

    // Contenedor de botones
    const botones = document.createElement('div');
    botones.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: center;
    `;

    // Botón Cancelar
    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = opciones.textoCancelar || 'Cancelar';
    btnCancelar.style.cssText = `
      padding: 11px 22px;
      background: white;
      border: 1px solid #cbd5e1;
      color: #475569;
      border-radius: 10px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      min-width: 110px;
      transition: background .15s;
    `;
    btnCancelar.onmouseenter = () => { btnCancelar.style.background = '#f1f5f9'; };
    btnCancelar.onmouseleave = () => { btnCancelar.style.background = 'white'; };

    // Botón Confirmar (marcado como primary para que Enter lo dispare)
    const btnConfirmar = document.createElement('button');
    btnConfirmar.textContent = opciones.textoConfirmar || 'Confirmar';
    btnConfirmar.setAttribute('data-primary', '');
    btnConfirmar.style.cssText = `
      padding: 11px 22px;
      background: ${opciones.colorConfirmar || '#4f46e5'};
      border: 0;
      color: white;
      border-radius: 10px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      min-width: 110px;
      transition: filter .15s;
      box-shadow: 0 4px 8px -2px ${opciones.colorConfirmar || '#4f46e5'}40;
    `;
    btnConfirmar.onmouseenter = () => { btnConfirmar.style.filter = 'brightness(.92)'; };
    btnConfirmar.onmouseleave = () => { btnConfirmar.style.filter = 'brightness(1)'; };

    botones.appendChild(btnCancelar);
    botones.appendChild(btnConfirmar);
    contenido.appendChild(botones);

    // Abrir el modal
    const modal = Modal.abrir({
      titulo: opciones.titulo || '',
      contenido,
      ancho: 'sm',
      mostrarBotonCerrar: false, // El usuario debe decidir explícitamente
      cerrarAlClicarFondo: false, // Forzar uso de los botones
      onClose: () => {
        // Si el modal se cerró sin que se haya resuelto, contamos como "cancelar"
        if (!resuelto) {
          resuelto = true;
          resolve(false);
        }
      },
    });

    // Manejar clicks
    let resuelto = false;
    btnCancelar.onclick = () => {
      resuelto = true;
      resolve(false);
      modal.cerrar();
    };
    btnConfirmar.onclick = () => {
      resuelto = true;
      resolve(true);
      modal.cerrar();
    };

    // Focus en el botón Confirmar (Enter confirma rápido)
    setTimeout(() => btnConfirmar.focus(), 200);
  });
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Diálogo de confirmación neutral (color por defecto, indigo).
 *
 * @param {string} mensaje - Pregunta a mostrar
 * @param {Object} [opciones] - Personalizaciones
 * @returns {Promise<boolean>}
 *
 * @example
 *   const ok = await Confirm.preguntar('¿Guardar los cambios?');
 *   if (ok) await guardar();
 */
export function preguntar(mensaje, opciones = {}) {
  return crearDialog({
    titulo: opciones.titulo || 'Confirmación',
    mensaje,
    icono: '?',
    colorIcono: '#4f46e5',
    colorConfirmar: '#4f46e5',
    textoConfirmar: opciones.textoConfirmar || 'Confirmar',
    textoCancelar: opciones.textoCancelar || 'Cancelar',
  });
}

/**
 * Diálogo de confirmación destructivo (rojo).
 * Úsalo para acciones que borran o cancelan algo importante.
 *
 * @param {string} mensaje
 * @param {Object} [opciones]
 * @returns {Promise<boolean>}
 *
 * @example
 *   const ok = await Confirm.peligro('¿Eliminar este producto?');
 *   if (ok) await db.remove('productos', id);
 */
export function peligro(mensaje, opciones = {}) {
  return crearDialog({
    titulo: opciones.titulo || 'Acción irreversible',
    mensaje,
    icono: '!',
    colorIcono: '#dc2626',
    colorConfirmar: '#dc2626',
    textoConfirmar: opciones.textoConfirmar || 'Eliminar',
    textoCancelar: opciones.textoCancelar || 'Cancelar',
  });
}

/**
 * Diálogo de confirmación positiva (verde).
 * Úsalo para confirmar acciones que el usuario quiere hacer.
 *
 * @param {string} mensaje
 * @param {Object} [opciones]
 * @returns {Promise<boolean>}
 *
 * @example
 *   const ok = await Confirm.exito('¿Marcar la venta como cobrada?');
 *   if (ok) await marcarCobrada(id);
 */
export function exito(mensaje, opciones = {}) {
  return crearDialog({
    titulo: opciones.titulo || 'Confirmar acción',
    mensaje,
    icono: '✓',
    colorIcono: '#15803d',
    colorConfirmar: '#15803d',
    textoConfirmar: opciones.textoConfirmar || 'Confirmar',
    textoCancelar: opciones.textoCancelar || 'Cancelar',
  });
}

/**
 * Diálogo de información simple (solo botón OK).
 * Para avisar algo sin esperar decisión.
 *
 * @param {string} mensaje
 * @param {Object} [opciones]
 * @returns {Promise<boolean>}
 *
 * @example
 *   await Confirm.aviso('Tu sesión expirará en 5 minutos');
 */
export function aviso(mensaje, opciones = {}) {
  return new Promise((resolve) => {
    const contenido = document.createElement('div');
    contenido.style.cssText = `text-align: center; padding: 8px 0 4px;`;

    // Ícono
    const iconoBox = document.createElement('div');
    iconoBox.style.cssText = `
      width: 56px; height: 56px; border-radius: 50%;
      background: #0284c715; color: #0284c7;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px; font-size: 28px; font-weight: 700;
    `;
    iconoBox.textContent = 'i';
    contenido.appendChild(iconoBox);

    const mensajeEl = document.createElement('div');
    mensajeEl.style.cssText = `
      font-size: 15px; color: #334155; line-height: 1.55;
      margin-bottom: 24px; max-width: 360px;
      margin-left: auto; margin-right: auto;
    `;
    mensajeEl.textContent = mensaje;
    contenido.appendChild(mensajeEl);

    const btnOk = document.createElement('button');
    btnOk.textContent = opciones.textoOk || 'Entendido';
    btnOk.style.cssText = `
      padding: 11px 22px; background: #4f46e5; border: 0; color: white;
      border-radius: 10px; cursor: pointer; font-size: 14px;
      font-weight: 600; font-family: inherit; min-width: 110px;
    `;

    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:center';
    div.appendChild(btnOk);
    contenido.appendChild(div);

    const modal = Modal.abrir({
      titulo: opciones.titulo || 'Aviso',
      contenido,
      ancho: 'sm',
      mostrarBotonCerrar: false,
      cerrarAlClicarFondo: false,
      onClose: () => {
        if (!resuelto) { resuelto = true; resolve(true); }
      },
    });

    let resuelto = false;
    btnOk.onclick = () => {
      resuelto = true;
      resolve(true);
      modal.cerrar();
    };
    setTimeout(() => btnOk.focus(), 250);
  });
}