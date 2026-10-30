/**
 * modules/contabilidad/contabilidad.view.js — Contabilidad (Fase 1)
 *
 * Pestañas:
 *   - Resumen: interruptor, fecha de inicio, revisión general, pendientes
 *     y balance de prueba (que SIEMPRE debe cuadrar).
 *   - Asientos: las causaciones generadas, con sus líneas.
 *   - Cuentas: qué cuenta del PUC usa cada cosa (caja, ingresos, IVA…).
 *   - Saldos iniciales: con qué arranca la contabilidad.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import * as Motor from '../../services/motor-contable.js';
import * as Servicio from './contabilidad.service.js';
import * as PUC from './puc.repo.js';
import { money, num, round } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO, fmtDate, startOfMonth } from '../../core/dates.js';
import { Toast, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { pageHeader, kpiGrid, badge } from '../../app/ui-kit.js';

let _c = null;
let _tab = 'resumen';
let _off = null;
let _ocupado = false;
let _filtro = { desde: startOfMonth(), hasta: todayISO(), q: '' };

const TABS = [
  { id: 'resumen',  label: 'Resumen',          icono: 'gauge' },
  { id: 'asientos', label: 'Asientos',         icono: 'list' },
  { id: 'cuentas',  label: 'Cuentas',          icono: 'settings-2' },
  { id: 'apertura', label: 'Saldos iniciales', icono: 'flag' },
];

const ORIGENES = {
  venta: 'Venta', recaudo: 'Recaudo', compra: 'Compra', pago: 'Pago a proveedor',
  gasto: 'Gasto', baja: 'Baja de productos', ajuste_inventario: 'Ajuste de inventario',
  apertura: 'Saldos iniciales', reversion: 'Reversión',
};

export async function render(contenedor) {
  _c = contenedor;
  if (_off) _off();
  _off = Servicio.onCambio(() => { if (!_ocupado && _c?.isConnected) pintar(); });
  await pintar();
}

async function pintar() {
  const cfg = await Motor.config();
  _c.innerHTML = `
    <div style="padding:32px 40px;max-width:1280px">
      ${pageHeader({
        icono: 'book-open-check',
        titulo: 'Contabilidad',
        descripcion: 'Cada venta, compra, gasto y abono crea su asiento solo, con partida doble.',
        acciones: cfg.activa ? badge('Activa', 'success') : badge('Apagada', 'neutral'),
      })}
      ${Sync.esSoloLectura() ? `
        <div style="background:#FEF3C7;border:1px solid #F5D78A;color:#7A4B00;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px">
          🧪 <b>Modo prueba:</b> la nube es solo lectura. Lo que hagas aquí queda en este navegador y no llega a la tienda.
        </div>` : ''}
      <div style="display:flex;gap:6px;border-bottom:1px solid #EADFD0;margin-bottom:22px;flex-wrap:wrap">
        ${TABS.map((t) => `
          <button data-tab="${t.id}" style="display:flex;align-items:center;gap:7px;padding:10px 14px;border:0;background:none;cursor:pointer;font:inherit;font-size:14px;font-weight:600;
            color:${_tab === t.id ? '#2A1A10' : '#7D6858'};border-bottom:2px solid ${_tab === t.id ? '#EE7623' : 'transparent'};margin-bottom:-1px">
            <i data-lucide="${t.icono}" style="width:16px;height:16px"></i>${t.label}
          </button>`).join('')}
      </div>
      <div id="ct-cuerpo"><div style="color:#7D6858;font-size:14px">Cargando…</div></div>
    </div>
  `;
  _c.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { _tab = b.dataset.tab; pintar(); }));
  const cuerpo = _c.querySelector('#ct-cuerpo');
  if (_tab === 'resumen') await tabResumen(cuerpo, cfg);
  else if (_tab === 'asientos') await tabAsientos(cuerpo);
  else if (_tab === 'cuentas') await tabCuentas(cuerpo, cfg);
  else await tabApertura(cuerpo, cfg);
  refrescarIconos(_c);
}

const tarjeta = (titulo, cuerpo, extra = '') => `
  <div style="background:#fff;border:1px solid #EADFD0;border-radius:16px;padding:20px 22px;margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <h2 style="margin:0;font-size:16px;font-weight:700;color:#2A1A10">${titulo}</h2>${extra}
    </div>
    ${cuerpo}
  </div>`;

const th = (t, der = false) => `<th style="text-align:${der ? 'right' : 'left'};padding:8px 10px;font-size:12px;color:#7D6858;font-weight:600;border-bottom:1px solid #EADFD0;white-space:nowrap">${t}</th>`;
const td = (t, der = false, estilo = '') => `<td style="text-align:${der ? 'right' : 'left'};padding:8px 10px;font-size:13px;color:#2A1A10;border-bottom:1px solid #F3ECE3;${der ? 'font-variant-numeric:tabular-nums;white-space:nowrap;' : ''}${estilo}">${t}</td>`;
const tabla = (cabeza, filas) => `
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr>${cabeza}</tr></thead><tbody>${filas}</tbody>
  </table></div>`;

// ============================================================
//  RESUMEN
// ============================================================

async function tabResumen(el, cfg) {
  const [asientos, errores, bp, tablaNube] = await Promise.all([
    db.getAll(Motor.TABLA), Servicio.errores(), Motor.balancePrueba(), Servicio.verificarTablaNube(),
  ]);
  const faltaTabla = tablaNube === 'falta' && !Sync.esSoloLectura();

  const estado = `
    <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:end">
      <div>
        <label class="lbl">Fecha de inicio contable</label>
        <input id="ct-inicio" type="date" class="input" value="${esc(cfg.fecha_inicio)}" ${cfg.activa ? 'disabled' : ''}>
        <div style="font-size:12px;color:#A8957F;margin-top:6px">Lo anterior a esta fecha no se contabiliza; entra como saldo inicial.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${cfg.activa
          ? `<button id="ct-apagar" class="btn btn-ghost"><i data-lucide="power"></i>Apagar contabilidad</button>`
          : `<button id="ct-activar" class="btn btn-primary" ${faltaTabla ? 'disabled' : ''}><i data-lucide="power"></i>Activar contabilidad</button>`}
      </div>
    </div>
    ${faltaTabla ? `
      <div style="background:#FDECEC;border:1px solid #F5C2C2;color:#8A1C1C;border-radius:12px;padding:12px 16px;margin-top:16px;font-size:13.5px;line-height:1.5">
        Falta la tabla <b>asientos</b> en Supabase. Corre el archivo <code>supabase-contabilidad.sql</code> en el SQL Editor y vuelve a esta pantalla.
      </div>` : ''}
  `;

  const kpis = kpiGrid([
    { label: 'Asientos', valor: String(asientos.length), sub: 'causaciones registradas', icono: 'list', color: '#4A2E1A' },
    { label: 'Pendientes por revisar', valor: String(errores.length), sub: errores.length ? 'documentos sin asiento' : 'todo contabilizado', icono: 'alert-triangle', color: errores.length ? '#B45309' : '#15803D' },
    { label: 'Débitos = Créditos', valor: bp.cuadrado ? 'Cuadra' : 'Descuadre', sub: `${money(bp.totalDebitos)} / ${money(bp.totalCreditos)}`, icono: 'scale', color: bp.cuadrado ? '#15803D' : '#B91C1C' },
  ]);

  const pendientes = errores.length === 0 ? '' : tarjeta('Pendientes por revisar', tabla(
    th('Documento') + th('Número') + th('Motivo'),
    errores.map((e) => `<tr>${td(esc(e.tabla))}${td(esc(e.numero || e.id))}${td(esc(e.error), false, 'color:#8A1C1C')}</tr>`).join(''),
  ), `<button id="ct-reintentar" class="btn btn-ghost"><i data-lucide="rotate-cw"></i>Reintentar</button>`);

  const balance = tarjeta('Balance de prueba', bp.filas.length === 0
    ? `<div style="color:#7D6858;font-size:14px">Todavía no hay asientos.</div>`
    : tabla(
      th('Cuenta') + th('Nombre') + th('Débitos', true) + th('Créditos', true) + th('Saldo', true),
      bp.filas.map((f) => `<tr>${td(esc(f.cuenta))}${td(esc(f.nombre))}${td(money(f.debitos), true)}${td(money(f.creditos), true)}${td(money(f.saldoFinal), true, f.saldoFinal < 0 ? 'color:#7D6858' : '')}</tr>`).join('')
      + `<tr>${td('<b>Totales</b>')}${td('')}${td(`<b>${money(bp.totalDebitos)}</b>`, true)}${td(`<b>${money(bp.totalCreditos)}</b>`, true)}${td('')}</tr>`,
    ), cfg.activa ? `<button id="ct-revisar" class="btn btn-ghost"><i data-lucide="refresh-ccw"></i>Revisar y contabilizar todo</button>` : '');

  el.innerHTML = tarjeta('Estado', estado) + kpis + `<div id="ct-progreso"></div>` + pendientes + balance;

  el.querySelector('#ct-activar')?.addEventListener('click', () => activar(el));
  el.querySelector('#ct-apagar')?.addEventListener('click', async () => {
    if (!(await Confirm.preguntar('Las ventas nuevas dejarán de contabilizarse hasta que la vuelvas a activar. Los asientos que ya existen se conservan.', { titulo: 'Apagar contabilidad', textoConfirmar: 'Apagar' }))) return;
    await Motor.guardarConfig({ activa: false });
    Toast.ok('Contabilidad apagada');
    pintar();
  });
  el.querySelector('#ct-revisar')?.addEventListener('click', () => revisarTodo(el));
  el.querySelector('#ct-reintentar')?.addEventListener('click', async () => {
    const r = await Servicio.reintentarPendientes();
    if (r.fallan) Toast.warn(`${r.ok} corregidos, ${r.fallan} siguen pendientes`);
    else Toast.ok('Pendientes contabilizados');
    pintar();
  });
}

async function activar(el) {
  const fecha = el.querySelector('#ct-inicio')?.value;
  if (!fecha) { Toast.warn('Escoge primero la fecha de inicio contable'); return; }
  const ok = await Confirm.preguntar(
    `Se van a contabilizar todas las ventas, compras, gastos y ajustes desde el ${fmtDate(fecha)}. Después, cada operación nueva crea su asiento sola.`,
    { titulo: 'Activar contabilidad', textoConfirmar: 'Activar' },
  );
  if (!ok) return;
  await Motor.guardarConfig({ activa: true, fecha_inicio: fecha });
  await revisarTodo(el);
}

async function revisarTodo(el) {
  if (_ocupado) return;
  _ocupado = true;
  const prog = el.querySelector('#ct-progreso');
  const mostrar = (t) => { if (prog) prog.innerHTML = `<div style="background:#FBF7F1;border:1px solid #EADFD0;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px;color:#5C4636">⏳ ${t}</div>`; };
  mostrar('Revisando documentos…');
  try {
    const r = await Servicio.contabilizarTodo({
      onProgress: (p) => mostrar(p.fase === 'guardando'
        ? `Guardando asientos ${p.n} de ${p.total}…`
        : `Revisando documentos ${p.n} de ${p.total}…`),
    });
    if (r.errores.length) Toast.warn(`${r.escritos} asientos escritos · ${r.errores.length} documentos pendientes`);
    else Toast.ok(r.escritos ? `${r.escritos} asientos escritos` : 'Todo estaba al día');
  } catch (e) {
    Toast.error(e.message || 'No se pudo contabilizar');
  } finally {
    _ocupado = false;
    pintar();
  }
}

// ============================================================
//  ASIENTOS
// ============================================================

async function tabAsientos(el) {
  const lista = (await Motor.libroDiario({ desde: _filtro.desde, hasta: _filtro.hasta })).reverse();
  const q = _filtro.q.trim().toLowerCase();
  const filtrados = q
    ? lista.filter((a) => `${a.numero} ${a.descripcion}`.toLowerCase().includes(q) || (a.lineas || []).some((l) => l.cuenta.startsWith(q)))
    : lista;
  const cuentas = new Map((await PUC.listar()).map((c) => [c.codigo, c.nombre]));
  const TOPE = 300;

  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
      <div><label class="lbl">Desde</label><input id="ct-desde" type="date" class="input" value="${_filtro.desde}"></div>
      <div><label class="lbl">Hasta</label><input id="ct-hasta" type="date" class="input" value="${_filtro.hasta}"></div>
      <div style="flex:1;min-width:200px"><label class="lbl">Buscar</label><input id="ct-q" class="input" placeholder="Número, descripción o cuenta" value="${esc(_filtro.q)}"></div>
    </div>
    ${tarjeta(`${filtrados.length} asiento(s)`, filtrados.length === 0
      ? `<div style="color:#7D6858;font-size:14px">No hay asientos en este rango.</div>`
      : filtrados.slice(0, TOPE).map((a) => htmlAsiento(a, cuentas)).join('')
        + (filtrados.length > TOPE ? `<div style="color:#7D6858;font-size:13px;margin-top:10px">Se muestran los ${TOPE} más recientes. Acota el rango de fechas para ver más.</div>` : ''))}
  `;
  const recargar = () => {
    _filtro = { desde: el.querySelector('#ct-desde').value || '0000', hasta: el.querySelector('#ct-hasta').value || '9999', q: el.querySelector('#ct-q').value };
    tabAsientos(el).then(() => refrescarIconos(el));
  };
  el.querySelector('#ct-desde').addEventListener('change', recargar);
  el.querySelector('#ct-hasta').addEventListener('change', recargar);
  let t;
  el.querySelector('#ct-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(recargar, 250); });
}

function htmlAsiento(a, cuentas) {
  const estado = a.estado === 'reversado' ? badge('Reversado', 'warn') : a.origen_tipo === 'reversion' ? badge('Reversión', 'info') : '';
  return `
    <details style="border:1px solid #F3ECE3;border-radius:12px;margin-bottom:8px;${a.estado === 'reversado' ? 'opacity:.7' : ''}">
      <summary style="display:flex;gap:12px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none;flex-wrap:wrap">
        <span style="font-size:12.5px;color:#7D6858;min-width:84px">${fmtDate(a.fecha)}</span>
        <span style="font-weight:700;font-size:13px;min-width:110px">${esc(a.numero)}</span>
        <span style="flex:1;font-size:13px;min-width:180px">${esc(a.descripcion)} <span style="color:#A8957F">· ${ORIGENES[a.origen_tipo] || a.origen_tipo}</span></span>
        ${estado}
        <span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${money(a.total_debito)}</span>
      </summary>
      <div style="padding:0 14px 12px">
        ${tabla(th('Cuenta') + th('Tercero') + th('Detalle') + th('Débito', true) + th('Crédito', true),
          (a.lineas || []).map((l) => `<tr>
            ${td(`<b>${esc(l.cuenta)}</b> ${esc(cuentas.get(l.cuenta) || '')}`)}
            ${td(esc(l.tercero_nombre || ''))}${td(esc(l.detalle))}
            ${td(l.debito ? money(l.debito) : '', true)}${td(l.credito ? money(l.credito) : '', true)}</tr>`).join(''))}
      </div>
    </details>`;
}

// ============================================================
//  CUENTAS (configuración de qué cuenta usa cada cosa)
// ============================================================

const CAMPOS = [
  ['caja', 'Caja (gastos pagados en efectivo)'],
  ['clientes', 'Clientes — cartera'],
  ['proveedores', 'Proveedores — cuentas por pagar'],
  ['inventario', 'Inventario de mercancías'],
  ['ingresos', 'Ingresos por ventas'],
  ['ivaGenerado', 'IVA generado en ventas'],
  ['costo', 'Costo de ventas'],
  ['sobrantes', 'Sobrantes de inventario'],
  ['faltantes', 'Faltantes de inventario'],
  ['bajaProductos', 'Baja de productos (dañados, vencidos)'],
  ['gastoDefault', 'Gasto sin categoría'],
  ['patrimonioApertura', 'Patrimonio (contrapartida de saldos iniciales)'],
];

async function tabCuentas(el, cfg) {
  const movs = await PUC.cuentasMovimiento();
  const select = (name, valor) => `
    <select class="input" name="${name}">
      ${movs.map((c) => `<option value="${c.codigo}" ${c.codigo === valor ? 'selected' : ''}>${c.codigo} — ${esc(c.nombre)}</option>`).join('')}
    </select>`;
  const fila = (label, name, valor) => `
    <div style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1.4fr);gap:12px;align-items:center;padding:6px 0">
      <label style="font-size:13.5px;color:#5C4636;font-weight:600">${label}</label>${select(name, valor)}
    </div>`;
  const C = cfg.cuentas;

  el.innerHTML = `
    <form id="ct-form-cuentas">
      ${tarjeta('Cuentas principales', CAMPOS.map(([k, l]) => fila(l, k, C[k])).join(''))}
      ${tarjeta('Medios de pago', Object.keys(Motor.CUENTAS_DEFAULT.medios).map((k) => fila(Motor.ETIQUETAS_MEDIOS[k] || k, `medios.${k}`, C.medios[k])).join(''))}
      ${tarjeta('Categorías de gastos', Object.keys(Motor.CUENTAS_DEFAULT.gastos).map((k) => fila(k, `gastos.${k}`, C.gastos[k])).join(''))}
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" id="ct-restaurar" class="btn btn-ghost">Volver a las del PUC estándar</button>
        <button type="submit" class="btn btn-primary"><i data-lucide="save"></i>Guardar cuentas</button>
      </div>
      <p style="font-size:12.5px;color:#7D6858;margin-top:12px">El cambio aplica a lo que se registre de ahora en adelante. Para recalcular lo ya contabilizado usa “Revisar y contabilizar todo” en Resumen.</p>
    </form>
  `;
  el.querySelector('#ct-form-cuentas').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuentas = { medios: {}, gastos: {} };
    for (const s of ev.target.querySelectorAll('select')) {
      const [a, b] = s.name.split('.');
      if (b) cuentas[a][b] = s.value; else cuentas[a] = s.value;
    }
    await Motor.guardarConfig({ cuentas });
    Toast.ok('Cuentas guardadas');
  });
  el.querySelector('#ct-restaurar').addEventListener('click', async () => {
    if (!(await Confirm.preguntar('Se vuelven a usar las cuentas estándar del PUC.', { titulo: 'Restaurar cuentas', textoConfirmar: 'Restaurar' }))) return;
    await Motor.guardarConfig({ cuentas: {} });
    Toast.ok('Cuentas restauradas');
    pintar();
  });
}

// ============================================================
//  SALDOS INICIALES
// ============================================================

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

async function tabApertura(el, cfg) {
  if (!cfg.fecha_inicio) {
    el.innerHTML = tarjeta('Saldos iniciales', `<div style="color:#7D6858;font-size:14px">Primero escoge la fecha de inicio contable en la pestaña Resumen.</div>`);
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
    ${actual ? `<div style="background:#ECFDF3;border:1px solid #B7EBC9;color:#14532D;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13.5px">
      Ya hay saldos iniciales registrados (${esc(actual.numero)}). Si guardas de nuevo, el asiento anterior se reversa y queda el nuevo.</div>` : ''}
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
      ? `<div style="color:#7D6858;font-size:14px">No hay ventas a crédito pendientes antes de la fecha de inicio.</div>`
      : tabla(th('Cliente') + th('Saldo', true), sug.cartera.map((x) => `<tr>${td(esc(x.tercero_nombre))}${td(money(x.valor), true)}</tr>`).join('')),
      `<span style="font-size:12.5px;color:#7D6858">Tomada de las ventas a crédito</span>`)}
    ${tarjeta(`Deudas con proveedores · ${money(totDeudas)}`, sug.deudas.length === 0
      ? `<div style="color:#7D6858;font-size:14px">No hay compras a crédito pendientes antes de la fecha de inicio.</div>`
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
      pintar();
    } catch (e) {
      Toast.error(e.message || 'No se pudieron guardar los saldos');
    }
  });
}
