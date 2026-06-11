import './styles/index.css';
import * as Core from './core/index.js';
import * as Services from './services/index.js';
import * as Components from './components/index.js';
import * as Auth from './services/auth.js';
import * as Realtime from './services/realtime.js';
import * as UsuariosRepo from './modules/usuarios/usuarios.repo.js';
import { mostrarLogin } from './app/login.js';
import { mostrarActivacion } from './app/activacion.js';
import { montarShell, setContenido, marcarActivo } from './app/shell.js';

console.log('🐾 PosPunto arrancando…');

document.addEventListener('DOMContentLoaded', async () => {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    await Services.db.init();
  } catch (err) {
    console.error('❌ Error inicializando IndexedDB:', err);
  }

  // Esperar a que Supabase esté listo antes de inicializar usuarios
  // — así la descarga de la nube SÍ ocurre en lugar de crear admin local
  try {
    const supaListo = await Services.Supa.waitForReady(3000);
    if (supaListo) console.log('☁️ Supabase listo, iniciando sync de usuarios…');
    else console.warn('⚠️ Supabase no respondió en 3s, iniciando solo en modo local');
  } catch (e) { console.warn('waitForReady error:', e); }

  // ACTIVACIÓN DE TERMINAL: si la nube está protegida con RLS y este
  // computador aún no está autorizado, pedir la cuenta del comercio.
  // Solo ocurre una vez por terminal (la sesión queda guardada).
  try {
    if (Services.Supa.isReady()) {
      const yaActivada = await Services.Supa.sesionDispositivo();
      if (!yaActivada) {
        const acceso = await Services.Supa.probarAcceso();
        if (acceso === 'bloqueado') {
          await mostrarActivacion(app);
        } else if (acceso === 'ok') {
          console.warn('⚠️ La nube acepta conexiones sin activar (RLS desactivado). ' +
            'Para producción ejecuta supabase-seguridad.sql.');
        }
      } else {
        console.log('🔐 Terminal activada (sesión de dispositivo válida)');
      }
    }
  } catch (e) { console.warn('Chequeo de activación falló:', e); }

  // Asegurar que exista al menos un admin (admin / admin123 por defecto)
  try {
    await UsuariosRepo.init();
  } catch (err) {
    console.error('❌ Error inicializando usuarios:', err);
  }

  // Si no hay sesión activa, mostrar pantalla de login
  if (!Auth.estaLogueado()) {
    await mostrarLogin(app);
  }

  // Tras el login, re-sincronizar usuarios desde la nube (por si en otra
  // terminal alguien creó nuevos usuarios o cambió el código de admin)
  try {
    if (Services.Supa.isReady()) {
      await UsuariosRepo.init();
    }
  } catch (err) {
    console.warn('No se pudo re-sincronizar usuarios:', err);
  }

  // Iniciar Realtime — suscribirse a cambios en la nube
  try {
    Realtime.iniciar();
  } catch (err) {
    console.warn('No se pudo iniciar Realtime:', err);
  }

  // Subir operaciones que quedaron pendientes de sesiones anteriores
  // (ventas/cambios hechos sin internet que aún no llegaron a la nube)
  try {
    if (Services.Sync.pendientes() > 0) {
      Services.Sync.flushPendientes()
        .then((r) => { if (r.exitos > 0) console.log(`☁️ ${r.exitos} operación(es) pendiente(s) sincronizadas`); })
        .catch((e) => console.warn('Flush inicial falló:', e));
    }
  } catch (err) { console.warn('No se pudo hacer flush inicial:', err); }

  montarShell(app);

  // Registrar rutas
  // Dashboard: módulo real
  Core.Router.registrar('dashboard', async () => {
    const mod = await import('./modules/dashboard/dashboard.js');
    await mod.montar();
  });

  // Ventas: módulo real
  Core.Router.registrar('ventas', async () => {
    const mod = await import('./modules/ventas/ventas.js');
    await mod.montar();
  });

  // Facturas: módulo real
  Core.Router.registrar('facturas', async () => {
    const mod = await import('./modules/facturas/facturas.js');
    await mod.montar();
  });

  // Clientes: módulo real
  Core.Router.registrar('clientes', async () => {
    const mod = await import('./modules/clientes/clientes.js');
    await mod.montar();
  });

  // Productos: módulo real
  Core.Router.registrar('productos', async () => {
    const mod = await import('./modules/productos/productos.js');
    await mod.montar();
  });

  // Compras: módulo real
  Core.Router.registrar('compras', async () => {
    const mod = await import('./modules/compras/compras.js');
    await mod.montar();
  });
  // Gastos: módulo real
  Core.Router.registrar('gastos', async () => {
    const mod = await import('./modules/gastos/gastos.js');
    await mod.montar();
  });
  // Reportes: módulo real
  Core.Router.registrar('reportes', async () => {
    const mod = await import('./modules/reportes/reportes.js');
    await mod.montar();
  });
  // Cierre de Caja: módulo real
  Core.Router.registrar('cierre', async () => {
    const mod = await import('./modules/cierre/cierre.js');
    await mod.montar();
  });
  // Configuración: módulo real
  Core.Router.registrar('config', async () => {
    const mod = await import('./modules/config/config.js');
    await mod.montar();
  });

  // Usuarios: módulo real (solo admin)
  Core.Router.registrar('usuarios', async () => {
    const mod = await import('./modules/usuarios/usuarios.js');
    await mod.montar();
  });

  Core.Router.iniciar({
    rutaInicial: 'dashboard',
    onCambio: async (ruta) => {
      if (!ruta) return;
      marcarActivo(ruta);

      // Limpiar las suscripciones de Realtime del módulo anterior.
      // Sin esto, vistas como Dashboard seguirían escuchando cambios
      // remotos y re-renderizando encima del módulo nuevo cuando el
      // usuario crea un producto/cliente en otra pantalla.
      try { Realtime.detenerVistaActual(); } catch (e) { /**/ }

      const cargador = Core.Router.obtenerCargador(ruta);
      if (cargador) {
        await cargador();
      } else {
        mostrarPlaceholder('No encontrado', 'circle-help', `La ruta "${ruta}" no existe.`);
      }
    },
  });

  console.log('✅ PosPunto listo — todos los módulos cargados');
});

function mostrarPlaceholder(titulo, icono, descripcion) {
  setContenido(`
    <div style="padding:40px 48px;max-width:980px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
        <i data-lucide="${icono}" style="width:32px;height:32px;stroke-width:1.75;color:#4f46e5"></i>
        <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.025em;margin:0;color:#0f172a">${titulo}</h1>
      </div>
      <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 28px">
        ${descripcion || 'Este módulo se construirá en los próximos pasos de la Fase 6.'}
      </p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;display:flex;align-items:center;gap:14px">
        <div style="width:42px;height:42px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center">
          <i data-lucide="construction" style="width:22px;height:22px;color:#d97706;stroke-width:1.75"></i>
        </div>
        <div>
          <div style="font-weight:600;color:#0f172a;margin-bottom:2px">En construcción</div>
          <div style="font-size:13.5px;color:#64748b">Mientras tanto, podés navegar entre módulos usando el sidebar a la izquierda.</div>
        </div>
      </div>
    </div>
  `);
}

