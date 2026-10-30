/**
 * Pestaña Configuración: qué cuenta del PUC usa la causación automática
 * para cada cosa (caja, ingresos, IVA, medios de pago, categorías de
 * gastos…).
 */

import * as Motor from '../../../services/motor-contable.js';
import * as PUC from '../puc.repo.js';
import { esc } from '../../../core/strings.js';
import { Toast, Confirm } from '../../../components/index.js';
import { tarjeta } from '../ui.js';

const CAMPOS = [
  ['caja', 'Caja (gastos pagados en efectivo)'],
  ['clientes', 'Clientes — cartera'],
  ['proveedores', 'Proveedores — cuentas por pagar'],
  ['inventario', 'Inventario de mercancías'],
  ['ingresos', 'Ingresos por ventas'],
  ['ivaGenerado', 'IVA generado en ventas'],
  ['devoluciones', 'Devoluciones en ventas (notas crédito)'],
  ['costo', 'Costo de ventas'],
  ['sobrantes', 'Sobrantes de inventario'],
  ['faltantes', 'Faltantes de inventario'],
  ['bajaProductos', 'Baja de productos (dañados, vencidos)'],
  ['gastoDefault', 'Gasto sin categoría'],
  ['patrimonioApertura', 'Patrimonio (contrapartida de saldos iniciales)'],
];

export async function render(el, ctx) {
  const movs = await PUC.cuentasMovimiento();
  const select = (name, valor) => `
    <select class="input" name="${name}">
      ${movs.map((c) => `<option value="${c.codigo}" ${c.codigo === valor ? 'selected' : ''}>${c.codigo} — ${esc(c.nombre)}</option>`).join('')}
    </select>`;
  const fila = (label, name, valor) => `
    <div style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1.4fr);gap:12px;align-items:center;padding:6px 0">
      <label style="font-size:13.5px;color:#5C4636;font-weight:600">${label}</label>${select(name, valor)}
    </div>`;
  const C = ctx.cfg.cuentas;

  el.innerHTML = `
    <form id="ct-form-cuentas">
      ${tarjeta('Cuentas principales', CAMPOS.map(([k, l]) => fila(l, k, C[k])).join(''))}
      ${tarjeta('Medios de pago', Object.keys(Motor.CUENTAS_DEFAULT.medios).map((k) => fila(Motor.ETIQUETAS_MEDIOS[k] || k, `medios.${k}`, C.medios[k])).join(''))}
      ${tarjeta('Categorías de gastos', Object.keys(Motor.CUENTAS_DEFAULT.gastos).map((k) => fila(k, `gastos.${k}`, C.gastos[k])).join(''))}
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" id="ct-restaurar" class="btn btn-ghost">Volver a las del PUC estándar</button>
        <button type="submit" class="btn btn-primary"><i data-lucide="save"></i>Guardar cuentas</button>
      </div>
      <p style="font-size:12.5px;color:#7D6858;margin-top:12px">El cambio aplica a lo que se registre de ahora en adelante. Para recalcular lo ya contabilizado (en meses abiertos) usa “Revisar y contabilizar todo” en Resumen. ¿Falta una cuenta? Créala en Plan de cuentas.</p>
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
    ctx.repintar();
  });
}
