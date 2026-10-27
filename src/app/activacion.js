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
import { logo, patron } from './marca.js';

export function mostrarActivacion(appRoot) {
  return new Promise((resolve) => {
    appRoot.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 42%,#6B4528 0%,#33200F 58%,#24160D 100%);font-family:Figtree,system-ui,sans-serif;padding:24px;position:relative;overflow:hidden">
        ${patron('#F5B82E', 0.08)}
        <div style="width:100%;max-width:420px;background:white;border-radius:24px;padding:32px 30px;box-shadow:0 40px 80px -30px rgba(0,0,0,.65);position:relative">

          <div style="text-align:center;margin-bottom:22px">
            <div style="display:flex;justify-content:center;margin-bottom:12px">${logo(76)}</div>
            <div style="font-family:Fredoka,sans-serif;font-size:26px;font-weight:600;color:#2A1A10">Activar esta terminal</div>
            <div style="font-size:13px;color:#7D6858;margin-top:6px;line-height:1.5">
              La base de datos de <b>Los Concentrados y Algo Más</b> está protegida.
              Ingresa la cuenta del comercio para autorizar este computador.
              <b>Solo se hace una vez.</b>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11.5px;color:#7D6858;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Correo de la cuenta del comercio</div>
              <input id="act-email" type="email" autocomplete="username" placeholder="pos@minegocio.com"
                style="width:100%;padding:12px 14px;border:1px solid #DCCFBE;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#7D6858;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clave de activación</div>
              <input id="act-password" type="password" autocomplete="current-password" placeholder="••••••••"
                style="width:100%;padding:12px 14px;border:1px solid #DCCFBE;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>

            <div id="act-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;color:#991b1b;font-size:13px;text-align:center"></div>

            <button id="act-entrar"
              style="width:100%;padding:14px;background:#EE7623;color:#24160D;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:800;font-family:inherit;box-shadow:0 10px 20px -10px rgba(217,98,15,.9);margin-top:4px">
              🔓 Activar terminal
            </button>

            <button id="act-offline"
              style="width:100%;padding:11px;background:white;color:#7D6858;border:1px solid #EADFD0;border-radius:11px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">
              Continuar sin nube (solo datos locales)
            </button>
          </div>

          <div style="margin-top:16px;padding:10px 12px;background:#FBF7F1;border:1px dashed #DCCFBE;border-radius:9px;font-size:11.5px;color:#7D6858;text-align:center;line-height:1.5">
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
