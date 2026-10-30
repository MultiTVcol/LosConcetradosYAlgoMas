/**
 * modules/documentos/documentos.forms.js — Formularios de documentos
 *
 * Cada función abre un modal y devuelve una promesa que se resuelve
 * cuando se guarda (true) o se cierra sin guardar (false).
 */

import * as db from '../../services/db.js';
import * as Repo from './documentos.repo.js';
import * as TercerosRepo from '../terceros/terceros.repo.js';
import * as Motor from '../../services/motor-contable.js';
import { abrirFicha } from '../terceros/terceros.view.js';
import { money, num } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { todayISO, fmtDate } from '../../core/dates.js';
import { Toast, Modal } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import { th, td, tabla, vacio, datalistCuentas, codigoDe } from '../contabilidad/ui.js';

const inp = 'class="input" style="padding:8px 10px;font-size:13px"';
const inpNum = 'class="input" inputmode="numeric" style="padding:8px 10px;font-size:13px;text-align:right"';
const numDe = (v) => num(String(v || '').replace(/[^\d.]/g, ''));

function opcionesMedio(sel = 'efectivo') {
  return Object.entries(Motor.ETIQUETAS_MEDIOS).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
}

/**
 * Selector de tercero: input con lista + botón "Nuevo". Devuelve
 * { html, montar(body) → { valor() } }.
 */
async function selectorTercero(id, { rol = null, valor = null } = {}) {
  let lista = await TercerosRepo.listar();
  const html = `
    <div style="display:flex;gap:6px">
      <input id="${id}" list="${id}-lista" class="input" style="flex:1" placeholder="Nombre o documento" value="${esc(valor?.tercero_nombre || '')}">
      <button type="button" id="${id}-nuevo" class="btn btn-ghost" title="Crear tercero"><i data-lucide="user-plus"></i></button>
    </div>
    <datalist id="${id}-lista">${lista.map((t) => `<option value="${esc(t.nombre)}">${esc(TercerosRepo.documentoTexto(t) || t.roles.map((r) => TercerosRepo.ROLES[r]).join(', '))}</option>`).join('')}</datalist>`;
  return {
    html,
    montar(body, alCambiar = () => {}) {
      const input = body.querySelector(`#${id}`);
      const elegido = () => {
        const n = input.value.trim().toLowerCase();
        return lista.find((t) => t.nombre.toLowerCase() === n) || null;
      };
      input.addEventListener('change', () => alCambiar(elegido()));
      body.querySelector(`#${id}-nuevo`).addEventListener('click', async () => {
        const t = await abrirFicha(null, { rolInicial: rol });
        if (!t) return;
        lista = await TercerosRepo.listar();
        body.querySelector(`#${id}-lista`).innerHTML = lista.map((x) => `<option value="${esc(x.nombre)}"></option>`).join('');
        input.value = t.nombre;
        alCambiar(elegido());
      });
      return {
        valor() {
          const t = elegido();
          const nombre = input.value.trim();
          return t ? { tercero_id: t.id, tercero_nombre: t.nombre } : { tercero_id: nombre ? `ter:${nombre}` : null, tercero_nombre: nombre };
        },
        elegido,
      };
    },
  };
}

function cerrarCon(m, resolve) {
  let ok = false;
  return { listo() { ok = true; m.cerrar(); }, onClose: () => resolve(ok) };
}

// ============================================================
//  RECIBO DE CAJA / COMPROBANTE DE EGRESO
// ============================================================

