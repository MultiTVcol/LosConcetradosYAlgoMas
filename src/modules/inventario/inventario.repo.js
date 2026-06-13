/**
 * modules/inventario/inventario.repo.js — Inventario y kardex
 *
 * El KARDEX de cada producto se DERIVA de los documentos (compras,
 * ventas, bajas y conteos) — no hay una tabla aparte que pueda
 * desincronizarse: una sola fuente de la verdad.
 *
 * El CONTEO FÍSICO compara lo contado contra el sistema y ajusta el
 * stock con el delta de unidades (sobrante/faltante), guardando el
 * documento del ajuste para que quede en la historia del producto.
 *
 * (Versión POS: sin asientos contables — eso vive en ContaExpress.)
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { uid } from '../../core/strings.js';
import { todayISO, nowISO } from '../../core/dates.js';
import { round, num } from '../../core/format.js';

const TABLA_AJUSTES = 'ajustes_inventario';

// ============================================================
//  RESUMEN (KPIs + filas de productos)
// ============================================================

export async function resumen() {
  const productos = await db.getAll('productos');
  let valorCosto = 0;
  let valorVenta = 0;
  let unidades = 0;
  let bajoStock = 0;
  let agotados = 0;

  for (const p of productos) {
    const st = num(p.stock);
    if (st > 0) {
      valorCosto += st * num(p.costo);
      valorVenta += st * num(p.precio);
      unidades += st;
    }
    if (st <= 0) agotados++;
    else if (st <= num(p.stock_min)) bajoStock++;
  }

  productos.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

  return {
    productos,
    skus: productos.length,
    unidades,
    valorCosto: round(valorCosto, 2),
    valorVenta: round(valorVenta, 2),
    utilidadPotencial: round(valorVenta - valorCosto, 2),
    bajoStock,
    agotados,
  };
}

// ============================================================
//  KARDEX (derivado de los documentos)
// ============================================================

/**
 * Historia completa de movimientos de UN producto:
 * compras (entradas), ventas (salidas), bajas (salidas) y conteos (±),
 * con saldo acumulado consistente con el stock actual.
 */
export async function kardexDe(productoId) {
  const producto = await db.get('productos', productoId);
  if (!producto) throw new Error('Producto no encontrado');

  const [ventas, compras, gastos, ajustes] = await Promise.all([
    db.getAll('ventas'),
    db.getAll('compras'),
    db.getAll('gastos'),
    db.getAll(TABLA_AJUSTES),
  ]);

  const movs = [];

  for (const c of compras) {
    if (c.estado === 'anulada') continue;
    for (const it of c.items || []) {
      if (it.producto_id !== productoId) continue;
      movs.push({
        fecha: c.fecha, orden: c.creado || '', tipo: 'Compra',
        doc: c.ref || '', detalle: c.proveedor || '',
        entrada: num(it.cantidad), salida: 0, costo: num(it.costo),
      });
    }
  }

  for (const v of ventas) {
    if (v.estado === 'anulada') continue;
    for (const it of v.items || []) {
      if (it.producto_id !== productoId) continue;
      movs.push({
        fecha: v.fecha, orden: v.data?.timestamp || '', tipo: 'Venta',
        doc: v.numero || '', detalle: v.cliente_nombre || '',
        entrada: 0, salida: num(it.cantidad), costo: num(it.costo),
      });
    }
  }

  for (const g of gastos) {
    if (g.categoria !== 'Productos') continue;
    for (const it of g.items || []) {
      if (it.producto_id !== productoId) continue;
      movs.push({
        fecha: g.fecha, orden: g.creado || '', tipo: 'Baja',
        doc: g.numero || '', detalle: it.motivo || '',
        entrada: 0, salida: num(it.cantidad), costo: num(it.costo),
      });
    }
  }

  for (const a of ajustes) {
    if (a.estado === 'anulado') continue;
    for (const it of a.items || []) {
      if (it.producto_id !== productoId) continue;
      const delta = num(it.delta);
      movs.push({
        fecha: a.fecha, orden: a.creado || '', tipo: 'Conteo físico',
        doc: a.numero || '', detalle: `Sistema ${it.sistema} → físico ${it.fisico}`,
        entrada: delta > 0 ? delta : 0, salida: delta < 0 ? -delta : 0, costo: num(it.costo),
      });
    }
  }

  movs.sort((a, b) => (a.fecha + a.orden).localeCompare(b.fecha + b.orden));

  // Saldo acumulado consistente con el stock actual:
  // saldoInicial = stockActual − Σ(entradas − salidas)
  const sumaDeltas = movs.reduce((s, m) => s + m.entrada - m.salida, 0);
  const saldoInicial = round(num(producto.stock) - sumaDeltas, 2);

  let saldo = saldoInicial;
  for (const m of movs) {
    saldo = round(saldo + m.entrada - m.salida, 2);
    m.saldo = saldo;
  }

  return { producto, saldoInicial, movimientos: movs };
}

// ============================================================
//  CONTEO FÍSICO (ajuste de unidades)
// ============================================================

/** Genera el siguiente número de ajuste: AJ-0001, AJ-0002, … */
async function siguienteNumero() {
  const items = await db.getAll(TABLA_AJUSTES);
  let max = 0;
  for (const a of items) {
    const m = String(a.numero || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `AJ-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Registra un conteo físico de UN producto: la diferencia contra el
 * sistema ajusta el stock (delta atómico) y guarda el documento del
 * ajuste para la historia del kardex.
 *
 * @param {Object} datos - { producto_id, fisico, nota?, fecha? }
 */
export async function registrarConteo(datos) {
  const p = await db.get('productos', datos.producto_id);
  if (!p) throw new Error('Producto no encontrado');

  const sistema = num(p.stock);
  const fisico = num(datos.fisico);
  if (fisico < 0) throw new Error('El conteo físico no puede ser negativo');
  const delta = round(fisico - sistema, 2);
  if (delta === 0) throw new Error('No hay diferencia: el físico coincide con el sistema');

  const costo = num(p.costo);
  const valor = round(delta * costo, 2); // + sobrante · − faltante

  const numero = await siguienteNumero();
  const ajuste = {
    id: uid(),
    numero,
    fecha: datos.fecha || todayISO(),
    items: [{
      producto_id: p.id,
      nombre: p.nombre,
      codigo: p.codigo || '',
      sistema,
      fisico,
      delta,
      costo,
      valor,
    }],
    valor,
    nota: String(datos.nota || '').trim(),
    estado: 'activo',
    creado: nowISO(),
  };

  // Ajustar unidades (delta atómico) y guardar el documento del ajuste
  await Sync.ajustarStock(p.id, delta);
  await Sync.guardar(TABLA_AJUSTES, ajuste);

  return ajuste;
}

export async function listarAjustes() {
  const items = await db.getAll(TABLA_AJUSTES);
  items.sort((a, b) => (b.fecha + (b.creado || '')).localeCompare(a.fecha + (a.creado || '')));
  return items;
}
