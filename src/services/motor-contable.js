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
export const TABLAS_FUENTE = ['ventas', 'compras', 'gastos', 'ajustes_inventario', 'documentos'];

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
  devoluciones:    '417505',  // notas crédito (devoluciones y descuentos en ventas)
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
function L(cuenta, { debito = 0, credito = 0, tercero_id = null, tercero_nombre = '', detalle = '', activo_id = null } = {}) {
  const linea = {
    cuenta: String(cuenta),
    tercero_id: tercero_id || null,
    tercero_nombre: String(tercero_nombre || ''),
    detalle: String(detalle || ''),
    debito: round(num(debito), 2),
    credito: round(num(credito), 2),
  };
  if (activo_id) linea.activo_id = activo_id;
  return linea;
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

/**
 * Documentos comerciales (módulo Documentos). Los abonos de recibos y
 * egresos a ventas/compras ya se causan desde la venta o la compra; aquí
 * solo va lo propio del documento ("otros conceptos", notas, traslados).
 * Cotizaciones, remisiones y órdenes de compra no mueven contabilidad.
 */
function reglasDocumento(d, C) {
  if (d.estado === 'anulado') return [];
  const x = d.data || {};
  const fecha = fecha10(d.fecha);
  const ter = { tercero_id: d.tercero_id || null, tercero_nombre: d.tercero_nombre || '' };
  const asiento = (lineas, descripcion) => [{
    origen_tipo: d.tipo, origen_id: d.id, numero: d.numero || '', fecha, descripcion, lineas: limpiar(lineas),
  }];
  const conceptos = (x.conceptos || []).filter((c) => num(c.valor) > 0);
  const totalConceptos = round(conceptos.reduce((s, c) => s + num(c.valor), 0), 2);

  switch (d.tipo) {
    case 'recibo_caja':
      if (!totalConceptos) return [];
      return asiento([
        L(cuentaMedio(etiquetaMedio(x.medio), C), { debito: totalConceptos, detalle: 'Recibo de caja' }),
        ...conceptos.map((c) => L(c.cuenta, { credito: c.valor, ...ter, detalle: c.detalle || 'Recibo de caja' })),
      ], `Recibo de caja ${d.numero} — ${d.tercero_nombre}`);
    case 'egreso':
      if (!totalConceptos) return [];
      return asiento([
        ...conceptos.map((c) => L(c.cuenta, { debito: c.valor, ...ter, detalle: c.detalle || 'Egreso' })),
        L(cuentaMedio(etiquetaMedio(x.medio), C), { credito: totalConceptos, detalle: 'Comprobante de egreso' }),
      ], `Egreso ${d.numero} — ${d.tercero_nombre}`);
    case 'nota_credito': {
      const total = round(num(d.total), 2);
      const iva = round(num(x.impuesto), 2);
      const costo = round(num(x.costo), 2);
      return asiento([
        L(C.devoluciones, { debito: round(total - iva, 2), detalle: x.motivo || 'Devolución en ventas' }),
        L(C.ivaGenerado, { debito: iva, detalle: 'IVA de la nota crédito' }),
        x.afecta === 'cartera'
          ? L(C.clientes, { credito: total, ...ter, detalle: `Nota crédito a la venta ${x.venta_numero || ''}` })
          : L(cuentaMedio(etiquetaMedio(x.medio), C), { credito: total, detalle: 'Reintegro al cliente' }),
        L(C.inventario, { debito: costo, detalle: 'Mercancía devuelta' }),
        L(C.costo, { credito: costo, detalle: 'Reverso del costo de ventas' }),
      ], `Nota crédito ${d.numero} a la venta ${x.venta_numero || ''} — ${d.tercero_nombre}`);
    }
    case 'nota_debito': {
      const total = round(num(d.total), 2);
      const iva = round(num(x.impuesto), 2);
      return asiento([
        L(C.clientes, { debito: total, ...ter, detalle: `Nota débito a la venta ${x.venta_numero || ''}` }),
        L(x.cuenta_ingreso || C.ingresos, { credito: round(total - iva, 2), detalle: x.motivo || 'Mayor valor' }),
        L(C.ivaGenerado, { credito: iva, detalle: 'IVA de la nota débito' }),
      ], `Nota débito ${d.numero} a la venta ${x.venta_numero || ''} — ${d.tercero_nombre}`);
    }
    case 'traslado': {
      const valor = round(num(d.total), 2);
      return asiento([
        L(x.destino, { debito: valor, detalle: 'Entrada por traslado' }),
        L(x.origen, { credito: valor, detalle: 'Salida por traslado' }),
      ], `Traslado ${d.numero}${x.nota ? ` — ${x.nota}` : ''}`);
    }
    default:
      return [];
  }
}

/** Clave de medio de pago ('nequi', 'efectivo'…) → texto que entiende cuentaMedio. */
function etiquetaMedio(medio) {
  return ETIQUETAS_MEDIOS[medio] || medio || 'Efectivo';
}

const REGLAS = {
  ventas: reglasVenta,
  compras: reglasCompra,
  gastos: reglasGasto,
  ajustes_inventario: reglasAjuste,
  documentos: reglasDocumento,
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

/**
 * Arma el asiento completo (validado) sin guardarlo.
 *
 * Si el documento cae en un periodo CERRADO (ej: se editó hoy una venta
 * de un mes ya cerrado), el asiento se registra en la fecha de hoy con
 * una nota. La firma se calcula con la fecha ORIGINAL del documento,
 * así la próxima revisión lo reconoce y no lo vuelve a crear.
 * Los comprobantes manuales no se corren: se rechazan (estricto).
 */
async function construir(d, { doc_tabla, doc_id, version = 0, usuario = '', estricto = false }) {
  const { totalDebito, totalCredito } = await validarLineas(d.lineas);
  const firma = firmaDe(d.fecha, d.lineas);
  let fecha = d.fecha;
  let descripcion = String(d.descripcion || '').trim();
  if (await periodoCerrado(fecha)) {
    if (estricto) throw new Error(`El periodo ${fecha.slice(0, 7)} está cerrado: no admite asientos`);
    fecha = await fechaAbierta();
    descripcion += ` (fecha original ${d.fecha}, periodo cerrado)`;
  }
  return {
    id: `as_${hash(`${d.origen_id}#${firma}#${version}`)}_${hash(d.origen_id)}`,
    numero: d.numero || '',
    fecha,
    periodo: fecha.slice(0, 7),
    origen_tipo: d.origen_tipo,
    origen_id: d.origen_id,
    doc_tabla,
    doc_id,
    descripcion,
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
async function inversoDe(original, motivo, usuario = '') {
  const lineas = (original.lineas || []).map((l) =>
    L(l.cuenta, {
      debito: l.credito, credito: l.debito,
      tercero_id: l.tercero_id, tercero_nombre: l.tercero_nombre,
      detalle: `Reversión: ${l.detalle || ''}`, activo_id: l.activo_id,
    }));
  let fecha = todayISO() < original.fecha ? original.fecha : todayISO();
  if (await periodoCerrado(fecha)) fecha = await fechaAbierta();
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
async function planDocumento({ deseados, existentes, doc_tabla, doc_id, motivo, usuario, estricto = false }) {
  const guardar = [];
  const vigentes = existentes.filter((a) => a.estado === 'activo' && a.origen_tipo !== 'reversion');
  const usados = new Set();

  for (const d of deseados) {
    const firma = firmaDe(d.fecha, d.lineas);
    const actual = vigentes.find((a) => a.origen_id === d.origen_id && !usados.has(a.id));
    if (actual && actual.firma === firma) { usados.add(actual.id); continue; }
    if (actual) {
      usados.add(actual.id);
      const inv = await inversoDe(actual, motivo, usuario);
      guardar.push(inv, { ...actual, estado: 'reversado', reversado_por: inv.id });
    }
    // version = cuántos asientos ya tuvo este origen (evita chocar ids)
    const version = existentes.filter((a) => a.origen_id === d.origen_id && a.origen_tipo !== 'reversion').length;
    guardar.push(await construir(d, { doc_tabla, doc_id, version, usuario, estricto }));
  }

  // Lo que estaba contabilizado y ya no aplica (o quedó duplicado) → se reversa
  for (const a of vigentes) {
    if (usados.has(a.id)) continue;
    const inv = await inversoDe(a, motivo, usuario);
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
      // Meses cerrados quedan congelados en la revisión general: si el
      // documento ya tiene asientos y todo cae en periodo cerrado, no se toca.
      const cerrados = await Promise.all(deseados.map((d) => periodoCerrado(d.fecha)));
      if (deseados.length && cerrados.every(Boolean) && existentes.some((a) => a.estado === 'activo')) continue;
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
  const guardar = await planDocumento({ deseados: [deseado], existentes, doc_tabla: 'apertura', doc_id: APERTURA_ID, motivo: 'saldos iniciales corregidos', usuario, estricto: true });
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

// ============================================================
//  PERIODOS (cierre de mes)
// ============================================================
//
// Un periodo es un mes 'YYYY-MM'. Sin registro = abierto. Los cerrados
// viven en kvs 'periodos_contables' (compartido entre terminales).

const KEY_PERIODOS = 'periodos_contables';

export async function periodos() {
  try {
    const row = await db.get('kvs', KEY_PERIODOS);
    return row?.datos && typeof row.datos === 'object' ? row.datos : {};
  } catch (e) {
    return {};
  }
}

export async function periodoCerrado(fecha) {
  const p = (await periodos())[String(fecha || '').slice(0, 7)];
  return p?.estado === 'cerrado';
}

/** Hoy, si su periodo está abierto. Si el mes actual está cerrado, falla. */
async function fechaAbierta() {
  const hoy = todayISO();
  if (await periodoCerrado(hoy)) throw new Error(`El mes actual (${hoy.slice(0, 7)}) está cerrado: reábrelo para registrar`);
  return hoy;
}

export async function cerrarPeriodo(periodo, usuario = '') {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new Error('Periodo inválido (formato AAAA-MM)');
  const todos = await periodos();
  todos[periodo] = { estado: 'cerrado', por: usuario, fecha: nowISO() };
  await Sync.guardar('kvs', { id: KEY_PERIODOS, valor: null, datos: todos });
}

export async function reabrirPeriodo(periodo, usuario = '') {
  const todos = await periodos();
  if (todos[periodo]?.estado !== 'cerrado') throw new Error('El periodo no está cerrado');
  todos[periodo] = { estado: 'abierto', por: usuario, fecha: nowISO() };
  await Sync.guardar('kvs', { id: KEY_PERIODOS, valor: null, datos: todos });
}

// ============================================================
//  COMPROBANTES MANUALES (ajustes del contador)
// ============================================================

/** Siguiente número CC-0001, CC-0002… (máximo + 1, nunca se repite). */
async function siguienteComprobante() {
  let max = 0;
  for (const a of await db.getAll(TABLA)) {
    if (a.origen_tipo !== 'manual') continue;
    const m = String(a.numero || '').match(/CC-(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CC-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Registra un comprobante contable manual. Las líneas se validan igual
 * que las automáticas (partida doble, cuentas, terceros, periodo).
 */
export async function guardarComprobante({ fecha, descripcion, lineas, usuario = '' }) {
  if (!fecha) throw new Error('Indica la fecha del comprobante');
  if (!String(descripcion || '').trim()) throw new Error('Escribe una descripción');
  const ls = limpiar((lineas || []).map((l) => L(l.cuenta, l)));
  const docId = `man_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const numero = await siguienteComprobante();
  const asiento = await construir(
    { origen_tipo: 'manual', origen_id: docId, numero, fecha, descripcion, lineas: ls },
    { doc_tabla: 'manual', doc_id: docId, usuario, estricto: true },
  );
  await Sync.guardar(TABLA, asiento);
  return asiento;
}

/**
 * Anula un asiento que no viene de un documento del POS (manual, saldos
 * iniciales, cierre de año, depreciación, compra de activo): se reversa.
 * Los asientos de ventas, compras o gastos se corrigen editando el
 * documento, no aquí.
 */
export async function anularAsiento(asientoId, motivo = '', usuario = '') {
  const a = await db.get(TABLA, asientoId);
  if (!a) throw new Error('Asiento no encontrado');
  if (TABLAS_FUENTE.includes(a.doc_tabla)) throw new Error('Este asiento viene de un documento del POS: corrige o borra el documento');
  if (a.estado !== 'activo' || a.origen_tipo === 'reversion') throw new Error('El asiento ya está reversado');
  const inv = await inversoDe(a, motivo || 'anulado', usuario);
  await Sync.guardar(TABLA, inv);
  await Sync.guardar(TABLA, { ...a, estado: 'reversado', reversado_por: inv.id });
  return inv;
}

// ============================================================
//  CIERRE DEL EJERCICIO (cierre de año)
// ============================================================

const esResultado = (cuenta) => ['4', '5', '6', '7'].includes(String(cuenta).charAt(0));

/**
 * Cancela las cuentas de resultado (clases 4, 5, 6 y 7) contra la
 * utilidad (360505) o pérdida (361005) del ejercicio, al 31 de diciembre.
 */
export async function cerrarEjercicio({ anio, usuario = '' }) {
  const yyyy = String(anio);
  const docId = `cierre_${yyyy}`;
  const previos = await asientosDelDocumento(docId);
  if (previos.some((a) => a.estado === 'activo' && a.origen_tipo === 'cierre')) {
    throw new Error(`El año ${yyyy} ya tiene cierre. Anúlalo primero si necesitas rehacerlo.`);
  }
  const corte = `${yyyy}-12-31`;
  const saldos = new Map();  // cuenta → saldo en términos débito (+)
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha > corte) continue;
    for (const l of a.lineas || []) {
      if (!esResultado(l.cuenta)) continue;
      saldos.set(l.cuenta, round((saldos.get(l.cuenta) || 0) + num(l.debito) - num(l.credito), 2));
    }
  }
  const lineas = [];
  let utilidad = 0;
  for (const [cuenta, s] of [...saldos.entries()].sort()) {
    if (Math.abs(s) < 0.005) continue;
    lineas.push(L(cuenta, s > 0 ? { credito: s, detalle: 'Cierre del ejercicio' } : { debito: -s, detalle: 'Cierre del ejercicio' }));
    utilidad = round(utilidad - s, 2);
  }
  if (lineas.length === 0) throw new Error(`No hay cuentas de resultado con saldo en ${yyyy}`);
  lineas.push(utilidad >= 0
    ? L('360505', { credito: utilidad, detalle: 'Utilidad del ejercicio' })
    : L('361005', { debito: -utilidad, detalle: 'Pérdida del ejercicio' }));

  const version = previos.filter((a) => a.origen_tipo === 'cierre').length;
  const asiento = await construir(
    { origen_tipo: 'cierre', origen_id: docId, numero: `CI ${yyyy}`, fecha: corte, descripcion: `Cierre del ejercicio ${yyyy}`, lineas: limpiar(lineas) },
    { doc_tabla: 'cierre', doc_id: docId, version, usuario, estricto: true },
  );
  await Sync.guardar(TABLA, asiento);
  return { asiento, utilidad };
}

// ============================================================
//  LIBROS: mayor y auxiliar por tercero
// ============================================================

/**
 * Libro mayor / auxiliar de una cuenta (o prefijo, ej: '1305'), con
 * saldo corrido en la naturaleza de la cuenta. Opcional: un tercero.
 */
export async function libroMayor(cuenta, { desde = '0000', hasta = '9999', tercero_id = null } = {}) {
  const pref = String(cuenta);
  const info = await PUC.obtener(pref);
  const nat = info?.naturaleza || (['1', '5', '6', '7'].includes(pref.charAt(0)) ? 'D' : 'C');
  const delta = (l) => (nat === 'D' ? num(l.debito) - num(l.credito) : num(l.credito) - num(l.debito));

  const todos = (await db.getAll(TABLA)).sort((a, b) => (a.fecha + a.creado).localeCompare(b.fecha + b.creado));
  let saldoInicial = 0, debitos = 0, creditos = 0;
  const movimientos = [];
  for (const a of todos) {
    if (a.fecha > hasta) continue;
    for (const l of a.lineas || []) {
      if (!String(l.cuenta).startsWith(pref)) continue;
      if (tercero_id && l.tercero_id !== tercero_id) continue;
      if (a.fecha < desde) { saldoInicial = round(saldoInicial + delta(l), 2); continue; }
      debitos = round(debitos + num(l.debito), 2);
      creditos = round(creditos + num(l.credito), 2);
      movimientos.push({
        fecha: a.fecha, numero: a.numero, descripcion: a.descripcion, cuenta: l.cuenta,
        tercero_nombre: l.tercero_nombre, detalle: l.detalle,
        debito: num(l.debito), credito: num(l.credito), asiento_id: a.id,
      });
    }
  }
  let corrido = saldoInicial;
  for (const m of movimientos) {
    corrido = round(corrido + (nat === 'D' ? m.debito - m.credito : m.credito - m.debito), 2);
    m.saldo = corrido;
  }
  return { cuenta: pref, nombre: info?.nombre || '', naturaleza: nat, saldoInicial, movimientos, debitos, creditos, saldoFinal: corrido };
}

/** Saldos por tercero de una cuenta o prefijo (cartera, proveedores…). */
export async function saldosPorTercero(cuenta, { hasta = '9999' } = {}) {
  const pref = String(cuenta);
  const nat = (await PUC.obtener(pref))?.naturaleza || 'D';
  const mapa = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha > hasta) continue;
    for (const l of a.lineas || []) {
      if (!String(l.cuenta).startsWith(pref)) continue;
      const k = l.tercero_id || '(sin tercero)';
      const prev = mapa.get(k) || { tercero_id: l.tercero_id, tercero_nombre: l.tercero_nombre || '(sin tercero)', saldo: 0 };
      prev.saldo = round(prev.saldo + (nat === 'D' ? num(l.debito) - num(l.credito) : num(l.credito) - num(l.debito)), 2);
      if (l.tercero_nombre) prev.tercero_nombre = l.tercero_nombre;
      mapa.set(k, prev);
    }
  }
  return [...mapa.values()].filter((x) => Math.abs(x.saldo) >= 0.005).sort((a, b) => b.saldo - a.saldo);
}

// ============================================================
//  ESTADOS FINANCIEROS
// ============================================================

/**
 * Agrupa saldos por subcuenta en un árbol clase → grupo → cuenta →
 * subcuenta, con los nombres del PUC. Los valores ya vienen en la
 * naturaleza del bloque (positivo = normal).
 */
async function arbol(saldos, prefijos) {
  const puc = new Map((await PUC.listar()).map((c) => [c.codigo, c]));
  const nodos = new Map();
  for (const [cuenta, valor] of saldos) {
    if (!prefijos.some((p) => cuenta.startsWith(p)) || Math.abs(valor) < 0.005) continue;
    const niveles = [1, 2, 4, 6, 8].filter((n) => n <= cuenta.length).map((n) => cuenta.slice(0, n));
    for (const cod of niveles) {
      const prev = nodos.get(cod) || { codigo: cod, nombre: puc.get(cod)?.nombre || '(sin nombre)', nivel: cod.length, valor: 0 };
      prev.valor = round(prev.valor + valor, 2);
      nodos.set(cod, prev);
    }
  }
  return [...nodos.values()].filter((n) => Math.abs(n.valor) >= 0.005).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/**
 * Estado de resultados de un rango. No cuenta el asiento de cierre de
 * año (si no, todo daría cero después de cerrar).
 */
export async function estadoResultados({ desde = '0000', hasta = '9999' } = {}) {
  const saldos = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha < desde || a.fecha > hasta) continue;
    if (String(a.doc_id || '').startsWith('cierre_')) continue;
    for (const l of a.lineas || []) {
      if (!esResultado(l.cuenta)) continue;
      // Ingresos en positivo; gastos y costos en positivo también
      const deb = num(l.debito) - num(l.credito);
      saldos.set(l.cuenta, round((saldos.get(l.cuenta) || 0) + (l.cuenta.charAt(0) === '4' ? -deb : deb), 2));
    }
  }
  const ingresos = await arbol(saldos, ['4']);
  const costos = await arbol(saldos, ['6', '7']);
  const gastos = await arbol(saldos, ['5']);
  const suma = (lista, codigos) => round(lista.filter((n) => codigos.includes(n.codigo)).reduce((s, n) => s + n.valor, 0), 2);
  const tIng = suma(ingresos, ['4']);
  const tCos = suma(costos, ['6', '7']);
  const tGas = suma(gastos, ['5']);
  const ingOper = suma(ingresos, ['41']);
  const gasOper = suma(gastos, ['51', '52']);
  return {
    ingresos, costos, gastos,
    totalIngresos: tIng, totalCostos: tCos, totalGastos: tGas,
    utilidadBruta: round(ingOper - tCos, 2),
    utilidadOperacional: round(ingOper - tCos - gasOper, 2),
    utilidad: round(tIng - tCos - tGas, 2),
  };
}

/**
 * Balance general a una fecha. El resultado del ejercicio es lo que
 * aún no se ha cerrado de las clases 4 a 7, así la ecuación
 * Activo = Pasivo + Patrimonio SIEMPRE cuadra.
 */
export async function balanceGeneral({ hasta = todayISO() } = {}) {
  const saldos = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (a.fecha > hasta) continue;
    for (const l of a.lineas || []) {
      saldos.set(l.cuenta, round((saldos.get(l.cuenta) || 0) + num(l.debito) - num(l.credito), 2));
    }
  }
  const credito = new Map([...saldos].map(([c, v]) => [c, -v]));
  const activos = await arbol(saldos, ['1']);
  const pasivos = await arbol(credito, ['2']);
  const patrimonio = await arbol(credito, ['3']);
  const sumaClase = (lista, c) => round(lista.filter((n) => n.codigo === c).reduce((s, n) => s + n.valor, 0), 2);
  const resultado = round([...credito].filter(([c]) => esResultado(c)).reduce((s, [, v]) => s + v, 0), 2);
  const totalActivo = sumaClase(activos, '1');
  const totalPasivo = sumaClase(pasivos, '2');
  const totalPatrimonio = round(sumaClase(patrimonio, '3') + resultado, 2);
  return {
    activos, pasivos, patrimonio, resultado,
    totalActivo, totalPasivo, totalPatrimonio,
    diferencia: round(totalActivo - totalPasivo - totalPatrimonio, 2),
  };
}

// ============================================================
//  ACTIVOS FIJOS Y DEPRECIACIÓN (línea recta)
// ============================================================

const KEY_ACTIVOS = 'activos_fijos';

/** Cuentas sugeridas de depreciación según la cuenta del activo. */
export const DEPRECIACION_SUGERIDA = {
  '1516': { acumulada: '159205', gasto: '516005', vida: 240 },
  '1520': { acumulada: '159210', gasto: '516010', vida: 120 },
  '1524': { acumulada: '159215', gasto: '516015', vida: 120 },
  '1528': { acumulada: '159220', gasto: '516020', vida: 60 },
  '1540': { acumulada: '159235', gasto: '516035', vida: 60 },
};

export async function activosFijos() {
  try {
    const row = await db.get('kvs', KEY_ACTIVOS);
    return Array.isArray(row?.datos) ? row.datos : [];
  } catch (e) {
    return [];
  }
}

async function guardarActivos(lista) {
  await Sync.guardar('kvs', { id: KEY_ACTIVOS, valor: null, datos: lista });
}

/** Cuota mensual de depreciación de un activo. */
export function cuotaMensual(af) {
  const vida = Math.max(1, Math.round(num(af.vida_meses)));
  return round((num(af.costo) - num(af.residual)) / vida, 2);
}

/** Depreciación acumulada contabilizada por activo (asientos vigentes y sus reversiones). */
export async function depreciacionAcumulada() {
  const mapa = new Map();
  for (const a of await db.getAll(TABLA)) {
    if (!String(a.doc_id || '').startsWith('dep_')) continue;
    for (const l of a.lineas || []) {
      if (!l.activo_id || String(l.cuenta).charAt(0) !== '1') continue;
      mapa.set(l.activo_id, round((mapa.get(l.activo_id) || 0) + num(l.credito) - num(l.debito), 2));
    }
  }
  return mapa;
}

/**
 * Crea o edita un activo fijo. Si trae `contrapartida`, registra el
 * asiento de la compra (débito al activo contra caja, banco o
 * proveedores), que se rehace si el activo cambia.
 */
export async function guardarActivo(datos, { usuario = '' } = {}) {
  const nombre = String(datos.nombre || '').trim();
  if (!nombre) throw new Error('El activo necesita un nombre');
  if (num(datos.costo) <= 0) throw new Error('El costo debe ser mayor a cero');
  if (num(datos.vida_meses) < 1) throw new Error('La vida útil debe ser de al menos 1 mes');
  if (num(datos.residual) >= num(datos.costo)) throw new Error('El valor residual debe ser menor al costo');
  if (!datos.fecha_compra) throw new Error('Indica la fecha de compra');
  for (const k of ['cuenta_activo', 'cuenta_acumulada', 'cuenta_gasto']) await PUC.validarParaMovimiento(datos[k]);

  const id = datos.id || `af_${Date.now().toString(36)}`;
  const af = {
    id, nombre,
    cuenta_activo: datos.cuenta_activo, cuenta_acumulada: datos.cuenta_acumulada, cuenta_gasto: datos.cuenta_gasto,
    fecha_compra: datos.fecha_compra,
    costo: round(num(datos.costo), 2),
    residual: round(num(datos.residual), 2),
    vida_meses: Math.round(num(datos.vida_meses)),
    contrapartida: datos.contrapartida || '',
    tercero_id: datos.tercero_id || null,
    tercero_nombre: datos.tercero_nombre || '',
    baja: datos.baja || null,
  };

  const docId = `afc_${id}`;
  const deseados = af.contrapartida ? [{
    origen_tipo: 'activo_compra', origen_id: docId, numero: `AF ${refCorta(id)}`, fecha: af.fecha_compra,
    descripcion: `Compra de activo fijo — ${nombre}`,
    lineas: [
      L(af.cuenta_activo, { debito: af.costo, detalle: nombre }),
      L(af.contrapartida, { credito: af.costo, detalle: `Pago de ${nombre}`, tercero_id: af.tercero_id, tercero_nombre: af.tercero_nombre }),
    ],
  }] : [];
  const guardar = await planDocumento({ deseados, existentes: await asientosDelDocumento(docId), doc_tabla: 'activo', doc_id: docId, motivo: 'activo modificado', usuario });
  for (const a of guardar) await Sync.guardar(TABLA, a);

  await guardarActivos([...(await activosFijos()).filter((x) => x.id !== id), af]);
  return af;
}

export async function eliminarActivo(id, { usuario = '' } = {}) {
  const docId = `afc_${id}`;
  const guardar = await planDocumento({ deseados: [], existentes: await asientosDelDocumento(docId), doc_tabla: 'activo', doc_id: docId, motivo: 'activo eliminado', usuario });
  for (const a of guardar) await Sync.guardar(TABLA, a);
  await guardarActivos((await activosFijos()).filter((x) => x.id !== id));
}

/** Meses entre el mes de compra y un periodo (1 = mes siguiente a la compra). */
function mesesEntre(fechaCompra, periodo) {
  const [ya, ma] = fechaCompra.slice(0, 7).split('-').map(Number);
  const [yp, mp] = periodo.split('-').map(Number);
  return (yp - ya) * 12 + (mp - ma);
}

/** Último día de un periodo 'YYYY-MM'. */
function finDeMes(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  return `${periodo}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/**
 * Asiento de depreciación de un mes: una cuota por activo que aún tiene
 * vida útil (empieza el mes siguiente a la compra). Volver a correrlo
 * es seguro: si nada cambió no escribe; si cambió, reversa y rehace.
 */
export async function depreciarMes(periodo, { usuario = '' } = {}) {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new Error('Periodo inválido (formato AAAA-MM)');
  const lineas = [];
  for (const af of await activosFijos()) {
    if (af.baja && af.baja.slice(0, 7) < periodo) continue;
    const n = mesesEntre(af.fecha_compra, periodo);
    if (n < 1 || n > af.vida_meses) continue;
    const cuota = cuotaMensual(af);
    if (cuota <= 0) continue;
    lineas.push(L(af.cuenta_gasto, { debito: cuota, detalle: `Depreciación ${af.nombre} (${n}/${af.vida_meses})`, activo_id: af.id }));
    lineas.push(L(af.cuenta_acumulada, { credito: cuota, detalle: `Depreciación ${af.nombre}`, activo_id: af.id }));
  }
  const docId = `dep_${periodo}`;
  const deseados = lineas.length ? [{
    origen_tipo: 'depreciacion', origen_id: docId, numero: `DP ${periodo}`, fecha: finDeMes(periodo),
    descripcion: `Depreciación de activos fijos ${periodo}`, lineas,
  }] : [];
  const guardar = await planDocumento({ deseados, existentes: await asientosDelDocumento(docId), doc_tabla: 'depreciacion', doc_id: docId, motivo: 'depreciación recalculada', usuario, estricto: true });
  for (const a of guardar) await Sync.guardar(TABLA, a);
  return { escritos: guardar.length, activos: lineas.length / 2 };
}