export function formMovimiento(tipo) {
  const esRecibo = tipo === 'recibo_caja';
  return new Promise(async (resolve) => {
    const sel = await selectorTercero('mv-ter', { rol: esRecibo ? 'cliente' : 'proveedor' });
    const conceptos = [];
    const contenido = `
      ${await datalistCuentas('mv-cuentas')}
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));padding:4px">
        <div style="grid-column:1/-1"><label class="lbl">${esRecibo ? 'Recibido de' : 'Pagado a'}</label>${sel.html}</div>
        <div><label class="lbl">Fecha</label><input id="mv-fecha" type="date" class="input" value="${todayISO()}"></div>
        <div><label class="lbl">Medio de pago</label><select id="mv-medio" class="input">${opcionesMedio()}</select></div>
      </div>
      <h3 style="font-size:14px;margin:18px 4px 8px;color:#2A1A10">${esRecibo ? 'Abonos a ventas a crédito' : 'Pagos a compras a crédito'}</h3>
      <div id="mv-facturas" style="padding:0 4px">${vacio('Escoge el tercero para ver sus facturas pendientes.')}</div>
      <h3 style="font-size:14px;margin:18px 4px 8px;color:#2A1A10">Otros conceptos <span style="font-weight:400;color:#7D6858;font-size:12.5px">(${esRecibo ? 'ej: intereses, préstamo recibido, aporte de socio' : 'ej: arriendo, servicios, nómina, anticipo'})</span></h3>
      <div style="padding:0 4px"><table style="width:100%;border-collapse:collapse"><tbody id="mv-conceptos"></tbody></table>
        <button type="button" id="mv-mas" class="btn btn-ghost" style="margin-top:6px"><i data-lucide="plus"></i>Agregar concepto</button></div>
      <div style="padding:12px 4px 0"><label class="lbl">Observaciones</label><input id="mv-nota" class="input"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:16px 4px 4px">
        <div id="mv-total" style="font-size:15px"></div>
        <button id="mv-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar ${esRecibo ? 'recibo' : 'egreso'}</button>
      </div>`;
    const m = Modal.abrir({ titulo: `Nuevo ${Repo.TIPOS[tipo].nombre.toLowerCase()}`, contenido, ancho: 'xl', onClose: () => c.onClose() });
    const c = cerrarCon(m, resolve);
    const b = m.body;
    refrescarIconos(b);
    let facturas = [];

    const total = () => {
      const tf = [...b.querySelectorAll('[data-aplic]')].reduce((s, i) => s + numDe(i.value), 0);
      const tc = conceptos.reduce((s, x) => s + numDe(x.valor), 0);
      b.querySelector('#mv-total').innerHTML = `Total: <b>${money(tf + tc)}</b>`;
    };
    const pintarFacturas = async (t) => {
      const caja = b.querySelector('#mv-facturas');
      if (!t) { facturas = []; caja.innerHTML = vacio('Escoge un tercero registrado para ver sus facturas pendientes.'); total(); return; }
      const docs = await db.getAll(esRecibo ? 'ventas' : 'compras');
      facturas = docs.filter((x) => x.tipoPago === 'credito' && num(x.saldo) > 0.5 && x.estado !== 'anulada'
        && (esRecibo ? x.cliente_id === t.id : x.proveedor_id === t.id))
        .sort((a, z) => String(a.fecha).localeCompare(String(z.fecha)));
      caja.innerHTML = facturas.length === 0 ? vacio('No tiene facturas a crédito pendientes.') : tabla(
        th('Factura') + th('Fecha') + th('Vence') + th('Saldo', true) + th('Abonar', true),
        facturas.map((f) => `<tr>${td(`<b>${esc(f.numero || f.ref || '')}</b>`)}${td(fmtDate(f.fecha))}${td(f.vence ? fmtDate(f.vence) : '')}
          ${td(money(f.saldo), true)}<td style="padding:4px;width:150px"><input data-aplic="${f.id}" ${inpNum} placeholder="0"></td></tr>`).join('')
        + `<tr><td colspan="5" style="padding:6px 10px"><button type="button" id="mv-todo" class="btn btn-ghost">Pagar todo el saldo</button></td></tr>`);
      caja.querySelectorAll('[data-aplic]').forEach((i) => i.addEventListener('input', total));
      caja.querySelector('#mv-todo')?.addEventListener('click', () => {
        caja.querySelectorAll('[data-aplic]').forEach((i) => { i.value = Math.round(num(facturas.find((f) => f.id === i.dataset.aplic).saldo)); });
        total();
      });
      total();
    };
    const ter = sel.montar(b, pintarFacturas);

    const pintarConceptos = () => {
      b.querySelector('#mv-conceptos').innerHTML = conceptos.map((x, i) => `<tr>
        <td style="padding:3px"><input data-c="cuenta" data-i="${i}" list="mv-cuentas" ${inp} placeholder="Cuenta" value="${esc(x.cuenta || '')}"></td>
        <td style="padding:3px"><input data-c="detalle" data-i="${i}" ${inp} placeholder="Detalle" value="${esc(x.detalle || '')}"></td>
        <td style="padding:3px;width:150px"><input data-c="valor" data-i="${i}" ${inpNum} placeholder="Valor" value="${esc(x.valor || '')}"></td>
        <td style="padding:3px;width:36px"><button type="button" data-quitar="${i}" class="btn btn-ghost" style="padding:6px"><i data-lucide="x"></i></button></td></tr>`).join('');
      b.querySelectorAll('[data-c]').forEach((i) => i.addEventListener('input', () => { conceptos[i.dataset.i][i.dataset.c] = i.value; total(); }));
      b.querySelectorAll('[data-quitar]').forEach((x) => x.addEventListener('click', () => { conceptos.splice(Number(x.dataset.quitar), 1); pintarConceptos(); }));
      refrescarIconos(b);
      total();
    };
    b.querySelector('#mv-mas').addEventListener('click', () => { conceptos.push({}); pintarConceptos(); });
    total();

    b.querySelector('#mv-guardar').addEventListener('click', async () => {
      const t = ter.valor();
      const aplicaciones = [...b.querySelectorAll('[data-aplic]')].map((i) => ({
        [esRecibo ? 'venta_id' : 'compra_id']: i.dataset.aplic, monto: numDe(i.value),
      })).filter((a) => a.monto > 0);
      try {
        const datos = {
          ...t, fecha: b.querySelector('#mv-fecha').value, medio: b.querySelector('#mv-medio').value,
          aplicaciones, nota: b.querySelector('#mv-nota').value,
          conceptos: conceptos.map((x) => ({ cuenta: codigoDe(x.cuenta), detalle: x.detalle, valor: numDe(x.valor) })),
        };
        const doc = esRecibo ? await Repo.guardarRecibo(datos) : await Repo.guardarEgreso(datos);
        Toast.ok(`${Repo.TIPOS[tipo].nombre} ${doc.numero} guardado`);
        c.listo();
      } catch (e) { Toast.error(e.message); }
    });
  });
}

