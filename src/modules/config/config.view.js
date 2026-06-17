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
import * as ProductosRepo from '../productos/productos.repo.js';
import * as ClientesRepo from '../clientes/clientes.repo.js';
import * as ImpExp from './import-export.js';
import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import * as Cajon from '../../services/cajon.js';
import { config as defaultConfig } from '../../services/config.js';
import { fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { Toast, Confirm, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import * as Auth from '../../services/auth.js';

let _contenedor = null;
let _cfg = null;

// ============================================================
//  RENDER
// ============================================================

export async function render(contenedor) {
  // Guard: la Configuración incluye acciones destructivas (borrar datos
  // del sistema local + nube). Solo el admin puede entrar, incluso si
  // un cajero navega directo por URL (#/config).
  if (!Auth.esAdmin()) {
    contenedor.innerHTML = `
      <div style="padding:40px 48px;max-width:560px;margin:40px auto;text-align:center;background:white;border:1px solid #e2e8f0;border-radius:12px">
        <div style="font-size:48px">🔒</div>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:10px 0 6px">Acceso restringido</h1>
        <div style="color:#64748b;font-size:14px">Solo el administrador puede acceder a la Configuración.</div>
      </div>
    `;
    return;
  }

  _contenedor = contenedor;
  contenedor.innerHTML = htmlCargando();

  _cfg = await Repo.leer();
  const stats = await contarTodo();

  contenedor.innerHTML = htmlLayout(_cfg, stats);
  refrescarIconos(contenedor);
  adjuntarEventos(contenedor);
  actualizarEstadoSync();
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
  contenedor.querySelector('#cfg-guardar-fe')?.addEventListener('click', guardarFE);

  // Cajón de dinero
  const estadoCajon = (txt, ok) => {
    const el = contenedor.querySelector('#cfg-cajon-estado');
    if (el) { el.textContent = txt; el.style.color = ok ? '#15803d' : '#dc2626'; }
  };
  contenedor.querySelector('#cfg-cajon-conectar')?.addEventListener('click', async () => {
    try {
      const baud = _cfg?.cajon?.baud || 9600;
      await Cajon.conectar(baud);
      estadoCajon('Cajón/impresora conectado por Web Serial ✓', true);
    } catch (err) {
      estadoCajon(err.message || 'No se pudo conectar (¿navegador sin Web Serial o cancelaste?)', false);
    }
  });
  contenedor.querySelector('#cfg-cajon-probar')?.addEventListener('click', async () => {
    try {
      const baud = _cfg?.cajon?.baud || 9600;
      const ok = await Cajon.probar(baud);
      if (ok) estadoCajon('¡Pulso enviado! Si el cajón no abrió, usa el método del driver de Windows.', true);
      else estadoCajon('No se encontró un cajón por Web Serial. Configura "abrir cajón al imprimir" en el driver.', false);
    } catch (err) {
      estadoCajon(err.message || 'No se pudo probar el cajón', false);
    }
  });

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
      Toast.ok(`${r.exitos} subidos · ${r.fallos} pendientes`);
      actualizarEstadoSync();
    } catch (err) {
      console.error(err);
      Toast.error('Error reintentando');
    }
  });

  // Respaldo
  contenedor.querySelector('#cfg-export-json')?.addEventListener('click', exportarJSON);
  contenedor.querySelector('#cfg-import-json')?.addEventListener('change', importarJSON);

  // Excel — Productos
  contenedor.querySelector('#cfg-exp-productos')?.addEventListener('click', exportarProductosExcel);
  contenedor.querySelector('#cfg-tpl-productos')?.addEventListener('click', () => {
    ImpExp.plantillaProductos();
    Toast.ok('Plantilla descargada');
  });
  contenedor.querySelector('#cfg-imp-productos')?.addEventListener('change', importarProductosExcel);

  // Excel — Clientes
  contenedor.querySelector('#cfg-exp-clientes')?.addEventListener('click', exportarClientesExcel);
  contenedor.querySelector('#cfg-tpl-clientes')?.addEventListener('click', () => {
    ImpExp.plantillaClientes();
    Toast.ok('Plantilla descargada');
  });
  contenedor.querySelector('#cfg-imp-clientes')?.addEventListener('change', importarClientesExcel);

  // Borrar datos
  contenedor.querySelector('#cfg-borrar-confirmar')?.addEventListener('click', borrarSeleccionado);
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

  _cfg.cajon = {
    ...(_cfg.cajon || {}),
    activo: _contenedor.querySelector('#cfg-cajon-activo')?.checked === true,
  };

  try {
    await Repo.guardar(_cfg);
    Toast.ok('Configuración guardada');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo guardar la configuración');
  }
}

