/**
 * modules/config/config.view.js — Vista del módulo Configuración
 *
 * Replica esencial de renderConfig del legacy con:
 *   - Datos del negocio (nombre, NIT, dirección, teléfono, ciudad, mensajes)
 *   - Lector de código de barras (pistola / manual)
 *   - Impresora predeterminada (preguntar / POS / Carta)
 *   - Sincronización con la nube (estado actual + reintentar)
 *   - Respaldo (export / import JSON)
 *   - Datos del sistema (conteos por entidad)
 */

import * as Repo from './config.repo.js';
import * as PlantillaRepo from '../factura/plantilla.repo.js';
import { html as facturaHTML } from '../factura/factura.html.js';
import { imprimirPOS } from '../../services/printer.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import { config as defaultConfig } from '../../services/config.js';
import { fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { Toast, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';

let _contenedor = null;
let _cfg = null;
let _plantilla = null;

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  _contenedor = contenedor;
  contenedor.innerHTML = htmlCargando();

  _cfg = await Repo.leer();
  _plantilla = await PlantillaRepo.leer();
  const stats = await contarTodo();

  contenedor.innerHTML = htmlLayout(_cfg, _plantilla, stats);
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  actualizarEstadoSync();
  actualizarVistaPreviaTicket();
}

async function contarTodo() {
  return {
    productos: await safeCount('productos'),
    clientes: await safeCount('clientes'),
    ventas: await safeCount('ventas'),
    compras: await safeCount('compras'),
    proveedores: await safeCount('proveedores'),
    gastos: await safeCount('gastos'),
  };
}

async function safeCount(tabla) {
  try { return await db.count(tabla); } catch (e) { return 0; }
}

// ============================================================
//  EVENTOS
// ============================================================

function adjuntarEventos(contenedor) {
  // Guardar datos del negocio
  contenedor.querySelector('#cfg-guardar-negocio')?.addEventListener('click', guardarDatosNegocio);

  // Lector
  contenedor.querySelector('#cfg-lector')?.addEventListener('change', async (e) => {
    _cfg.lector = e.target.value;
    await Repo.guardar(_cfg);
    Toast.ok('Modo lector actualizado');
  });

  // Impresora
  contenedor.querySelector('#cfg-impresora')?.addEventListener('change', async (e) => {
    _cfg.impresoraDefault = e.target.value;
    await Repo.guardar(_cfg);
    Toast.ok('Impresora predeterminada actualizada');
  });

  // Sincronización
  contenedor.querySelector('#cfg-sync-flush')?.addEventListener('click', async () => {
    Toast.info('Reintentando pendientes…');
    try {
      const r = await Sync.flushPendientes();
      Toast.ok(`✅ ${r.exitos} subidos · ${r.fallos} pendientes`);
      actualizarEstadoSync();
    } catch (err) {
      console.error(err);
      Toast.error('Error reintentando');
    }
  });

  // Respaldo
  contenedor.querySelector('#cfg-export-json')?.addEventListener('click', exportarJSON);
  contenedor.querySelector('#cfg-import-json')?.addEventListener('change', importarJSON);

  // Borrar datos
  contenedor.querySelector('#cfg-borrar-confirmar')?.addEventListener('click', borrarSeleccionado);

  // Plantilla de factura
  cablearEditorPlantilla(contenedor);
}

// ============================================================
//  EDITOR DE PLANTILLA DE FACTURA
// ============================================================

const PL_INPUTS = ['pl-fuente', 'pl-tam', 'pl-line', 'pl-sep', 'pl-ancho', 'pl-mayus', 'pl-neg', 'pl-tituloDoc', 'pl-msg1', 'pl-msg2'];

function cablearEditorPlantilla(contenedor) {
  const refrescar = () => {
    actualizarPlantillaDesdeForm();
    actualizarVistaPreviaTicket();
  };

  PL_INPUTS.forEach((id) => {
    const el = contenedor.querySelector(`#${id}`);
    if (el) el.addEventListener('input', refrescar);
    if (el) el.addEventListener('change', refrescar);
  });
  contenedor.querySelectorAll('.pl-toggle').forEach((el) => {
    el.addEventListener('change', refrescar);
  });

  contenedor.querySelector('#cfg-pl-guardar')?.addEventListener('click', guardarPlantilla);
  contenedor.querySelector('#cfg-pl-prueba')?.addEventListener('click', imprimirPrueba);
  contenedor.querySelector('#cfg-pl-restablecer')?.addEventListener('click', restablecerPlantilla);
}

function actualizarPlantillaDesdeForm() {
  if (!_contenedor || !_plantilla) return;
  const q = (id) => _contenedor.querySelector(`#${id}`);

  _plantilla.fuente = q('pl-fuente')?.value || _plantilla.fuente;
  _plantilla.tamBase = Number(q('pl-tam')?.value) || _plantilla.tamBase;
  _plantilla.interlineado = Number(q('pl-line')?.value) || _plantilla.interlineado;
  _plantilla.separador = q('pl-sep')?.value || 'dashed';
  _plantilla.anchoMm = Number(q('pl-ancho')?.value) || 80;
  _plantilla.mayusculas = !!q('pl-mayus')?.checked;
  _plantilla.encNegrita = !!q('pl-neg')?.checked;
  _plantilla.tituloDocumento = q('pl-tituloDoc')?.value || 'FACTURA';
  _plantilla.mensaje1 = q('pl-msg1')?.value || '';
  _plantilla.mensaje2 = q('pl-msg2')?.value || '';

  _contenedor.querySelectorAll('.pl-toggle').forEach((el) => {
    _plantilla[el.dataset.key] = !!el.checked;
  });
}

function actualizarVistaPreviaTicket() {
  if (!_contenedor || !_plantilla || !_cfg) return;
  const box = _contenedor.querySelector('#cfg-pl-preview');
  if (!box) return;
  const ticket = facturaHTML(ventaDemo(), _plantilla, _cfg);
  box.innerHTML = ticket;
}

function ventaDemo() {
  return {
    numero: '0001',
    fecha: new Date().toISOString().slice(0, 10),
    cliente_nombre: 'Cliente de Ejemplo',
    cliente: {
      id: 'demo',
      nombre: 'Cliente de Ejemplo',
      negocio: 'Veterinaria El Roble',
      telefono: '315 444 1122',
    },
    items: [
      { producto_id: 'p1', nombre: 'Concentrado Perro 15kg', precio: 124900, cantidad: 1, descuento: 0 },
      { producto_id: 'p2', nombre: 'Snacks Dentales x12', precio: 16900, cantidad: 2, descuento: 1000 },
    ],
    subtotal: 158700,
    impuesto: 0,
    descuento: 0,
    descuentoLineas: 2000,
    total: 156700,
    metodo_pago: 'Efectivo',
    data: { timestamp: new Date().toISOString(), recibido: 160000, cambio: 3300 },
  };
}

async function guardarPlantilla() {
  actualizarPlantillaDesdeForm();
  try {
    await PlantillaRepo.guardar(_plantilla);
    Toast.ok('Diseño de factura guardado');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo guardar el diseño');
  }
}

async function imprimirPrueba() {
  actualizarPlantillaDesdeForm();
  const ticket = facturaHTML(ventaDemo(), _plantilla, _cfg);
  imprimirPOS(ticket, { anchoMm: _plantilla.anchoMm || 80, titulo: 'Vista previa factura' });
}

async function restablecerPlantilla() {
  const ok = await Confirm.peligro('¿Restablecer el diseño de la factura a los valores por defecto?', {
    titulo: 'Restablecer diseño',
    textoConfirmar: '↺ Restablecer',
  });
  if (!ok) return;
  _plantilla = await PlantillaRepo.restablecer();
  // Re-renderizar la vista entera para reflejar valores
  render(_contenedor);
  Toast.ok('Diseño restablecido');
}

async function guardarDatosNegocio() {
  const get = (id) => _contenedor.querySelector(`#${id}`)?.value || '';
  _cfg.negocio = {
    ..._cfg.negocio,
    nombre: get('cfg-negocio').trim(),
    nit: get('cfg-nit').trim(),
    telefono: get('cfg-telefono').trim(),
    telefono2: get('cfg-telefono2').trim(),
    direccion: get('cfg-direccion').trim(),
    ciudad: get('cfg-ciudad').trim(),
    pais: get('cfg-pais').trim(),
    regimen: get('cfg-regimen').trim(),
  };
  _cfg.mensajes = {
    mensaje1: get('cfg-msg1').trim(),
    mensaje2: get('cfg-msg2').trim(),
  };

  const sonido = _contenedor.querySelector('#cfg-sonido');
  const utilidad = _contenedor.querySelector('#cfg-utilidad');
  _cfg.sonido = sonido?.checked ?? true;
  _cfg.mostrarUtilidad = utilidad?.checked ?? false;

  try {
    await Repo.guardar(_cfg);
    Toast.ok('Configuración guardada');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo guardar la configuración');
  }
}

function actualizarEstadoSync() {
  const box = _contenedor?.querySelector('#cfg-sync-estado');
  if (!box) return;

  const ready = Supa.isReady();
  const activa = Sync.estaActiva();
  const pendientes = Sync.pendientes();

  let html = '';
  if (!ready) {
    html = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:#94a3b8"></div>
        <span>Supabase no configurado.</span>
      </div>
    `;
  } else if (activa) {
    html = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:#15803d;box-shadow:0 0 0 3px rgba(21,128,61,.15)"></div>
        <span>Conectada y sincronizando. <b>${pendientes}</b> registro(s) en cola.</span>
      </div>
    `;
  } else {
    html = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:#a16207"></div>
        <span>Sincronización desactivada. <b>${pendientes}</b> pendiente(s) acumulados.</span>
      </div>
    `;
  }
  box.innerHTML = html;
}

// ============================================================
//  RESPALDO
// ============================================================

async function exportarJSON() {
  try {
    const datos = {
      generado: new Date().toISOString(),
      version: 1,
      productos: await db.getAll('productos'),
      clientes: await db.getAll('clientes'),
      ventas: await db.getAll('ventas'),
      compras: await db.getAll('compras'),
      proveedores: await db.getAll('proveedores'),
      gastos: await db.getAll('gastos'),
      kvs: await db.getAll('kvs'),
    };
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pospunto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.ok('Respaldo descargado');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo generar el respaldo');
  }
}

async function importarJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const ok = await Confirm.peligro(
    'Importar este respaldo SOBREESCRIBIRÁ todos los datos locales. ¿Continuar?',
    { titulo: 'Importar respaldo', textoConfirmar: '⬆️ Importar' },
  );
  if (!ok) { e.target.value = ''; return; }

  try {
    const texto = await file.text();
    const datos = JSON.parse(texto);

    const tablas = ['productos', 'clientes', 'ventas', 'compras', 'proveedores', 'gastos', 'kvs'];
    for (const tabla of tablas) {
      if (!Array.isArray(datos[tabla])) continue;
      await db.clear(tabla);
      for (const item of datos[tabla]) {
        await db.put(tabla, item);
      }
    }
    Toast.ok('Respaldo importado · Recarga la app');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo leer el respaldo');
  } finally {
    e.target.value = '';
  }
}

// ============================================================
//  BORRAR DATOS
// ============================================================

async function borrarSeleccionado() {
  const seleccionados = Array.from(_contenedor.querySelectorAll('.cfg-bd:checked')).map((c) => c.dataset.tipo);
  if (seleccionados.length === 0) {
    Toast.warn('Selecciona al menos una categoría');
    return;
  }

  const labels = {
    stock: 'el STOCK de los productos',
    productos: 'todo el CATÁLOGO de productos',
    clientes: 'todos los CLIENTES',
    ventas: 'todas las VENTAS',
    compras: 'todas las COMPRAS',
    gastos: 'todos los GASTOS',
    proveedores: 'todos los PROVEEDORES',
  };
  const desc = seleccionados.map((s) => labels[s] || s).join(', ');

  const ok = await Confirm.peligro(
    `Vas a borrar: ${desc}. Esta acción NO se puede deshacer. ¿Continuar?`,
    { titulo: 'Borrar datos', textoConfirmar: '🗑️ Borrar' },
  );
  if (!ok) return;

  try {
    const resumen = [];
    for (const tipo of seleccionados) {
      if (tipo === 'stock') {
        // Resetear stock = 0 en cada producto (local + sube cada uno a nube)
        const productos = await db.getAll('productos');
        for (const p of productos) {
          await Sync.guardar('productos', { ...p, stock: 0 });
        }
        resumen.push(`Stock reseteado a 0 en ${productos.length} productos`);
      } else if (tipo === 'productos') {
        const r = await Sync.vaciarTabla('productos');
        resumen.push(`Productos: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'clientes') {
        const r = await Sync.vaciarTabla('clientes');
        resumen.push(`Clientes: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'ventas') {
        const r = await Sync.vaciarTabla('ventas');
        resumen.push(`Ventas: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'compras') {
        const r = await Sync.vaciarTabla('compras');
        resumen.push(`Compras: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'gastos') {
        const r = await Sync.vaciarTabla('gastos');
        resumen.push(`Gastos: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'proveedores') {
        const r = await Sync.vaciarTabla('proveedores');
        resumen.push(`Proveedores: ${r.local} local · ${r.nube} nube`);
      }
    }
    console.log('🗑️ Borrado completado:\n  • ' + resumen.join('\n  • '));
    Toast.ok('Datos borrados (local + nube)');
    render(_contenedor);
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo borrar todo: ' + (err.message || err));
  }
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando configuración…</div>`;
}

function htmlLayout(cfg, plantilla, stats) {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="settings" style="width:30px;height:30px;color:#4f46e5;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Configuración</h1>
      </div>

      <div style="margin-bottom:16px">
        ${htmlPlantillaFactura(plantilla)}
      </div>

      <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;align-items:start">
        ${htmlDatosNegocio(cfg)}
        <div style="display:flex;flex-direction:column;gap:16px">
          ${htmlLector(cfg)}
          ${htmlImpresora(cfg)}
          ${htmlSync()}
          ${htmlRespaldo()}
          ${htmlDatosSistema(stats)}
        </div>
      </div>
    </div>
  `;
}

function htmlPlantillaFactura(p) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🎨 Diseño de la factura POS 80mm</h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">Personaliza tipografía, secciones y mensajes de tu ticket térmico.</div>
        </div>
        <button id="cfg-pl-restablecer"
          style="padding:8px 14px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#475569;font-family:inherit">
          ↺ Restablecer
        </button>
      </div>

      <div style="display:grid;gap:18px;grid-template-columns:1.4fr 1fr;align-items:start">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Tipografía</div>
              <select id="pl-fuente"
                style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
                <option value="'Courier New','Roboto Mono',monospace" ${p.fuente.includes('Courier') ? 'selected' : ''}>Courier (clásica)</option>
                <option value="'Roboto Mono',monospace" ${p.fuente.includes('Roboto') && !p.fuente.includes('Courier') ? 'selected' : ''}>Roboto Mono</option>
                <option value="'JetBrains Mono',monospace" ${p.fuente.includes('JetBrains') ? 'selected' : ''}>JetBrains Mono</option>
                <option value="Inter,system-ui,sans-serif" ${p.fuente.includes('Inter') ? 'selected' : ''}>Inter (sin serifa)</option>
                <option value="Arial,sans-serif" ${p.fuente.includes('Arial') ? 'selected' : ''}>Arial</option>
              </select>
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Tamaño base (px)</div>
              <input id="pl-tam" type="number" min="9" max="20" value="${p.tamBase}"
                style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Interlineado</div>
              <input id="pl-line" type="number" step="0.1" min="1" max="2.5" value="${p.interlineado}"
                style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Separador entre secciones</div>
              <select id="pl-sep"
                style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
                <option value="dashed" ${p.separador === 'dashed' ? 'selected' : ''}>Línea punteada — — —</option>
                <option value="solid" ${p.separador === 'solid' ? 'selected' : ''}>Línea continua ───</option>
                <option value="none" ${p.separador === 'none' ? 'selected' : ''}>Sin línea (solo espacio)</option>
              </select>
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Ancho del papel</div>
              <select id="pl-ancho"
                style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
                <option value="58" ${p.anchoMm === 58 ? 'selected' : ''}>58 mm</option>
                <option value="76" ${p.anchoMm === 76 ? 'selected' : ''}>76 mm</option>
                <option value="80" ${p.anchoMm === 80 ? 'selected' : ''}>80 mm (estándar)</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:18px;padding-top:18px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;font-weight:600;cursor:pointer">
                <input id="pl-mayus" type="checkbox" ${p.mayusculas ? 'checked' : ''} style="width:16px;height:16px"> Mayúsculas
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;font-weight:600;cursor:pointer">
                <input id="pl-neg" type="checkbox" ${p.encNegrita ? 'checked' : ''} style="width:16px;height:16px"> Títulos en negrita
              </label>
            </div>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Secciones visibles</div>
            <div style="display:grid;gap:6px;grid-template-columns:1fr 1fr">
              ${[
                ['pl-mNombre', 'mostrarNombre', 'Nombre del negocio'],
                ['pl-mNit', 'mostrarNit', 'NIT'],
                ['pl-mTel', 'mostrarTelefono', 'Teléfono'],
                ['pl-mDir', 'mostrarDireccion', 'Dirección'],
                ['pl-mCiudad', 'mostrarCiudad', 'Ciudad'],
                ['pl-mFolio', 'mostrarFolio', 'N° factura'],
                ['pl-mFecha', 'mostrarFecha', 'Fecha y hora'],
                ['pl-mCli', 'mostrarCliente', 'Cliente'],
                ['pl-mNegCli', 'mostrarNegocioCliente', 'Negocio del cliente'],
                ['pl-mTelCli', 'mostrarTelefonoCliente', 'Tel. del cliente'],
                ['pl-mItems', 'mostrarItems', 'Lista de productos'],
                ['pl-mSub', 'mostrarSubtotal', 'Subtotal'],
                ['pl-mImp', 'mostrarImpuestos', 'Impuestos'],
                ['pl-mDesc', 'mostrarDescuento', 'Descuento'],
                ['pl-mTot', 'mostrarTotal', 'Total'],
                ['pl-mMet', 'mostrarMetodoPago', 'Método de pago'],
                ['pl-mRec', 'mostrarRecibidoCambio', 'Recibido / Cambio'],
                ['pl-mPie', 'mostrarPieRepetido', 'Pie con N° factura'],
              ].map(([id, key, label]) => `
                <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#475569;cursor:pointer">
                  <input class="pl-toggle" id="${id}" data-key="${key}" type="checkbox" ${p[key] ? 'checked' : ''} style="width:15px;height:15px">
                  ${label}
                </label>
              `).join('')}
            </div>
          </div>

          <div style="display:grid;gap:10px">
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Título del documento</div>
              <input id="pl-tituloDoc" type="text" value="${esc(p.tituloDocumento || 'FACTURA')}" placeholder="FACTURA, REMISIÓN, RECIBO..."
                style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;font-weight:700;letter-spacing:.04em" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mensaje 1 (pie)</div>
              <input id="pl-msg1" type="text" value="${esc(p.mensaje1 || '')}"
                style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
            <div>
              <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mensaje 2</div>
              <input id="pl-msg2" type="text" value="${esc(p.mensaje2 || '')}"
                style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
            </div>
          </div>

          <div style="display:flex;gap:10px">
            <button id="cfg-pl-guardar"
              style="flex:1;padding:12px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
              💾 Guardar diseño
            </button>
            <button id="cfg-pl-prueba"
              style="flex:1;padding:12px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">
              🧾 Imprimir prueba
            </button>
          </div>
        </div>

        <div>
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Vista previa</div>
          <div style="background:#f1f5f9;border-radius:10px;padding:14px;display:flex;justify-content:center">
            <div id="cfg-pl-preview" style="background:white;width:280px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.08);max-height:600px;overflow:auto"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function htmlDatosNegocio(cfg) {
  const neg = cfg.negocio;
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🧾 Datos para la factura</h3>

      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
        <div style="grid-column:1/-1">${campo('cfg-negocio', 'Nombre del negocio', neg.nombre)}</div>
        ${campo('cfg-telefono', 'Teléfono', neg.telefono)}
        ${campo('cfg-telefono2', 'Teléfono 2', neg.telefono2 || '')}
        <div style="grid-column:1/-1">${campo('cfg-direccion', 'Dirección', neg.direccion)}</div>
        ${campo('cfg-ciudad', 'Ciudad', neg.ciudad)}
        ${campo('cfg-pais', 'País', neg.pais)}
        ${campo('cfg-nit', 'NIT / Cédula', neg.nit, 'Ej: 1094948361-6')}
        ${campo('cfg-regimen', 'Régimen / IVA', neg.regimen || '', 'Ej: No Responsable de IVA')}
        <div style="grid-column:1/-1">${campo('cfg-msg1', 'Mensaje 1 (pie de factura)', cfg.mensajes.mensaje1)}</div>
        <div style="grid-column:1/-1">${campo('cfg-msg2', 'Mensaje 2', cfg.mensajes.mensaje2)}</div>
      </div>

      <div style="display:flex;gap:18px;flex-wrap:wrap;padding-top:6px">
        <label style="display:flex;align-items:center;gap:7px;font-weight:600;cursor:pointer;font-size:13.5px;color:#475569">
          <input id="cfg-sonido" type="checkbox" ${cfg.sonido ? 'checked' : ''} style="width:18px;height:18px"> Sonidos al vender
        </label>
        <label style="display:flex;align-items:center;gap:7px;font-weight:600;cursor:pointer;font-size:13.5px;color:#475569">
          <input id="cfg-utilidad" type="checkbox" ${cfg.mostrarUtilidad ? 'checked' : ''} style="width:18px;height:18px"> Mostrar utilidad en ventas
        </label>
      </div>

      <button id="cfg-guardar-negocio"
        style="width:100%;padding:13px;background:#4f46e5;color:white;border:0;border-radius:11px;cursor:pointer;font-size:14.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35);margin-top:8px">
        💾 Guardar configuración
      </button>
    </div>
  `;
}

function campo(id, label, valor, placeholder = '') {
  return `
    <div>
      <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
      <input id="${id}" type="text" value="${esc(valor || '')}" placeholder="${esc(placeholder)}"
        style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
    </div>
  `;
}

function htmlLector(cfg) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🔫 Lector de código de barras</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Elige cómo escaneas en la pantalla de Ventas.</p>
      <select id="cfg-lector"
        style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
        <option value="pistola" ${cfg.lector === 'pistola' ? 'selected' : ''}>Pistola / Lector USB (no usa cámara)</option>
        <option value="manual" ${cfg.lector === 'manual' ? 'selected' : ''}>Manual (escribir en el buscador)</option>
      </select>
    </div>
  `;
}

function htmlImpresora(cfg) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🖨️ Impresora predeterminada</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Cuando imprimas una factura, el POS puede ir directo a una impresora o preguntarte cada vez.</p>
      <select id="cfg-impresora"
        style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
        <option value="preguntar" ${cfg.impresoraDefault === 'preguntar' ? 'selected' : ''}>🤔 Preguntar cada vez (recomendado)</option>
        <option value="pos" ${cfg.impresoraDefault === 'pos' ? 'selected' : ''}>🧾 POS 80mm (térmica)</option>
        <option value="carta" ${cfg.impresoraDefault === 'carta' ? 'selected' : ''}>📄 Carta empresarial</option>
      </select>
    </div>
  `;
}

function htmlSync() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">☁️ Sincronización con la nube</h3>
      <div id="cfg-sync-estado" style="font-size:14px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:11px 13px">Cargando estado…</div>
      <button id="cfg-sync-flush"
        style="padding:10px 14px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569">
        🔁 Reintentar pendientes
      </button>
      <p style="color:#94a3b8;font-size:12.5px;margin:0">El POS sigue funcionando aunque la nube esté caída. Los registros locales se subirán cuando vuelva la conexión.</p>
    </div>
  `;
}

