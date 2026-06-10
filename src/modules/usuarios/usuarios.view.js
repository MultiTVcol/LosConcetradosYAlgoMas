/**
 * modules/usuarios/usuarios.view.js — Gestión de usuarios y permisos
 *
 * Solo accesible para admin. Permite crear cajeros, editar permisos,
 * activar/desactivar usuarios y cambiar el código de autorización.
 */

import * as Repo from './usuarios.repo.js';
import * as Auth from '../../services/auth.js';
import * as Realtime from '../../services/realtime.js';
import { esc } from '../../core/strings.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';

let _contenedor = null;
let _usuarios = [];
let _codigoAdmin = '';
let _offRealtime = null;

export async function render(contenedor) {
  if (!Auth.esAdmin()) {
    contenedor.innerHTML = `
      <div style="padding:40px 48px;max-width:560px;margin:40px auto;text-align:center;background:white;border:1px solid #e2e8f0;border-radius:12px">
        <div style="font-size:48px">🔒</div>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:10px 0 6px">Acceso restringido</h1>
        <div style="color:#64748b;font-size:14px">Solo el administrador puede acceder a la gestión de usuarios.</div>
      </div>
    `;
    return;
  }

  _contenedor = contenedor;

  // Cerrar suscripción anterior
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = `<div style="padding:40px 48px;color:#64748b">Cargando usuarios…</div>`;

  try { _usuarios = await Repo.listar(); } catch (e) { _usuarios = []; }
  try { _codigoAdmin = await Repo.leerCodigoAdmin(); } catch (e) { _codigoAdmin = ''; }

  contenedor.innerHTML = htmlLayout();
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);

  // Realtime: si otra terminal crea/edita usuarios o cambia el código,
  // refrescar la lista automáticamente
  _offRealtime = Realtime.escucharVarias(['usuarios', 'kvs'], async () => {
    try {
      _usuarios = await Repo.listar();
      _codigoAdmin = await Repo.leerCodigoAdmin();
      // Re-renderizar manteniendo el contenedor
      contenedor.innerHTML = htmlLayout();
      refrescarIconos(contenedor);
      adjuntarEventos(contenedor);
    } catch (err) { console.warn('Realtime usuarios:', err); }
  });
}