async function guardarFE() {
  const get = (id) => _contenedor.querySelector(`#${id}`)?.value || '';
  _cfg.fe = {
    activa: _contenedor.querySelector('#cfg-fe-activa')?.checked === true,
    ambiente: get('cfg-fe-ambiente') === 'produccion' ? 'produccion' : 'sandbox',
    emisor: {
      ...(_cfg.fe?.emisor || {}),
      razonSocial: get('cfg-fe-razon').trim(),
      nit: get('cfg-fe-nit').trim(),
      dv: get('cfg-fe-dv').trim(),
      tipoPersona: get('cfg-fe-tipopersona'),
      regimen: get('cfg-fe-regimen'),
      responsabilidades: get('cfg-fe-resp').trim(),
      actividadCIIU: get('cfg-fe-ciiu').trim(),
      direccion: get('cfg-fe-direccion').trim(),
      municipio: get('cfg-fe-municipio').trim(),
      municipioDane: get('cfg-fe-dane').trim(),
      departamento: get('cfg-fe-departamento').trim(),
      email: get('cfg-fe-email').trim(),
      telefono: get('cfg-fe-telefono').trim(),
    },
    resolucion: {
      ...(_cfg.fe?.resolucion || {}),
      prefijo: get('cfg-fe-prefijo').trim(),
      numeroResolucion: get('cfg-fe-numres').trim(),
      rangoDesde: get('cfg-fe-rangodesde').trim(),
      rangoHasta: get('cfg-fe-rangohasta').trim(),
      fechaResolucion: get('cfg-fe-fecharesol'),
      vigenciaHasta: get('cfg-fe-vigencia'),
    },
  };
  try {
    await Repo.guardar(_cfg);
    Toast.ok(_cfg.fe.activa ? 'Facturación electrónica activada y guardada' : 'Datos de facturación electrónica guardados');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudieron guardar los datos de FE');
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
    { titulo: 'Importar respaldo', textoConfirmar: 'Importar' },
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

// ============================================================
//  IMPORT / EXPORT EXCEL
// ============================================================

async function exportarProductosExcel() {
  try {
    const n = await ImpExp.exportarProductos();
    Toast.ok(`${n} producto(s) exportado(s)`);
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo exportar productos');
  }
}

async function exportarClientesExcel() {
  try {
    const n = await ImpExp.exportarClientes();
    Toast.ok(`${n} cliente(s) exportado(s)`);
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo exportar clientes');
  }
}

async function importarProductosExcel(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const info = await ImpExp.analizarArchivo(file, 'productos');
    if (info.filasRaw.length === 0) {
      Toast.warn('El archivo está vacío');
      return;
    }
    await abrirMapeoYPreview({
      titulo: 'Importar productos',
      filasRaw: info.filasRaw,
      columnasArchivo: info.columnas,
      mapeoSugerido: info.mapeoSugerido,
      formatoDetectado: info.formatoDetectado,
      columnasModelo: ImpExp.COLUMNAS_PRODUCTOS,
      tipo: 'productos',
      onConfirmar: async (filas) => {
        const overlay = abrirOverlayProgreso(`Importando ${fmt(filas.length)} productos…`);
        try {
          const r = await ImpExp.importarProductos(filas, (n, total) => overlay.actualizar(`Importando ${fmt(total)} productos…`, n, total));
          Toast.ok(`${r.creados} creados · ${r.actualizados} actualizados${r.errores ? ` · ⚠ ${r.errores} con errores` : ''}`);
          render(_contenedor);
        } finally { overlay.cerrar(); }
      },
    });
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo leer el archivo: ' + (err.message || err));
  } finally {
    e.target.value = '';
  }
}

async function importarClientesExcel(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const info = await ImpExp.analizarArchivo(file, 'clientes');
    if (info.filasRaw.length === 0) {
      Toast.warn('El archivo está vacío');
      return;
    }
    await abrirMapeoYPreview({
      titulo: 'Importar clientes',
      filasRaw: info.filasRaw,
      columnasArchivo: info.columnas,
      mapeoSugerido: info.mapeoSugerido,
      formatoDetectado: info.formatoDetectado,
      columnasModelo: ImpExp.COLUMNAS_CLIENTES,
      tipo: 'clientes',
      onConfirmar: async (filas) => {
        const overlay = abrirOverlayProgreso(`Importando ${fmt(filas.length)} clientes…`);
        try {
          const r = await ImpExp.importarClientes(filas, (n, total) => overlay.actualizar(`Importando ${fmt(total)} clientes…`, n, total));
          Toast.ok(`${r.creados} creados · ${r.actualizados} actualizados${r.errores ? ` · ⚠ ${r.errores} con errores` : ''}`);
          render(_contenedor);
        } finally { overlay.cerrar(); }
      },
    });
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo leer el archivo: ' + (err.message || err));
  } finally {
    e.target.value = '';
  }
}

