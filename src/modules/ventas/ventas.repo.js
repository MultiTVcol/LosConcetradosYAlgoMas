/**
 * modules/ventas/ventas.repo.js — Acceso a datos + lógica de negocio
 *
 * Este es el archivo más importante del módulo Ventas:
 *   - Cálculo de totales (subtotal, impuesto, descuento, total)
 *   - Validación del carrito (que tenga items, cantidades válidas)
 *   - Numeración automática (V-0001, V-0002...)
 *   - Descuento de stock al completar la venta
 *   - Sincronización local + nube
 *
 * Por qué esta lógica vive acá:
 *   El cálculo de totales no es trivial (cada producto tiene impuesto
 *   distinto, hay descuentos posibles). Centralizándolo en el repo
 *   garantizamos que SIEMPRE se calcula igual, sin importar quién
 *   lo llame (la vista, un test, un reporte futuro).
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Supa from '../../services/supabase.js';
import { uid } from '../../core/strings.js';
import { todayISO, nowISO } from '../../core/dates.js';
import { round } from '../../core/format.js';

// ============================================================
//  CONSTANTES
// ============================================================

const TABLA = 'ventas';
const TABLA_PRODUCTOS = 'productos';

// ============================================================
//  CÁLCULO DE TOTALES (lógica de negocio central)
// ============================================================

/**
 * Calcula el subtotal de un item del carrito.
 * Subtotal = precio × cantidad (antes de impuesto y descuento del item)
 *
 * @param {Object} item - { precio, cantidad, descuento_pct?, impuesto_pct? }
 * @returns {number}
 */
export function calcularSubtotalItem(item) {
  const precio = Number(item.precio) || 0;
  const cantidad = Number(item.cantidad) || 0;
  const descuento = Number(item.descuento) || 0;
  return round(Math.max(0, precio - descuento) * cantidad, 2);
}

/**
 * Calcula el impuesto de un item (sobre el subtotal del item).
 *
 * @param {Object} item - { precio, cantidad, impuesto_pct }
 * @returns {number}
 */
export function calcularImpuestoItem(item) {
  const subtotal = calcularSubtotalItem(item);
  const pct = Number(item.impuesto_pct) || 0;
  return round((subtotal * pct) / 100, 2);
}

/**
 * Calcula el total de un item (subtotal + impuesto).
 *
 * @param {Object} item
 * @returns {number}
 */
export function calcularTotalItem(item) {
  return round(calcularSubtotalItem(item) + calcularImpuestoItem(item), 2);
}

/**
 * Calcula los totales completos de un carrito.
 * Devuelve un objeto con: subtotal, impuesto, descuento, total.
 *
 * @param {Array} items - Array de items del carrito
 * @param {number} [descuento=0] - Descuento global en pesos
 * @returns {Object} - { subtotal, impuesto, descuento, total, cantidadItems }
 *
 * @example
 *   const { total } = calcularTotales(carrito);
 */
export function calcularTotales(items, descuento = 0) {
  let subtotal = 0;
  let impuesto = 0;
  let cantidadItems = 0;
  let descuentoLineas = 0;
  let costoTotal = 0;

  for (const item of items || []) {
    subtotal += calcularSubtotalItem(item);
    impuesto += calcularImpuestoItem(item);
    cantidadItems += Number(item.cantidad) || 0;
    descuentoLineas += (Number(item.descuento) || 0) * (Number(item.cantidad) || 0);
    costoTotal += (Number(item.costo) || 0) * (Number(item.cantidad) || 0);
  }

  const desc = Number(descuento) || 0;
  const total = Math.max(0, round(subtotal + impuesto - desc, 2));
  // Utilidad estimada = total cobrado - costo de mercancía
  const utilidad = round(total - costoTotal, 2);

  return {
    subtotal: round(subtotal, 2),
    impuesto: round(impuesto, 2),
    descuento: round(desc, 2),
    descuentoLineas: round(descuentoLineas, 2),
    costoTotal: round(costoTotal, 2),
    utilidad,
    total,
    cantidadItems,
  };
}

