/**
 * services/motor-contable.js — MOTOR CONTABLE de PosPunto
 *
 * Adaptado del motor de ContaExpress a los documentos de PosPunto. Cada
 * venta, abono, compra, gasto o ajuste de inventario genera SOLO su
 * asiento (la causación), con partida doble validada al centavo.
 *
 * Cómo funciona:
 *   1. `asientosDeseados(tabla, doc)` calcula qué asientos DEBERÍA tener
 *      el documento en su estado actual (una venta a crédito con dos
 *      abonos → 3 asientos: la venta y un recaudo por abono).
 *   2. `contabilizar(tabla, doc)` compara contra lo ya contabilizado:
 *        - igual        → no hace nada (idempotente)
 *        - cambió       → reversa el asiento viejo y crea el nuevo
 *        - ya no aplica → reversa el viejo
 *   3. `alBorrar(tabla, id)` reversa todo lo del documento borrado.
 *
 * Los asientos son INMUTABLES: nunca se editan ni se borran — se reversan
 * con un asiento inverso vinculado (pista de auditoría).
 *
 * Los ids son deterministas (se derivan del documento y su contenido),
 * así dos terminales que contabilicen el mismo documento no duplican.
 */

import * as db from './db.js';
import * as Sync from './sync.js';
import * as PUC from '../modules/contabilidad/puc.repo.js';
import { todayISO, nowISO } from '../core/dates.js';
import { round, num } from '../core/format.js';

export const TABLA = 'asientos';
const KEY_CONFIG = 'config_contable';

/** Tablas de PosPunto que generan contabilidad. */
export const TABLAS_FUENTE = ['ventas', 'compras', 'gastos', 'ajustes_inventario'];

// ============================================================
//  CONFIGURACIÓN (kvs 'config_contable', compartida entre terminales)
// ============================================================

export const CUENTAS_DEFAULT = {
  caja:            '110505',
  banco:           '111005',
  clientes:        '130505',  // cartera (CXC)
  proveedores:     '220505',  // CXP
  inventario:      '143505',
  ivaGenerado:     '240802',
  ingresos:        '413505',  // venta de mercancías
  costo:           '613505',
  sobrantes:       '429505',
  faltantes:       '539520',
  bajaProductos:   '539520',  // productos dañados / vencidos dados de baja
  gastoDefault:    '519595',
  patrimonioApertura: '313005', // contrapartida de los saldos iniciales
  // Cuenta donde entra / sale el dinero según el medio de pago
  medios: {
    efectivo:      '110505',
    transferencia: '111005',
    nequi:         '111010',
    daviplata:     '111015',
    qr:            '111020',
    tarjeta:       '111020',
    otro:          '110505',
  },
  // Cuenta de gasto por categoría del módulo Gastos
  gastos: {
    Servicios:     '513595',
    Nómina:        '510506',
    Arriendo:      '512010',
    Impuestos:     '511595',
    Transporte:    '513550',
    Mercadeo:      '523560',
    Mantenimiento: '514515',
    Insumos:       '519595',
    Comisiones:    '530505',
    Otros:         '519595',
  },
};

export const ETIQUETAS_MEDIOS = {
  efectivo: 'Efectivo', transferencia: 'Transferencia (banco)', nequi: 'Nequi',
  daviplata: 'Daviplata', qr: 'QR', tarjeta: 'Tarjeta / datáfono', otro: 'Otro',
};

/**
 * Configuración contable: { activa, fecha_inicio, cuentas }.
 * `activa` es el interruptor general; apagada, nada se contabiliza.
 */
export async function config() {
  let datos = {};
  try {
    const row = await db.get('kvs', KEY_CONFIG);
    datos = row?.datos || {};
  } catch (e) { /* sin config: valores por defecto */ }
  const c = datos.cuentas || {};
  return {
    activa: datos.activa === true,
    fecha_inicio: datos.fecha_inicio || '',
    cuentas: {
      ...CUENTAS_DEFAULT,
      ...c,
      medios: { ...CUENTAS_DEFAULT.medios, ...(c.medios || {}) },
      gastos: { ...CUENTAS_DEFAULT.gastos, ...(c.gastos || {}) },
    },
  };
}

export async function guardarConfig(cambios) {
  const actual = await config();
  const nueva = { ...actual, ...cambios };
  await Sync.guardar('kvs', { id: KEY_CONFIG, valor: null, datos: nueva });
  return nueva;
}

