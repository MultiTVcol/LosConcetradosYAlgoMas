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
import { logo, patron } from './marca.js';

function fechaLarga() {
  const t = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function mostrarLogin(appRoot) {
  return new Promise((resolve) => {
    appRoot.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 42%,#6B4528 0%,#33200F 58%,#24160D 100%);font-family:Figtree,system-ui,sans-serif;padding:24px;position:relative;overflow:hidden">
        ${patron('#F5B82E', 0.08)}
        <div style="display:flex;flex-wrap:wrap;width:100%;max-width:800px;background:white;border-radius:24px;overflow:hidden;box-shadow:0 40px 80px -30px rgba(0,0,0,.65);position:relative">

          <!-- Panel de marca -->
          <div style="flex:1 1 300px;background:linear-gradient(160deg,#4A2E1A,#24160D);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 28px;color:#fff;text-align:center;position:relative;overflow:hidden">
            ${patron('#fff', 0.07)}
            <div style="position:relative;filter:drop-shadow(0 18px 30px rgba(0,0,0,.5))">${logo(150)}</div>
            <div style="position:relative;margin-top:18px">
              <div style="font-family:Fredoka,sans-serif;font-weight:600;font-size:30px;line-height:1">Los Concentrados</div>
              <div style="font-family:Caveat,cursive;font-weight:700;font-size:32px;color:#EE7623;line-height:1">y algo más</div>
            </div>
            <div style="color:#D9C2AC;font-size:13px;margin-top:10px;position:relative">Todo para su mascota y su finca</div>
          </div>

          <!-- Form -->
          <div style="flex:1 1 320px;padding:44px 40px;display:flex;flex-direction:column;gap:14px;justify-content:center">
            <div style="margin-bottom:8px">
              <div style="font-family:Fredoka,sans-serif;font-weight:600;font-size:31px;line-height:1;color:#2A1A10">Iniciar sesión</div>
              <div style="font-size:13.5px;color:#8C7766;margin-top:6px">${esc(fechaLarga())}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#5C4636;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Usuario</div>
              <input id="login-usuario" type="text" autocomplete="username" placeholder="Tu usuario"
                style="width:100%;padding:12px 14px;border:1.5px solid #EADFD0;border-radius:12px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit"
                onfocus="this.style.borderColor='#EE7623';this.style.boxShadow='0 0 0 4px rgba(238,118,35,.14)'" onblur="this.style.borderColor='#EADFD0';this.style.boxShadow='none'" />
            </div>
            <div>
              <div style="font-size:11px;color:#5C4636;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Contraseña</div>
              <input id="login-password" type="password" autocomplete="current-password" placeholder="••••••"
                style="width:100%;padding:12px 14px;border:1.5px solid #EADFD0;border-radius:12px;font-size:15px;outline:none;box-sizing:border-box;font-family:inherit"
                onfocus="this.style.borderColor='#EE7623';this.style.boxShadow='0 0 0 4px rgba(238,118,35,.14)'" onblur="this.style.borderColor='#EADFD0';this.style.boxShadow='none'" />
            </div>

            <div id="login-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 12px;color:#991b1b;font-size:13px;text-align:center"></div>

            <button id="login-entrar"
              style="width:100%;padding:14px;background:#EE7623;color:#24160D;border:0;border-radius:12px;cursor:pointer;font-size:15px;font-weight:800;font-family:inherit;box-shadow:0 10px 20px -10px rgba(217,98,15,.9);margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px">
              Abrir la caja →
            </button>

          <!-- Hint para primera vez (solo visible si el admin aún tiene la clave de fábrica) -->
          <div id="login-hint" style="display:none;margin-top:18px;padding:10px 12px;background:#FBF7F1;border:1px dashed #DCCFBE;border-radius:9px;font-size:11.5px;color:#7D6858;text-align:center">
            <div style="font-weight:600;color:#5C4636;margin-bottom:2px">¿Primera vez?</div>
            Usuario por defecto: <b style="color:#33200F;font-family:inherit">admin</b>
            · contraseña: <b style="color:#33200F;font-family:inherit">admin123</b>
            <div style="margin-top:4px;color:#a16207">⚠ Cambia esta contraseña apenas entres (módulo Usuarios).</div>
          </div>
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
        btnEntrar.textContent = 'Abrir la caja →';
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
