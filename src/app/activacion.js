/**
 * app/activacion.js — Pantalla de activación de terminal
 *
 * Aparece SOLO cuando la nube está protegida con RLS y esta terminal
 * todavía no inició sesión de dispositivo (Supabase Auth). Se activa
 * UNA vez por computador: la sesión queda guardada y se renueva sola.
 *
 * La cuenta del comercio se crea en el dashboard de Supabase:
 *   Authentication → Users → Add user (email + clave fuerte).
 */

import * as Supa from '../services/supabase.js';
import { config } from '../services/config.js';

export function mostrarActivacion(appRoot) {
  return new Promise((resolve) => {
    appRoot.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fef3c7 0%,#f8fafc 100%);font-family:Inter,system-ui,sans-serif;padding:24px">
        <div style="width:100%;max-width:420px;background:white;border:1px solid #e2e8f0;border-radius:18px;padding:32px 30px;box-shadow:0 20px 50px -10px rgba(15,23,42,.15)">

          <div style="text-align:center;margin-bottom:22px">
            <div style="width:68px;height:68px;border-radius:18px;background:linear-gradient(135deg,#d97706,#a16207);color:white;display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 12px;box-shadow:0 10px 24px -8px rgba(217,119,6,.5)">🔐</div>
            <div style="font-size:21px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">Activar esta terminal</div>
            <div style="font-size:13px;color:#64748b;margin-top:6px;line-height:1.5">
              La base de datos de <b>${esc(config.branding?.appName || 'este comercio')}</b> está protegida.
              Ingresa la cuenta del comercio para autorizar este computador.
              <b>Solo se hace una vez.</b>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Correo de la cuenta del comercio</div>
              <input id="act-email" type="email" autocomplete="username" placeholder="pos@minegocio.com"
                style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clave de activación</div>
              <input id="act-password" type="password" autocomplete="current-password" placeholder="••••••••"
                style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>

            <div id="act-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;color:#991b1b;font-size:13px;text-align:center"></div>

            <button id="act-entrar"
              style="width:100%;padding:13px;background:#a16207;color:white;border:0;border-radius:11px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 14px -2px rgba(161,98,7,.45);margin-top:4px">
              🔓 Activar terminal
            </button>

            <button id="act-offline"
              style="width:100%;padding:11px;background:white;color:#64748b;border:1px solid #e2e8f0;border-radius:11px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">
              Continuar sin nube (solo datos locales)
            </button>
          </div>

          <div style="margin-top:16px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:9px;font-size:11.5px;color:#64748b;text-align:center;line-height:1.5">
            ¿No tienes la clave? Pídesela al dueño del negocio o a quien
            instaló el sistema. Sin activar, el POS funciona pero
            <b>no sincroniza con la nube</b>.
          </div>
        </div>
      </div>
    `;

    const inpEmail = appRoot.querySelector('#act-email');
    const inpPass = appRoot.querySelector('#act-password');
    const btn = appRoot.querySelector('#act-entrar');
    const btnOffline = appRoot.querySelector('#act-offline');
    const errBox = appRoot.querySelector('#act-error');

    const mostrarError = (msg) => {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    };

    setTimeout(() => inpEmail.focus(), 80);

    const activar = async () => {
      errBox.style.display = 'none';
      const email = inpEmail.value.trim();
      const pass = inpPass.value;
      if (!email || !pass) { mostrarError('Completa correo y clave'); return; }

      btn.disabled = true;
      btn.textContent = 'Activando…';
      const r = await Supa.activarDispositivo(email, pass);
      if (r.ok) {
        resolve({ activada: true });
      } else {
        mostrarError(
          /invalid login/i.test(r.mensaje)
            ? 'Correo o clave incorrectos'
            : 'No se pudo activar: ' + r.mensaje
        );
        btn.disabled = false;
        btn.textContent = '🔓 Activar terminal';
      }
    };

    [inpEmail, inpPass].forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); activar(); }
      });
    });
    btn.addEventListener('click', activar);
    btnOffline.addEventListener('click', () => resolve({ activada: false }));
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