/**
 * Modal de import con MAPEO MANUAL de columnas + selector de formato numérico.
 * El usuario elige qué columna del Excel corresponde a cada campo, y el preview
 * se actualiza en vivo al cambiar el mapeo o el formato.
 */
function abrirMapeoYPreview({ titulo, filasRaw, columnasArchivo, mapeoSugerido, formatoDetectado, columnasModelo, tipo, onConfirmar }) {
  return new Promise((resolve) => {
    // Estado del modal
    let mapeo = { ...mapeoSugerido };
    let formato = formatoDetectado || 'auto';

    const m = Modal.abrir({ titulo, contenido: '<div id="imp-root">Cargando…</div>', ancho: 'xl' });

    const render = () => {
      const { filas, ignoradas, errores } = ImpExp.procesarFilas(filasRaw, mapeo, tipo, formato);
      const filasMostrar = filas.slice(0, 12);

      // Reconstruir el contenido del modal
      m.body.querySelector('#imp-root').innerHTML = htmlImport({
        filasRaw, filasProc: filas, filasMostrar, ignoradas, errores,
        columnasArchivo, columnasModelo, mapeo, formato, formatoDetectado,
      });

      // Cablear cambios en los selects de mapeo
      m.body.querySelectorAll('.imp-map-sel').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const campo = e.target.dataset.campo;
          mapeo[campo] = e.target.value || undefined;
          if (!e.target.value) delete mapeo[campo];
          render();
        });
      });

      // Cambio del formato numérico
      m.body.querySelectorAll('.imp-fmt-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          formato = btn.dataset.fmt;
          render();
        });
      });

      // Cancelar
      m.body.querySelector('#imp-cancel').onclick = () => { m.cerrar(); resolve(false); };

      // Confirmar
      m.body.querySelector('#imp-confirmar').onclick = async () => {
        const btn = m.body.querySelector('#imp-confirmar');
        btn.textContent = 'Importando…';
        btn.disabled = true;
        try {
          await onConfirmar(filas);
          m.cerrar();
          resolve(true);
        } catch (err) {
          console.error(err);
          Toast.error('Error al importar: ' + (err.message || err));
          m.cerrar();
          resolve(false);
        }
      };
    };

    render();
  });
}

/**
 * HTML del modal de import (se vuelve a generar en cada cambio de mapeo).
 */
