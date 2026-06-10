/**
 * modules/usuarios/usuarios.repo.js — Sistema de usuarios y permisos
 *
 * Roles disponibles:
 *   - admin   → todos los permisos, incluido eliminar/editar ventas y crear usuarios
 *   - cajero  → vende, gestiona productos/clientes/compras/gastos, pero
 *               para editar o eliminar ventas requiere un código del admin
 *
 * Default al primer arranque:
 *   - admin / admin123    (rol admin)
 *   - código autorización: 1094  (configurable desde la UI)
 *
 * NOTA: los passwords se guardan en texto plano en IndexedDB. Para un POS
 * de mostrador esto es aceptable; en producción real conviene cifrarlos.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import { uid } from '../../core/strings.js';
import { nowISO } from '../../core/dates.js';

const TABLA = 'usuarios';
const TABLA_KV = 'kvs';
const KEY_CODIGO_ADMIN = 'codigo_autorizacion';
const DEFAULT_CODIGO = '1094';

// ============================================================
//  PERMISOS
// ============================================================

/**
 * Lista de todos los permisos del sistema. El admin los tiene todos
 * automáticamente. El cajero puede tener subset configurable.
 */
export const PERMISOS = {
  // Ventas
  'ventas.crear':      'Crear ventas',
  'ventas.editar':     'Editar ventas',
  'ventas.eliminar':   'Eliminar ventas',
  // Productos
  'productos.crear':   'Crear productos',
  'productos.editar':  'Editar productos',
  'productos.eliminar':'Eliminar productos',
  // Clientes
  'clientes.crear':    'Crear clientes',
  'clientes.editar':   'Editar clientes',
  'clientes.eliminar': 'Eliminar clientes',
  // Compras
  'compras.crear':     'Registrar compras',
  'compras.editar':    'Editar compras',
  'compras.eliminar':  'Eliminar compras',
  // Gastos
  'gastos.crear':      'Registrar gastos',
  'gastos.editar':     'Editar gastos',
  'gastos.eliminar':   'Eliminar gastos',
  // Reportes
  'reportes.ver':      'Ver reportes',
  'cierre.ver':        'Ver/generar cierre de caja',
  // Sistema (solo admin por defecto)
  'usuarios.gestionar':'Gestionar usuarios y permisos',
  'config.editar':     'Editar configuración del negocio',
  'datos.borrar':      'Borrar datos del sistema',
};

/**
 * Permisos por defecto para el rol cajero.
 * Puede vender, registrar compras/gastos/clientes/productos pero
 * NO puede editar ni eliminar ventas (necesita código del admin).
 */
export const PERMISOS_CAJERO_DEFAULT = {
  'ventas.crear':       true,
  'ventas.editar':      false,
  'ventas.eliminar':    false,
  'productos.crear':    true,
  'productos.editar':   true,
  'productos.eliminar': false,
  'clientes.crear':     true,
  'clientes.editar':    true,
  'clientes.eliminar':  false,
  'compras.crear':      true,
  'compras.editar':     false,
  'compras.eliminar':   false,
  'gastos.crear':       true,
  'gastos.editar':      false,
  'gastos.eliminar':    false,
  'reportes.ver':       true,
  'cierre.ver':         true,
  'usuarios.gestionar': false,
  'config.editar':      false,
  'datos.borrar':       false,
};

// ============================================================
//  API USUARIOS
// ============================================================

/**
 * Asegura que exista al menos un admin. Si no hay usuarios, crea
 * el admin por defecto.
 *
 * @returns {Promise<void>}
 */
