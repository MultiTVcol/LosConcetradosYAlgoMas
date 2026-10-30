/**
 * Pestaña Saldos iniciales: con qué arranca la contabilidad. El dinero
 * lo escribe el usuario; inventario, cartera y deudas los calcula el
 * sistema a la fecha de inicio.
 */

import * as db from '../../../services/db.js';
import * as Sync from '../../../services/sync.js';
import * as Motor from '../../../services/motor-contable.js';
import * as Servicio from '../contabilidad.service.js';
import * as PUC from '../puc.repo.js';
import { money, num, round } from '../../../core/format.js';
import { esc } from '../../../core/strings.js';
import { fmtDate } from '../../../core/dates.js';
import { Toast } from '../../../components/index.js';
import { tarjeta, th, td, tabla, vacio, aviso } from '../ui.js';

/** Lo que el sistema ya sabe a la fecha de inicio: inventario, cartera y deudas. */
async function sugerencias(inicio, cuentaInventario) {
  const [productos, ventas, compras, movido] = await Promise.all([
    db.getAll('productos'), db.getAll('ventas'), db.getAll('compras'), Motor.movimientoSinApertura(cuentaInventario),
  ]);
  // Inventario de hoy (stock × costo) menos lo que ya movieron los
  // asientos desde la fecha de inicio = inventario a la fecha de inicio.
  const inventarioHoy = round(productos.reduce((s, p) => s + Math.max(0, num(p.stock)) * num(p.costo), 0), 2);
  const inventario = round(Math.max(0, inventarioHoy - movido), 2);

  const pendienteAl = (doc) => {
    const abonado = (doc.abonos || []).filter((a) => String(a.fecha || '').slice(0, 10) < inicio).reduce((s, a) => s + num(a.monto), 0);
    return round(num(doc.total) - abonado, 2);
  };
  const agrupar = (docs, idDe, nombreDe) => {
    const m = new Map();
    for (const d of docs) {
      const v = pendienteAl(d);
      if (v <= 0.5) continue;
      const id = idDe(d);
      const prev = m.get(id) || { tercero_id: id, tercero_nombre: nombreDe(d), valor: 0 };
      prev.valor = round(prev.valor + v, 2);
      m.set(id, prev);
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor);
  };
  const antes = (d) => String(d.fecha || '').slice(0, 10) < inicio;
  const cartera = agrupar(
    ventas.filter((v) => antes(v) && v.tipoPago === 'credito' && v.estado !== 'anulada'),
    (v) => v.cliente_id || `cli:${v.cliente_nombre || 'ocasional'}`, (v) => v.cliente_nombre || 'Cliente ocasional');
  const deudas = agrupar(
    compras.filter((c) => antes(c) && c.tipoPago === 'credito'),
    (c) => c.proveedor_id || `prov:${c.proveedor || 'sin-nombre'}`, (c) => c.proveedor || 'Proveedor');
  return { inventario, inventarioHoy, movido, cartera, deudas };
}