// ============================================================
//  HELPERS
// ============================================================

/** Crea una línea de asiento normalizada. */
function L(cuenta, { debito = 0, credito = 0, tercero_id = null, tercero_nombre = '', detalle = '' } = {}) {
  return {
    cuenta: String(cuenta),
    tercero_id: tercero_id || null,
    tercero_nombre: String(tercero_nombre || ''),
    detalle: String(detalle || ''),
    debito: round(num(debito), 2),
    credito: round(num(credito), 2),
  };
}

/** Quita líneas en cero (no aportan nada al asiento). */
function limpiar(lineas) {
  return lineas.filter((l) => l.debito > 0 || l.credito > 0);
}

const fecha10 = (f) => String(f || '').slice(0, 10) || todayISO();

/** Referencia corta para documentos sin número propio (gastos, compras sin ref). */
const refCorta = (id) => String(id || '').replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase();

/** Hash corto y estable de un texto (djb2) — para ids deterministas. */
function hash(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Firma del contenido contable de un asiento (fecha + líneas). */
function firmaDe(fecha, lineas) {
  const ls = lineas
    .map((l) => `${l.cuenta}|${l.tercero_id || ''}|${l.debito.toFixed(2)}|${l.credito.toFixed(2)}`)
    .sort()
    .join(';');
  return hash(`${fecha}#${ls}`);
}

/**
 * Cuenta del medio de pago a partir del texto que guarda PosPunto
 * ("Efectivo", "Transferencia (Nequi)", "QR", "tarjeta"…).
 */
export function cuentaMedio(texto, C) {
  const t = String(texto || '').toLowerCase();
  const M = C.medios;
  if (t.includes('nequi')) return M.nequi;
  if (t.includes('davi')) return M.daviplata;
  if (t.includes('qr')) return M.qr;
  if (t.includes('tarjeta') || t.includes('datáfono') || t.includes('datafono')) return M.tarjeta;
  if (t.includes('transfer') || t.includes('banco')) return M.transferencia;
  if (t.includes('efectivo') || t === '') return M.efectivo;
  return M.otro;
}

/** "$ 12.500" → 12500 (los montos del POS no llevan decimales). */
function montoDeTexto(s) {
  const digitos = String(s || '').replace(/[^\d]/g, '');
  return digitos ? Number(digitos) : 0;
}

/**
 * Débitos de una venta de contado según su medio de pago. El pago mixto
 * llega como "Mixto (Efectivo: $ 10.000, Nequi: $ 5.000)": lo que no es
 * efectivo va a su cuenta y el efectivo es el resto (así el cambio
 * entregado nunca descuadra el asiento).
 */
function debitosContado(metodo, total, C) {
  const texto = String(metodo || '');
  if (/^mixto/i.test(texto)) {
    const partes = [];
    const re = /([^:,()]+):\s*([^,)]+)/g;
    let m;
    while ((m = re.exec(texto))) {
      const etiqueta = m[1].trim();
      if (/efectivo/i.test(etiqueta)) continue;
      const valor = montoDeTexto(m[2]);
      if (valor > 0) partes.push({ cuenta: cuentaMedio(etiqueta, C), valor, etiqueta });
    }
    // Nunca más que el total en medios electrónicos
    let noEfectivo = round(partes.reduce((s, p) => s + p.valor, 0), 2);
    while (noEfectivo > total + 0.005 && partes.length) {
      const ult = partes[partes.length - 1];
      const exceso = round(noEfectivo - total, 2);
      ult.valor = round(Math.max(0, ult.valor - exceso), 2);
      if (ult.valor === 0) partes.pop();
      noEfectivo = round(partes.reduce((s, p) => s + p.valor, 0), 2);
    }
    const efectivo = round(total - noEfectivo, 2);
    return [
      L(C.medios.efectivo, { debito: efectivo, detalle: 'Pago en efectivo' }),
      ...partes.map((p) => L(p.cuenta, { debito: p.valor, detalle: `Pago ${p.etiqueta}` })),
    ];
  }
  return [L(cuentaMedio(texto, C), { debito: total, detalle: `Venta de contado (${texto || 'Efectivo'})` })];
}

function terceroCliente(v) {
  const nombre = v.cliente_nombre || v.cliente?.nombre || '';
  return {
    tercero_id: v.cliente_id || (nombre ? `cli:${nombre}` : 'cli:ocasional'),
    tercero_nombre: nombre || 'Cliente ocasional',
  };
}

