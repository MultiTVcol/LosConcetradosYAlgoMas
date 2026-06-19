/**
 * modules/inventario/inventario.view.js — Inventario (kardex y conteo)
 *
 *   - KPIs: valor a costo, valor a venta, utilidad potencial, alertas
 *   - Tabla de productos con stock y valorización; click → KARDEX
 *     (la historia completa del producto: compras, ventas, bajas, conteos)
 *   - Conteo físico: comparar lo contado vs el sistema → ajuste de stock
 *     (sobrante/faltante)
 */

import * as Repo from './inventario.repo.js';
import * as ProductosRepo from '../productos/productos.repo.js';
import { money, num, fmt } from '../../core/format.js';
import { esc } from '../../core/strings.js';
import { fmtDate } from '../../core/dates.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { refrescarIconos } from '../../app/shell.js';
import * as Realtime from '../../services/realtime.js';
import { imprimirPOS } from '../../services/printer.js';
import * as ConfigRepo from '../config/config.repo.js';

let _contenedor = null;
let _res = null;       // resumen (KPIs + productos)
let _q = '';
let _verTodos = false; // false = tope 200 filas (rápido); true = todas
let _offRealtime = null;

const TOPE_FILAS = 200;

export async function render(contenedor) {
  _contenedor = contenedor;
  _q = '';
  _verTodos = false;
  if (_offRealtime) { _offRealtime(); _offRealtime = null; }

  contenedor.innerHTML = `<div style="padding:40px 48px;color:#64748b;font-size:14px">Cargando inventario…</div>`;
  await refrescar();

  _offRealtime = Realtime.escucharVarias(['productos', 'compras', 'ventas', 'gastos'], async () => {
    try { await refrescar(); } catch (e) { console.warn('Realtime inventario:', e); }
  });
}

async function refrescar() {
  _res = await Repo.resumen();
  _contenedor.innerHTML = htmlLayout(_res);
  refrescarIconos(_contenedor);
  adjuntarEventos(_contenedor);
  pintarTabla();
}

function adjuntarEventos(c) {
  const inp = c.querySelector('#inv-buscar');
  let debounce;
  inp?.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { _q = e.target.value; pintarTabla(); }, 100);
  });
  c.querySelector('#inv-btn-conteo')?.addEventListener('click', () => abrirConteo());
  c.querySelector('#inv-btn-ajustes')?.addEventListener('click', () => abrirHistorial());
}

// ============================================================
//  HTML
// ============================================================

function htmlLayout(r) {
  const kpi = (label, valor, color, sub) => `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px">
      <div style="font-size:13px;color:#475569;font-weight:600;margin-bottom:6px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color};letter-spacing:-0.02em">${valor}</div>
      <div style="color:#64748b;font-size:12px;margin-top:6px">${sub}</div>
    </div>
  `;

  return `
    <div style="padding:32px 40px;max-width:1280px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          <i data-lucide="boxes" style="width:30px;height:30px;color:#2563eb;stroke-width:1.75"></i>
          <h1 style="font-size:26px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-0.02em">Inventario</h1>
        </div>
        <div style="display:flex;gap:8px">
          <button id="inv-btn-ajustes"
            style="padding:10px 16px;background:white;color:#2563eb;border:1px solid #bfdbfe;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">Ajustes</button>
          <button id="inv-btn-conteo"
            style="padding:10px 16px;background:#2563eb;color:white;border:0;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(37, 99, 235,.35)">Conteo físico</button>
        </div>
      </div>

      <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:18px">
        ${kpi('Valor a costo', money(r.valorCosto), '#8b5cf6', `${fmt(r.unidades)} unidades · ${fmt(r.skus)} productos`)}
        ${kpi('Valor a venta', money(r.valorVenta), '#0f172a', 'Si se vendiera todo hoy')}
        ${kpi('Utilidad potencial', money(r.utilidadPotencial), '#15803d', 'Venta − costo')}
        ${kpi('Alertas', `${fmt(r.bajoStock)} bajos · ${fmt(r.agotados)} agotados`, r.bajoStock + r.agotados > 0 ? '#dc2626' : '#15803d', 'Stock bajo mínimo / en cero')}
      </div>

      <div style="background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;color:#0f172a">Productos</h3>
            <div style="font-size:12.5px;color:#64748b;margin-top:2px">Haz click en un producto para ver su <b>kardex</b> (toda su historia)</div>
          </div>
          <input id="inv-buscar" type="text" placeholder="Buscar por nombre o código…" autocomplete="off"
            style="padding:10px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;font-family:inherit;min-width:260px" />
        </div>
        <div id="inv-tabla" style="overflow-x:auto"></div>
      </div>
    </div>
  `;
}