function htmlLayout() {
  return `
    <div style="padding:32px 40px;max-width:1100px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="users" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Usuarios y permisos</h1>
      </div>

      <!-- Código de autorización del admin -->
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700;font-size:15px;color:#92400e">🔑 Código de autorización</div>
          <div style="color:#92400e;font-size:13px;margin-top:3px">Los cajeros lo necesitan para editar o eliminar ventas (y otras acciones restringidas).</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="background:white;border:1.5px solid #fde68a;padding:9px 16px;border-radius:9px;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:800;font-size:18px;color:#92400e;letter-spacing:.2em" id="codigo-actual">${esc(_codigoAdmin)}</span>
          <button id="btn-cambiar-codigo"
            style="padding:9px 14px;background:#a16207;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">✏️ Cambiar código</button>
        </div>
      </div>

      <!-- Lista de usuarios -->
      <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div>
            <h3 style="font-size:17px;font-weight:700;margin:0;color:#0f172a">${_usuarios.length} usuario(s)</h3>
            <div style="font-size:12.5px;color:#64748b;margin-top:2px">Administra los accesos al sistema.</div>
          </div>
          <button id="btn-nuevo-usuario"
            style="padding:10px 16px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35);display:flex;align-items:center;gap:6px">
            <i data-lucide="user-plus" style="width:16px;height:16px"></i> Nuevo usuario
          </button>
        </div>

        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
                <th style="padding:10px 12px">Usuario</th>
                <th style="padding:10px 12px">Nombre</th>
                <th style="padding:10px 12px">Rol</th>
                <th style="padding:10px 12px;text-align:center">Estado</th>
                <th style="padding:10px 12px;width:200px"></th>
              </tr>
            </thead>
            <tbody>
              ${_usuarios.map((u) => fila(u)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function fila(u) {
  const esYo = Auth.usuarioActual()?.id === u.id;
  return `
    <tr style="border-bottom:1px solid #f1f5f9" data-id="${esc(u.id)}">
      <td style="padding:14px 12px;color:#0f172a;font-weight:600;font-family:'JetBrains Mono',ui-monospace,monospace">
        ${esc(u.usuario)}${esYo ? ' <span style="background:#e0e7ff;color:#4338ca;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:5px;margin-left:6px">TÚ</span>' : ''}
      </td>
      <td style="padding:14px 12px;color:#475569">${esc(u.nombre)}</td>
      <td style="padding:14px 12px">
        <span style="background:${u.rol === 'admin' ? '#eef2ff' : '#fef3c7'};color:${u.rol === 'admin' ? '#4338ca' : '#92400e'};font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em">
          ${u.rol === 'admin' ? '👑 Admin' : '💼 Cajero'}
        </span>
      </td>
      <td style="padding:14px 12px;text-align:center">
        <span style="background:${u.activo ? '#dcfce7' : '#fef2f2'};color:${u.activo ? '#166534' : '#dc2626'};font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:6px">
          ${u.activo ? '✓ Activo' : '✗ Inactivo'}
        </span>
      </td>
      <td style="padding:14px 12px">
        <div style="display:flex;gap:6px;justify-content:flex-end">
          ${u.rol !== 'admin' ? `
            <button class="u-permisos" data-id="${esc(u.id)}" title="Configurar permisos"
              style="padding:6px 11px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit">🔧 Permisos</button>
          ` : ''}
          <button class="u-editar" data-id="${esc(u.id)}" title="Editar"
            style="width:32px;height:32px;border:1px solid #fde68a;background:#fef9c3;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center">
            <i data-lucide="pencil" style="width:14px;height:14px;color:#a16207"></i>
          </button>
          ${!esYo ? `
            <button class="u-borrar" data-id="${esc(u.id)}" title="Eliminar"
              style="width:32px;height:32px;border:1px solid #fecaca;background:#fef2f2;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center">
              <i data-lucide="trash-2" style="width:14px;height:14px;color:#dc2626"></i>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

function adjuntarEventos(contenedor) {
  contenedor.querySelector('#btn-nuevo-usuario')?.addEventListener('click', () => abrirFormUsuario());
  contenedor.querySelector('#btn-cambiar-codigo')?.addEventListener('click', cambiarCodigo);

  contenedor.querySelectorAll('.u-editar').forEach((b) => {
    b.onclick = () => abrirFormUsuario(b.dataset.id);
  });
  contenedor.querySelectorAll('.u-borrar').forEach((b) => {
    b.onclick = () => borrarUsuario(b.dataset.id);
  });
  contenedor.querySelectorAll('.u-permisos').forEach((b) => {
    b.onclick = () => abrirEditorPermisos(b.dataset.id);
  });
}

// ============================================================
//  FORM USUARIO
// ============================================================

async function abrirFormUsuario(id) {
  const usuario = id ? _usuarios.find((u) => u.id === id) : null;
  const datos = usuario || { usuario: '', nombre: '', password: '', rol: 'cajero', permisos: { ...Repo.PERMISOS_CAJERO_DEFAULT }, activo: true };

  const contenido = `
    <div style="display:grid;gap:12px">
      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nombre completo *</div>
        <input id="uf-nombre" type="text" value="${esc(datos.nombre)}" placeholder="Ej: Juan Pérez"
          style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>
      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Usuario *</div>
          <input id="uf-usuario" type="text" value="${esc(datos.usuario)}" placeholder="Ej: jperez" ${id ? 'readonly' : ''} autocomplete="off"
            style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:'JetBrains Mono',ui-monospace,monospace;${id ? 'background:#f1f5f9;color:#64748b' : ''}" />
        </div>
        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Contraseña *</div>
          <input id="uf-password" type="password" value="${esc(datos.password)}" placeholder="Mínimo 4 caracteres" autocomplete="new-password"
            style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
        </div>
      </div>

      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Rol</div>
        <div style="display:flex;gap:8px">
          <label style="flex:1;cursor:pointer">
            <input type="radio" name="uf-rol" value="admin" ${datos.rol === 'admin' ? 'checked' : ''} style="display:none" class="uf-rol-radio" />
            <div class="uf-rol-card" data-rol="admin" style="padding:11px;border:2px solid ${datos.rol === 'admin' ? '#4f46e5' : '#e2e8f0'};background:${datos.rol === 'admin' ? '#eef2ff' : 'white'};border-radius:10px;text-align:center;font-weight:700;font-size:13px;color:${datos.rol === 'admin' ? '#4338ca' : '#475569'}">👑 Administrador</div>
          </label>
          <label style="flex:1;cursor:pointer">
            <input type="radio" name="uf-rol" value="cajero" ${datos.rol === 'cajero' ? 'checked' : ''} style="display:none" class="uf-rol-radio" />
            <div class="uf-rol-card" data-rol="cajero" style="padding:11px;border:2px solid ${datos.rol === 'cajero' ? '#a16207' : '#e2e8f0'};background:${datos.rol === 'cajero' ? '#fef3c7' : 'white'};border-radius:10px;text-align:center;font-weight:700;font-size:13px;color:${datos.rol === 'cajero' ? '#92400e' : '#475569'}">💼 Cajero</div>
          </label>
        </div>
        <div style="font-size:11.5px;color:#64748b;margin-top:6px">
          El <b>Administrador</b> tiene acceso total. El <b>Cajero</b> tiene permisos configurables; para acciones restringidas debe ingresar el código de autorización.
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:#475569;font-weight:600;cursor:pointer;margin-top:4px">
        <input id="uf-activo" type="checkbox" ${datos.activo !== false ? 'checked' : ''} style="width:17px;height:17px"> Usuario activo
      </label>

      <div id="uf-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;color:#991b1b;font-size:13px"></div>

      <div style="display:flex;gap:10px;margin-top:6px">
        <button id="uf-cancelar"
          style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="uf-guardar"
          style="flex:1.2;padding:11px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">💾 Guardar</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({
    titulo: id ? '✏️ Editar usuario' : '➕ Nuevo usuario',
    contenido,
    ancho: 'md',
    cerrarAlClicarFondo: false,
  });

  // Cards de rol clickeables
  m.body.querySelectorAll('.uf-rol-card').forEach((card) => {
    card.addEventListener('click', () => {
      const rol = card.dataset.rol;
      m.body.querySelectorAll('.uf-rol-radio').forEach((r) => r.checked = r.value === rol);
      // Refrescar visual
      m.body.querySelectorAll('.uf-rol-card').forEach((c) => {
        const seleccionado = c.dataset.rol === rol;
        const esAdmin = c.dataset.rol === 'admin';
        c.style.borderColor = seleccionado ? (esAdmin ? '#4f46e5' : '#a16207') : '#e2e8f0';
        c.style.background = seleccionado ? (esAdmin ? '#eef2ff' : '#fef3c7') : 'white';
        c.style.color = seleccionado ? (esAdmin ? '#4338ca' : '#92400e') : '#475569';
      });
    });
  });

  const errBox = m.body.querySelector('#uf-error');
  setTimeout(() => m.body.querySelector('#uf-nombre')?.focus(), 80);

  m.body.querySelector('#uf-cancelar').onclick = () => m.cerrar();
  m.body.querySelector('#uf-guardar').onclick = async () => {
    const rolSeleccionado = m.body.querySelector('input[name="uf-rol"]:checked')?.value || 'cajero';
    const obj = {
      id: id || undefined,
      usuario: m.body.querySelector('#uf-usuario').value.trim().toLowerCase(),
      nombre: m.body.querySelector('#uf-nombre').value.trim(),
      password: m.body.querySelector('#uf-password').value,
      rol: rolSeleccionado,
      permisos: usuario?.permisos || (rolSeleccionado === 'cajero' ? { ...Repo.PERMISOS_CAJERO_DEFAULT } : {}),
      activo: m.body.querySelector('#uf-activo').checked,
      creado: usuario?.creado,
    };

    try {
      await Repo.guardar(obj);
      Toast.ok(id ? 'Usuario actualizado' : 'Usuario creado');
      m.cerrar();
      render(_contenedor);
    } catch (err) {
      console.error(err);
      errBox.textContent = err.message || 'Error al guardar';
      errBox.style.display = 'block';
    }
  };
}

// ============================================================
//  EDITOR DE PERMISOS DEL CAJERO
// ============================================================

async function abrirEditorPermisos(id) {
  const usuario = _usuarios.find((u) => u.id === id);
  if (!usuario) return;
  const permisos = { ...Repo.PERMISOS_CAJERO_DEFAULT, ...(usuario.permisos || {}) };

  const grupos = {
    'Ventas': ['ventas.crear', 'ventas.editar', 'ventas.eliminar'],
    'Productos': ['productos.crear', 'productos.editar', 'productos.eliminar'],
    'Clientes': ['clientes.crear', 'clientes.editar', 'clientes.eliminar'],
    'Compras': ['compras.crear', 'compras.editar', 'compras.eliminar'],
    'Gastos': ['gastos.crear', 'gastos.editar', 'gastos.eliminar'],
    'Reportes y Caja': ['reportes.ver', 'cierre.ver'],
    'Sistema (requiere admin)': ['usuarios.gestionar', 'config.editar', 'datos.borrar'],
  };

  const contenido = `
    <div style="color:#64748b;font-size:13px;margin-bottom:14px">
      Configura qué puede hacer <b style="color:#0f172a">${esc(usuario.nombre)}</b> (<code style="background:#f1f5f9;padding:2px 6px;border-radius:5px;font-family:'JetBrains Mono',ui-monospace,monospace">${esc(usuario.usuario)}</code>).
      Las acciones desmarcadas requerirán el código de autorización del admin.
    </div>

    <div style="display:flex;flex-direction:column;gap:14px;max-height:55vh;overflow-y:auto;padding-right:6px">
      ${Object.entries(grupos).map(([grupo, keys]) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:8px">${esc(grupo)}</div>
          <div style="display:grid;gap:7px;grid-template-columns:1fr 1fr">
            ${keys.map((k) => `
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;cursor:pointer">
                <input class="perm-toggle" data-key="${esc(k)}" type="checkbox" ${permisos[k] ? 'checked' : ''} style="width:15px;height:15px">
                ${esc(Repo.PERMISOS[k] || k)}
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>

    <div style="display:flex;gap:10px;margin-top:16px">
      <button id="perm-cancelar"
        style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="perm-guardar"
        style="flex:1.2;padding:11px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">💾 Guardar permisos</button>
    </div>
  `;

  const m = Modal.abrir({
    titulo: `🔧 Permisos de ${usuario.nombre}`,
    contenido,
    ancho: 'lg',
  });

  m.body.querySelector('#perm-cancelar').onclick = () => m.cerrar();
  m.body.querySelector('#perm-guardar').onclick = async () => {
    const nuevos = {};
    m.body.querySelectorAll('.perm-toggle').forEach((cb) => {
      nuevos[cb.dataset.key] = cb.checked;
    });
    try {
      await Repo.guardar({ ...usuario, permisos: nuevos });
      Toast.ok('Permisos actualizados');
      m.cerrar();
      _usuarios = await Repo.listar();
    } catch (err) {
      console.error(err);
      Toast.error(err.message || 'No se pudo guardar');
    }
  };
}

// ============================================================
//  CAMBIAR CÓDIGO DE AUTORIZACIÓN
// ============================================================

function cambiarCodigo() {
  const contenido = `
    <div style="text-align:center;margin-bottom:14px;color:#64748b;font-size:13px">
      Define el nuevo código que el admin entregará a los cajeros para autorizar acciones restringidas.
    </div>
    <input id="codigo-nuevo" type="text" inputmode="numeric" placeholder="Ej: 1094" value="${esc(_codigoAdmin)}" maxlength="10"
      style="width:100%;padding:14px 16px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:24px;font-weight:800;font-family:'JetBrains Mono',ui-monospace,monospace;outline:none;box-sizing:border-box;text-align:center;letter-spacing:.3em" />
    <div id="codigo-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;color:#991b1b;font-size:12.5px;margin-top:8px;text-align:center"></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button id="codigo-cancelar"
        style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="codigo-guardar"
        style="flex:1.2;padding:11px;background:#a16207;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">💾 Guardar código</button>
    </div>
  `;
  const m = Modal.abrir({ titulo: '🔑 Cambiar código de autorización', contenido, ancho: 'sm' });
  const inp = m.body.querySelector('#codigo-nuevo');
  const err = m.body.querySelector('#codigo-error');
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
  m.body.querySelector('#codigo-cancelar').onclick = () => m.cerrar();
  m.body.querySelector('#codigo-guardar').onclick = async () => {
    try {
      const nuevo = await Repo.guardarCodigoAdmin(inp.value);
      _codigoAdmin = nuevo;
      _contenedor.querySelector('#codigo-actual').textContent = nuevo;
      Toast.ok('Código actualizado');
      m.cerrar();
    } catch (e) {
      err.textContent = e.message || 'Error al guardar';
      err.style.display = 'block';
    }
  };
}

async function borrarUsuario(id) {
  const u = _usuarios.find((x) => x.id === id);
  if (!u) return;
  const ok = await Confirm.peligro(
    `¿Eliminar al usuario "${u.nombre}" (${u.usuario})?`,
    { titulo: 'Eliminar usuario', textoConfirmar: '🗑️ Eliminar' },
  );
  if (!ok) return;
  try {
    await Repo.eliminar(id);
    Toast.ok('Usuario eliminado');
    render(_contenedor);
  } catch (err) {
    Toast.error(err.message || 'No se pudo eliminar');
  }
}