function terceroProveedor(c) {
  const nombre = c.proveedor || '';
  return {
    tercero_id: c.proveedor_id || (nombre ? `prov:${nombre}` : 'prov:sin-nombre'),
    tercero_nombre: nombre || 'Proveedor',
  };
}

// ============================================================
//  REGLAS: qué asientos debe tener cada documento
// ============================================================
//
// Cada regla devuelve [{ origen_tipo, origen_id, numero, fecha,
// descripcion, lineas }]. Un documento sin efecto contable devuelve [].

function reglasVenta(v, C) {
  if (v.estado === 'anulada') return [];
  const out = [];
  const total = round(num(v.total), 2);
  const iva = round(Math.min(num(v.impuesto), total), 2);
  const base = round(total - iva, 2);
  const costo = round((v.items || []).reduce((s, it) => s + num(it.costo) * num(it.cantidad), 0), 2);
  const credito = v.tipoPago === 'credito';
  const ter = terceroCliente(v);

  if (total > 0 || costo > 0) {
    const debitos = credito
      ? [L(C.clientes, { debito: total, ...ter, detalle: 'Venta a crédito' })]
      : debitosContado(v.metodo_pago, total, C);
    out.push({
      origen_tipo: 'venta',
      origen_id: v.id,
      numero: `FV ${v.numero || ''}`.trim(),
      fecha: fecha10(v.fecha),
      descripcion: `Venta ${v.numero || ''} — ${ter.tercero_nombre}`,
      lineas: limpiar([
        ...debitos,
        L(C.ingresos, { credito: base, detalle: 'Ingreso por ventas' }),
        L(C.ivaGenerado, { credito: iva, detalle: 'IVA generado' }),
        L(C.costo, { debito: costo, detalle: 'Costo de ventas' }),
        L(C.inventario, { credito: costo, detalle: 'Salida de inventario' }),
      ]),
    });
  }

  // Recaudos: un asiento por abono (incluye el abono inicial)
  if (credito) {
    (v.abonos || []).forEach((a, i) => {
      const monto = round(num(a.monto), 2);
      if (monto <= 0) return;
      out.push({
        origen_tipo: 'recaudo',
        origen_id: `${v.id}:ab:${a.id || i}`,
        numero: `RC ${v.numero || ''}-${i + 1}`,
        fecha: fecha10(a.fecha || v.fecha),
        descripcion: `Abono ${i + 1} a la venta ${v.numero || ''} — ${ter.tercero_nombre}`,
        lineas: [
          L(cuentaMedio(a.metodo, C), { debito: monto, detalle: `Recaudo (${a.metodo || 'Efectivo'})` }),
          L(C.clientes, { credito: monto, ...ter, detalle: 'Abono de cliente' }),
        ],
      });
    });
  }
  return out;
}

function reglasCompra(c, C) {
  const out = [];
  const total = round(num(c.total), 2);
  const credito = c.tipoPago === 'credito';
  const ter = terceroProveedor(c);
  const ref = c.ref || refCorta(c.id);

  if (total > 0) {
    // Cuenta por pagar migrada (sin mercancía): es un saldo inicial
    const debito = c.sinInventario || c.origen === 'migracion'
      ? L(C.patrimonioApertura, { debito: total, detalle: 'Deuda inicial con proveedor' })
      : L(C.inventario, { debito: total, detalle: 'Entrada de mercancía' });
    out.push({
      origen_tipo: 'compra',
      origen_id: c.id,
      numero: `FC ${ref}`,
      fecha: fecha10(c.fecha),
      descripcion: `Compra ${ref} — ${ter.tercero_nombre}`,
      lineas: [
        debito,
        credito
          ? L(C.proveedores, { credito: total, ...ter, detalle: 'Compra a crédito' })
          : L(cuentaMedio(c.metodoPago, C), { credito: total, detalle: `Compra de contado (${c.metodoPago || 'Efectivo'})` }),
      ],
    });
  }

  if (credito) {
    (c.abonos || []).forEach((a, i) => {
      const monto = round(num(a.monto), 2);
      if (monto <= 0) return;
      out.push({
        origen_tipo: 'pago',
        origen_id: `${c.id}:ab:${a.id || i}`,
        numero: `CE ${ref}-${i + 1}`,
        fecha: fecha10(a.fecha || c.fecha),
        descripcion: `Pago ${i + 1} de la compra ${ref} — ${ter.tercero_nombre}`,
        lineas: [
          L(C.proveedores, { debito: monto, ...ter, detalle: 'Pago a proveedor' }),
          L(cuentaMedio(a.metodo, C), { credito: monto, detalle: `Pago (${a.metodo || 'Efectivo'})` }),
        ],
      });
    });
  }
  return out;
}

