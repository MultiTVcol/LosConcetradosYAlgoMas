/**
 * modules/compras/compras.repo.js — Acceso a datos del módulo Compras
 *
 * Una compra registra mercancía entrante de un proveedor: suma stock a
 * los productos y, según el tipo de pago, deja saldo pendiente (crédito)
 * o no (contado).
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { uid } from '../../core/strings.js';
import { todayISO, nowISO } from '../../core/dates.js';

const TABLA = 'compras';
const TABLA_PRODUCTOS = 'productos';

export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];

// ============================================================
//  LISTAR / OBTENER
// ============================================================

export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return items;
}

export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

export async function contar() {
  return await db.count(TABLA);
}

// ============================================================
//  REGISTRAR / ACTUALIZAR
// ============================================================

/**
 * Registra una compra nueva. Suma stock de productos y actualiza su costo.
 *
 * @param {Object} datos - { proveedor, items, fecha, ref, tipoPago, metodoPago, vence, abonoInicial, nota }
 *   items: [{ producto_id, nombre, cantidad, costo }]
 * @returns {Promise<Object>} la compra guardada
 */
export async function registrar(datos) {
  const items = (datos.items || []).map((it) => ({
    producto_id: it.producto_id,
    nombre: it.nombre,
    codigo: it.codigo || '',
    cantidad: Number(it.cantidad) || 0,
    costo: Number(it.costo) || 0,
    subtotal: (Number(it.cantidad) || 0) * (Number(it.costo) || 0),
  }));

  if (items.length === 0) throw new Error('La compra no tiene items');

  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const tipoPago = datos.tipoPago === 'credito' ? 'credito' : 'contado';
  const abonoIni = Number(datos.abonoInicial) || 0;
  const saldo = tipoPago === 'credito' ? Math.max(0, total - abonoIni) : 0;

  const compra = {
    id: uid(),
    fecha: datos.fecha || todayISO(),
    ref: String(datos.ref || '').trim(),
    proveedor_id: datos.proveedor_id || null,
    proveedor: String(datos.proveedor || '').trim(),
    items,
    total,
    tipoPago,
    metodoPago: datos.metodoPago || (tipoPago === 'credito' ? 'Crédito' : 'Efectivo'),
    vence: tipoPago === 'credito' ? (datos.vence || '') : '',
    abonos: tipoPago === 'credito' && abonoIni > 0
      ? [{ id: uid(), fecha: datos.fecha || todayISO(), monto: abonoIni, metodo: datos.metodoPago || 'Efectivo' }]
      : [],
    saldo,
    nota: String(datos.nota || '').trim(),
    creado: nowISO(),
  };

  // Sumar stock + actualizar costo (delta atómico en la nube)
  for (const it of items) {
    if (!it.producto_id) continue;
    try {
      await Sync.ajustarStock(it.producto_id, it.cantidad, { costo: it.costo });
    } catch (e) {
      console.warn('Error sumando stock de compra:', e);
    }
  }

  await Sync.guardar(TABLA, compra);
  return compra;
}

/**
 * Crea una CUENTA POR PAGAR sin afectar el inventario.
 *
 * Pensado para migraciones / saldos iniciales: registrar facturas de
 * compra que quedaron pendientes de pago, sin sumar stock (la mercancía
 * ya entró antes o el inventario se cargó por separado).
 *
 * @param {Object} datos - { proveedor, proveedor_id?, ref?, fecha?, total,
 *                            abonoInicial?, vence?, nota? }
 * @returns {Promise<Object>} la cuenta por pagar guardada
 */
export async function registrarCuentaPorPagar(datos) {
  const total = Math.max(0, Number(datos.total) || 0);
  if (total <= 0) throw new Error('El monto de la deuda debe ser mayor a cero');
  if (!String(datos.proveedor || '').trim()) throw new Error('Indica el proveedor');

  const abonoIni = Math.min(Math.max(0, Number(datos.abonoInicial) || 0), total);
  const saldo = Math.max(0, total - abonoIni);

  const cuenta = {
    id: uid(),
    fecha: datos.fecha || todayISO(),
    ref: String(datos.ref || '').trim(),
    proveedor_id: datos.proveedor_id || null,
    proveedor: String(datos.proveedor || '').trim(),
    items: [],                 // sin productos → no toca inventario
    total,
    tipoPago: 'credito',
    metodoPago: 'Crédito',
    vence: datos.vence || '',
    abonos: abonoIni > 0
      ? [{ id: uid(), fecha: datos.fecha || todayISO(), monto: abonoIni, metodo: datos.metodoAbono || 'Efectivo' }]
      : [],
    saldo,
    nota: String(datos.nota || '').trim(),
    origen: 'migracion',       // marca: cuenta creada sin afectar inventario
    sinInventario: true,
    creado: nowISO(),
  };

  // OJO: NO se llama a Sync.ajustarStock — el inventario queda intacto.
  await Sync.guardar(TABLA, cuenta);
  return cuenta;
}

/**
 * Registra un abono a una compra de crédito.
 *
 * @param {string} compraId
 * @param {Object} abono - { monto, metodo, fecha?, nota? }
 */
export async function abonar(compraId, abono) {
  const compra = await db.get(TABLA, compraId);
  if (!compra) throw new Error('Compra no encontrada');
  if (compra.tipoPago !== 'credito') throw new Error('Solo se abonan compras a crédito');

  const monto = Math.max(0, Number(abono.monto) || 0);
  if (monto <= 0) throw new Error('El monto del abono debe ser mayor a cero');

  const saldoActual = Number(compra.saldo) || 0;
  if (monto > saldoActual + 0.5) throw new Error('El abono supera el saldo pendiente');

  const abonos = Array.isArray(compra.abonos) ? [...compra.abonos] : [];
  abonos.push({
    id: uid(),
    fecha: abono.fecha || todayISO(),
    monto,
    metodo: abono.metodo || 'Efectivo',
    nota: String(abono.nota || '').trim(),
  });

  const actualizada = {
    ...compra,
    abonos,
    saldo: Math.max(0, saldoActual - monto),
  };
  await Sync.guardar(TABLA, actualizada);
  return actualizada;
}

/**
 * Elimina una compra y devuelve el stock al inventario.
 */
export async function eliminar(id) {
  const compra = await db.get(TABLA, id);
  if (!compra) throw new Error('Compra no encontrada');

  for (const it of compra.items || []) {
    if (!it.producto_id) continue;
    try {
      // Permitir negativo (igual que Ventas): si ya se vendió parte de
      // esta mercancía, recortar a 0 inflaría el inventario en silencio.
      await Sync.ajustarStock(it.producto_id, -(Number(it.cantidad) || 0));
    } catch (e) {
      console.warn('Error revirtiendo stock:', e);
    }
  }

  await Sync.borrar(TABLA, id);
}
