/**
 * services/auth.js — Autenticación y sesión actual
 *
 * - login(usuario, password)  → valida y guarda sesión en sessionStorage
 * - logout()                  → limpia sesión
 * - usuarioActual()           → devuelve el usuario logueado (o null)
 * - puede(accion)             → verifica permiso. Admin siempre true.
 * - solicitarAutorizacion()   → modal que pide código del admin
 */

import * as UsuariosRepo from '../modules/usuarios/usuarios.repo.js';
import { Modal, Toast } from '../components/index.js';

const KEY_SESION = 'pospunto.sesion';

// ============================================================
//  SESIÓN
// ============================================================

export async function login(usuario, password) {
  const u = await UsuariosRepo.buscarPorUsuario(usuario);
  if (!u) throw new Error('Usuario no encontrado');
  if (!u.activo) throw new Error('Este usuario está desactivado');
  if (String(u.password || '') !== String(password || '')) {
    throw new Error('Contraseña incorrecta');
  }
  const sesion = {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    permisos: u.permisos || {},
    iniciada: new Date().toISOString(),
  };
  try { sessionStorage.setItem(KEY_SESION, JSON.stringify(sesion)); } catch (e) { /**/ }
  return sesion;
}

export function logout() {
  try { sessionStorage.removeItem(KEY_SESION); } catch (e) { /**/ }
}

export function usuarioActual() {
  try {
    const raw = sessionStorage.getItem(KEY_SESION);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function estaLogueado() {
  return !!usuarioActual();
}

// ============================================================
//  PERMISOS
// ============================================================

/**
 * @param {string} accion - clave de PERMISOS, ej 'ventas.eliminar'
 * @returns {boolean}
 */
export function puede(accion) {
  const u = usuarioActual();
  if (!u) return false;
  if (u.rol === 'admin') return true;
  return !!(u.permisos && u.permisos[accion]);
}

/**
 * Indica si el usuario actual es admin.
 */
export function esAdmin() {
  const u = usuarioActual();
  return !!(u && u.rol === 'admin');
}

/**
 * Modal que pide el código de autorización al admin para que un cajero
 * pueda hacer una acción restringida. Si el usuario actual ES admin,
 * la promesa resuelve de inmediato sin pedir nada.
 *
 * @param {string} mensaje - texto que explica la acción que se está intentando
 * @returns {Promise<boolean>} - true si autorizado, false si cancelado
 */
export function solicitarAutorizacion(mensaje = '') {
  return new Promise((resolve) => {
    if (esAdmin()) { resolve(true); return; }

    const contenido = `
      <div style="text-align:center;margin-bottom:14px">
        <div style="width:64px;height:64px;border-radius:50%;background:#fef3c7;color:#a16207;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 10px">🔒</div>
        <div style="font-weight:700;font-size:15px;color:#0f172a">Acción restringida</div>
        ${mensaje ? `<div style="color:#64748b;font-size:13px;margin-top:4px">${mensaje}</div>` : ''}
      </div>

      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Código de autorización del administrador</div>
      <input id="auth-code" type="password" placeholder="Solicita el código al administrador" autocomplete="off"
        style="width:100%;padding:14px 16px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:22px;font-weight:700;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box;text-align:center;letter-spacing:.3em" />
      <div id="auth-error" style="display:none;margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;color:#991b1b;font-size:12.5px;text-align:center"></div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button id="auth-cancelar"
          style="flex:1;padding:11px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="auth-aceptar"
          style="flex:1.2;padding:11px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">🔓 Autorizar</button>
      </div>
    `;

    let resuelto = false;
    const m = Modal.abrir({
      titulo: '🔒 Autorización requerida',
      contenido,
      ancho: 'sm',
      cerrarAlClicarFondo: false,
      onClose: () => { if (!resuelto) resolve(false); },
    });

    const inp = m.body.querySelector('#auth-code');
    const err = m.body.querySelector('#auth-error');
    setTimeout(() => inp.focus(), 80);

    const verificar = async () => {
      const ok = await UsuariosRepo.verificarCodigoAdmin(inp.value);
      if (ok) {
        resuelto = true;
        resolve(true);
        m.cerrar();
      } else {
        err.textContent = 'Código incorrecto';
        err.style.display = 'block';
        inp.select();
        inp.style.borderColor = '#dc2626';
        setTimeout(() => { inp.style.borderColor = '#cbd5e1'; }, 600);
      }
    };

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); verificar(); }
    });
    m.body.querySelector('#auth-cancelar').onclick = () => { resuelto = true; resolve(false); m.cerrar(); };
    m.body.querySelector('#auth-aceptar').onclick = verificar;
  });
}