function reglasGasto(g, C) {
  const monto = round(num(g.monto), 2);
  if (monto <= 0) return [];
  const esBaja = g.categoria === 'Productos';
  const lineas = esBaja
    ? [L(C.bajaProductos, { debito: monto, detalle: g.concepto || 'Baja de productos' }),
       L(C.inventario, { credito: monto, detalle: 'Salida de inventario' })]
    : [L(C.gastos[g.categoria] || C.gastoDefault, { debito: monto, detalle: g.concepto || g.categoria || 'Gasto' }),
       L(C.caja, { credito: monto, detalle: 'Pago del gasto' })];
  return [{
    origen_tipo: esBaja ? 'baja' : 'gasto',
    origen_id: g.id,
    numero: `GS ${refCorta(g.id)}`,
    fecha: fecha10(g.fecha),
    descripcion: `${esBaja ? 'Baja' : 'Gasto'} — ${g.concepto || g.categoria || ''}`.trim(),
    lineas,
  }];
}

function reglasAjuste(a, C) {
  if (a.estado && a.estado !== 'activo') return [];
  const valor = round(num(a.valor), 2);
  if (valor === 0) return [];
  const abs = Math.abs(valor);
  const lineas = valor > 0
    ? [L(C.inventario, { debito: abs, detalle: 'Sobrante de inventario' }),
       L(C.sobrantes, { credito: abs, detalle: 'Sobrante de inventario' })]
    : [L(C.faltantes, { debito: abs, detalle: 'Faltante de inventario' }),
       L(C.inventario, { credito: abs, detalle: 'Faltante de inventario' })];
  return [{
    origen_tipo: 'ajuste_inventario',
    origen_id: a.id,
    numero: a.numero || `AJ ${refCorta(a.id)}`,
    fecha: fecha10(a.fecha),
    descripcion: `Ajuste de inventario ${a.numero || ''}`.trim(),
    lineas,
  }];
}

const REGLAS = {
  ventas: reglasVenta,
  compras: reglasCompra,
  gastos: reglasGasto,
  ajustes_inventario: reglasAjuste,
};

/** Asientos que debería tener un documento (sin guardar nada). */
export function asientosDeseados(tabla, doc, cfg) {
  const regla = REGLAS[tabla];
  if (!regla || !doc || !doc.id) return [];
  const desde = cfg.fecha_inicio || '0000';
  return regla(doc, cfg.cuentas).filter((a) => a.fecha >= desde && a.lineas.length > 0);
}

// ============================================================
//  VALIDACIÓN (el corazón de la integridad contable)
// ============================================================

/**
 * Valida un conjunto de líneas. Lanza Error si algo está mal.
 * Devuelve { totalDebito, totalCredito } si todo cuadra.
 */
export async function validarLineas(lineas) {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    throw new Error('Un asiento necesita al menos 2 líneas (partida doble)');
  }
  let totalDebito = 0;
  let totalCredito = 0;
  for (const l of lineas) {
    const deb = round(num(l.debito), 2);
    const cre = round(num(l.credito), 2);
    if (deb < 0 || cre < 0) throw new Error(`Línea con valor negativo en cuenta ${l.cuenta}`);
    if (deb > 0 && cre > 0) throw new Error(`La línea de la cuenta ${l.cuenta} tiene débito Y crédito a la vez`);
    if (deb === 0 && cre === 0) throw new Error(`La línea de la cuenta ${l.cuenta} está en cero`);
    const cuenta = await PUC.validarParaMovimiento(l.cuenta);
    if (cuenta.requiere_tercero && !l.tercero_id) {
      throw new Error(`La cuenta ${cuenta.codigo} (${cuenta.nombre}) exige un tercero`);
    }
    totalDebito = round(totalDebito + deb, 2);
    totalCredito = round(totalCredito + cre, 2);
  }
  if (Math.abs(totalDebito - totalCredito) > 0.005) {
    throw new Error(`Asiento descuadrado: débitos ${totalDebito} ≠ créditos ${totalCredito}`);
  }
  return { totalDebito, totalCredito };
}

