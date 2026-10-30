/**
 * modules/contabilidad/contabilidad.service.js — Causación automática
 *
 * Escucha lo que esta terminal guarda o borra (ventas, compras, gastos,
 * ajustes de inventario) y le pide al motor contable que deje al día los
 * asientos de ese documento.
 *
 * REGLA DE ORO: la contabilidad NUNCA frena ni rompe una venta. Corre
 * después de guardar, en segundo plano y en fila; si un asiento falla,
 * el documento queda en la lista de "pendientes" para revisarlo.
 *
 * Los cambios que llegan de OTRAS terminales (realtime) no pasan por
 * aquí: cada terminal contabiliza lo que ella misma registra.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import * as Motor from '../../services/motor-contable.js';
import * as Auth from '../../services/auth.js';

/** Errores de causación (solo en esta terminal; no se suben). */
const KEY_ERRORES = 'contab_errores';

let _iniciado = false;
let _fila = Promise.resolve();
const _listeners = new Set();

function usuario() {
  return Auth.usuarioActual()?.nombre || '';
}

/** Ejecuta las tareas una detrás de otra (nunca dos a la vez). */
function enFila(tarea) {
  _fila = _fila.then(tarea).catch((e) => console.error('Contabilidad:', e));
  return _fila;
}

function avisar() {
  for (const fn of _listeners) {
    try { fn(); } catch (e) { /**/ }
  }
}

/** Para que la vista se refresque cuando cambia algo contable. */
export function onCambio(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ============================================================
//  REGISTRO DE ERRORES (pendientes por revisar)
// ============================================================

export async function errores() {
  try {
    const row = await db.get('kvs', KEY_ERRORES);
    return Array.isArray(row?.datos) ? row.datos : [];
  } catch (e) {
    return [];
  }
}

async function guardarErrores(lista) {
  await db.put('kvs', { id: KEY_ERRORES, valor: null, datos: lista.slice(-500) });
}

async function anotarError(tabla, id, numero, err) {
  const lista = (await errores()).filter((e) => e.id !== id);
  lista.push({ tabla, id, numero: numero || '', error: err?.message || String(err), fecha: new Date().toISOString() });
  await guardarErrores(lista);
}

async function quitarError(id) {
  const lista = await errores();
  if (lista.some((e) => e.id === id)) await guardarErrores(lista.filter((e) => e.id !== id));
}

/** Reemplaza la lista de pendientes (tras una revisión general). */
export async function fijarErrores(lista) {
  await guardarErrores(lista.map((e) => ({ ...e, fecha: e.fecha || new Date().toISOString() })));
  avisar();
}

// ============================================================
//  REACCIÓN A LO QUE GUARDA / BORRA ESTA TERMINAL
// ============================================================

function alEvento(e) {
  if (!Motor.TABLAS_FUENTE.includes(e.tabla)) return;
  if (e.tipo === 'local-ok' && e.item?.id) {
    const doc = e.item;
    enFila(async () => {
      const cfg = await Motor.config();
      if (!cfg.activa) return;
      try {
        const n = await Motor.contabilizar(e.tabla, doc, { usuario: usuario(), cfg });
        await quitarError(doc.id);
        if (n > 0) avisar();
      } catch (err) {
        console.warn(`⚠️ Contabilidad: no se pudo causar ${e.tabla}/${doc.id}:`, err.message || err);
        await anotarError(e.tabla, doc.id, doc.numero || doc.ref, err);
        avisar();
      }
    });
  } else if (e.tipo === 'local-borrado' && e.id) {
    enFila(async () => {
      try {
        const n = await Motor.alBorrar(e.tabla, e.id, { usuario: usuario() });
        await quitarError(e.id);
        if (n > 0) avisar();
      } catch (err) {
        await anotarError(e.tabla, e.id, '', err);
        avisar();
      }
    });
  }
}

/**
 * Se llama una vez al arrancar el POS (después de la sincronización
 * inicial). Si la contabilidad está activa, baja los asientos de la nube
 * para que esta terminal conozca lo que causaron las demás.
 */
export async function iniciar() {
  if (_iniciado) return;
  _iniciado = true;
  Sync.onChange(alEvento);
  try {
    const cfg = await Motor.config();
    if (cfg.activa && Sync.estaActiva() && (await verificarTablaNube()) === 'ok') {
      await Sync.descargar(Motor.TABLA);
      // En vivo: si otra caja contabiliza algo, esta terminal lo sabe y no
      // duplica al editar ese documento. (Si aun así pasara, "Revisar y
      // contabilizar todo" reversa el sobrante.)
      Sync.suscribir(Motor.TABLA, () => avisar());
    }
  } catch (e) {
    console.warn('Contabilidad: no se pudieron bajar los asientos:', e);
  }
}

/** Reintenta los documentos que quedaron pendientes. */
export async function reintentarPendientes() {
  const lista = await errores();
  let ok = 0;
  await enFila(async () => {
    for (const e of lista) {
      try {
        const doc = await db.get(e.tabla, e.id);
        if (doc) await Motor.contabilizar(e.tabla, doc, { usuario: usuario() });
        else await Motor.alBorrar(e.tabla, e.id, { usuario: usuario() });
        await quitarError(e.id);
        ok++;
      } catch (err) {
        await anotarError(e.tabla, e.id, e.numero, err);
      }
    }
  });
  avisar();
  return { ok, fallan: lista.length - ok };
}

/** Revisión general (también la primera carga), en la misma fila. */
export async function contabilizarTodo(opts = {}) {
  let r = null;
  await enFila(async () => {
    r = await Motor.contabilizarTodo({ ...opts, usuario: usuario() });
    await fijarErrores(r.errores);
  });
  avisar();
  return r;
}

/**
 * ¿Existe la tabla `asientos` en la nube? Sin ella, cada asiento
 * quedaría eternamente pendiente de subir.
 * @returns {Promise<'ok'|'falta'|'sin-nube'>}
 */
export async function verificarTablaNube() {
  if (!Supa.isReady()) return 'sin-nube';
  try {
    const { error } = await Supa.getClient().from(Motor.TABLA).select('id').limit(1);
    if (!error) return 'ok';
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || '')) return 'falta';
    return 'sin-nube';
  } catch (e) {
    return 'sin-nube';
  }
}