// ============================================================
//  NOTA CRÉDITO / DÉBITO
// ============================================================

export function formNota(tipo) {
  const esNC = tipo === 'nota_credito';
  return new Promise(async (resolve) => {
    const ventas = (await db.getAll('ventas')).filter((v) => v.estado !== 'anulada' && (esNC || v.tipoPago === 'credito'))
      .sort((a, z) => String(z.fecha).localeCompare(String(a.fecha))).slice(0, 400);
    const contenido = `
      <datalist id="nt-ventas">${ventas.map((v) => `<option value="${esc(v.numero)} · ${esc(v.cliente_nombre || 'Cliente ocasional')} · ${money(v.total)}"></option>`).join('')}</datalist>
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));padding:4px">
        <div style="grid-column:1/-1"><label class="lbl">Venta</label><input id="nt-venta" list="nt-ventas" class="input" placeholder="Número de la venta (ej: V-0012)"></div>
        <div><label class="lbl">Fecha</label><input id="nt-fecha" type="date" class="input" value="${todayISO()}"></div>
        <div style="grid-column:span 2;min-width:200px"><label class="lbl">Motivo</label><input id="nt-motivo" class="input" placeholder="${esNC ? 'Ej: Devolución por producto vencido' : 'Ej: Intereses por mora'}"></div>
      </div>
      <div id="nt-detalle" style="padding:8px 4px">${vacio('Escoge la venta.')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 4px 4px">
        <div id="nt-total" style="font-size:15px"></div>
        <button id="nt-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar nota</button>
      </div>`;
    const m = Modal.abrir({ titulo: `Nueva ${Repo.TIPOS[tipo].nombre.toLowerCase()}`, contenido, ancho: 'xl', onClose: () => c.onClose() });
    const c = cerrarCon(m, resolve);
    const b = m.body;
    refrescarIconos(b);
    let venta = null;

    const leerItems = () => [...b.querySelectorAll('[data-dev]')].map((i) => {
      const it = venta.items.find((x) => x.producto_id === i.dataset.dev);
      return { ...it, cantidad: numDe(i.value) };
    }).filter((it) => it.cantidad > 0);
    const total = () => {
      if (!venta) return;
      const modo = b.querySelector('[name=nt-modo]:checked')?.value || 'valor';
      const t = modo === 'items' ? Repo.calcularItems(leerItems()).total : numDe(b.querySelector('#nt-valor')?.value);
      b.querySelector('#nt-total').innerHTML = `Total de la nota: <b>${money(t)}</b>`;
    };
    const pintar = () => {
      const caja = b.querySelector('#nt-detalle');
      if (!venta) { caja.innerHTML = vacio('Escoge una venta de la lista.'); return; }
      const credito = venta.tipoPago === 'credito';
      caja.innerHTML = `
        <div style="background:#FBF7F1;border-radius:12px;padding:10px 14px;font-size:13.5px;margin-bottom:12px">
          <b>${esc(venta.numero)}</b> · ${esc(venta.cliente_nombre || 'Cliente ocasional')} · ${fmtDate(venta.fecha)} · Total ${money(venta.total)}
          ${credito ? ` · <b>Saldo ${money(venta.saldo)}</b>` : ' · De contado'}
        </div>
        ${esNC ? `<div style="display:flex;gap:16px;margin-bottom:10px;font-size:13.5px">
          <label><input type="radio" name="nt-modo" value="items" checked> Devolución de productos</label>
          <label><input type="radio" name="nt-modo" value="valor"> Descuento por valor</label></div>` : ''}
        <div id="nt-items" style="${esNC ? '' : 'display:none'}">
          ${tabla(th('Producto') + th('Vendido', true) + th('Precio', true) + th('Devuelve', true),
            venta.items.map((it) => `<tr>${td(esc(it.nombre))}${td(String(it.cantidad), true)}${td(money(it.precio), true)}
              <td style="padding:4px;width:120px"><input data-dev="${esc(it.producto_id)}" ${inpNum} placeholder="0"></td></tr>`).join(''))}
          <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13.5px"><input type="checkbox" id="nt-inv" checked> Los productos vuelven al inventario</label>
        </div>
        <div id="nt-val" style="${esNC ? 'display:none;' : ''}display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
          <div><label class="lbl">Valor total (con IVA)</label><input id="nt-valor" ${inpNum}></div>
          <div><label class="lbl">IVA incluido</label><select id="nt-iva" class="input"><option value="0">Sin IVA</option><option value="5">5%</option><option value="19">19%</option></select></div>
        </div>
        ${esNC && !credito ? `<div style="margin-top:12px;max-width:280px"><label class="lbl">Se le devuelve la plata por</label><select id="nt-medio" class="input">${opcionesMedio()}</select></div>` : ''}
        ${esNC && credito ? `<p style="font-size:12.5px;color:#7D6858;margin:10px 0 0">La venta es a crédito: la nota baja lo que debe el cliente.</p>` : ''}
        ${!esNC ? `<p style="font-size:12.5px;color:#7D6858;margin:10px 0 0">La nota débito sube lo que debe el cliente en esta venta.</p>` : ''}`;
      caja.querySelectorAll('input,select').forEach((x) => x.addEventListener('input', total));
      caja.querySelectorAll('[name=nt-modo]').forEach((r) => r.addEventListener('change', () => {
        const items = r.value === 'items' && r.checked;
        caja.querySelector('#nt-items').style.display = items ? '' : 'none';
        caja.querySelector('#nt-val').style.display = items ? 'none' : 'grid';
        total();
      }));
      total();
    };
    b.querySelector('#nt-venta').addEventListener('change', (e) => {
      const n = String(e.target.value).split('·')[0].trim();
      venta = ventas.find((v) => v.numero === n) || null;
      pintar();
    });

    b.querySelector('#nt-guardar').addEventListener('click', async () => {
      if (!venta) { Toast.warn('Escoge la venta'); return; }
      const modo = b.querySelector('[name=nt-modo]:checked')?.value || 'valor';
      try {
        const doc = await Repo.guardarNota({
          tipo, venta_id: venta.id, fecha: b.querySelector('#nt-fecha').value, motivo: b.querySelector('#nt-motivo').value,
          items: modo === 'items' ? leerItems() : null,
          valor: numDe(b.querySelector('#nt-valor')?.value), impuesto_pct: num(b.querySelector('#nt-iva')?.value),
          devolver_inventario: modo === 'items' && !!b.querySelector('#nt-inv')?.checked,
          medio: b.querySelector('#nt-medio')?.value,
        });
        Toast.ok(`${Repo.TIPOS[tipo].nombre} ${doc.numero} guardada`);
        c.listo();
      } catch (e) { Toast.error(e.message); }
    });
  });
}