// ============================================================
//  NÚCLEO: construir, guardar y reversar asientos
// ============================================================

/** Arma el asiento completo (validado) sin guardarlo. */
async function construir(d, { doc_tabla, doc_id, version = 0, usuario = '' }) {
  const { totalDebito, totalCredito } = await validarLineas(d.lineas);
  const firma = firmaDe(d.fecha, d.lineas);
  return {
    id: `as_${hash(`${d.origen_id}#${firma}#${version}`)}_${hash(d.origen_id)}`,
    numero: d.numero || '',
    fecha: d.fecha,
    periodo: d.fecha.slice(0, 7),
    origen_tipo: d.origen_tipo,
    origen_id: d.origen_id,
    doc_tabla,
    doc_id,
    descripcion: String(d.descripcion || '').trim(),
    lineas: d.lineas,
    total_debito: totalDebito,
    total_credito: totalCredito,
    estado: 'activo',
    firma,
    reversa_de: null,
    reversado_por: null,
    creado_por: usuario,
    creado: nowISO(),
  };
}

/** Asiento inverso (débito ↔ crédito) de uno existente, fechado hoy. */
function inversoDe(original, motivo, usuario = '') {
  const lineas = (original.lineas || []).map((l) =>
    L(l.cuenta, {
      debito: l.credito, credito: l.debito,
      tercero_id: l.tercero_id, tercero_nombre: l.tercero_nombre,
      detalle: `Reversión: ${l.detalle || ''}`,
    }));
  const fecha = todayISO() < original.fecha ? original.fecha : todayISO();
  return {
    id: `rv_${original.id}`,
    numero: `RV ${original.numero || ''}`.trim(),
    fecha,
    periodo: fecha.slice(0, 7),
    origen_tipo: 'reversion',
    origen_id: original.origen_id,
    doc_tabla: original.doc_tabla,
    doc_id: original.doc_id,
    descripcion: `Reversión de ${original.numero || original.descripcion}${motivo ? ' — ' + motivo : ''}`,
    lineas,
    total_debito: original.total_credito,
    total_credito: original.total_debito,
    estado: 'activo',
    firma: `rv:${original.firma || ''}`,
    reversa_de: original.id,
    reversado_por: null,
    creado_por: usuario,
    creado: nowISO(),
  };
}

/** Asientos de un documento (por el índice doc_id, sin leer toda la tabla). */
async function asientosDelDocumento(docId) {
  try {
    return await db.getAllByIndexRange(TABLA, 'doc_id', docId, docId);
  } catch (e) {
    return (await db.getAll(TABLA)).filter((a) => a.doc_id === docId);
  }
}

/**
 * Calcula qué hay que guardar para dejar un documento al día:
 * devuelve la lista de asientos nuevos/actualizados (sin guardar).
 * `existentes` son los asientos que ya tiene el documento.
 */
async function planDocumento({ deseados, existentes, doc_tabla, doc_id, motivo, usuario }) {
  const guardar = [];
  const vigentes = existentes.filter((a) => a.estado === 'activo' && a.origen_tipo !== 'reversion');
  const usados = new Set();

  for (const d of deseados) {
    const firma = firmaDe(d.fecha, d.lineas);
    const actual = vigentes.find((a) => a.origen_id === d.origen_id);
    if (actual && actual.firma === firma) { usados.add(actual.id); continue; }
    if (actual) {
      usados.add(actual.id);
      const inv = inversoDe(actual, motivo, usuario);
      guardar.push(inv, { ...actual, estado: 'reversado', reversado_por: inv.id });
    }
    // version = cuántos asientos ya tuvo este origen (evita chocar ids)
    const version = existentes.filter((a) => a.origen_id === d.origen_id && a.origen_tipo !== 'reversion').length;
    guardar.push(await construir(d, { doc_tabla, doc_id, version, usuario }));
  }

  // Lo que estaba contabilizado y ya no aplica → se reversa
  for (const a of vigentes) {
    if (usados.has(a.id)) continue;
    const inv = inversoDe(a, motivo, usuario);
    guardar.push(inv, { ...a, estado: 'reversado', reversado_por: inv.id });
  }
  return guardar;
}