export async function init() {
  // 1) Si Supabase está disponible, descargar usuarios y código de autorización
  //    para que esta máquina vea las cuentas creadas en otra terminal.
  if (Supa.isReady()) {
    try {
      const remotos = await Supa.selectAll(TABLA);
      for (const u of remotos) {
        // Guardar local sin re-subir (evita loop)
        await db.put(TABLA, u);
      }
      const codigoRemoto = await Supa.selectOne(TABLA_KV, KEY_CODIGO_ADMIN);
      if (codigoRemoto) {
        await db.put(TABLA_KV, codigoRemoto);
      }
    } catch (err) {
      console.warn('No se pudo bajar usuarios de la nube:', err);
    }
  }

  // 2) Si después de descargar todavía no hay usuarios, crear admin por defecto
  const todos = await db.getAll(TABLA);
  if (todos.length === 0) {
    const admin = {
      id: uid(),
      usuario: 'admin',
      nombre: 'Administrador',
      password: 'admin123',
      rol: 'admin',
      permisos: {},          // admin tiene todos implícitos
      activo: true,
      creado: nowISO(),
    };
    // Subir a la nube también (la primera máquina lo crea)
    await Sync.guardar(TABLA, admin);
    console.log('🔐 Admin por defecto creado: admin / admin123');
  }
}

export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => {
    // Admins primero, luego por nombre
    if (a.rol !== b.rol) return a.rol === 'admin' ? -1 : 1;
    return String(a.nombre || '').localeCompare(String(b.nombre || ''));
  });
  return items;
}

export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

export async function buscarPorUsuario(usuario) {
  const todos = await db.getAll(TABLA);
  const u = (usuario || '').toLowerCase().trim();
  return todos.find((x) => String(x.usuario || '').toLowerCase().trim() === u) || null;
}

export async function guardar(datos) {
  const item = {
    id: datos.id || uid(),
    usuario: String(datos.usuario || '').trim().toLowerCase(),
    nombre: String(datos.nombre || '').trim(),
    password: String(datos.password || '').trim(),
    rol: datos.rol === 'admin' ? 'admin' : 'cajero',
    permisos: datos.permisos || {},
    activo: datos.activo !== false,
    creado: datos.creado || nowISO(),
  };
  if (!item.usuario) throw new Error('El nombre de usuario es obligatorio');
  if (!item.nombre) throw new Error('El nombre completo es obligatorio');
  if (!item.password || item.password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');

  // Validar que no exista otro usuario con el mismo nombre de usuario
  const existente = await buscarPorUsuario(item.usuario);
  if (existente && existente.id !== item.id) {
    throw new Error('Ese nombre de usuario ya está en uso');
  }

  // Guardar local + sincronizar a la nube
  await Sync.guardar(TABLA, item);
  return item;
}

export async function eliminar(id) {
  const u = await obtener(id);
  if (!u) throw new Error('Usuario no encontrado');
  // No permitir eliminar el último admin activo
  if (u.rol === 'admin') {
    const todos = await db.getAll(TABLA);
    const otrosAdminsActivos = todos.filter((x) => x.id !== id && x.rol === 'admin' && x.activo);
    if (otrosAdminsActivos.length === 0) {
      throw new Error('No se puede eliminar el último administrador activo');
    }
  }
  await Sync.borrar(TABLA, id);
}

// ============================================================
//  CÓDIGO DE AUTORIZACIÓN DEL ADMIN
// ============================================================

export async function leerCodigoAdmin() {
  try {
    const v = await db.get(TABLA_KV, KEY_CODIGO_ADMIN);
    return v?.valor || DEFAULT_CODIGO;
  } catch (e) {
    return DEFAULT_CODIGO;
  }
}

export async function guardarCodigoAdmin(codigo) {
  const v = String(codigo || '').trim();
  if (!v || v.length < 3) throw new Error('El código debe tener al menos 3 caracteres');
  // Sincronizar con la nube para que se propague a otras terminales
  await Sync.guardar(TABLA_KV, { id: KEY_CODIGO_ADMIN, valor: v });
  return v;
}

export async function verificarCodigoAdmin(codigo) {
  const real = await leerCodigoAdmin();
  return String(codigo || '').trim() === String(real).trim();
}