// ============================================================
//  COTIZACIÓN / REMISIÓN / ORDEN DE COMPRA
// ============================================================

export function formPedido(tipo, doc = null) {
  const compra = tipo === 'orden_compra';
  return new Promise(async (resolve) => {
    const productos = (await db.getAll('productos')).sort((a, z) => String(a.nombre).localeCompare(String(z.nombre)));
    const sel = await selectorTercero('pd-ter', { rol: compra ? 'proveedor' : 'cliente', valor: doc });
    const items = (doc?.items || []).map((it) => ({ ...it }));
    const contenido = `
      <datalist id="pd-prods">${productos.map((p) => `<option value="${esc(p.codigo ? `${p.codigo} · ` : '')}${esc(p.nombre)}"></option>`).join('')}</datalist>
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));padding:4px">
        <div style="grid-column:1/-1"><label class="lbl">${compra ? 'Proveedor' : 'Cliente'}</label>${sel.html}</div>
        <div><label class="lbl">Fecha</label><input id="pd-fecha" type="date" class="input" value="${doc?.fecha || todayISO()}"></div>
        ${tipo === 'cotizacion' ? `<div><label class="lbl">Válida por (días)</label><input id="pd-validez" ${inpNum} value="${doc?.data?.validez || 15}"></div>` : ''}
      </div>
      <div style="padding:10px 4px 0"><label class="lbl">Agregar producto</label><input id="pd-buscar" list="pd-prods" class="input" placeholder="Escribe el nombre o el código y escoge"></div>
      <div style="padding:8px 4px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead><tr>${th('Producto')}${th('Cantidad', true)}${th(compra ? 'Costo' : 'Precio', true)}${compra ? '' : th('IVA', true)}${th('Total', true)}${th('')}</tr></thead>
        <tbody id="pd-items"></tbody></table></div>
      <div style="padding:0 4px"><label class="lbl">Observaciones</label><input id="pd-nota" class="input" value="${esc(doc?.data?.nota || '')}"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:16px 4px 4px">
        <div id="pd-total" style="font-size:15px"></div>
        <button id="pd-guardar" class="btn btn-primary"><i data-lucide="save"></i>Guardar</button>
      </div>`;
    const m = Modal.abrir({ titulo: `${doc ? 'Editar' : 'Nueva'} ${Repo.TIPOS[tipo].nombre.toLowerCase()}${doc ? ` ${doc.numero}` : ''}`, contenido, ancho: 'xl', onClose: () => c.onClose() });
    const c = cerrarCon(m, resolve);
    const b = m.body;
    refrescarIconos(b);
    const ter = sel.montar(b);

    const pintar = () => {
      const calc = Repo.calcularItems(items, { compra });
      b.querySelector('#pd-items').innerHTML = items.map((it, i) => `<tr>
        ${td(esc(it.nombre))}
        <td style="padding:3px;width:100px"><input data-k="cantidad" data-i="${i}" ${inpNum} value="${it.cantidad}"></td>
        <td style="padding:3px;width:130px"><input data-k="${compra ? 'costo' : 'precio'}" data-i="${i}" ${inpNum} value="${Math.round(compra ? it.costo : it.precio)}"></td>
        ${compra ? '' : td(`${it.impuesto_pct || 0}%`, true)}
        ${td(money(calc.items[i]?.total || 0), true)}
        <td style="padding:3px;width:36px"><button type="button" data-quitar="${i}" class="btn btn-ghost" style="padding:6px"><i data-lucide="x"></i></button></td></tr>`).join('')
        || `<tr><td colspan="6" style="padding:12px;color:#7D6858;font-size:13.5px">Agrega productos con el buscador.</td></tr>`;
      b.querySelector('#pd-total').innerHTML = compra ? `Total: <b>${money(calc.total)}</b>` : `Subtotal ${money(calc.subtotal)} · IVA ${money(calc.impuesto)} · Total <b>${money(calc.total)}</b>`;
      b.querySelectorAll('#pd-items [data-k]').forEach((x) => x.addEventListener('change', () => { items[x.dataset.i][x.dataset.k] = numDe(x.value); pintar(); }));
      b.querySelectorAll('[data-quitar]').forEach((x) => x.addEventListener('click', () => { items.splice(Number(x.dataset.quitar), 1); pintar(); }));
      refrescarIconos(b);
    };
    b.querySelector('#pd-buscar').addEventListener('change', (e) => {
      const v = e.target.value;
      const p = productos.find((x) => `${x.codigo ? `${x.codigo} · ` : ''}${x.nombre}` === v);
      if (!p) return;
      const ya = items.find((it) => it.producto_id === p.id);
      if (ya) ya.cantidad = num(ya.cantidad) + 1;
      else items.push({ producto_id: p.id, codigo: p.codigo || '', nombre: p.nombre, cantidad: 1, precio: num(p.precio), costo: num(p.costo), impuesto_pct: num(p.impuesto_pct) });
      e.target.value = '';
      pintar();
    });
    pintar();

    b.querySelector('#pd-guardar').addEventListener('click', async () => {
      try {
        const d = await Repo.guardarPedido(tipo, {
          id: doc?.id, ...ter.valor(), fecha: b.querySelector('#pd-fecha').value, items,
          nota: b.querySelector('#pd-nota').value, validez: numDe(b.querySelector('#pd-validez')?.value),
        });
        Toast.ok(`${Repo.TIPOS[tipo].nombre} ${d.numero} guardada`);
        c.listo();
      } catch (e) { Toast.error(e.message); }
    });
  });
}