/**
 * Deja la contabilidad de UN documento al día con su estado actual.
 * Devuelve cuántos asientos se escribieron (0 = ya estaba al día).
 */
export async function contabilizar(tabla, doc, { usuario = '', cfg = null } = {}) {
  const c = cfg || (await config());
  if (!c.activa || !REGLAS[tabla] || !doc?.id) return 0;
  const deseados = asientosDeseados(tabla, doc, c);
  const existentes = await asientosDelDocumento(doc.id);
  const guardar = await planDocumento({ deseados, existentes, doc_tabla: tabla, doc_id: doc.id, motivo: 'documento modificado', usuario });
  for (const a of guardar) await Sync.guardar(TABLA, a);
  return guardar.length;
}

/** Un documento fue borrado: reversa todo lo que tenía contabilizado. */
export async function alBorrar(tabla, docId, { usuario = '' } = {}) {
  const c = await config();
  if (!c.activa || !REGLAS[tabla] || !docId) return 0;
  const existentes = await asientosDelDocumento(docId);
  const guardar = await planDocumento({ deseados: [], existentes, doc_tabla: tabla, doc_id: docId, motivo: 'documento eliminado', usuario });
  for (const a of guardar) await Sync.guardar(TABLA, a);
  return guardar.length;
}

/**
 * Revisa TODOS los documentos desde la fecha de inicio y deja la
 * contabilidad al día (también sirve para la primera carga). Si un
 * documento falla, sigue con los demás y lo reporta.
 *
 * @returns {Promise<{documentos, escritos, errores: [{tabla, id, numero, error}]}>}
 */
export async function contabilizarTodo({ onProgress = () => {}, usuario = '' } = {}) {
  const cfg = await config();
  if (!cfg.activa) throw new Error('La contabilidad está apagada');

  // Índice de asientos por documento (una sola lectura)
  const porDoc = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (!a.doc_id) continue;
    if (!porDoc.has(a.doc_id)) porDoc.set(a.doc_id, []);
    porDoc.get(a.doc_id).push(a);
  }

  const docs = [];
  for (const tabla of TABLAS_FUENTE) {
    for (const doc of await db.getAll(tabla)) docs.push({ tabla, doc });
  }
  const vivos = new Set(docs.map((x) => x.doc.id));

  const pendientes = [];
  const errores = [];
  let i = 0;
  for (const { tabla, doc } of docs) {
    i++;
    try {
      const deseados = asientosDeseados(tabla, doc, cfg);
      const existentes = porDoc.get(doc.id) || [];
      if (deseados.length === 0 && existentes.length === 0) continue;
      pendientes.push(...(await planDocumento({ deseados, existentes, doc_tabla: tabla, doc_id: doc.id, motivo: 'revisión general', usuario })));
    } catch (e) {
      errores.push({ tabla, id: doc.id, numero: doc.numero || doc.ref || '', error: e.message || String(e) });
    }
    if (i % 200 === 0) onProgress({ fase: 'revisando', n: i, total: docs.length });
  }

  // Documentos que ya no existen pero quedaron con asientos vigentes
  for (const [docId, existentes] of porDoc) {
    const tabla = existentes[0]?.doc_tabla;
    if (vivos.has(docId) || !REGLAS[tabla]) continue;
    pendientes.push(...(await planDocumento({ deseados: [], existentes, doc_tabla: tabla, doc_id: docId, motivo: 'documento eliminado', usuario })));
  }

  if (pendientes.length > 0) {
    await Sync.guardarVarios(TABLA, pendientes, {
      batchSize: 25,
      onProgress: (n, total) => onProgress({ fase: 'guardando', n, total }),
    });
  }
  return { documentos: docs.length, escritos: pendientes.length, errores };
}

// ============================================================
//  SALDOS INICIALES (asiento de apertura)
// ============================================================

export const APERTURA_ID = 'apertura';

/** Asiento de apertura vigente (o null). */
export async function aperturaActual() {
  const todos = await asientosDelDocumento(APERTURA_ID);
  return todos.find((a) => a.estado === 'activo' && a.origen_tipo === 'apertura') || null;
}

/**
 * Guarda los saldos iniciales. Recibe las líneas de activos y pasivos;
 * la diferencia se cuadra contra la cuenta de patrimonio configurada.
 * Si ya había una apertura, se reversa y se crea la nueva.
 */