// ============================================================
//  VALIDACIÓN
// ============================================================

/**
 * Valida que una venta esté lista para guardarse.
 *
 * @param {Object} v - Venta { items, metodoPago, cliente_id?, ... }
 * @returns {Array<string>}
 */
export function validar(v) {
  const errores = [];

  if (!v || typeof v !== 'object') {
    errores.push('Venta inválida');
    return errores;
  }

  if (!Array.isArray(v.items) || v.items.length === 0) {
    errores.push('La venta debe tener al menos un producto');
  } else {
    for (const item of v.items) {
      if (!item.producto_id) {
        errores.push('Hay un item sin producto');
        break;
      }
      if (!item.cantidad || Number(item.cantidad) <= 0) {
        errores.push(`"${item.nombre}" tiene cantidad inválida`);
        break;
      }
    }
  }

  if (!v.metodo_pago || String(v.metodo_pago).trim() === '') {
    errores.push('Hay que elegir un método de pago');
  }

  return errores;
}

// ============================================================
//  NUMERACIÓN
// ============================================================

/**
 * Genera el próximo número de venta secuencial (V-0001, V-0002, ...).
 * Se basa en la cantidad de ventas locales actuales.
 *
 * @returns {Promise<string>}
 */
export async function siguienteNumero() {
  const total = await db.count(TABLA);
  const n = (total || 0) + 1;
  return 'V-' + String(n).padStart(4, '0');
}

// ============================================================
//  NORMALIZACIÓN
// ============================================================

/**
 * Convierte el estado del carrito a un objeto venta listo para guardar.
 *
 * @param {Object} datos - { items, cliente, metodo_pago, descuento, numero }
 * @returns {Object} - Objeto venta normalizado
 */