function htmlRespaldo() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">💾 Respaldo (copia de seguridad)</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Guarda todo tu sistema en un archivo, o restáuralo cuando quieras.</p>
      <button id="cfg-export-json"
        style="padding:12px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
        ⬇️ Exportar respaldo (JSON)
      </button>
      <label
        style="padding:12px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569;text-align:center">
        ⬆️ Importar respaldo (JSON)
        <input id="cfg-import-json" type="file" accept=".json" style="display:none" />
      </label>
    </div>
  `;
}

function htmlDatosSistema(stats) {
  const badge = (icono, label, count) => `
    <span style="background:#e0e7ff;color:#4338ca;font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:7px">
      ${icono} ${fmt(count)} ${label}
    </span>
  `;

  const tipos = [
    ['stock', '📊 Solo el stock (dejar productos en 0)', 'Conserva nombre, código, precio y costo. Útil para hacer un conteo físico desde cero.'],
    ['productos', '📦 Productos completos (catálogo entero)', 'Elimina todos los productos. Quedas sin catálogo.'],
    ['clientes', '👥 Clientes', 'Borra el listado completo de clientes.'],
    ['ventas', '🧾 Ventas / Facturas', 'Borra el historial de ventas.'],
    ['compras', '🚚 Compras', 'Borra el historial de compras a proveedores.'],
    ['gastos', '💸 Gastos', 'Borra todos los gastos registrados.'],
    ['proveedores', '🏢 Proveedores', 'Borra el listado de proveedores.'],
  ];

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:11px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">🗃️ Datos del sistema</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${badge('📦', 'productos', stats.productos)}
        ${badge('👥', 'clientes', stats.clientes)}
        ${badge('🧾', 'ventas', stats.ventas)}
        ${badge('🚚', 'compras', stats.compras)}
        ${badge('🏢', 'proveedores', stats.proveedores)}
        ${badge('💸', 'gastos', stats.gastos)}
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px;display:flex;flex-direction:column;gap:9px;margin-top:6px">
        <div style="font-size:12.5px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Borrado selectivo</div>
        ${tipos.map(([tipo, label, desc]) => `
          <label style="display:flex;gap:9px;cursor:pointer;align-items:flex-start">
            <input class="cfg-bd" type="checkbox" data-tipo="${tipo}" style="margin-top:3px;width:16px;height:16px;cursor:pointer;flex-shrink:0">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:#0f172a">${label}</div>
              <div style="font-size:11.5px;color:#64748b">${desc}</div>
            </div>
          </label>
        `).join('')}
        <button id="cfg-borrar-confirmar"
          style="margin-top:6px;padding:11px;background:#dc2626;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">
          🗑️ Borrar seleccionado
        </button>
      </div>
    </div>
  `;
}
