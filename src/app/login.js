/**
 * app/login.js — Pantalla de login antes del POS
 *
 * Reemplaza el contenido de #app con un formulario de login.
 * Cuando el usuario se autentica correctamente, resuelve la promesa
 * con el objeto de sesión y main.js procede a montar el shell.
 */

import * as Auth from '../services/auth.js';
import { Toast } from '../components/index.js';
import { config } from '../services/config.js';

export function mostrarLogin(appRoot) {
  return new Promise((resolve) => {
    appRoot.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eef2ff 0%,#f8fafc 100%);font-family:Inter,system-ui,sans-serif;padding:24px">
        <div style="width:100%;max-width:380px;background:white;border:1px solid #e2e8f0;border-radius:18px;padding:32px 30px;box-shadow:0 20px 50px -10px rgba(15,23,42,.15)">

          <!-- Logo / marca -->
          <div style="text-align:center;margin-bottom:24px">
            <div style="width:68px;height:68px;border-radius:18px;background:linear-gradient(135deg,#4f46e5,#4338ca);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:30px;margin:0 auto 12px;box-shadow:0 10px 24px -8px rgba(79,70,229,.5)">P</div>
            <div style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">${esc(config.branding?.appName || 'PosPunto')}</div>
            <div style="font-size:13px;color:#64748b;margin-top:3px">Inicia sesión para continuar</div>
          </div>

          <!-- Form -->
          <div style="display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Usuario</div>
              <input id="login-usuario" type="text" autocomplete="username" placeholder="admin"
                style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Contraseña</div>
              <input id="login-password" type="password" autocomplete="current-password" placeholder="••••••"
                style="width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>

            <div id="login-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;color:#991b1b;font-size:13px;text-align:center"></div>

            <button id="login-entrar"
              style="width:100%;padding:13px;background:#4f46e5;color:white;border:0;border-radius:11px;cursor:pointer;font-size:15px;font-weight:700;font-family:inherit;box-shadow:0 4px 14px -2px rgba(79,70,229,.45);margin-top:4px;display:flex;align-items:center;justify-content:center;gap:8px">
              Iniciar sesión →
            </button>
          </div>

          <!-- Hint para primera vez (solo visible si el admin aún tiene la clave de fábrica) -->
          <div id="login-hint" style="display:none;margin-top:18px;padding:10px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:9px;font-size:11.5px;color:#64748b;text-align:center">
            <div style="font-weight:600;color:#475569;margin-bottom:2px">¿Primera vez?</div>
            Usuario por defecto: <b style="color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace">admin</b>
            · contraseña: <b style="color:#4338ca;font-family:'JetBrains Mono',ui-monospace,monospace">admin123</b>
            <div style="margin-top:4px;color:#a16207">⚠ Cambia esta contraseña apenas entres (módulo Usuarios).</div>
          </div>
        </div>
      </div>
    `;

    const inpUsuario = appRoot.querySelector('#login-usuario');
    const inpPass = appRoot.querySelector('#login-password');
    const btnEntrar = appRoot.querySelector('#login-entrar');
    const errBox = appRoot.querySelector('#login-error');

    // Mostrar el hint de credenciales por defecto SOLO si el admin
    // todavía tiene la contraseña de fábrica. Una vez cambiada, no se
    // vuelve a anunciar al público.
    (async () => {
      try {
        const UsuariosRepo = await import('../modules/usuarios/usuarios.repo.js');
        const admin = await UsuariosRepo.buscarPorUsuario('admin');
        // Funciona tanto con contraseña en texto plano (formato viejo)
        // como con hash (formato nuevo)
        if (admin && admin.activo && await UsuariosRepo.verificarPassword(admin, 'admin123')) {
          const hint = appRoot.querySelector('#login-hint');
          if (hint) hint.style.display = 'block';
        }
      } catch (e) { /* sin hint si algo falla */ }
    })();

    const mostrarError = (msg) => {
      errBox.textContent = msg;
      errBox.style.display = 'block';
      inpPass.select();
    };
    const ocultarError = () => { errBox.style.display = 'none'; };

    setTimeout(() => inpUsuario.focus(), 80);

    const entrar = async () => {
      ocultarError();
      const u = inpUsuario.value.trim();
      const p = inpPass.value;
      if (!u || !p) { mostrarError('Completa usuario y contraseña'); return; }

      btnEntrar.disabled = true;
      btnEntrar.textContent = 'Verificando…';
      try {
        const sesion = await Auth.login(u, p);
        Toast.ok(`Bienvenido, ${sesion.nombre}`);
        resolve(sesion);
      } catch (err) {
        console.warn('Login fallido:', err);
        mostrarError(err.message || 'Error al iniciar sesión');
        btnEntrar.disabled = false;
        btnEntrar.textContent = 'Iniciar sesión →';
      }
    };

    [inpUsuario, inpPass].forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); entrar(); }
      });
      inp.addEventListener('input', ocultarError);
    });

    btnEntrar.addEventListener('click', entrar);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