/** Facturar (cotización/remisión → venta) o recibir (orden de compra → compra). */
export function formConvertir(doc) {
  const compra = doc.tipo === 'orden_compra';
  return new Promise((resolve) => {
    const contenido = `
      <div style="display:grid;gap:12px;padding:4px">
        <div style="background:#FBF7F1;border-radius:12px;padding:10px 14px;font-size:13.5px"><b>${esc(doc.numero)}</b> · ${esc(doc.tercero_nombre)} · Total <b>${money(doc.total)}</b></div>
        <div style="display:flex;gap:16px;font-size:13.5px">
          <label><input type="radio" name="cv-tipo" value="contado" checked> De contado</label>
          <label><input type="radio" name="cv-tipo" value="credito"> A crédito</label></div>
        <div id="cv-contado"><label class="lbl">Medio de pago</label><select id="cv-medio" class="input">
          ${(compra ? ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'] : ['Efectivo', 'Transferencia (Nequi)', 'Transferencia (Daviplata)', 'QR', 'Tarjeta'])
            .map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div id="cv-credito" style="display:none;gap:12px;grid-template-columns:1fr 1fr">
          <div><label class="lbl">Abono inicial</label><input id="cv-abono" ${inpNum} placeholder="0"></div>
          <div><label class="lbl">Vence</label><input id="cv-vence" type="date" class="input"></div>
        </div>
        ${compra ? `<div><label class="lbl">Número de factura del proveedor</label><input id="cv-ref" class="input" placeholder="Opcional"></div>` : ''}
        <p style="font-size:12.5px;color:#7D6858;margin:0">${compra ? 'Se registra la compra: suma el stock, actualiza costos y se contabiliza sola.' : 'Se registra la venta en el POS: descuenta el stock y se contabiliza sola.'}</p>
        <div style="display:flex;justify-content:flex-end"><button id="cv-ok" class="btn btn-primary"><i data-lucide="check"></i>${compra ? 'Recibir mercancía' : 'Facturar'}</button></div>
      </div>`;
    const m = Modal.abrir({ titulo: compra ? 'Recibir orden de compra' : 'Facturar', contenido, ancho: 'sm', onClose: () => c.onClose() });
    const c = cerrarCon(m, resolve);
    const b = m.body;
    refrescarIconos(b);
    b.querySelectorAll('[name=cv-tipo]').forEach((r) => r.addEventListener('change', () => {
      const cred = b.querySelector('[name=cv-tipo]:checked').value === 'credito';
      b.querySelector('#cv-contado').style.display = cred ? 'none' : '';
      b.querySelector('#cv-credito').style.display = cred ? 'grid' : 'none';
    }));
    b.querySelector('#cv-ok').addEventListener('click', async () => {
      const tipoPago = b.querySelector('[name=cv-tipo]:checked').value;
      const medio = b.querySelector('#cv-medio').value;
      try {
        if (compra) {
          await Repo.recibirOrden(doc.id, { tipoPago, metodoPago: medio, abonoInicial: numDe(b.querySelector('#cv-abono').value), vence: b.querySelector('#cv-vence').value, ref: b.querySelector('#cv-ref').value });
          Toast.ok('Compra registrada');
        } else {
          const v = await Repo.facturar(doc.id, { tipoPago, metodo_pago: medio, abonoInicial: numDe(b.querySelector('#cv-abono').value), metodoAbono: 'Efectivo', vence: b.querySelector('#cv-vence').value });
          Toast.ok(`Venta ${v.numero} registrada`);
        }
        c.listo();
      } catch (e) { Toast.error(e.message); }
    });
  });
}

