/**
 * modules/documentos/documentos.repo.js — Documentos comerciales
 *
 * Una sola tabla `documentos` para todos los tipos. Lo propio de cada
 * tipo va dentro de `data` (jsonb), así la tabla de la nube no necesita
 * columnas nuevas cuando se agregue un tipo:
 *
 *   recibo_caja   plata que entra: abonos a ventas a crédito y/o otros conceptos
 *   egreso        plata que sale: pagos a compras a crédito y/o otros conceptos
 *   nota_credito  devolución o descuento sobre una venta
 *   nota_debito   mayor valor cobrado sobre una venta a crédito
 *   cotizacion    oferta al cliente (se convierte en remisión o en venta)
 *   remision      entrega de mercancía pendiente de facturar
 *   orden_compra  pedido al proveedor (al recibirlo se vuelve compra)
 *   traslado      plata que pasa de una caja o banco a otro
 *
 * REGLA: los abonos a ventas y compras se registran con los mismos
 * métodos del POS (VentasRepo.abonar / ComprasRepo.abonar). Así Cuentas
 * por cobrar, Facturas de compra y la contabilidad dicen siempre lo mismo.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Auth from '../../services/auth.js';
import * as Motor from '../../services/motor-contable.js';
import * as VentasRepo from '../ventas/ventas.repo.js';
import * as ComprasRepo from '../compras/compras.repo.js';
import { exigirTablas } from '../contabilidad/contabilidad.service.js';
import { uid } from '../../core/strings.js';
import { todayISO, nowISO } from '../../core/dates.js';
import { round, num } from '../../core/format.js';

export const TABLA = 'documentos';

export const TIPOS = {
  recibo_caja:  { nombre: 'Recibo de caja',         plural: 'Recibos de caja',          prefijo: 'RC' },
  egreso:       { nombre: 'Comprobante de egreso',  plural: 'Comprobantes de egreso',   prefijo: 'CE' },
  nota_credito: { nombre: 'Nota crédito',           plural: 'Notas crédito',            prefijo: 'NC' },
  nota_debito:  { nombre: 'Nota débito',            plural: 'Notas débito',             prefijo: 'ND' },
  cotizacion:   { nombre: 'Cotización',             plural: 'Cotizaciones',             prefijo: 'COT' },
  remision:     { nombre: 'Remisión',               plural: 'Remisiones',               prefijo: 'REM' },
  orden_compra: { nombre: 'Orden de compra',        plural: 'Órdenes de compra',        prefijo: 'OC' },
  traslado:     { nombre: 'Traslado de fondos',     plural: 'Traslados',                prefijo: 'TF' },
};

export const ESTADOS = {
  activo: 'Activo', anulado: 'Anulado', pendiente: 'Pendiente',
  facturada: 'Facturada', convertida: 'Convertida en remisión', recibida: 'Recibida',
};

const usuario = () => Auth.usuarioActual()?.nombre || '';

// ============================================================
//  LECTURA
// ============================================================

export async function listar(tipo = null) {
  const todos = await db.getAll(TABLA);
  return todos
    .filter((d) => !tipo || d.tipo === tipo)
    .sort((a, b) => (b.fecha + (b.creado || '')).localeCompare(a.fecha + (a.creado || '')));
}

export async function obtener(id) {
  return id ? db.get(TABLA, id) : null;
}

async function siguienteNumero(tipo) {
  const pref = TIPOS[tipo].prefijo;
  let max = 0;
  for (const d of await listar(tipo)) {
    const m = String(d.numero || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${pref}-${String(max + 1).padStart(4, '0')}`;
}

// ============================================================
//  ITEMS (cotizaciones, remisiones, órdenes de compra, notas)
// ============================================================

/** Normaliza items y calcula subtotal, IVA y total de cada uno. */
export function calcularItems(items, { compra = false } = {}) {
  const out = (items || [])
    .filter((it) => it.nombre && num(it.cantidad) > 0)
    .map((it) => {
      const cantidad = num(it.cantidad);
      const precio = round(num(compra ? it.costo : it.precio), 2);
      const pct = compra ? 0 : num(it.impuesto_pct);
      const subtotal = round(precio * cantidad, 2);
      const impuesto = round(subtotal * pct / 100, 2);
      return {
        producto_id: it.producto_id || null, codigo: it.codigo || '', nombre: String(it.nombre),
        cantidad, precio: compra ? 0 : precio, costo: compra ? precio : round(num(it.costo), 2),
        impuesto_pct: pct, subtotal, impuesto, total: round(subtotal + impuesto, 2),
      };
    });
  const subtotal = round(out.reduce((s, it) => s + it.subtotal, 0), 2);
  const impuesto = round(out.reduce((s, it) => s + it.impuesto, 0), 2);
  return { items: out, subtotal, impuesto, total: round(subtotal + impuesto, 2) };
}

