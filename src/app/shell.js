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
  { ruta: 'dashboard', etiqueta: 'Inicio',         icono: 'home',          feature: 'dashboard' },
  { ruta: 'ventas',    etiqueta: 'Vender',         icono: 'shopping-cart', feature: 'ventas' },
  { ruta: 'facturas',  etiqueta: 'Facturas',       icono: 'receipt',       feature: 'facturas' },
  { ruta: 'clientes',  etiqueta: 'Clientes',       icono: 'users',         feature: 'clientes' },
  { ruta: 'productos', etiqueta: 'Productos',      icono: 'package',       feature: 'productos' },
  { ruta: 'compras',   etiqueta: 'Compras',        icono: 'truck',         feature: 'compras' },
  { ruta: 'gastos',    etiqueta: 'Gastos',         icono: 'wallet',        feature: 'gastos' },
  { ruta: 'reportes',  etiqueta: 'Reportes',       icono: 'bar-chart-3',   feature: 'reportes' },
  { ruta: 'cierre',    etiqueta: 'Cierre de Caja', icono: 'shield-check',  feature: 'cierreCaja' },
  { ruta: 'config',    etiqueta: 'Configuración',  icono: 'settings',      feature: 'configuracion', soloAdmin: true },
  { ruta: 'usuarios',  etiqueta: 'Usuarios',       icono: 'user-cog',      feature: 'dashboard',     soloAdmin: true },
];

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
    grid-template-columns: 240px 1fr;
    height: 100vh;
    width: 100vw;
    background: #fafafa;
    font-family: Inter, system-ui, sans-serif;
    color: #0f172a;
    overflow: hidden;
  `;

  // ============================================================
  //  SIDEBAR IZQUIERDO
  // ============================================================
  const sidebar = document.createElement('aside');
  sidebar.style.cssText = `
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  `;

  // ============================================================
  //  Header del sidebar: logo + nombre del negocio
  // ============================================================
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px 18px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    gap: 12px;
  `;

  const logo = document.createElement('div');
  logo.style.cssText = `
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: linear-gradient(135deg, ${branding.primary}, ${branding.primaryDark});
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    flex-shrink: 0;
    box-shadow: 0 4px 8px -2px ${branding.primary}40;
  `;
  logo.textContent = (branding.appName || 'P').charAt(0).toUpperCase();
  header.appendChild(logo);

  const tituloBox = document.createElement('div');
  tituloBox.style.cssText = `flex: 1; min-width: 0;`;

  const tituloEl = document.createElement('div');
  tituloEl.textContent = branding.appName || 'PosPunto';
  tituloEl.style.cssText = `
    font-weight: 600;
    font-size: 15px;
    line-height: 1.2;
    color: #0f172a;
    letter-spacing: -0.01em;
  `;
  tituloBox.appendChild(tituloEl);

  const subEl = document.createElement('div');
  subEl.textContent = negocio.nombre || '';
  subEl.style.cssText = `
    font-size: 12px;
    color: #94a3b8;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  tituloBox.appendChild(subEl);

  header.appendChild(tituloBox);

  // Badge de estado realtime (punto verde/gris/rojo)
  const badge = document.createElement('div');
  badge.id = 'rt-badge';
  badge.title = 'Sincronización en tiempo real';
  badge.style.cssText = `
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #cbd5e1;
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
        badge.style.background = '#15803d';
        badge.style.boxShadow = '0 0 0 3px rgba(21,128,61,.18)';
        badge.title = `🟢 En vivo · ${estado.tablas.length}/${estado.total} tablas conectadas`;
      } else {
        badge.style.background = '#cbd5e1';
        badge.style.boxShadow = 'none';
        badge.title = '⚪ Sin conexión en vivo';
      }
    });
  } catch (e) { /**/ }

  // ============================================================
  //  Menú de navegación
  // ============================================================
  const nav = document.createElement('nav');
  nav.style.cssText = `
    flex: 1;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  _enlaces.clear();

  MODULOS.forEach((mod) => {
    // Solo mostrar módulos cuya feature está activa
    if (!isFeatureEnabled(mod.feature)) return;
    // Ocultar módulos soloAdmin si el usuario no es admin
    if (mod.soloAdmin && !Auth.esAdmin()) return;

    const btn = document.createElement('button');
    btn.dataset.ruta = mod.ruta;
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 10px 14px;
      background: transparent;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #475569;
      font-family: inherit;
      text-align: left;
      transition: background .15s, color .15s;
    `;

    // Ícono Lucide (será reemplazado por SVG después)
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
        btn.style.background = '#f1f5f9';
        btn.style.color = '#0f172a';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('activo')) {
        btn.style.background = 'transparent';
        btn.style.color = '#475569';
      }
    });

    btn.addEventListener('click', () => {
      Router.navegar(mod.ruta);
    });

    _enlaces.set(mod.ruta, btn);
    nav.appendChild(btn);
  });

  sidebar.appendChild(nav);

  // ============================================================
  //  Footer del sidebar
  // ============================================================
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 10px 14px 16px;
    border-top: 1px solid #f1f5f9;
    font-size: 11px;
    color: #94a3b8;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  `;
  const u = Auth.usuarioActual();
  const inicial = u?.nombre ? u.nombre.trim().charAt(0).toUpperCase() : '?';
  const colorRol = u?.rol === 'admin' ? { bg: '#eef2ff', fg: '#4338ca' } : { bg: '#fef3c7', fg: '#92400e' };
  footer.innerHTML = `
    ${u ? `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px">
        <div style="width:36px;height:36px;border-radius:9px;background:${colorRol.bg};color:${colorRol.fg};display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:800;font-size:15px;flex-shrink:0">${inicial}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:Inter,sans-serif;font-weight:700;font-size:13px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.nombre}</div>
          <div style="font-family:Inter,sans-serif;font-size:11px;color:${colorRol.fg};font-weight:600;text-transform:uppercase;letter-spacing:.04em">${u.rol === 'admin' ? '👑 Admin' : '💼 Cajero'}</div>
        </div>
        <button id="btn-logout" title="Cerrar sesión"
          style="background:white;border:1px solid #e2e8f0;border-radius:7px;padding:6px 8px;cursor:pointer;color:#dc2626;display:flex;align-items:center;justify-content:center">
          <i data-lucide="log-out" style="width:14px;height:14px;stroke-width:2"></i>
        </button>
      </div>
    ` : ''}
    <div>v0.0.0 · Fase 6</div>
    <div style="margin-top:2px">tenant: <span style="color:#475569">${config.supabase.tenantId}</span></div>
  `;
  sidebar.appendChild(footer);

  // Wire-up botón logout
  setTimeout(() => {
    const btnLogout = footer.querySelector('#btn-logout');
    if (btnLogout) {
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
    background: #fafafa;
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
    btn.style.color = '#475569';
  });

  // Marcar el nuevo
  const btn = _enlaces.get(ruta);
  if (btn) {
    btn.classList.add('activo');
    btn.style.background = '#eef2ff';
    btn.style.color = config.branding.primary;
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