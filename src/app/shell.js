/**
 * app/shell.js — App Shell (esqueleto visual de la aplicación)
 *
 * Renderiza la estructura principal que siempre está visible:
 *   - Sidebar izquierdo con identidad del negocio + menú de navegación
 *   - Área de contenido derecha donde se monta el módulo activo
 *
 * Los íconos del sidebar usan Lucide (cargado vía CDN en index.html).
 * Los módulos visibles dependen de qué features están activas en config.
 *
 * Uso típico (desde main.js):
 *   import { montarShell, setContenido, marcarActivo } from './app/shell.js';
 *
 *   montarShell(document.getElementById('app'));
 *   setContenido('<div>Hola</div>');
 *   marcarActivo('productos');
 */

import { config, isFeatureEnabled, getBranding } from '../services/config.js';
import * as Auth from '../services/auth.js';
import * as Realtime from '../services/realtime.js';
import { Router } from '../core/index.js';

// ============================================================
//  DEFINICIÓN DE LOS MÓDULOS DEL POS
// ============================================================
/**
 * Lista de módulos disponibles. El orden acá define el orden del sidebar.
 *
 * Cada módulo tiene:
 *   - ruta: identificador para el router (ej: 'ventas')
 *   - etiqueta: nombre visible en el sidebar
 *   - icono: nombre del ícono Lucide (ver https://lucide.dev/icons)
 *   - feature: nombre de la feature en config.features que lo habilita
 *
 * Orden tomado del legacy PetPOS/PosPunto real.
 */
const MODULOS = [
  { ruta: 'dashboard', etiqueta: 'Inicio',          icono: 'layout-dashboard', feature: 'dashboard' },
  { ruta: 'ventas',    etiqueta: 'Punto de Venta',  icono: 'shopping-cart',    feature: 'ventas' },
  { ruta: 'facturas',  etiqueta: 'Facturas',        icono: 'receipt',          feature: 'facturas' },
  { ruta: 'cuentas-cobrar', etiqueta: 'Cuentas por cobrar', icono: 'hand-coins', feature: 'ventas' },
  { ruta: 'clientes',  etiqueta: 'Clientes',        icono: 'users',            feature: 'clientes' },
  { ruta: 'productos', etiqueta: 'Productos',       icono: 'package',          feature: 'productos' },
  { ruta: 'inventario',etiqueta: 'Inventario',      icono: 'boxes',            feature: 'productos' },
  { ruta: 'compras',   etiqueta: 'Compras',         icono: 'truck',            feature: 'compras' },
  { ruta: 'facturas-compra', etiqueta: 'Facturas de compra', icono: 'receipt-text', feature: 'compras' },
  { ruta: 'gastos',    etiqueta: 'Gastos',          icono: 'wallet',           feature: 'gastos' },
  { ruta: 'cierre',    etiqueta: 'Cierre de Caja',  icono: 'shield-check',     feature: 'cierreCaja' },
  { ruta: 'reportes',  etiqueta: 'Reportes',        icono: 'bar-chart-3',      feature: 'reportes' },
  { ruta: 'config',    etiqueta: 'Configuración',   icono: 'settings',         feature: 'configuracion', soloAdmin: true },
  { ruta: 'usuarios',  etiqueta: 'Usuarios',        icono: 'user-cog',         feature: 'dashboard',     soloAdmin: true },
];

/**
 * Agrupación del sidebar por categorías (estilo ERP empresarial).
 * Cada grupo referencia módulos por su `ruta`; el feature-gating y el
 * control de admin se siguen resolviendo contra MODULOS.
 */
const GRUPOS = [
  { titulo: null,         rutas: ['dashboard'] },
  { titulo: 'Ventas',     rutas: ['ventas', 'facturas', 'cuentas-cobrar', 'clientes'] },
  { titulo: 'Inventario', rutas: ['productos', 'inventario', 'compras', 'facturas-compra'] },
  { titulo: 'Finanzas',   rutas: ['gastos', 'cierre', 'reportes'] },
  { titulo: 'Sistema',    rutas: ['usuarios', 'config'] },
];

const MODULO_POR_RUTA = MODULOS.reduce((m, x) => { m[x.ruta] = x; return m; }, {});

/* Paleta del sidebar oscuro (corporativo, estilo Linear/Stripe) */
const SB = {
  bg:        '#111827',  // gray-900
  hover:     '#1F2937',  // gray-800
  active:    '#2563EB',  // primary
  text:      '#D1D5DB',  // gray-300
  textDim:   '#9CA3AF',  // gray-400
  section:   '#6B7280',  // gray-500
  border:    'rgba(255,255,255,.07)',
};

// ============================================================
//  REFERENCIAS A ELEMENTOS DEL DOM (se llenan al montar)
// ============================================================

let _sidebar = null;
let _contenido = null;
let _enlaces = new Map(); // ruta → elemento <button>

// ============================================================
//  HELPER: renderizar íconos Lucide
// ============================================================

/**
 * Refresca los íconos Lucide dentro de un elemento.
 * Lucide procesa <i data-lucide="nombre"> y los reemplaza por SVG.
 */