function base(tipo, datos, extra) {
  return {
    id: datos.id || uid(),
    tipo,
    numero: datos.numero || null,
    fecha: datos.fecha || todayISO(),
    estado: 'activo',
    tercero_id: datos.tercero_id || null,
    tercero_nombre: String(datos.tercero_nombre || '').trim(),
    total: 0,
    items: [],
    data: {},
    creado: datos.creado || nowISO(),
    creado_por: datos.creado_por || usuario(),
    ...extra,
  };
}

async function guardarDoc(doc) {
  if (!doc.numero) doc.numero = await siguienteNumero(doc.tipo);
  await Sync.guardar(TABLA, doc);
  return doc;
}

// ============================================================
//  RECIBO DE CAJA y COMPROBANTE DE EGRESO
// ============================================================

/**
 * Recibo de caja: plata que entra de un tercero.
 * @param {Object} d - { fecha, tercero_id, tercero_nombre, medio,
 *   aplicaciones: [{ venta_id, monto }], conceptos: [{ cuenta, detalle, valor }], nota }
 */
export async function guardarRecibo(d) {
  return guardarMovimiento('recibo_caja', d);
}

/**
 * Comprobante de egreso: plata que sale hacia un tercero.
 * @param {Object} d - { fecha, tercero_id, tercero_nombre, medio,
 *   aplicaciones: [{ compra_id, monto }], conceptos: [{ cuenta, detalle, valor }], nota }
 */
export async function guardarEgreso(d) {
  return guardarMovimiento('egreso', d);
}

async function guardarMovimiento(tipo, d) {
  await exigirTablas();
  const esRecibo = tipo === 'recibo_caja';
  if (!d.tercero_nombre) throw new Error(esRecibo ? '¿Quién paga? Escoge el tercero' : '¿A quién se le paga? Escoge el tercero');
  if (!d.medio) throw new Error('Escoge el medio de pago');
  const aplic = (d.aplicaciones || []).filter((a) => num(a.monto) > 0);
  const conceptos = (d.conceptos || []).filter((c) => c.cuenta && num(c.valor) > 0)
    .map((c) => ({ cuenta: String(c.cuenta), detalle: String(c.detalle || ''), valor: round(num(c.valor), 2) }));
  if (!aplic.length && !conceptos.length) throw new Error('No hay nada que registrar: aplica a facturas o agrega un concepto');
  for (const c of conceptos) await Motor.validarLineas([{ cuenta: c.cuenta, debito: 1, tercero_id: d.tercero_id || 'x' }, { cuenta: c.cuenta, credito: 1, tercero_id: d.tercero_id || 'x' }]);

  const doc = base(tipo, d, {});
  doc.numero = await siguienteNumero(tipo);
  const metodo = Motor.ETIQUETAS_MEDIOS[d.medio] || d.medio;

  // 1) Abonos a las ventas / compras (por el mismo camino del POS)
  const aplicadas = [];
  for (const a of aplic) {
    const monto = round(num(a.monto), 2);
    const ref = { monto, metodo, fecha: doc.fecha, nota: `${TIPOS[tipo].nombre} ${doc.numero}` };
    if (esRecibo) {
      const v = await VentasRepo.abonar(a.venta_id, ref);
      aplicadas.push({ venta_id: v.id, numero: v.numero, monto, abono_id: v.abonos[v.abonos.length - 1].id });
    } else {
      const c = await ComprasRepo.abonar(a.compra_id, ref);
      aplicadas.push({ compra_id: c.id, numero: c.ref || '', monto, abono_id: c.abonos[c.abonos.length - 1].id });
    }
  }

  // 2) El documento (sus "otros conceptos" generan su propio asiento)
  doc.total = round(aplicadas.reduce((s, a) => s + a.monto, 0) + conceptos.reduce((s, c) => s + c.valor, 0), 2);
  doc.data = { medio: d.medio, aplicaciones: aplicadas, conceptos, nota: String(d.nota || '').trim() };
  return guardarDoc(doc);
}

