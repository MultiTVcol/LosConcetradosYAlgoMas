/**
 * modules/gastos/gastos.repo.js — Acceso a datos del módulo Gastos
 *
 * Gastos representan salidas de dinero del negocio: servicios, nómina,
 * impuestos, etc. La categoría especial "Productos" sirve para registrar
 * bajas de inventario (dañado, vencido, uso interno) y descuenta stock.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { uid } from '../../core/strings.js';
import { todayISO, nowISO } from '../../core/dates.js';
import * as Auth from '../../services/auth.js';

/** Cajero de la sesión actual (para el cierre por cajero). */
function cajeroSello() {
  const u = Auth.usuarioActual();
  return { cajero: (u && u.nombre) || '', cajero_id: (u && u.id) || '' };
}

const TABLA = 'gastos';
const TABLA_PRODUCTOS = 'productos';

export const CATEGORIAS = [
  'Servicios', 'Nómina', 'Arriendo', 'Impuestos', 'Transporte',
  'Mercadeo', 'Mantenimiento', 'Insumos', 'Comisiones', 'Productos', 'Otros',
];

export const ICONOS = {
  Servicios: '💡', Nómina: '👷', Arriendo: '🏠', Impuestos: '🏛️',
  Transporte: '🚗', Mercadeo: '📣', Mantenimiento: '🔧', Insumos: '🧰',
  Comisiones: '🤝', Productos: '📦', Otros: '📌',
};

export const MOTIVOS_BAJA = ['Dañado', 'Vencido', 'Uso interno', 'Robo/Pérdida', 'Otro'];

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

/**
 * Guarda un gasto normal (no baja de productos).
 */
export async function guardar(datos) {
  const item = {
    id: datos.id || uid(),
    fecha: datos.fecha || todayISO(),
    categoria: datos.categoria || 'Otros',
    concepto: String(datos.concepto || '').trim(),
    monto: Number(datos.monto) || 0,
    nota: String(datos.nota || '').trim(),
    creado: datos.creado || nowISO(),
    ...cajeroSello(),
  };
  await Sync.guardar(TABLA, item);
  return item;
}

/**
 * Guarda un gasto categoría Productos: registra la baja, descuenta stock.
 * Si es edición, revierte el stock del gasto original primero.
 *
 * @param {Object} datos - { id?, fecha, items: [{producto_id,nombre,cantidad,costo,motivo}], nota }
 * @returns {Promise<Object>} - El gasto guardado
 */
export async function guardarBajaProductos(datos) {
  const items = datos.items || [];
  if (items.length === 0) throw new Error('No hay productos en la baja');

  // Si es edición, revertir stock del gasto original (delta atómico)
  if (datos.id) {
    const original = await db.get(TABLA, datos.id);
    if (original && original.categoria === 'Productos' && Array.isArray(original.items)) {
      for (const it of original.items) {
        try {
          await Sync.ajustarStock(it.producto_id, Number(it.cantidad) || 0);
        } catch (e) {
          console.warn('Error revirtiendo stock:', e);
        }
      }
    }
  }

  // Descontar stock de los productos de la nueva baja (delta atómico;
  // permite negativo, consistente con Ventas y Compras)
  for (const it of items) {
    try {
      await Sync.ajustarStock(it.producto_id, -(Number(it.cantidad) || 0));
    } catch (e) {
      console.warn('Error descontando stock:', e);
    }
  }

  const total = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.costo) || 0), 0);
  const conceptoAuto = items.length === 1
    ? `Baja de ${items[0].nombre} (${items[0].motivo})`
    : `Baja de ${items.length} producto(s) del inventario`;

  const item = {
    id: datos.id || uid(),
    fecha: datos.fecha || todayISO(),
    categoria: 'Productos',
    concepto: conceptoAuto,
    monto: total,
    nota: String(datos.nota || '').trim(),
    items: items.map((it) => ({
      producto_id: it.producto_id,
      nombre: it.nombre,
      codigo: it.codigo || '',
      cantidad: Number(it.cantidad) || 0,
      costo: Number(it.costo) || 0,
      motivo: it.motivo || 'Otro',
    })),
    creado: datos.creado || nowISO(),
    ...cajeroSello(),
  };

  await Sync.guardar(TABLA, item);
  return item;
}

/**
 * Elimina un gasto. Si era una baja de productos, devuelve el stock.
 */
export async function eliminar(id) {
  const gasto = await db.get(TABLA, id);
  if (!gasto) throw new Error('Gasto no encontrado');

  if (gasto.categoria === 'Productos' && Array.isArray(gasto.items)) {
    for (const it of gasto.items) {
      try {
        await Sync.ajustarStock(it.producto_id, Number(it.cantidad) || 0);
      } catch (e) {
        console.warn('Error devolviendo stock:', e);
      }
    }
  }

  await Sync.borrar(TABLA, id);
  return { devuelto: gasto.categoria === 'Productos' };
}

/**
 * Devuelve los gastos dentro de un rango de fechas (YYYY-MM-DD),
 * con desglose por categoría.
 */
export async function rango(desde, hasta) {
  const items = await listar();
  let total = 0;
  let n = 0;
  const porCategoria = {};

  for (const g of items) {
    const d = (g.fecha || '').slice(0, 10);
    if (d >= desde && d <= hasta) {
      const m = Number(g.monto) || 0;
      total += m;
      n++;
      const cat = g.categoria || 'Otros';
      porCategoria[cat] = (porCategoria[cat] || 0) + m;
    }
  }
  return { total, n, porCategoria };
}