export async function guardarApertura({ fecha, lineas, usuario = '' }) {
  const cfg = await config();
  if (!fecha) throw new Error('Indica la fecha de los saldos iniciales');
  const ls = limpiar(lineas.map((l) => L(l.cuenta, l)));
  if (ls.length === 0) throw new Error('No hay saldos para registrar');
  const dif = round(ls.reduce((s, l) => s + l.debito - l.credito, 0), 2);
  if (dif !== 0) {
    ls.push(L(cfg.cuentas.patrimonioApertura, dif > 0
      ? { credito: dif, detalle: 'Patrimonio inicial' }
      : { debito: -dif, detalle: 'Patrimonio inicial (negativo)' }));
  }
  const deseado = {
    origen_tipo: 'apertura',
    origen_id: APERTURA_ID,
    numero: `SI ${fecha}`,
    fecha,
    descripcion: `Saldos iniciales al ${fecha}`,
    lineas: ls,
  };
  const existentes = await asientosDelDocumento(APERTURA_ID);
  const guardar = await planDocumento({ deseados: [deseado], existentes, doc_tabla: 'apertura', doc_id: APERTURA_ID, motivo: 'saldos iniciales corregidos', usuario });
  for (const a of guardar) await Sync.guardar(TABLA, a);
  return guardar.length;
}

// ============================================================
//  CONSULTAS
// ============================================================
//
// Los asientos reversados Y sus reversiones se incluyen siempre (se
// anulan entre sí, que es lo contablemente correcto).

export async function libroDiario({ desde = '0000', hasta = '9999' } = {}) {
  const todos = (await db.getAll(TABLA)).filter((a) => a.fecha >= desde && a.fecha <= hasta);
  todos.sort((a, b) => (a.fecha + a.creado).localeCompare(b.fecha + b.creado));
  return todos;
}

/**
 * Balance de prueba: por subcuenta, saldo anterior, débitos, créditos y
 * saldo final (en términos débito +). Los totales SIEMPRE deben cuadrar.
 */
export async function balancePrueba({ desde = '0000', hasta = '9999' } = {}) {
  const porCuenta = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha > hasta) continue;
    for (const l of a.lineas || []) {
      const c = String(l.cuenta);
      if (!porCuenta.has(c)) porCuenta.set(c, { saldoAnterior: 0, debitos: 0, creditos: 0 });
      const acc = porCuenta.get(c);
      if (a.fecha < desde) acc.saldoAnterior = round(acc.saldoAnterior + num(l.debito) - num(l.credito), 2);
      else {
        acc.debitos = round(acc.debitos + num(l.debito), 2);
        acc.creditos = round(acc.creditos + num(l.credito), 2);
      }
    }
  }
  const filas = [];
  let totDeb = 0, totCre = 0;
  for (const [codigo, acc] of [...porCuenta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const info = await PUC.obtener(codigo);
    filas.push({
      cuenta: codigo,
      nombre: info?.nombre || '(cuenta no catalogada)',
      naturaleza: info?.naturaleza || 'D',
      ...acc,
      saldoFinal: round(acc.saldoAnterior + acc.debitos - acc.creditos, 2),
    });
    totDeb = round(totDeb + acc.debitos, 2);
    totCre = round(totCre + acc.creditos, 2);
  }
  return { filas, totalDebitos: totDeb, totalCreditos: totCre, cuadrado: Math.abs(totDeb - totCre) <= 0.005 };
}

/**
 * Movimiento neto de una cuenta SIN contar los saldos iniciales. Sirve
 * para deducir el inventario a la fecha de inicio: valor de hoy menos
 * lo que ya movieron las compras, ventas y ajustes contabilizados.
 */
export async function movimientoSinApertura(cuenta) {
  let s = 0;
  for (const a of await db.getAll(TABLA)) {
    if (a.doc_id === APERTURA_ID) continue;
    for (const l of a.lineas || []) {
      if (l.cuenta === String(cuenta)) s = round(s + num(l.debito) - num(l.credito), 2);
    }
  }
  return s;
}

/** Saldo (en términos débito +) de una cuenta o prefijo a una fecha. */
export async function saldo(prefijo, { hasta = '9999' } = {}) {
  let s = 0;
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha > hasta) continue;
    for (const l of a.lineas || []) {
      if (String(l.cuenta).startsWith(String(prefijo))) s = round(s + num(l.debito) - num(l.credito), 2);
    }
  }
  return s;
}