/** Quita un abono de una venta o compra y le devuelve el saldo. */
async function quitarAbono(tabla, docId, abonoId) {
  const x = await db.get(tabla, docId);
  if (!x) return;
  const ab = (x.abonos || []).find((a) => a.id === abonoId);
  if (!ab) return;
  await Sync.guardar(tabla, {
    ...x,
    abonos: x.abonos.filter((a) => a.id !== abonoId),
    saldo: round(num(x.saldo) + num(ab.monto), 2),
  });
}

// ============================================================
//  NOTAS CRÉDITO Y DÉBITO (sobre una venta)
// ============================================================

/**
 * @param {Object} d - { tipo: 'nota_credito'|'nota_debito', venta_id, fecha, motivo,
 *   items?: [{ producto_id, nombre, cantidad, precio, impuesto_pct, costo }],   (devolución)
 *   valor?: number, impuesto_pct?: number,                                      (descuento / cargo)
 *   devolver_inventario?: boolean, medio?: string (reintegro si la venta fue de contado) }
 */
export async function guardarNota(d) {
  await exigirTablas();
  const tipo = d.tipo === 'nota_debito' ? 'nota_debito' : 'nota_credito';
  const venta = await db.get('ventas', d.venta_id);
  if (!venta) throw new Error('Escoge la venta a la que aplica la nota');
  if (!String(d.motivo || '').trim()) throw new Error('Escribe el motivo de la nota');
  const credito = venta.tipoPago === 'credito';

  let calc;
  if (Array.isArray(d.items) && d.items.length) {
    calc = calcularItems(d.items);
  } else {
    const total = round(num(d.valor), 2);
    const pct = num(d.impuesto_pct);
    const subtotal = round(total / (1 + pct / 100), 2);
    calc = { items: [], subtotal, impuesto: round(total - subtotal, 2), total };
  }
  if (calc.total <= 0) throw new Error('El valor de la nota debe ser mayor a cero');

  // Las notas de una venta viven en venta.data.notas (la tabla ventas de
  // la nube no tiene columna propia para ellas; `data` es jsonb).
  const previas = (venta.data?.notas || []).filter((n) => n.tipo === 'nota_credito');
  const yaDevuelto = round(previas.reduce((s, n) => s + num(n.total), 0), 2);
  if (tipo === 'nota_credito') {
    if (calc.total > round(num(venta.total) - yaDevuelto, 2) + 0.5) throw new Error('La nota supera lo que queda de la venta');
    if (credito && calc.total > num(venta.saldo) + 0.5) throw new Error(`La venta solo debe ${num(venta.saldo)}: la nota no puede ser mayor al saldo pendiente`);
    if (!credito && !d.medio) throw new Error('La venta fue de contado: escoge por dónde se le devuelve la plata');
  } else if (!credito) {
    throw new Error('La nota débito solo aplica a ventas a crédito (queda como mayor valor de la deuda)');
  }

  const devolver = tipo === 'nota_credito' && !!d.devolver_inventario && calc.items.length > 0;
  const costo = devolver ? round(calc.items.reduce((s, it) => s + num(it.costo) * num(it.cantidad), 0), 2) : 0;

  const doc = base(tipo, {
    ...d,
    tercero_id: venta.cliente_id || (venta.cliente_nombre ? `cli:${venta.cliente_nombre}` : 'cli:ocasional'),
    tercero_nombre: venta.cliente_nombre || 'Cliente ocasional',
  }, {});
  doc.numero = await siguienteNumero(tipo);
  doc.items = calc.items;
  doc.total = calc.total;
  doc.data = {
    venta_id: venta.id, venta_numero: venta.numero, motivo: String(d.motivo).trim(),
    subtotal: calc.subtotal, impuesto: calc.impuesto,
    afecta: credito ? 'cartera' : 'caja', medio: credito ? null : d.medio,
    devolver_inventario: devolver, costo,
    cuenta_ingreso: d.cuenta_ingreso || null,
  };

  // Efecto en la venta: el saldo y la lista de notas
  const notas = [...(venta.data?.notas || []), { id: doc.id, tipo, numero: doc.numero, total: doc.total, fecha: doc.fecha }];
  const saldo = credito ? round(Math.max(0, num(venta.saldo) + (tipo === 'nota_debito' ? doc.total : -doc.total)), 2) : num(venta.saldo);
  await Sync.guardar('ventas', { ...venta, saldo, data: { ...(venta.data || {}), notas } });

  // Devolución de mercancía al inventario
  if (devolver) {
    for (const it of calc.items) if (it.producto_id) await Sync.ajustarStock(it.producto_id, it.cantidad);
  }
  return guardarDoc(doc);
}