function htmlImport({ filasRaw, filasProc, filasMostrar, ignoradas, errores, columnasArchivo, columnasModelo, mapeo, formato, formatoDetectado }) {
  const totalUtil = filasProc.length;
  const sample = (col) => {
    // Devuelve una muestra de los valores de esa columna (primeros 3 no vacíos)
    if (!col) return '';
    const vals = [];
    for (const f of filasRaw.slice(0, 20)) {
      const v = f[col];
      if (v != null && String(v).trim() !== '') {
        vals.push(String(v));
        if (vals.length >= 2) break;
      }
    }
    return vals.length ? `<span style="color:#94a3b8;font-size:10.5px"> · ej: ${esc(vals.join(', '))}</span>` : '';
  };

  // Detectar campos obligatorios sin mapear
  const sinMapear = ['nombre'].filter((k) => !mapeo[k]);

  return `
    <!-- Banner: archivo leído -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;padding:11px 14px;margin-bottom:12px;font-size:13.5px;color:#1d4ed8">
      <b>${fmt(filasRaw.length)}</b> fila(s) detectadas en el archivo · <b>${fmt(columnasArchivo.length)}</b> columna(s) encontradas
    </div>

    <!-- PASO 1: Mapeo de columnas -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:11px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;font-size:14px;color:#0f172a">1️⃣ Asigna las columnas del archivo a cada campo</div>
        <div style="font-size:11.5px;color:#64748b">Elige qué columna del Excel va a qué campo del POS</div>
      </div>
      <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr">
        ${columnasModelo.map((cm) => {
          const obligatorio = cm.clave === 'nombre';
          const valActual = mapeo[cm.clave] || '';
          return `
            <div>
              <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px">
                ${esc(cm.etiqueta)}${obligatorio ? ' <span style="color:#dc2626">*</span>' : ''}
                ${sample(valActual)}
              </div>
              <select class="imp-map-sel" data-campo="${esc(cm.clave)}"
                style="width:100%;padding:8px 10px;border:1px solid ${obligatorio && !valActual ? '#fecaca' : '#cbd5e1'};border-radius:7px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;background:${obligatorio && !valActual ? '#fef2f2' : 'white'}">
                <option value="">— No importar —</option>
                ${columnasArchivo.map((col) => `<option value="${esc(col)}" ${col === valActual ? 'selected' : ''}>${esc(col)}</option>`).join('')}
              </select>
            </div>
          `;
        }).join('')}
      </div>
      ${sinMapear.length > 0 ? `
        <div style="margin-top:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-size:12.5px;color:#991b1b">
          Campo obligatorio sin mapear: <b>${sinMapear.join(', ')}</b>. Sin esto no se podrá importar.
        </div>
      ` : ''}
    </div>

    <!-- PASO 2: Formato numérico -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:11px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;font-size:14px;color:#0f172a">2️⃣ Formato de los números</div>
        ${formatoDetectado !== 'auto' ? `<div style="font-size:11px;color:#15803d;font-weight:600">Auto-detectado: <b>${esc(formatoDetectado)}</b></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[
          ['auto',  'Auto', 'Detecta automáticamente cada valor'],
          ['es-CO', '🇨🇴 1.500.000 / 1.500,50', 'Punto = miles · Coma = decimal'],
          ['en-US', '🇺🇸 1,500,000 / 1,500.50', 'Coma = miles · Punto = decimal'],
        ].map(([id, label, hint]) => `
          <button class="imp-fmt-btn" data-fmt="${id}"
            style="flex:1;min-width:160px;padding:10px;border:1.5px solid ${formato === id ? '#2563eb' : '#e2e8f0'};background:${formato === id ? '#eff6ff' : 'white'};color:${formato === id ? '#1d4ed8' : '#475569'};border-radius:9px;cursor:pointer;font-family:inherit;text-align:left">
            <div style="font-weight:700;font-size:12.5px;font-family:'JetBrains Mono',ui-monospace,monospace">${label}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${hint}</div>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- PASO 3: Preview con datos mapeados -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:11px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;font-size:14px;color:#0f172a">3️⃣ Vista previa (primeras ${filasMostrar.length})</div>
        <div style="font-size:12px;color:#64748b">
          <b style="color:#15803d">${fmt(totalUtil)}</b> válidas · ${ignoradas > 0 ? `<b style="color:#a16207">${fmt(ignoradas)}</b> ignoradas` : '0 ignoradas'}
        </div>
      </div>
      ${filasMostrar.length === 0 ? `
        <div style="text-align:center;padding:24px;color:#94a3b8;font-size:13.5px">
          Sin datos para mostrar. Verifica el mapeo de la columna "Nombre".
        </div>
      ` : `
        <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:auto;max-height:32vh">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f8fafc;color:#475569;font-weight:700;text-align:left;border-bottom:1px solid #e2e8f0;position:sticky;top:0">
                ${columnasModelo.map((c) => `<th style="padding:7px 8px;white-space:nowrap">${esc(c.etiqueta)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${filasMostrar.map((f) => `
                <tr style="border-bottom:1px solid #f1f5f9">
                  ${columnasModelo.map((c) => {
                    const v = f[c.clave];
                    const esNum = ['precio', 'costo', 'stock', 'stock_min', 'impuesto_pct'].includes(c.clave);
                    let str;
                    if (v == null || v === '') {
                      str = '<span style="color:#cbd5e1">—</span>';
                    } else if (esNum) {
                      str = `<span style="font-family:'JetBrains Mono',ui-monospace,monospace;color:#1d4ed8">${Number(v).toLocaleString('es-CO')}</span>`;
                    } else {
                      str = esc(String(v));
                    }
                    return `<td style="padding:6px 8px;color:#475569;white-space:nowrap">${str}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${filasProc.length > filasMostrar.length ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:6px;text-align:center">… y ${fmt(filasProc.length - filasMostrar.length)} más se importarán</div>` : ''}
      `}

      ${errores.length > 0 ? `
        <div style="margin-top:10px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400e">
          <b>${errores.length} advertencia(s)</b>:
          <ul style="margin:4px 0 0 18px;padding:0">
            ${errores.slice(0, 5).map((e) => `<li>Fila ${e.fila}: ${esc(e.msg)}</li>`).join('')}
            ${errores.length > 5 ? `<li>… y ${errores.length - 5} más</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>

    <!-- Aviso -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:9px;padding:10px 12px;font-size:12.5px;color:#1d4ed8;margin-bottom:14px">
      Los registros existentes (mismo código o nombre) se <b>actualizarán</b>. Los nuevos se crearán. Todo se sincronizará automáticamente con la nube.
    </div>

    <!-- Botones -->
    <div style="display:flex;gap:10px">
      <button id="imp-cancel"
        style="flex:1;padding:11px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
      <button id="imp-confirmar" data-primary
        ${(totalUtil === 0 || sinMapear.length > 0) ? 'disabled' : ''}
        style="flex:1.4;padding:11px;background:${totalUtil > 0 && sinMapear.length === 0 ? '#15803d' : '#cbd5e1'};color:white;border:0;border-radius:10px;cursor:${totalUtil > 0 && sinMapear.length === 0 ? 'pointer' : 'not-allowed'};font-size:14px;font-weight:700;font-family:inherit;${totalUtil > 0 && sinMapear.length === 0 ? 'box-shadow:0 4px 12px -2px rgba(21,128,61,.35)' : ''}">Importar ${fmt(totalUtil)} fila${totalUtil === 1 ? '' : 's'}</button>
    </div>
  `;
}

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
    { titulo: 'Borrar datos', textoConfirmar: 'Borrar' },
  );
  if (!ok) return;

  // Overlay de progreso (para que el usuario sepa que está trabajando)
  const overlay = abrirOverlayProgreso('Borrando datos…');

  try {
    const resumen = [];
    for (const tipo of seleccionados) {
      if (tipo === 'stock') {
        // Resetear stock = 0 — ahora en paralelo por lotes
        const productos = await db.getAll('productos');
        overlay.actualizar(`Reseteando stock de ${fmt(productos.length)} productos…`, 0, productos.length);
        const items = productos.map((p) => ({ ...p, stock: 0 }));
        const r = await Sync.guardarVarios('productos', items, {
          batchSize: 30,
          onProgress: (n, total) => overlay.actualizar(`Reseteando stock de ${fmt(total)} productos…`, n, total),
        });
        resumen.push(`Stock reseteado en ${r.ok} productos${r.fail ? ` (⚠ ${r.fail} fallaron)` : ''}`);
      } else if (tipo === 'productos') {
        overlay.actualizar('Borrando productos…');
        const r = await Sync.vaciarTabla('productos');
        resumen.push(`Productos: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'clientes') {
        overlay.actualizar('Borrando clientes…');
        const r = await Sync.vaciarTabla('clientes');
        resumen.push(`Clientes: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'ventas') {
        overlay.actualizar('Borrando ventas…');
        const r = await Sync.vaciarTabla('ventas');
        resumen.push(`Ventas: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'compras') {
        overlay.actualizar('Borrando compras…');
        const r = await Sync.vaciarTabla('compras');
        resumen.push(`Compras: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'gastos') {
        overlay.actualizar('Borrando gastos…');
        const r = await Sync.vaciarTabla('gastos');
        resumen.push(`Gastos: ${r.local} local · ${r.nube} nube`);
      } else if (tipo === 'proveedores') {
        overlay.actualizar('Borrando proveedores…');
        const r = await Sync.vaciarTabla('proveedores');
        resumen.push(`Proveedores: ${r.local} local · ${r.nube} nube`);
      }
    }
    overlay.cerrar();
    console.log('Borrado completado:\n  • ' + resumen.join('\n  • '));
    Toast.ok('Datos borrados (local + nube)');
    render(_contenedor);
  } catch (err) {
    overlay.cerrar();
    console.error(err);
    Toast.error('No se pudo borrar todo: ' + (err.message || err));
  }
}

/**
 * Muestra un overlay fixed con spinner + barra de progreso.
 * Devuelve { actualizar(texto, n?, total?), cerrar() }.
 */
function abrirOverlayProgreso(textoInicial) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);
    z-index:11000;display:flex;align-items:center;justify-content:center;
  `;
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;padding:24px 28px;min-width:300px;max-width:380px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div class="op-spinner" style="width:24px;height:24px;border-radius:50%;border:3px solid #e0e7ff;border-top-color:#2563eb;animation:opspin 0.8s linear infinite"></div>
        <div id="op-texto" style="flex:1;font-weight:600;color:#0f172a;font-size:14px">${textoInicial || 'Procesando…'}</div>
      </div>
      <div id="op-barra-wrap" style="display:none;background:#f1f5f9;border-radius:999px;height:8px;overflow:hidden">
        <div id="op-barra" style="height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#7c3aed);transition:width .2s ease;border-radius:999px"></div>
      </div>
      <div id="op-conteo" style="display:none;font-size:11.5px;color:#64748b;text-align:right;margin-top:5px;font-family:'JetBrains Mono',ui-monospace,monospace"></div>
    </div>
    <style>@keyframes opspin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(overlay);

  return {
    actualizar(texto, n, total) {
      const elT = overlay.querySelector('#op-texto');
      if (elT && texto) elT.textContent = texto;
      const wrap = overlay.querySelector('#op-barra-wrap');
      const barra = overlay.querySelector('#op-barra');
      const conteo = overlay.querySelector('#op-conteo');
      if (n != null && total != null && total > 0) {
        wrap.style.display = 'block';
        conteo.style.display = 'block';
        barra.style.width = ((n / total) * 100).toFixed(1) + '%';
        conteo.textContent = `${n} / ${total}`;
      }
    },
    cerrar() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    },
  };
}

// ============================================================
//  HTML
// ============================================================

function htmlCargando() {
  return `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando configuración…</div>`;
}

function htmlLayout(cfg, stats) {
  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <i data-lucide="settings" style="width:30px;height:30px;color:#2563eb;stroke-width:1.75"></i>
        <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Configuración</h1>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:22px">💡</span>
        <div style="font-size:13.5px;color:#1e40af;line-height:1.5">
          <b>La personalización del ticket POS 80mm</b> ya no vive aquí.
          Edita el ticket de venta desde <b>Ventas → 🎨 Personaliza tu ticket</b>,
          y los tickets de cierre y reporte desde <b>Reportes</b>.
        </div>
      </div>

      <div style="display:grid;gap:16px;grid-template-columns:1fr 1fr;align-items:start">
        ${htmlDatosNegocio(cfg)}
        <div style="display:flex;flex-direction:column;gap:16px">
          ${htmlLector(cfg)}
          ${htmlImpresora(cfg)}
          ${htmlCajon(cfg)}
          ${htmlSync()}
          ${htmlExcel(stats)}
          ${htmlRespaldo()}
          ${htmlDatosSistema(stats)}
        </div>
      </div>

      ${htmlFacturacionElectronica(cfg)}
    </div>
  `;
}

function htmlFacturacionElectronica(cfg) {
  const fe = cfg.fe || {};
  const e = fe.emisor || {};
  const r = fe.resolucion || {};
  const sel = (id, label, valor, opciones) => `
    <label class="ui-field" style="gap:5px">
      <span class="ui-label">${label}</span>
      <select id="${id}" class="ui-input">
        ${opciones.map(([v, t]) => `<option value="${v}" ${valor === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>`;
  const inp = (id, label, valor, ph = '') => `
    <label class="ui-field" style="gap:5px">
      <span class="ui-label">${label}</span>
      <input id="${id}" class="ui-input" type="text" value="${esc(String(valor || ''))}" placeholder="${esc(ph)}" autocomplete="off" />
    </label>`;

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-top:16px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <i data-lucide="file-check" style="width:22px;height:22px;color:#2563eb;stroke-width:1.9"></i>
          <div>
            <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Facturación electrónica (DIAN)</h3>
            <div style="font-size:12.5px;color:#64748b">Datos del emisor y resolución. La conexión con Factus se configura aparte (en el servidor).</div>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;font-size:13.5px;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px 13px">
          <input id="cfg-fe-activa" type="checkbox" ${fe.activa ? 'checked' : ''} style="width:18px;height:18px"> Activar facturación electrónica
        </label>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 13px;font-size:12.5px;color:#92400e">
        Mientras esté <b>desactivada</b>, nada cambia en Punto de Venta. Al activarla (cuando el servidor tenga las credenciales de Factus), el cajero podrá marcar cada venta como factura electrónica.
      </div>

      <div>
        <div class="ui-label" style="margin-bottom:8px">Ambiente</div>
        ${sel('cfg-fe-ambiente', 'Ambiente de emisión', fe.ambiente, [['sandbox', 'Pruebas (sandbox)'], ['produccion', 'Producción (DIAN real)']])}
      </div>

      <div>
        <div style="font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Datos del emisor (tu empresa)</div>
        <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <div style="grid-column:1/-1">${inp('cfg-fe-razon', 'Razón social', e.razonSocial, 'Como está en el RUT')}</div>
          ${inp('cfg-fe-nit', 'NIT', e.nit, 'Sin dígito de verificación')}
          ${inp('cfg-fe-dv', 'Dígito verificación (DV)', e.dv, 'Ej: 6')}
          ${sel('cfg-fe-tipopersona', 'Tipo de persona', e.tipoPersona, [['juridica', 'Jurídica'], ['natural', 'Natural']])}
          ${sel('cfg-fe-regimen', 'Régimen IVA', e.regimen, [['no_responsable_iva', 'No responsable de IVA'], ['responsable_iva', 'Responsable de IVA']])}
          ${inp('cfg-fe-resp', 'Responsabilidades (RUT)', e.responsabilidades, 'Ej: O-13; O-15; R-99-PN')}
          ${inp('cfg-fe-ciiu', 'Actividad económica (CIIU)', e.actividadCIIU, 'Ej: 4711')}
          <div style="grid-column:1/-1">${inp('cfg-fe-direccion', 'Dirección fiscal', e.direccion)}</div>
          ${inp('cfg-fe-municipio', 'Municipio', e.municipio, 'Ej: Armenia')}
          ${inp('cfg-fe-dane', 'Código DANE del municipio', e.municipioDane, 'Ej: 63001')}
          ${inp('cfg-fe-departamento', 'Departamento', e.departamento, 'Ej: Quindío')}
          ${inp('cfg-fe-email', 'Correo del emisor', e.email)}
          ${inp('cfg-fe-telefono', 'Teléfono', e.telefono)}
        </div>
      </div>

      <div>
        <div style="font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Resolución de numeración DIAN</div>
        <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
          ${inp('cfg-fe-prefijo', 'Prefijo', r.prefijo, 'Ej: SETP / FE')}
          ${inp('cfg-fe-numres', 'N° de resolución', r.numeroResolucion)}
          ${inp('cfg-fe-rangodesde', 'Rango desde', r.rangoDesde, 'Ej: 1')}
          ${inp('cfg-fe-rangohasta', 'Rango hasta', r.rangoHasta, 'Ej: 5000')}
          <label class="ui-field" style="gap:5px"><span class="ui-label">Fecha resolución</span><input id="cfg-fe-fecharesol" class="ui-input" type="date" value="${esc(r.fechaResolucion || '')}" /></label>
          <label class="ui-field" style="gap:5px"><span class="ui-label">Vigencia hasta</span><input id="cfg-fe-vigencia" class="ui-input" type="date" value="${esc(r.vigenciaHasta || '')}" /></label>
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:6px">En pruebas, Factus te da una resolución de prueba. En producción usa la que te autorizó la DIAN.</div>
      </div>

      <button id="cfg-guardar-fe"
        style="width:100%;padding:13px;background:#2563eb;color:white;border:0;border-radius:11px;cursor:pointer;font-size:14.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">
        Guardar datos de facturación electrónica
      </button>
    </div>
  `;
}


function htmlDatosNegocio(cfg) {
  const neg = cfg.negocio;
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Datos para la factura</h3>

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
        style="width:100%;padding:13px;background:#2563eb;color:white;border:0;border-radius:11px;cursor:pointer;font-size:14.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35);margin-top:8px">
        Guardar configuración
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
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Lector de código de barras</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Elige cómo escaneas en la pantalla de Ventas.</p>
      <select id="cfg-lector"
        style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
        <option value="pistola" ${cfg.lector === 'pistola' ? 'selected' : ''}>Pistola / Lector USB (no usa cámara)</option>
        <option value="manual" ${cfg.lector === 'manual' ? 'selected' : ''}>Manual (escribir en el buscador)</option>
      </select>
    </div>
  `;
}

function htmlCajon(cfg) {
  const c = cfg.cajon || {};
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Cajón de dinero</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Abre la gaveta automáticamente al confirmar cada venta.</p>

      <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;font-size:13.5px;color:#475569">
        <input id="cfg-cajon-activo" type="checkbox" ${c.activo ? 'checked' : ''} style="width:18px;height:18px"> Abrir cajón al confirmar la venta
      </label>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="cfg-cajon-conectar" style="padding:9px 13px;border:1px solid #cbd5e1;background:white;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;color:#475569">Conectar cajón / impresora</button>
        <button id="cfg-cajon-probar" style="padding:9px 13px;border:0;background:#2563eb;color:white;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">Probar (abrir cajón)</button>
      </div>
      <div id="cfg-cajon-estado" style="font-size:12px;color:#94a3b8"></div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:10px 12px;font-size:12px;color:#92400e;line-height:1.5">
        Como imprimes con el diálogo del navegador, lo más confiable es configurar tu impresora en Windows para <b>"abrir cajón al imprimir"</b>: así la gaveta salta sola con cada ticket. El botón <b>Probar</b> intenta abrirla por software (Web Serial); si tu impresora no aparece, usa el método del driver.
      </div>
    </div>
  `;
}

function htmlImpresora(cfg) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Impresora predeterminada</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Cuando imprimas una factura, el POS puede ir directo a una impresora o preguntarte cada vez.</p>
      <select id="cfg-impresora"
        style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
        <option value="preguntar" ${cfg.impresoraDefault === 'preguntar' ? 'selected' : ''}>Preguntar cada vez (recomendado)</option>
        <option value="pos" ${cfg.impresoraDefault === 'pos' ? 'selected' : ''}>POS 80mm (térmica)</option>
        <option value="carta" ${cfg.impresoraDefault === 'carta' ? 'selected' : ''}>Carta empresarial</option>
      </select>
    </div>
  `;
}

function htmlSync() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Sincronización con la nube</h3>
      <div id="cfg-sync-estado" style="font-size:14px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:11px 13px">Cargando estado…</div>
      <button id="cfg-sync-flush"
        style="padding:10px 14px;border:1px solid #e2e8f0;background:white;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;color:#475569">
        Reintentar pendientes
      </button>
      <p style="color:#94a3b8;font-size:12.5px;margin:0">El POS sigue funcionando aunque la nube esté caída. Los registros locales se subirán cuando vuelva la conexión.</p>
    </div>
  `;
}

function htmlExcel(stats) {
  const cardLado = (titulo, icono, count, idExp, idTpl, idImp) => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:14px">
      <div style="font-weight:700;font-size:14.5px;color:#0f172a;margin-bottom:10px">${icono} ${esc(titulo)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button id="${idExp}"
          style="padding:10px 12px;background:#0f172a;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          Exportar (${fmt(count)})
        </button>
        <button id="${idTpl}"
          style="padding:10px 12px;background:white;border:1px solid #e2e8f0;color:#475569;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:600;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          Descargar plantilla
        </button>
        <label
          style="padding:10px 12px;background:#2563eb;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">
          Importar Excel/CSV
          <input id="${idImp}" type="file" accept=".xlsx,.xls,.csv,.txt" style="display:none" />
        </label>
      </div>
    </div>
  `;

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Productos y clientes en Excel</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">
        Exporta tus datos, descarga una <b>plantilla lista para llenar</b>, o importa desde Excel/CSV.
        Al importar se sincronizará automáticamente en la nube y en las otras terminales conectadas.
      </p>
      <div style="display:grid;gap:10px;grid-template-columns:1fr 1fr">
        ${cardLado('Productos', '📦', stats.productos, 'cfg-exp-productos', 'cfg-tpl-productos', 'cfg-imp-productos')}
        ${cardLado('Clientes', '👥', stats.clientes, 'cfg-exp-clientes', 'cfg-tpl-clientes', 'cfg-imp-clientes')}
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:4px 0 0">
        Descarga la plantilla, llénala en Excel y vuelve a importarla. También puedes exportar lo que ya tienes, editarlo y reimportarlo.
      </p>
    </div>
  `;
}

function htmlRespaldo() {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Respaldo (copia de seguridad)</h3>
      <p style="color:#64748b;font-size:13.5px;margin:0">Guarda todo tu sistema en un archivo, o restáuralo cuando quieras.</p>
      <button id="cfg-export-json"
        style="padding:12px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">
        Exportar respaldo (JSON)
      </button>
      <label
        style="padding:12px;background:white;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569;text-align:center">
        Importar respaldo (JSON)
        <input id="cfg-import-json" type="file" accept=".json" style="display:none" />
      </label>
    </div>
  `;
}

function htmlDatosSistema(stats) {
  const badge = (icono, label, count) => `
    <span style="background:#e0e7ff;color:#1d4ed8;font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:7px">
      ${icono} ${fmt(count)} ${label}
    </span>
  `;

  const tipos = [
    ['stock', 'Solo el stock (dejar productos en 0)', 'Conserva nombre, código, precio y costo. Útil para hacer un conteo físico desde cero.'],
    ['productos', 'Productos completos (catálogo entero)', 'Elimina todos los productos. Quedas sin catálogo.'],
    ['clientes', 'Clientes', 'Borra el listado completo de clientes.'],
    ['ventas', 'Ventas / Facturas', 'Borra el historial de ventas.'],
    ['compras', 'Compras', 'Borra el historial de compras a proveedores.'],
    ['gastos', 'Gastos', 'Borra todos los gastos registrados.'],
    ['proveedores', 'Proveedores', 'Borra el listado de proveedores.'],
  ];

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:11px">
      <h3 style="font-size:18px;font-weight:700;margin:0;color:#0f172a">Datos del sistema</h3>
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
          Borrar seleccionado
        </button>
      </div>
    </div>
  `;
}