export function construirVenta(datos) {
  const totales = calcularTotales(datos.items, datos.descuento || 0);

  // Snapshot del cliente para que la factura se pueda reimprimir aunque
  // el cliente se edite o borre después. Solo guardamos los campos básicos.
  const cli = datos.cliente || null;
  const clienteSnapshot = cli ? {
    id: cli.id || null,
    nombre: cli.nombre || '',
    negocio: cli.negocio || '',
    telefono: cli.telefono || '',
    direccion: cli.direccion || '',
    ciudad: cli.ciudad || '',
  } : null;

  return {
    id: datos.id || uid(),
    fecha: todayISO(),
    numero: datos.numero || null, // se asigna después con siguienteNumero()
    cliente_id: (datos.cliente && datos.cliente.id) || null,
    cliente_nombre: (datos.cliente && datos.cliente.nombre) || '',
    cliente: clienteSnapshot,
    metodo_pago: String(datos.metodo_pago || '').trim(),
    items: (datos.items || []).map((it) => ({
      producto_id: it.producto_id,
      codigo: it.codigo || '',
      nombre: it.nombre,
      precio: Number(it.precio) || 0,
      cantidad: Number(it.cantidad) || 0,
      descuento: Number(it.descuento) || 0,
      costo: Number(it.costo) || 0,
      impuesto_pct: Number(it.impuesto_pct) || 0,
      subtotal: calcularSubtotalItem(it),
      impuesto: calcularImpuestoItem(it),
      total: calcularTotalItem(it),
    })),
    subtotal: totales.subtotal,
    impuesto: totales.impuesto,
    descuento: totales.descuento,
    utilidad: totales.utilidad,
    total: totales.total,
    estado: 'completada',
    data: {
      timestamp: nowISO(),
    },
  };
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Lista todas las ventas almacenadas localmente, ordenadas
 * por fecha descendente (más nuevas primero).
 *
 * @returns {Promise<Array>}
 */
export async function listar() {
  const items = await db.getAll(TABLA);
  items.sort((a, b) => {
    const fa = a.fecha || '';
    const fb = b.fecha || '';
    if (fa !== fb) return fb.localeCompare(fa); // fecha desc
    // Si misma fecha, ordenar por numero desc
    const na = a.numero || '';
    const nb = b.numero || '';
    return nb.localeCompare(na);
  });
  return items;
}

/**
 * Obtiene UNA venta por su ID.
 */
export async function obtener(id) {
  if (!id) return null;
  return await db.get(TABLA, id);
}

/**
 * Cuenta cuántas ventas hay almacenadas localmente.
 */
export async function contar() {
  return await db.count(TABLA);
}

/**
 * Registra una venta completa:
 *   1. Valida el carrito
 *   2. Asigna número secuencial
 *   3. Guarda en local + nube
 *   4. Descuenta el stock de cada producto
 *
 * @param {Object} datos - { items, cliente?, metodo_pago, descuento? }
 * @returns {Promise<Object>} - La venta guardada
 * @throws {Error} - Si la validación falla
 */
export async function registrar(datos) {
  const errores = validar(datos);
  if (errores.length > 0) {
    throw new Error('Validación: ' + errores.join(', '));
  }

  // Asignar número secuencial
  const numero = await siguienteNumero();
  const venta = construirVenta({ ...datos, numero });

  // 1) Guardar la venta (local + nube)
  await Sync.guardar(TABLA, venta);

  // 2) Descontar stock de cada producto vendido
  try {
    await descontarStock(venta.items);
  } catch (err) {
    console.warn('Error descontando stock:', err);
    // No revertimos la venta — el ajuste de stock puede hacerse manualmente
  }

  return venta;
}

/**
 * Descuenta el stock de los productos vendidos.
 * Por cada item del carrito, busca el producto y le resta la cantidad.
 *
 * @param {Array} items - Items vendidos
 */
async function descontarStock(items) {
  const resumen = [];
  for (const item of items) {
    if (!item.producto_id) {
      console.warn('🛑 Item sin producto_id, no se descuenta stock:', item);
      continue;
    }
    try {
      const producto = await db.get(TABLA_PRODUCTOS, item.producto_id);
      if (!producto) {
        console.warn(`🛑 Producto ${item.producto_id} (${item.nombre}) no encontrado en IndexedDB. Stock NO descontado.`);
        continue;
      }

      const stockAnterior = Number(producto.stock) || 0;
      const cantidad = Number(item.cantidad) || 0;
      // Permitir stock negativo (sobreventa) — refleja la realidad del inventario
      const stockNuevo = stockAnterior - cantidad;
      const actualizado = { ...producto, stock: stockNuevo };

      await Sync.guardar(TABLA_PRODUCTOS, actualizado);
      resumen.push(`${producto.nombre}: ${stockAnterior} → ${stockNuevo} (−${cantidad})`);
    } catch (e) {
      console.error(`❌ Error descontando stock de ${item.producto_id}:`, e);
    }
  }
  if (resumen.length > 0) {
    console.log('📦 Stock actualizado tras la venta:\n  • ' + resumen.join('\n  • '));
  }
}

/**
 * Elimina una venta y devuelve el stock de los productos vendidos
 * al inventario.
 *
 * @param {string} id - ID de la venta
 * @returns {Promise<{devueltas: number}>} - Cantidad de unidades devueltas al stock
 */
export async function eliminar(id) {
  const venta = await db.get(TABLA, id);
  if (!venta) throw new Error('Venta no encontrada');

  let devueltas = 0;
  for (const item of venta.items || []) {
    if (!item.producto_id) continue;
    try {
      const producto = await db.get(TABLA_PRODUCTOS, item.producto_id);
      if (!producto) continue;
      const cantidad = Number(item.cantidad) || 0;
      const stockNuevo = (Number(producto.stock) || 0) + cantidad;
      const actualizado = { ...producto, stock: stockNuevo };
      await Sync.guardar(TABLA_PRODUCTOS, actualizado);
      devueltas += cantidad;
    } catch (e) {
      console.warn(`No se pudo devolver stock de ${item.producto_id}:`, e);
    }
  }

  await Sync.borrar(TABLA, id);
  return { devueltas };
}

/**
 * Actualiza una venta existente (usado para ediciones).
 * Ajusta el stock según la diferencia de cantidades entre la versión
 * vieja y la nueva, y agrega una entrada al historial de ediciones.
 *
 * @param {string} id - ID de la venta
 * @param {Array} itemsNuevos - Lista nueva de items con cantidad/precio/desc actualizados
 * @param {string} [motivo] - Texto opcional con el motivo de la edición
 * @returns {Promise<Object>} - La venta actualizada
 */
export async function actualizar(id, itemsNuevos, motivo = '') {
  const venta = await db.get(TABLA, id);
  if (!venta) throw new Error('Venta no encontrada');

  // Cantidades previas para calcular delta de stock
  const previos = (venta.items || []).map((it) => ({
    producto_id: it.producto_id,
    cantidad: Number(it.cantidad) || 0,
  }));

  // Construir items actualizados con cálculos al día
  const items = itemsNuevos.map((nuevo) => {
    const orig = venta.items.find((x) => x.producto_id === nuevo.producto_id) || {};
    const merged = {
      producto_id: nuevo.producto_id,
      codigo: orig.codigo || '',
      nombre: orig.nombre || nuevo.nombre || '',
      precio: Number(nuevo.precio) || 0,
      cantidad: Math.max(0, Number(nuevo.cantidad) || 0),
      impuesto_pct: Number(orig.impuesto_pct) || 0,
      descuento: Math.max(0, Number(nuevo.descuento) || 0),
    };
    merged.subtotal = calcularSubtotalItem(merged);
    merged.impuesto = calcularImpuestoItem(merged);
    merged.total = calcularTotalItem(merged);
    return merged;
  });

  // Ajustar stock según diferencia (delta = nueva - previa)
  const cambios = [];
  for (const it of items) {
    const prev = previos.find((p) => p.producto_id === it.producto_id);
    const prevQty = prev ? prev.cantidad : 0;
    const delta = it.cantidad - prevQty;

    if (delta !== 0 && it.producto_id) {
      try {
        const producto = await db.get(TABLA_PRODUCTOS, it.producto_id);
        if (producto) {
          const stockNuevo = (Number(producto.stock) || 0) - delta;
          await Sync.guardar(TABLA_PRODUCTOS, { ...producto, stock: stockNuevo });
        }
      } catch (e) {
        console.warn(`No se pudo ajustar stock de ${it.producto_id}:`, e);
      }
      cambios.push(`${it.nombre}: cantidad ${prevQty} → ${it.cantidad}`);
    }
  }

  // Recalcular totales globales
  const totales = calcularTotales(items, venta.descuento || 0);

  const ediciones = Array.isArray(venta.ediciones) ? [...venta.ediciones] : [];
  if (cambios.length > 0) {
    ediciones.push({
      fecha: nowISO(),
      motivo,
      cambios,
      totalAnterior: venta.total,
      totalNuevo: totales.total,
    });
  }

  const actualizada = {
    ...venta,
    items,
    subtotal: totales.subtotal,
    impuesto: totales.impuesto,
    total: totales.total,
    ediciones,
  };

  await Sync.guardar(TABLA, actualizada);
  return actualizada;
}

/**
 * Sincroniza desde la nube: baja todas las ventas del tenant
 * actual y las guarda en local.
 */
export async function descargarDeNube() {
  if (!Supa.isReady()) {
    console.warn('Supabase no disponible, no se puede descargar');
    return 0;
  }
  return await Sync.descargar(TABLA);
}