// ============================================================
//  COTIZACIÓN, REMISIÓN, ORDEN DE COMPRA
// ============================================================

/**
 * @param {string} tipo - 'cotizacion' | 'remision' | 'orden_compra'
 * @param {Object} d - { id?, fecha, tercero_id, tercero_nombre, items, nota, validez? (días) }
 */
export async function guardarPedido(tipo, d) {
  await exigirTablas();
  if (!['cotizacion', 'remision', 'orden_compra'].includes(tipo)) throw new Error('Tipo inválido');
  if (!d.tercero_nombre) throw new Error(tipo === 'orden_compra' ? 'Escoge el proveedor' : 'Escoge el cliente');
  const previo = d.id ? await obtener(d.id) : null;
  if (previo && previo.estado !== 'pendiente') throw new Error('Este documento ya no se puede editar');
  const calc = calcularItems(d.items, { compra: tipo === 'orden_compra' });
  if (!calc.items.length) throw new Error('Agrega al menos un producto');
  const doc = base(tipo, { ...(previo || {}), ...d }, { estado: 'pendiente' });
  if (previo) { doc.numero = previo.numero; doc.creado = previo.creado; }
  doc.items = calc.items;
  doc.total = calc.total;
  doc.data = { ...(previo?.data || {}), subtotal: calc.subtotal, impuesto: calc.impuesto, nota: String(d.nota || '').trim(), validez: num(d.validez) || null, ...(d.data || {}) };
  return guardarDoc(doc);
}

/** Cotización → remisión (la cotización queda "convertida"). */
export async function convertirEnRemision(cotId) {
  const cot = await obtener(cotId);
  if (!cot || cot.tipo !== 'cotizacion' || cot.estado !== 'pendiente') throw new Error('La cotización no está pendiente');
  const rem = await guardarPedido('remision', {
    tercero_id: cot.tercero_id, tercero_nombre: cot.tercero_nombre, items: cot.items,
    nota: cot.data?.nota || '', data: { origen_id: cot.id, origen_numero: cot.numero },
  });
  await Sync.guardar(TABLA, { ...cot, estado: 'convertida', data: { ...cot.data, remision_id: rem.id, remision_numero: rem.numero } });
  return rem;
}

/**
 * Cotización o remisión → venta del POS (descuenta stock y se
 * contabiliza sola, igual que una venta en caja).
 * @param {Object} pago - { metodo_pago, tipoPago, abonoInicial, metodoAbono, vence }
 */
export async function facturar(docId, pago) {
  const d = await obtener(docId);
  if (!d || !['cotizacion', 'remision'].includes(d.tipo) || d.estado !== 'pendiente') throw new Error('El documento no está pendiente');
  const cliente = d.tercero_id ? await db.get('clientes', d.tercero_id) : null;
  if (pago.tipoPago === 'credito' && !cliente) throw new Error('Para vender a crédito el tercero debe ser cliente');
  if (d.items.some((it) => !it.producto_id)) throw new Error('Hay líneas sin producto del inventario: no se pueden facturar desde el POS');
  const venta = await VentasRepo.registrar({
    items: d.items.map((it) => ({
      producto_id: it.producto_id, codigo: it.codigo, nombre: it.nombre, precio: it.precio,
      cantidad: it.cantidad, costo: it.costo, impuesto_pct: it.impuesto_pct, descuento: 0,
    })),
    cliente: cliente || (d.tercero_nombre ? { id: null, nombre: d.tercero_nombre } : null),
    metodo_pago: pago.tipoPago === 'credito' ? 'Crédito' : (pago.metodo_pago || 'Efectivo'),
    tipoPago: pago.tipoPago === 'credito' ? 'credito' : 'contado',
    abonoInicial: num(pago.abonoInicial),
    metodoAbono: pago.metodoAbono || 'Efectivo',
    vence: pago.vence || '',
  });
  await Sync.guardar(TABLA, { ...d, estado: 'facturada', data: { ...d.data, venta_id: venta.id, venta_numero: venta.numero } });
  return venta;
}