// ============================================================
//  TRASLADO DE FONDOS
// ============================================================

export function formTraslado(cfg) {
  return new Promise(async (resolve) => {
    const cajas = (await (await import('../contabilidad/puc.repo.js')).cuentasMovimiento()).filter((x) => x.codigo.startsWith('11'));
    const opts = (sel) => cajas.map((x) => `<option value="${x.codigo}" ${x.codigo === sel ? 'selected' : ''}>${x.codigo} — ${esc(x.nombre)}</option>`).join('');
    const contenido = `
      <div style="display:grid;gap:12px;padding:4px">
        <div><label class="lbl">Fecha</label><input id="tr-fecha" type="date" class="input" value="${todayISO()}"></div>
        <div><label class="lbl">Sale de</label><select id="tr-origen" class="input">${opts(cfg.cuentas.medios.efectivo)}</select></div>
        <div><label class="lbl">Llega a</label><select id="tr-destino" class="input">${opts(cfg.cuentas.medios.transferencia)}</select></div>
        <div><label class="lbl">Valor</label><input id="tr-valor" ${inpNum}></div>
        <div><label class="lbl">Nota</label><input id="tr-nota" class="input" placeholder="Ej: Consignación del efectivo del día"></div>
        <div style="display:flex;justify-content:flex-end"><button id="tr-ok" class="btn btn-primary"><i data-lucide="save"></i>Guardar traslado</button></div>
      </div>`;
    const m = Modal.abrir({ titulo: 'Traslado de fondos', contenido, ancho: 'sm', onClose: () => c.onClose() });
    const c = cerrarCon(m, resolve);
    const b = m.body;
    refrescarIconos(b);
    b.querySelector('#tr-ok').addEventListener('click', async () => {
      try {
        const d = await Repo.guardarTraslado({
          fecha: b.querySelector('#tr-fecha').value, origen: b.querySelector('#tr-origen').value, destino: b.querySelector('#tr-destino').value,
          valor: numDe(b.querySelector('#tr-valor').value), nota: b.querySelector('#tr-nota').value,
        });
        Toast.ok(`Traslado ${d.numero} guardado`);
        c.listo();
      } catch (e) { Toast.error(e.message); }
    });
  });
}