function pintarTabla() {
  const box = _contenedor.querySelector('#inv-tabla');
  if (!box) return;

  // Mismo buscador con prioridad que Ventas/Compras
  const filas = !String(_q || '').trim()
    ? _res.productos
    : ProductosRepo.filtrarConPrioridad(_res.productos, _q);

  if (filas.length === 0) {
    box.innerHTML = `<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13.5px">Sin productos${String(_q || '').trim() ? ` para "${esc(_q)}"` : ''}.</div>`;
    return;
  }

  box.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <thead>
        <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left">
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Código</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Producto</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Stock</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Costo</th>
          <th style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right">Valor (costo)</th>
        </tr>
      </thead>
      <tbody>
        ${(_verTodos ? filas : filas.slice(0, TOPE_FILAS)).map((p) => {
          const st = num(p.stock);
          const alerta = st <= 0 ? '#dc2626' : (st <= num(p.stock_min) ? '#d97706' : '#0f172a');
          return `
          <tr class="inv-fila" data-id="${esc(p.id)}" style="border-bottom:1px solid #f1f5f9;cursor:pointer">
            <td style="padding:10px 8px;color:#64748b;font-family:inherit;font-size:12.5px">${esc(p.codigo || '—')}</td>
            <td style="padding:10px 8px;font-weight:600;color:#0f172a">${esc(p.nombre)}</td>
            <td style="padding:10px 8px;text-align:right;font-weight:800;color:${alerta}">${fmt(st)}</td>
            <td style="padding:10px 8px;text-align:right;color:#475569">${money(p.costo)}</td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;color:#0f172a">${money(st > 0 ? st * num(p.costo) : 0)}</td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
    ${filas.length > TOPE_FILAS ? `
      <div style="text-align:center;padding:14px 10px 4px">
        ${_verTodos
          ? `<span style="color:#94a3b8;font-size:12.5px">Mostrando los ${fmt(filas.length)} productos · </span>
             <button id="inv-vermenos" style="background:none;border:0;color:#2563eb;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;text-decoration:underline">Mostrar menos</button>`
          : `<span style="color:#94a3b8;font-size:12.5px">Mostrando ${TOPE_FILAS} de ${fmt(filas.length)} · </span>
             <button id="inv-vertodos" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;border-radius:8px;padding:6px 12px;margin-left:4px">Mostrar todos (${fmt(filas.length)})</button>`}
      </div>` : ''}
  `;

  box.querySelector('#inv-vertodos')?.addEventListener('click', () => { _verTodos = true; pintarTabla(); });
  box.querySelector('#inv-vermenos')?.addEventListener('click', () => { _verTodos = false; pintarTabla(); _contenedor.querySelector('#inv-tabla')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });

  box.querySelectorAll('.inv-fila').forEach((tr) => {
    tr.onclick = () => abrirKardex(tr.dataset.id);
  });
}

// ============================================================
//  KARDEX
// ============================================================

async function abrirKardex(productoId) {
  let k;
  try {
    k = await Repo.kardexDe(productoId);
  } catch (err) {
    Toast.error(err.message || 'No se pudo cargar el kardex');
    return;
  }

  const colorTipo = { Compra: '#15803d', Venta: '#2563eb', Baja: '#dc2626', 'Conteo físico': '#a16207' };

  const contenido = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="font-size:12px;color:#94a3b8">${esc(k.producto.codigo || '')}</div>
        <div style="font-weight:800;font-size:17px;color:#0f172a">${esc(k.producto.nombre)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:#94a3b8">Stock actual</div>
        <div style="font-weight:800;font-size:20px;color:#0f172a">${fmt(k.producto.stock)} <span style="font-size:12px;color:#64748b">unidades</span></div>
      </div>
    </div>

    ${k.movimientos.length === 0 ? `
      <div style="text-align:center;padding:30px;color:#94a3b8;font-size:13.5px">
        Sin movimientos registrados todavía.<br>
        <span style="font-size:12px">El stock actual (${fmt(k.producto.stock)}) proviene de la creación del producto o de un import.</span>
      </div>
    ` : `
      <div style="max-height:48vh;overflow:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left;position:sticky;top:0;background:white">
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Fecha</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Tipo</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Doc</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Entrada</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Salida</th>
              <th style="padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px dashed #e2e8f0;color:#94a3b8">
              <td colspan="5" style="padding:8px">Saldo inicial</td>
              <td style="padding:8px;text-align:right;font-weight:700">${fmt(k.saldoInicial)}</td>
            </tr>
            ${k.movimientos.map((m) => `
              <tr style="border-bottom:1px solid #f1f5f9" title="${esc(m.detalle || '')}">
                <td style="padding:8px;color:#64748b;white-space:nowrap">${esc(fmtDate(m.fecha))}</td>
                <td style="padding:8px"><span style="color:${colorTipo[m.tipo] || '#475569'};font-weight:700;font-size:12px">${esc(m.tipo)}</span></td>
                <td style="padding:8px"><span style="background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px">${esc(m.doc || '—')}</span></td>
                <td style="padding:8px;text-align:right;color:#15803d;font-weight:700">${m.entrada > 0 ? '+' + fmt(m.entrada) : ''}</td>
                <td style="padding:8px;text-align:right;color:#dc2626;font-weight:700">${m.salida > 0 ? '−' + fmt(m.salida) : ''}</td>
                <td style="padding:8px;text-align:right;font-weight:800;color:#0f172a">${fmt(m.saldo)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  Modal.abrir({ titulo: `Kardex`, contenido, ancho: 'lg' });
}

// ============================================================
//  CONTEO FÍSICO
// ============================================================

function abrirConteo() {
  // Planilla: cada entrada es { producto_id, nombre, codigo, sistema, costo, fisico }
  // (fisico se guarda como string para distinguir "vacío" de "0")
  const hoja = [];

  const contenido = `
    <div style="display:grid;gap:12px">
      <div style="display:flex;gap:8px;align-items:stretch;position:relative">
        <div style="flex:1;position:relative">
          <input id="ct-buscar" type="text" placeholder="Agregar producto por nombre o código…" autocomplete="off"
            style="width:100%;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit" />
          <div id="ct-resultados" style="position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;display:flex;flex-direction:column;gap:4px;max-height:230px;overflow:auto;background:white;border-radius:8px"></div>
        </div>
        <button id="ct-todos" style="padding:0 14px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;white-space:nowrap">Cargar todos</button>
      </div>

      <div id="ct-sheet"></div>

      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Nota</div>
        <input id="ct-nota" type="text" placeholder="Ej: conteo de fin de mes"
          style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
      </div>

      <div id="ct-footer" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;font-size:13px;color:#334155"></div>

      <div style="display:flex;gap:10px;margin-top:4px">
        <button id="ct-cancelar" style="flex:1;padding:12px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;color:#475569">Cancelar</button>
        <button id="ct-confirmar" data-primary disabled style="flex:1.4;padding:12px;border:0;background:#94a3b8;color:white;border-radius:10px;cursor:not-allowed;font-size:14px;font-weight:700;font-family:inherit">Registrar ajustes</button>
      </div>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Conteo físico (planilla)', contenido, ancho: 'xl' });

  const inpBuscar = m.body.querySelector('#ct-buscar');
  const boxRes = m.body.querySelector('#ct-resultados');
  const sheet = m.body.querySelector('#ct-sheet');
  const footer = m.body.querySelector('#ct-footer');
  const btnOk = m.body.querySelector('#ct-confirmar');

  setTimeout(() => inpBuscar.focus(), 60);

  const agregar = (p) => {
    if (hoja.some((x) => x.producto_id === p.id)) return; // ya está
    hoja.push({ producto_id: p.id, nombre: p.nombre, codigo: p.codigo || '', sistema: num(p.stock), costo: num(p.costo), fisico: '' });
    pintarSheet();
  };

  const pintarResultados = (q) => {
    const lista = !String(q || '').trim() ? [] :
      ProductosRepo.filtrarConPrioridad(_res.productos, q)
        .filter((p) => !hoja.some((x) => x.producto_id === p.id))
        .slice(0, 8);
    boxRes.innerHTML = lista.map((p) => `
      <button class="ct-res" data-id="${esc(p.id)}"
        style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-family:inherit;text-align:left;font-size:13px">
        <span style="font-weight:600;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.nombre)}</span>
        <span style="color:#64748b;flex-shrink:0">Sistema: <b>${fmt(p.stock)}</b></span>
      </button>
    `).join('');
    boxRes.querySelectorAll('.ct-res').forEach((b) => {
      b.onclick = () => {
        const p = _res.productos.find((x) => x.id === b.dataset.id);
        if (p) agregar(p);
        inpBuscar.value = '';
        boxRes.innerHTML = '';
        inpBuscar.focus();
      };
    });
  };

  const pintarSheet = () => {
    if (hoja.length === 0) {
      sheet.innerHTML = `<div style="text-align:center;padding:26px;color:#94a3b8;font-size:13.5px;border:1px dashed #e2e8f0;border-radius:10px">
        Busca productos para agregarlos, o usa <b>Cargar todos</b> para contar el inventario completo.</div>`;
      actualizarFooter();
      return;
    }
    sheet.innerHTML = `
      <div style="max-height:46vh;overflow:auto;border:1px solid #e2e8f0;border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left;position:sticky;top:0;z-index:1">
              <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase">Producto</th>
              <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Sistema</th>
              <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:center;width:110px">Contado</th>
              <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right;width:120px">Diferencia</th>
              <th style="width:34px"></th>
            </tr>
          </thead>
          <tbody>
            ${hoja.map((it, i) => `
              <tr class="ct-row" data-i="${i}" style="border-bottom:1px solid #f1f5f9">
                <td style="padding:7px 10px;font-weight:600;color:#0f172a">${esc(it.nombre)}${it.codigo ? `<span style="color:#94a3b8;font-weight:400;font-size:11.5px"> · ${esc(it.codigo)}</span>` : ''}</td>
                <td style="padding:7px 10px;text-align:right;color:#475569">${fmt(it.sistema)}</td>
                <td style="padding:7px 10px;text-align:center">
                  <input class="ct-fis" inputmode="numeric" value="${it.fisico === '' ? '' : esc(String(it.fisico))}" placeholder="—"
                    style="width:90px;padding:7px 8px;border:1.5px solid #cbd5e1;border-radius:7px;font-size:14px;font-weight:700;text-align:center;outline:none;font-family:inherit;box-sizing:border-box" />
                </td>
                <td class="ct-dif" style="padding:7px 10px;text-align:right;font-weight:700;color:#cbd5e1">—</td>
                <td style="text-align:center"><button class="ct-del" title="Quitar" style="border:0;background:none;cursor:pointer;color:#cbd5e1;font-size:16px;line-height:1;padding:4px">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    sheet.querySelectorAll('.ct-row').forEach((row) => {
      const i = Number(row.dataset.i);
      const it = hoja[i];
      const inp = row.querySelector('.ct-fis');
      const cel = row.querySelector('.ct-dif');
      const refrescarDif = () => {
        it.fisico = inp.value;
        const has = inp.value.trim() !== '';
        if (!has) { cel.textContent = '—'; cel.style.color = '#cbd5e1'; actualizarFooter(); return; }
        const delta = num(inp.value) - it.sistema;
        if (delta === 0) { cel.textContent = '0'; cel.style.color = '#15803d'; }
        else { cel.textContent = (delta > 0 ? '+' : '−') + fmt(Math.abs(delta)); cel.style.color = delta > 0 ? '#1d4ed8' : '#dc2626'; }
        actualizarFooter();
      };
      inp.addEventListener('input', refrescarDif);
      refrescarDif();
      row.querySelector('.ct-del').onclick = () => { hoja.splice(i, 1); pintarSheet(); };
    });
    actualizarFooter();
  };

  const conDiferencia = () => hoja.filter((it) => String(it.fisico).trim() !== '' && (num(it.fisico) - it.sistema) !== 0);

  const actualizarFooter = () => {
    const difs = conDiferencia();
    const valorNeto = difs.reduce((s, it) => s + (num(it.fisico) - it.sistema) * it.costo, 0);
    const sobra = difs.filter((it) => num(it.fisico) > it.sistema).length;
    const falta = difs.filter((it) => num(it.fisico) < it.sistema).length;

    const habilitado = difs.length > 0;
    btnOk.disabled = !habilitado;
    btnOk.style.background = habilitado ? '#2563eb' : '#94a3b8';
    btnOk.style.cursor = habilitado ? 'pointer' : 'not-allowed';
    btnOk.textContent = habilitado ? `Registrar ${difs.length} ajuste(s)` : 'Registrar ajustes';

    if (hoja.length === 0) { footer.style.display = 'none'; return; }
    footer.style.display = 'block';
    footer.innerHTML = `
      <b>${fmt(hoja.length)}</b> producto(s) en la planilla · <b style="color:#1d4ed8">${sobra}</b> sobrante(s) · <b style="color:#dc2626">${falta}</b> faltante(s)
      ${difs.length ? ` · ajuste neto <b style="color:${valorNeto >= 0 ? '#15803d' : '#dc2626'}">${money(Math.abs(valorNeto))}</b> ${valorNeto >= 0 ? '(sobra)' : '(falta)'}` : ''}
    `;
  };

  let debounce;
  inpBuscar.addEventListener('input', (e) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => pintarResultados(e.target.value), 100);
  });
  inpBuscar.addEventListener('blur', () => setTimeout(() => { boxRes.innerHTML = ''; }, 150));

  m.body.querySelector('#ct-todos').onclick = () => {
    for (const p of _res.productos) {
      if (!hoja.some((x) => x.producto_id === p.id)) {
        hoja.push({ producto_id: p.id, nombre: p.nombre, codigo: p.codigo || '', sistema: num(p.stock), costo: num(p.costo), fisico: '' });
      }
    }
    boxRes.innerHTML = '';
    pintarSheet();
  };

  m.body.querySelector('#ct-cancelar').onclick = () => m.cerrar();
  btnOk.onclick = async () => {
    const difs = conDiferencia();
    if (difs.length === 0) return;
    btnOk.disabled = true;
    try {
      const ajuste = await Repo.registrarConteoMultiple({
        conteos: difs.map((it) => ({ producto_id: it.producto_id, fisico: num(it.fisico) })),
        nota: m.body.querySelector('#ct-nota').value,
      });
      Toast.ok(`Ajuste ${ajuste.numero} registrado · ${ajuste.items.length} producto(s)`);
      m.cerrar();
      await refrescar();
    } catch (err) {
      btnOk.disabled = false;
      Toast.error(err.message || 'No se pudo registrar el conteo');
    }
  };

  pintarSheet();
}

// ============================================================
//  HISTORIAL DE AJUSTES (ver / imprimir / eliminar)
// ============================================================

let _histModal = null;

async function abrirHistorial() {
  _histModal = Modal.abrir({
    titulo: 'Ajustes de inventario',
    contenido: '<div style="padding:24px;text-align:center;color:#64748b;font-size:13.5px">Cargando…</div>',
    ancho: 'lg',
    onClose: () => { _histModal = null; },
  });
  await pintarHistorial();
}

async function pintarHistorial() {
  if (!_histModal) return;
  const ajustes = await Repo.listarAjustes();

  if (ajustes.length === 0) {
    _histModal.body.innerHTML = `
      <div style="text-align:center;padding:36px;color:#94a3b8;font-size:13.5px">
        <div style="font-size:34px">📭</div>
        <div style="margin-top:8px;font-weight:600;color:#475569">Aún no hay ajustes de inventario</div>
        <div style="font-size:12px;margin-top:2px">Usa <b>Conteo físico</b> para registrar el primero.</div>
      </div>`;
    return;
  }

  _histModal.body.innerHTML = `
    <div style="max-height:60vh;overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left;position:sticky;top:0;background:white">
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase">Ajuste</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase">Fecha</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Productos</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Ajuste neto</th>
            <th style="width:120px"></th>
          </tr>
        </thead>
        <tbody>
          ${ajustes.map((a) => {
            const nProd = (a.items || []).length;
            const neto = num(a.valor);
            return `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:9px 10px"><b style="color:#2563eb">${esc(a.numero || '—')}</b>${a.nota ? `<div style="font-size:11.5px;color:#94a3b8">${esc(a.nota)}</div>` : ''}</td>
              <td style="padding:9px 10px;color:#64748b;white-space:nowrap">${esc(fmtDate(a.fecha))}</td>
              <td style="padding:9px 10px;text-align:right;color:#475569">${fmt(nProd)}</td>
              <td style="padding:9px 10px;text-align:right;font-weight:700;color:${neto >= 0 ? '#15803d' : '#dc2626'}">${neto >= 0 ? '+' : '−'}${money(Math.abs(neto))}</td>
              <td style="padding:9px 10px;text-align:right;white-space:nowrap">
                <button class="hist-ver" data-id="${esc(a.id)}" title="Ver detalle" style="border:0;background:none;cursor:pointer;font-size:15px;padding:3px 5px">👁️</button>
                <button class="hist-print" data-id="${esc(a.id)}" title="Imprimir" style="border:0;background:none;cursor:pointer;font-size:15px;padding:3px 5px">🖨️</button>
                <button class="hist-del" data-id="${esc(a.id)}" title="Eliminar" style="border:0;background:none;cursor:pointer;font-size:15px;padding:3px 5px">🗑️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  _histModal.body.querySelectorAll('.hist-ver').forEach((b) => { b.onclick = () => verAjuste(b.dataset.id); });
  _histModal.body.querySelectorAll('.hist-print').forEach((b) => { b.onclick = () => imprimirAjuste(b.dataset.id); });
  _histModal.body.querySelectorAll('.hist-del').forEach((b) => { b.onclick = () => eliminarAjuste(b.dataset.id); });
}

async function verAjuste(id) {
  const a = await Repo.obtenerAjuste(id);
  if (!a) { Toast.error('Ajuste no encontrado'); return; }

  const filas = (a.items || []).map((it) => {
    const d = num(it.delta);
    return `
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px 10px;font-weight:600;color:#0f172a">${esc(it.nombre)}${it.codigo ? `<span style="color:#94a3b8;font-weight:400;font-size:11.5px"> · ${esc(it.codigo)}</span>` : ''}</td>
        <td style="padding:8px 10px;text-align:right;color:#475569">${fmt(it.sistema)}</td>
        <td style="padding:8px 10px;text-align:right;color:#0f172a;font-weight:700">${fmt(it.fisico)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:${d >= 0 ? '#1d4ed8' : '#dc2626'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}</td>
        <td style="padding:8px 10px;text-align:right;color:${num(it.valor) >= 0 ? '#15803d' : '#dc2626'}">${num(it.valor) >= 0 ? '+' : '−'}${money(Math.abs(num(it.valor)))}</td>
      </tr>`;
  }).join('');

  const neto = num(a.valor);
  const contenido = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div>
        <div style="font-weight:800;font-size:17px;color:#0f172a">${esc(a.numero || '')}</div>
        <div style="font-size:12.5px;color:#64748b">${esc(fmtDate(a.fecha))}${a.nota ? ` · ${esc(a.nota)}` : ''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:#94a3b8">Ajuste neto</div>
        <div style="font-weight:800;font-size:18px;color:${neto >= 0 ? '#15803d' : '#dc2626'}">${neto >= 0 ? '+' : '−'}${money(Math.abs(neto))}</div>
      </div>
    </div>
    <div style="max-height:46vh;overflow:auto;border:1px solid #e2e8f0;border-radius:10px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#94a3b8;text-align:left;position:sticky;top:0">
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase">Producto</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Sistema</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Contado</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Dif.</th>
            <th style="padding:8px 10px;font-size:10.5px;font-weight:700;text-transform:uppercase;text-align:right">Valor</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button id="det-del" style="flex:1;padding:11px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">Eliminar ajuste</button>
      <button id="det-print" data-primary style="flex:1.4;padding:11px;border:0;background:#2563eb;color:white;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit">Imprimir</button>
    </div>
  `;

  const m = Modal.abrir({ titulo: 'Detalle del ajuste', contenido, ancho: 'lg' });
  m.body.querySelector('#det-print').onclick = () => imprimirAjuste(a.id);
  m.body.querySelector('#det-del').onclick = async () => { m.cerrar(); await eliminarAjuste(a.id); };
}

async function imprimirAjuste(id) {
  const a = await Repo.obtenerAjuste(id);
  if (!a) { Toast.error('Ajuste no encontrado'); return; }
  let cfg;
  try { cfg = await ConfigRepo.leer(); } catch (e) { cfg = { negocio: {} }; }
  const neg = cfg.negocio || {};
  imprimirPOS(htmlTicketAjuste(a, neg), { titulo: `Ajuste ${a.numero || ''}`.trim(), anchoMm: 80 });
}

function htmlTicketAjuste(a, neg) {
  const filas = (a.items || []).map((it) => {
    const d = num(it.delta);
    return `
      <tr><td colspan="2" style="padding-top:5px;font-weight:bold">${esc(it.nombre)}</td></tr>
      <tr style="font-size:11px">
        <td>Sist ${fmt(it.sistema)} &rarr; Cont ${fmt(it.fisico)}</td>
        <td style="text-align:right;font-weight:bold">${d >= 0 ? '+' : '-'}${fmt(Math.abs(d))}</td>
      </tr>`;
  }).join('');
  const neto = num(a.valor);
  return `
    <div style="font-family:'Courier New',monospace;font-size:12px;color:#000;line-height:1.35">
      <div style="text-align:center">
        <div style="font-weight:bold;font-size:14px">${esc(neg.nombre || 'PosPunto')}</div>
        ${neg.nit ? `<div>NIT ${esc(neg.nit)}</div>` : ''}
        ${neg.direccion ? `<div>${esc(neg.direccion)}</div>` : ''}
        ${neg.telefono ? `<div>Tel ${esc(neg.telefono)}</div>` : ''}
        <div style="margin-top:6px;font-weight:bold">AJUSTE DE INVENTARIO</div>
        <div style="font-weight:bold">${esc(a.numero || '')}</div>
      </div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <div>Fecha: ${esc(fmtDate(a.fecha))}</div>
      ${a.nota ? `<div>Nota: ${esc(a.nota)}</div>` : ''}
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <table style="width:100%;border-collapse:collapse">${filas}</table>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <div style="display:flex;justify-content:space-between;font-weight:bold">
        <span>Productos:</span><span>${fmt((a.items || []).length)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:bold">
        <span>Ajuste neto:</span><span>${neto >= 0 ? '+' : '-'}${money(Math.abs(neto))}</span>
      </div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <div style="text-align:center;font-size:11px">Soporte de conteo fisico</div>
      <div style="text-align:center;margin-top:18px">________________________</div>
      <div style="text-align:center;font-size:11px">Responsable</div>
    </div>
  `;
}

async function eliminarAjuste(id) {
  const a = await Repo.obtenerAjuste(id);
  if (!a) { Toast.error('Ajuste no encontrado'); return; }

  const ok = await Confirm.peligro(
    `¿Eliminar el ajuste ${a.numero}? Se DEVOLVERÁ el stock de ${fmt((a.items || []).length)} producto(s) al estado anterior al conteo.`,
    { titulo: 'Eliminar ajuste', textoConfirmar: 'Eliminar' },
  );
  if (!ok) return;

  try {
    await Repo.eliminarAjuste(id);
    Toast.ok(`Ajuste ${a.numero} eliminado · stock revertido`);
    if (_histModal) await pintarHistorial();
    await refrescar();
  } catch (err) {
    Toast.error(err.message || 'No se pudo eliminar el ajuste');
  }
}
