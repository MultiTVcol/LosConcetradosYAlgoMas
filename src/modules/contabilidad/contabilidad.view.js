/**
 * modules/contabilidad/contabilidad.view.js — Contabilidad
 *
 * Marco de la pantalla (encabezado + pestañas). Cada pestaña vive en su
 * propio archivo dentro de ./tabs y exporta `render(el, ctx)`:
 *   - Resumen, Asientos (y comprobantes manuales), Libros (mayor y
 *     auxiliar), Estados financieros, Cierres (mes y año), Activos fijos,
 *     Plan de cuentas, Configuración de cuentas y Saldos iniciales.
 */

import * as Sync from '../../services/sync.js';
import * as Motor from '../../services/motor-contable.js';
import * as Servicio from './contabilidad.service.js';
import * as PUC from './puc.repo.js';
import { refrescarIconos } from '../../app/shell.js';
import { pageHeader, badge } from '../../app/ui-kit.js';
import { aviso } from './ui.js';

const TABS = [
  { id: 'resumen',   label: 'Resumen',             icono: 'gauge',           carga: () => import('./tabs/resumen.js') },
  { id: 'asientos',  label: 'Asientos',            icono: 'list',            carga: () => import('./tabs/asientos.js') },
  { id: 'libros',    label: 'Libros',              icono: 'book-open',       carga: () => import('./tabs/libros.js') },
  { id: 'estados',   label: 'Estados financieros', icono: 'file-bar-chart',  carga: () => import('./tabs/estados.js') },
  { id: 'cierres',   label: 'Cierres',             icono: 'lock',            carga: () => import('./tabs/cierres.js') },
  { id: 'activos',   label: 'Activos fijos',       icono: 'armchair',        carga: () => import('./tabs/activos.js') },
  { id: 'puc',       label: 'Plan de cuentas',     icono: 'list-tree',       carga: () => import('./tabs/plan.js') },
  { id: 'cuentas',   label: 'Configuración',       icono: 'settings-2',      carga: () => import('./tabs/cuentas.js') },
  { id: 'apertura',  label: 'Saldos iniciales',    icono: 'flag',            carga: () => import('./tabs/apertura.js') },
];

let _c = null;
let _tab = 'resumen';
let _off = null;
const ctx = { ocupado: false, repintar: () => pintar(), irA: (tab) => { _tab = tab; pintar(); } };

export async function render(contenedor) {
  _c = contenedor;
  PUC.invalidarCache();
  if (_off) _off();
  _off = Servicio.onCambio(() => { if (!ctx.ocupado && _c?.isConnected && _tab === 'resumen') pintar(); });
  await pintar();
}

async function pintar() {
  PUC.invalidarCache(); // por si otra caja cambió el plan de cuentas
  const cfg = await Motor.config();
  ctx.cfg = cfg;
  _c.innerHTML = `
    <div style="padding:32px 40px;max-width:1280px">
      ${pageHeader({
        icono: 'book-open-check',
        titulo: 'Contabilidad',
        descripcion: 'Cada venta, compra, gasto y abono crea su asiento solo, con partida doble.',
        acciones: cfg.activa ? badge('Activa', 'success') : badge('Apagada', 'neutral'),
      })}
      ${Sync.esSoloLectura() ? aviso('🧪 <b>Modo prueba:</b> la nube es solo lectura. Lo que hagas aquí queda en este navegador y no llega a la tienda.', 'warn') : ''}
      <div style="display:flex;gap:2px;border-bottom:1px solid #EADFD0;margin-bottom:22px;flex-wrap:wrap">
        ${TABS.map((t) => `
          <button data-tab="${t.id}" style="display:flex;align-items:center;gap:7px;padding:10px 12px;border:0;background:none;cursor:pointer;font:inherit;font-size:13.5px;font-weight:600;
            color:${_tab === t.id ? '#2A1A10' : '#7D6858'};border-bottom:2px solid ${_tab === t.id ? '#EE7623' : 'transparent'};margin-bottom:-1px">
            <i data-lucide="${t.icono}" style="width:15px;height:15px"></i>${t.label}
          </button>`).join('')}
      </div>
      <div id="ct-cuerpo"><div style="color:#7D6858;font-size:14px">Cargando…</div></div>
    </div>
  `;
  _c.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => ctx.irA(b.dataset.tab)));
  refrescarIconos(_c);

  const cuerpo = _c.querySelector('#ct-cuerpo');
  const tab = TABS.find((t) => t.id === _tab) || TABS[0];
  try {
    const mod = await tab.carga();
    await mod.render(cuerpo, ctx);
  } catch (e) {
    console.error('Contabilidad:', e);
    cuerpo.innerHTML = aviso(`No se pudo cargar esta pestaña: ${e.message || e}`, 'error');
  }
  refrescarIconos(cuerpo);
}