/**
 * Orden de compra → compra (suma stock, actualiza costos y se
 * contabiliza sola).
 * @param {Object} pago - { tipoPago, metodoPago, abonoInicial, vence, ref }
 */
export async function recibirOrden(ocId, pago) {
  const oc = await obtener(ocId);
  if (!oc || oc.tipo !== 'orden_compra' || oc.estado !== 'pendiente') throw new Error('La orden no está pendiente');
  if (oc.items.some((it) => !it.producto_id)) throw new Error('Hay líneas sin producto del inventario');
  const compra = await ComprasRepo.registrar({
    proveedor: oc.tercero_nombre, proveedor_id: oc.tercero_id,
    items: oc.items.map((it) => ({ producto_id: it.producto_id, nombre: it.nombre, codigo: it.codigo, cantidad: it.cantidad, costo: it.costo })),
    fecha: todayISO(), ref: pago.ref || oc.numero,
    tipoPago: pago.tipoPago === 'credito' ? 'credito' : 'contado',
    metodoPago: pago.metodoPago || 'Efectivo', vence: pago.vence || '',
    abonoInicial: num(pago.abonoInicial), nota: `Orden de compra ${oc.numero}`,
  });
  await Sync.guardar(TABLA, { ...oc, estado: 'recibida', data: { ...oc.data, compra_id: compra.id } });
  return compra;
}

// ============================================================
//  TRASLADO DE FONDOS
// ============================================================

/** @param {Object} d - { fecha, origen, destino, valor, nota } (origen/destino = cuentas PUC) */
export async function guardarTraslado(d) {
  await exigirTablas();
  if (!d.origen || !d.destino) throw new Error('Escoge de dónde sale y a dónde llega la plata');
  if (d.origen === d.destino) throw new Error('El origen y el destino deben ser distintos');
  const valor = round(num(d.valor), 2);
  if (valor <= 0) throw new Error('El valor debe ser mayor a cero');
  const doc = base('traslado', { ...d, tercero_nombre: '' }, {});
  doc.total = valor;
  doc.data = { origen: d.origen, destino: d.destino, nota: String(d.nota || '').trim() };
  return guardarDoc(doc);
}

// ============================================================
//  ANULAR
// ============================================================

/**
 * Anula un documento deshaciendo su efecto: abonos devueltos, saldo de
 * la venta restaurado, mercancía de la devolución retirada, etc. Su
 * asiento se reversa solo (el motor ve el estado "anulado").
 */
export async function anular(id) {
  const d = await obtener(id);
  if (!d) throw new Error('Documento no encontrado');
  if (d.estado === 'anulado') throw new Error('El documento ya está anulado');
  if (['facturada', 'recibida'].includes(d.estado)) throw new Error('Ya se convirtió en venta o compra: anula esa venta o compra en su módulo');
  if (d.estado === 'convertida') throw new Error('Ya se convirtió en remisión: anula la remisión');

  if (d.tipo === 'recibo_caja') {
    for (const a of d.data?.aplicaciones || []) await quitarAbono('ventas', a.venta_id, a.abono_id);
  } else if (d.tipo === 'egreso') {
    for (const a of d.data?.aplicaciones || []) await quitarAbono('compras', a.compra_id, a.abono_id);
  } else if (d.tipo === 'nota_credito' || d.tipo === 'nota_debito') {
    const venta = await db.get('ventas', d.data?.venta_id);
    if (venta) {
      const credito = venta.tipoPago === 'credito';
      const saldo = credito ? round(Math.max(0, num(venta.saldo) + (d.tipo === 'nota_credito' ? d.total : -d.total)), 2) : num(venta.saldo);
      await Sync.guardar('ventas', { ...venta, saldo, data: { ...(venta.data || {}), notas: (venta.data?.notas || []).filter((n) => n.id !== d.id) } });
    }
    if (d.data?.devolver_inventario) {
      for (const it of d.items || []) if (it.producto_id) await Sync.ajustarStock(it.producto_id, -num(it.cantidad));
    }
  }
  await Sync.guardar(TABLA, { ...d, estado: 'anulado', data: { ...d.data, anulado_por: usuario(), anulado_el: nowISO() } });
}