export async function render(el, ctx) {
  const cfg = ctx.cfg;
  if (!cfg.fecha_inicio) {
    el.innerHTML = tarjeta('Saldos iniciales', vacio('Primero escoge la fecha de inicio contable en la pestaña Resumen.'));
    return;
  }
  const C = cfg.cuentas;
  const [sug, actual, cuentas] = await Promise.all([sugerencias(cfg.fecha_inicio, C.inventario), Motor.aperturaActual(), PUC.listar()]);
  const nombre = new Map(cuentas.map((c) => [c.codigo, c.nombre]));
  const previo = (cuenta) => round((actual?.lineas || []).filter((l) => l.cuenta === cuenta).reduce((s, l) => s + l.debito, 0), 2);

  const dinero = [
    ['Caja (efectivo)', C.medios.efectivo],
    ['Banco', C.medios.transferencia],
    ['Nequi', C.medios.nequi],
    ['Daviplata', C.medios.daviplata],
    ['QR / datáfono', C.medios.qr],
  ].filter(([, cta], i, arr) => arr.findIndex(([, c2]) => c2 === cta) === i);

  const totCartera = round(sug.cartera.reduce((s, x) => s + x.valor, 0), 2);
  const totDeudas = round(sug.deudas.reduce((s, x) => s + x.valor, 0), 2);
  const inp = (id, valor) => `<input id="${id}" class="input" inputmode="numeric" style="text-align:right;max-width:180px" value="${valor ? Math.round(valor) : ''}" placeholder="0">`;

  el.innerHTML = `
    ${actual ? aviso(`Ya hay saldos iniciales registrados (${esc(actual.numero)}). Si guardas de nuevo, el asiento anterior se reversa y queda el nuevo.`, 'ok') : ''}
    ${tarjeta(`Dinero al ${fmtDate(cfg.fecha_inicio)}`, `<p style="margin:0 0 8px;font-size:13px;color:#7D6858">Lo que había en caja y en cada cuenta al empezar ese día.</p>` + dinero.map(([l, cta]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0">
        <span style="font-size:13.5px;color:#5C4636;font-weight:600">${l} <span style="color:#A8957F;font-weight:400">${cta} ${esc(nombre.get(cta) || '')}</span></span>
        ${inp(`ap-${cta}`, previo(cta))}
      </div>`).join(''))}
    ${tarjeta('Inventario', `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:13.5px;color:#5C4636;max-width:640px;line-height:1.5">Valor a costo de la mercancía al ${fmtDate(cfg.fecha_inicio)}: <b>${money(sug.inventario)}</b>
          <span style="color:#7D6858">(hoy vale ${money(sug.inventarioHoy)} y desde esa fecha las compras, ventas y ajustes ya movieron ${money(sug.movido)}).</span></span>
        ${inp('ap-inventario', previo(C.inventario) || sug.inventario)}
      </div>`)}
    ${tarjeta(`Cartera de clientes · ${money(totCartera)}`, sug.cartera.length === 0
      ? vacio('No hay ventas a crédito pendientes antes de la fecha de inicio.')
      : tabla(th('Cliente') + th('Saldo', true), sug.cartera.map((x) => `<tr>${td(esc(x.tercero_nombre))}${td(money(x.valor), true)}</tr>`).join('')),
      `<span style="font-size:12.5px;color:#7D6858">Tomada de las ventas a crédito</span>`)}
    ${tarjeta(`Deudas con proveedores · ${money(totDeudas)}`, sug.deudas.length === 0
      ? vacio('No hay compras a crédito pendientes antes de la fecha de inicio.')
      : tabla(th('Proveedor') + th('Saldo', true), sug.deudas.map((x) => `<tr>${td(esc(x.tercero_nombre))}${td(money(x.valor), true)}</tr>`).join('')),
      `<span style="font-size:12.5px;color:#7D6858">Tomadas de las compras a crédito</span>`)}
    <div id="ap-total" style="background:#FBF7F1;border:1px solid #EADFD0;border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:14px;color:#2A1A10"></div>
    <div style="display:flex;justify-content:flex-end">
      <button id="ap-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar saldos iniciales</button>
    </div>
  `;

  const valor = (id) => num(String(el.querySelector(`#${id}`)?.value || '').replace(/[^\d]/g, ''));
  const armar = () => {
    const lineas = [];
    for (const [, cta] of dinero) {
      const v = valor(`ap-${cta}`);
      if (v > 0) lineas.push({ cuenta: cta, debito: v, detalle: 'Saldo inicial' });
    }
    const invent = valor('ap-inventario');
    if (invent > 0) lineas.push({ cuenta: C.inventario, debito: invent, detalle: 'Inventario inicial' });
    for (const x of sug.cartera) lineas.push({ cuenta: C.clientes, debito: x.valor, tercero_id: x.tercero_id, tercero_nombre: x.tercero_nombre, detalle: 'Cartera inicial' });
    for (const x of sug.deudas) lineas.push({ cuenta: C.proveedores, credito: x.valor, tercero_id: x.tercero_id, tercero_nombre: x.tercero_nombre, detalle: 'Deuda inicial' });
    return lineas;
  };
  const actualizarTotal = () => {
    const ls = armar();
    const activos = round(ls.reduce((s, l) => s + num(l.debito), 0), 2);
    const pasivos = round(ls.reduce((s, l) => s + num(l.credito), 0), 2);
    el.querySelector('#ap-total').innerHTML = `Activos <b>${money(activos)}</b> − Deudas <b>${money(pasivos)}</b> = Patrimonio inicial <b>${money(activos - pasivos)}</b>
      <span style="color:#7D6858">(cuenta ${C.patrimonioApertura} ${esc(nombre.get(C.patrimonioApertura) || '')})</span>`;
  };
  el.querySelectorAll('input').forEach((i) => i.addEventListener('input', actualizarTotal));
  actualizarTotal();

  el.querySelector('#ap-guardar').addEventListener('click', async () => {
    if (!Sync.esSoloLectura() && (await Servicio.verificarTablaNube()) === 'falta') {
      Toast.warn('Primero corre supabase-contabilidad.sql en Supabase');
      return;
    }
    try {
      const n = await Motor.guardarApertura({ fecha: cfg.fecha_inicio, lineas: armar() });
      Toast.ok(n ? 'Saldos iniciales guardados' : 'Los saldos ya estaban así');
      ctx.repintar();
    } catch (e) {
      Toast.error(e.message || 'No se pudieron guardar los saldos');
    }
  });
}