function renderLucide(root) {
  if (typeof window === 'undefined' || !window.lucide || !window.lucide.createIcons) return;
  try {
    window.lucide.createIcons({ root: root || document.body });
  } catch (e) {
    console.warn('No se pudieron renderizar íconos Lucide:', e);
  }
}

// ============================================================
//  CONSTRUCTOR DEL SHELL
// ============================================================

/**
 * Monta el shell completo dentro de un contenedor.
 * Reemplaza todo el contenido del contenedor.
 *
 * @param {HTMLElement} contenedor - Elemento donde se monta (típicamente #app)
 */
export function montarShell(contenedor) {
  if (!contenedor) throw new Error('montarShell: se requiere un contenedor');

  const branding = getBranding();
  const negocio = config.negocio;

  // Limpiar contenedor y aplicar layout
  contenedor.innerHTML = '';
  contenedor.style.cssText = `
    display: grid;
    grid-template-columns: 248px 1fr;
    height: 100vh;
    width: 100vw;
    background: #eff3fb;
    font-family: Inter, system-ui, sans-serif;
    color: #111827;
    overflow: hidden;
  `;

  // ============================================================
  //  SIDEBAR IZQUIERDO (oscuro, agrupado, estilo ERP)
  // ============================================================
  const sidebar = document.createElement('aside');
  sidebar.style.cssText = `
    background: ${SB.bg};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `;

  // ---- Header: logo + identidad del producto ----
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px 18px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid ${SB.border};
  `;

  const logo = document.createElement('div');
  logo.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: ${SB.active};
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 19px;
    flex-shrink: 0;
    box-shadow: 0 4px 12px -2px rgba(37,99,235,.45);
  `;
  logo.textContent = (branding.appName || 'P').charAt(0).toUpperCase();
  header.appendChild(logo);

  const tituloBox = document.createElement('div');
  tituloBox.style.cssText = `flex: 1; min-width: 0;`;

  const tituloEl = document.createElement('div');
  tituloEl.textContent = `${branding.appName || 'PosPunto'} ERP`;
  tituloEl.style.cssText = `
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
    color: #ffffff;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  tituloBox.appendChild(tituloEl);

  const subEl = document.createElement('div');
  subEl.textContent = 'Gestión Empresarial';
  subEl.style.cssText = `
    font-size: 11.5px;
    color: ${SB.textDim};
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  tituloBox.appendChild(subEl);

  header.appendChild(tituloBox);

  // Badge de estado realtime (punto verde/gris)
  const badge = document.createElement('div');
  badge.id = 'rt-badge';
  badge.title = 'Sincronización en tiempo real';
  badge.style.cssText = `
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #4b5563;
    flex-shrink: 0;
    transition: background .3s ease, box-shadow .3s ease;
  `;
  header.appendChild(badge);

  sidebar.appendChild(header);

  // Actualizar badge según estado de Realtime
  try {
    Realtime.onEstadoChange((estado) => {
      if (!badge.isConnected) return;
      if (estado.activo && estado.tablas.length > 0) {
        badge.style.background = '#22c55e';
        badge.style.boxShadow = '0 0 0 3px rgba(34,197,94,.20)';
        badge.title = `En vivo · ${estado.tablas.length}/${estado.total} tablas conectadas`;
      } else {
        badge.style.background = '#4b5563';
        badge.style.boxShadow = 'none';
        badge.title = 'Sin conexión en vivo';
      }
    });
  } catch (e) { /**/ }

  // ---- Navegación agrupada por categorías ----
  const nav = document.createElement('nav');
  nav.style.cssText = `
    flex: 1;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  `;

  _enlaces.clear();

  GRUPOS.forEach((grupo) => {
    // Resolver los módulos visibles de este grupo
    const visibles = grupo.rutas
      .map((r) => MODULO_POR_RUTA[r])
      .filter((mod) => mod && isFeatureEnabled(mod.feature) && !(mod.soloAdmin && !Auth.esAdmin()));

    if (visibles.length === 0) return;

    // Encabezado de sección (salvo el grupo sin título: dashboard)
    if (grupo.titulo) {
      const sec = document.createElement('div');
      sec.textContent = grupo.titulo;
      sec.style.cssText = `
        padding: 14px 12px 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: ${SB.section};
      `;
      nav.appendChild(sec);
    }

    visibles.forEach((mod) => {
      const btn = document.createElement('button');
      btn.dataset.ruta = mod.ruta;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 9px 12px;
        background: transparent;
        border: 0;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13.5px;
        font-weight: 500;
        color: ${SB.text};
        font-family: inherit;
        text-align: left;
        transition: background .15s, color .15s;
      `;

      const iconoEl = document.createElement('i');
      iconoEl.setAttribute('data-lucide', mod.icono);
      iconoEl.style.cssText = `
        width: 18px;
        height: 18px;
        stroke-width: 2;
        flex-shrink: 0;
        display: inline-block;
        vertical-align: middle;
      `;
      btn.appendChild(iconoEl);

      const textoEl = document.createElement('span');
      textoEl.textContent = mod.etiqueta;
      btn.appendChild(textoEl);

      btn.addEventListener('mouseenter', () => {
        if (!btn.classList.contains('activo')) {
          btn.style.background = SB.hover;
          btn.style.color = '#ffffff';
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.classList.contains('activo')) {
          btn.style.background = 'transparent';
          btn.style.color = SB.text;
        }
      });

      btn.addEventListener('click', () => {
        Router.navegar(mod.ruta);
      });

      _enlaces.set(mod.ruta, btn);
      nav.appendChild(btn);
    });
  });

  sidebar.appendChild(nav);

  // ---- Footer: usuario + sesión ----
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 12px;
    border-top: 1px solid ${SB.border};
  `;
  const u = Auth.usuarioActual();
  const inicial = u?.nombre ? u.nombre.trim().charAt(0).toUpperCase() : '?';
  const esAdminUsr = u?.rol === 'admin';
  const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nombreSeguro = escHtml(u?.nombre);
  const inicialSegura = escHtml(inicial);
  footer.innerHTML = `
    ${u ? `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:${SB.hover};border-radius:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:${SB.active};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${inicialSegura}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nombreSeguro}</div>
          <div style="font-size:11px;color:${SB.textDim};font-weight:500;text-transform:uppercase;letter-spacing:.04em">${esAdminUsr ? 'Administrador' : 'Cajero'}</div>
        </div>
        <button id="btn-logout" title="Cerrar sesión"
          style="background:transparent;border:1px solid ${SB.border};border-radius:8px;padding:7px;cursor:pointer;color:${SB.textDim};display:flex;align-items:center;justify-content:center;transition:color .15s,border-color .15s">
          <i data-lucide="log-out" style="width:15px;height:15px;stroke-width:2"></i>
        </button>
      </div>
    ` : ''}
  `;
  sidebar.appendChild(footer);

  // Wire-up botón logout
  setTimeout(() => {
    const btnLogout = footer.querySelector('#btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('mouseenter', () => { btnLogout.style.color = '#f87171'; btnLogout.style.borderColor = '#f87171'; });
      btnLogout.addEventListener('mouseleave', () => { btnLogout.style.color = SB.textDim; btnLogout.style.borderColor = SB.border; });
      btnLogout.addEventListener('click', () => {
        Auth.logout();
        location.reload();
      });
    }
  }, 0);

  // ============================================================
  //  Área de contenido (donde se montan los módulos)
  // ============================================================
  const main = document.createElement('main');
  main.style.cssText = `
    overflow-y: auto;
    padding: 0;
    background: #eff3fb;
  `;

  contenedor.appendChild(sidebar);
  contenedor.appendChild(main);

  // Guardar referencias
  _sidebar = sidebar;
  _contenido = main;

  // Renderizar todos los íconos Lucide del sidebar
  renderLucide(sidebar);
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Reemplaza el contenido del área principal.
 *
 * @param {string|HTMLElement} contenido - HTML string o elemento DOM
 */
export function setContenido(contenido) {
  if (!_contenido) {
    console.warn('Shell no está montado. Llamá a montarShell() primero.');
    return;
  }
  if (typeof contenido === 'string') {
    _contenido.innerHTML = contenido;
  } else if (contenido instanceof HTMLElement) {
    _contenido.innerHTML = '';
    _contenido.appendChild(contenido);
  } else {
    _contenido.innerHTML = '';
  }
  // Refrescar íconos Lucide en el nuevo contenido
  renderLucide(_contenido);
  // Scroll al inicio cuando cambiamos de módulo
  _contenido.scrollTop = 0;
}

/**
 * Marca un enlace del sidebar como activo (resalta visualmente).
 *
 * @param {string} ruta - Nombre de la ruta a marcar
 */
export function marcarActivo(ruta) {
  // Limpiar el activo anterior
  _enlaces.forEach((btn) => {
    btn.classList.remove('activo');
    btn.style.background = 'transparent';
    btn.style.color = SB.text;
    btn.style.boxShadow = 'none';
  });

  // Marcar el nuevo
  const btn = _enlaces.get(ruta);
  if (btn) {
    btn.classList.add('activo');
    btn.style.background = SB.active;
    btn.style.color = '#ffffff';
    btn.style.boxShadow = '0 4px 12px -3px rgba(37,99,235,.55)';
  }
}

/**
 * Devuelve el contenedor del área principal (por si un módulo lo necesita).
 *
 * @returns {HTMLElement|null}
 */
export function getContenido() {
  return _contenido;
}

/**
 * Re-renderiza los íconos Lucide en el contenido actual.
 * Útil para módulos que inyectan HTML con íconos después del primer render.
 */
export function refrescarIconos(root) {
  renderLucide(root || _contenido);
}

/**
 * Dispara la transición de entrada (fade + slide-up) del área de contenido.
 * Se llama al cambiar de módulo para que el contenido no aparezca "de golpe".
 * Re-arranca la animación quitando la clase, forzando un reflow y volviéndola
 * a poner.
 */
export function animarEntrada() {
  if (!_contenido) return;
  _contenido.classList.remove('mod-enter');
  void _contenido.offsetWidth; // fuerza reflow para reiniciar la animación
  _contenido.classList.add('mod-enter');
}