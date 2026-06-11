/**
 * modules/factura/editor-plantilla.view.js — Editor visual de plantilla POS 80mm
 *
 * Editor reutilizable accesible desde Ventas, Reportes y Cierre.
 * Abre un Modal grande con el formulario + vista previa en vivo
 * y permite guardar, imprimir prueba o restablecer al default.
 *
 * Uso:
 *   import * as EditorPlantilla from '../factura/editor-plantilla.view.js';
 *   await EditorPlantilla.abrir('venta');   // 'cierre' | 'reporte'
 */

import * as PlantillaRepo from './plantilla.repo.js';
import { html as facturaHTML } from './factura.html.js';
import { imprimirPOS } from '../../services/printer.js';
import * as ConfigRepo from '../config/config.repo.js';
import { Toast, Modal, Confirm } from '../../components/index.js';
import { esc } from '../../core/strings.js';

const TITULOS = {
  venta:   '🎨 Personaliza tu ticket de venta',
  cierre:  '🎨 Personaliza el ticket de cierre de caja',
  reporte: '🎨 Personaliza el ticket de reporte',
};

const PL_INPUTS = ['pl-fuente', 'pl-tam', 'pl-line', 'pl-sep', 'pl-ancho', 'pl-mayus', 'pl-neg', 'pl-tituloDoc', 'pl-msg1', 'pl-msg2'];

/**
 * Abre el editor de plantilla para un tipo dado.
 * @param {'venta'|'cierre'|'reporte'} tipo
 */
export async function abrir(tipo = 'venta') {
  const cfg = await ConfigRepo.leer();
  let plantilla = await PlantillaRepo.leer(tipo);

  const titulo = TITULOS[tipo] || TITULOS.venta;

  const m = Modal.abrir({
    titulo,
    contenido: htmlEditor(plantilla),
    ancho: 'full',
  });

  // --- helpers internos ---
  const body = m.body;

  const leerForm = () => {
    const q = (id) => body.querySelector(`#${id}`);
    plantilla.fuente = q('pl-fuente')?.value || plantilla.fuente;
    plantilla.tamBase = Number(q('pl-tam')?.value) || plantilla.tamBase;
    plantilla.interlineado = Number(q('pl-line')?.value) || plantilla.interlineado;
    plantilla.separador = q('pl-sep')?.value || 'dashed';
    plantilla.anchoMm = Number(q('pl-ancho')?.value) || 80;
    plantilla.mayusculas = !!q('pl-mayus')?.checked;
    plantilla.encNegrita = !!q('pl-neg')?.checked;
    plantilla.tituloDocumento = q('pl-tituloDoc')?.value || PlantillaRepo.defaultPara(tipo).tituloDocumento;
    plantilla.mensaje1 = q('pl-msg1')?.value || '';
    plantilla.mensaje2 = q('pl-msg2')?.value || '';
    body.querySelectorAll('.pl-toggle').forEach((el) => {
      plantilla[el.dataset.key] = !!el.checked;
    });
  };

  const refrescarPreview = () => {
    const box = body.querySelector('#ed-pl-preview');
    if (!box) return;
    box.innerHTML = facturaHTML(ventaDemo(tipo), plantilla, cfg);
  };

  const onChange = () => { leerForm(); refrescarPreview(); };

  // --- cablear inputs ---
  PL_INPUTS.forEach((id) => {
    const el = body.querySelector(`#${id}`);
    if (el) {
      el.addEventListener('input', onChange);
      el.addEventListener('change', onChange);
    }
  });
  body.querySelectorAll('.pl-toggle').forEach((el) => {
    el.addEventListener('change', onChange);
  });

  // --- botones ---
  body.querySelector('#ed-pl-guardar')?.addEventListener('click', async () => {
    leerForm();
    try {
      await PlantillaRepo.guardar(plantilla, tipo);
      Toast.ok('Diseño guardado');
      m.cerrar();
    } catch (err) {
      console.error(err);
      Toast.error('No se pudo guardar el diseño');
    }
  });

  body.querySelector('#ed-pl-prueba')?.addEventListener('click', () => {
    leerForm();
    const ticket = facturaHTML(ventaDemo(tipo), plantilla, cfg);
    imprimirPOS(ticket, { anchoMm: plantilla.anchoMm || 80, titulo: 'Vista previa' });
  });

  body.querySelector('#ed-pl-restablecer')?.addEventListener('click', async () => {
    const ok = await Confirm.peligro('¿Restablecer este diseño a los valores por defecto?', {
      titulo: 'Restablecer diseño',
      textoConfirmar: '↺ Restablecer',
    });
    if (!ok) return;
    plantilla = await PlantillaRepo.restablecer(tipo);
    // re-render del modal con la plantilla restablecida
    m.cerrar();
    setTimeout(() => abrir(tipo), 200);
  });

  body.querySelector('#ed-pl-cancelar')?.addEventListener('click', () => m.cerrar());

  // primera carga del preview
  refrescarPreview();
}

// ============================================================
//  HTML del editor
// ============================================================

function htmlEditor(p) {
  return `
    <div style="display:grid;gap:18px;grid-template-columns:1.4fr 1fr;align-items:start">
      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Tipografía</div>
            <select id="pl-fuente"
              style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
              <option value="'Courier New','Roboto Mono',monospace" ${p.fuente.includes('Courier') ? 'selected' : ''}>Courier (clásica)</option>
              <option value="'Roboto Mono',monospace" ${p.fuente.includes('Roboto') && !p.fuente.includes('Courier') ? 'selected' : ''}>Roboto Mono</option>
              <option value="'JetBrains Mono',monospace" ${p.fuente.includes('JetBrains') ? 'selected' : ''}>JetBrains Mono</option>
              <option value="Inter,system-ui,sans-serif" ${p.fuente.includes('Inter') ? 'selected' : ''}>Inter (sin serifa)</option>
              <option value="Arial,sans-serif" ${p.fuente.includes('Arial') ? 'selected' : ''}>Arial</option>
            </select>
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Tamaño base (px)</div>
            <input id="pl-tam" type="number" min="9" max="20" value="${p.tamBase}"
              style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Interlineado</div>
            <input id="pl-line" type="number" step="0.1" min="1" max="2.5" value="${p.interlineado}"
              style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Separador entre secciones</div>
            <select id="pl-sep"
              style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
              <option value="dashed" ${p.separador === 'dashed' ? 'selected' : ''}>Línea punteada — — —</option>
              <option value="solid" ${p.separador === 'solid' ? 'selected' : ''}>Línea continua ───</option>
              <option value="none" ${p.separador === 'none' ? 'selected' : ''}>Sin línea (solo espacio)</option>
            </select>
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Ancho del papel</div>
            <select id="pl-ancho"
              style="width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;background:white">
              <option value="58" ${p.anchoMm === 58 ? 'selected' : ''}>58 mm</option>
              <option value="76" ${p.anchoMm === 76 ? 'selected' : ''}>76 mm</option>
              <option value="80" ${p.anchoMm === 80 ? 'selected' : ''}>80 mm (estándar)</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:18px;padding-top:18px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;font-weight:600;cursor:pointer">
              <input id="pl-mayus" type="checkbox" ${p.mayusculas ? 'checked' : ''} style="width:16px;height:16px"> Mayúsculas
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;font-weight:600;cursor:pointer">
              <input id="pl-neg" type="checkbox" ${p.encNegrita ? 'checked' : ''} style="width:16px;height:16px"> Títulos en negrita
            </label>
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Secciones visibles</div>
          <div style="display:grid;gap:6px;grid-template-columns:1fr 1fr">
            ${[
              ['pl-mNombre', 'mostrarNombre', 'Nombre del negocio'],
              ['pl-mNit', 'mostrarNit', 'NIT'],
              ['pl-mTel', 'mostrarTelefono', 'Teléfono'],
              ['pl-mDir', 'mostrarDireccion', 'Dirección'],
              ['pl-mCiudad', 'mostrarCiudad', 'Ciudad'],
              ['pl-mFolio', 'mostrarFolio', 'N° factura / ID'],
              ['pl-mFecha', 'mostrarFecha', 'Fecha y hora'],
              ['pl-mCli', 'mostrarCliente', 'Cliente'],
              ['pl-mNegCli', 'mostrarNegocioCliente', 'Negocio del cliente'],
              ['pl-mTelCli', 'mostrarTelefonoCliente', 'Tel. del cliente'],
              ['pl-mItems', 'mostrarItems', 'Lista de productos / detalle'],
              ['pl-mSub', 'mostrarSubtotal', 'Subtotal'],
              ['pl-mImp', 'mostrarImpuestos', 'Impuestos'],
              ['pl-mDesc', 'mostrarDescuento', 'Descuento'],
              ['pl-mTot', 'mostrarTotal', 'Total'],
              ['pl-mMet', 'mostrarMetodoPago', 'Método de pago'],
              ['pl-mRec', 'mostrarRecibidoCambio', 'Recibido / Cambio'],
              ['pl-mPie', 'mostrarPieRepetido', 'Pie con N° / Nombre'],
            ].map(([id, key, label]) => `
              <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#475569;cursor:pointer">
                <input class="pl-toggle" id="${id}" data-key="${key}" type="checkbox" ${p[key] ? 'checked' : ''} style="width:15px;height:15px">
                ${label}
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:grid;gap:10px">
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Título del documento</div>
            <input id="pl-tituloDoc" type="text" value="${esc(p.tituloDocumento || '')}" placeholder="FACTURA, CIERRE DE CAJA, REPORTE..."
              style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;font-weight:700;letter-spacing:.04em" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mensaje 1 (pie)</div>
            <input id="pl-msg1" type="text" value="${esc(p.mensaje1 || '')}"
              style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
          <div>
            <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Mensaje 2</div>
            <input id="pl-msg2" type="text" value="${esc(p.mensaje2 || '')}"
              style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit" />
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button id="ed-pl-guardar" data-primary
            style="flex:1;min-width:140px;padding:12px;background:#4f46e5;color:white;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;box-shadow:0 4px 12px -2px rgba(79,70,229,.35)">
            💾 Guardar diseño
          </button>
          <button id="ed-pl-prueba"
            style="flex:1;min-width:140px;padding:12px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit">
            🧾 Imprimir prueba
          </button>
          <button id="ed-pl-restablecer"
            style="flex:0 0 auto;padding:12px 16px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#475569;font-family:inherit">
            ↺ Restablecer
          </button>
          <button id="ed-pl-cancelar"
            style="flex:0 0 auto;padding:12px 16px;border:1px solid #e2e8f0;background:white;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#475569;font-family:inherit">
            Cancelar
          </button>
        </div>
      </div>

      <div>
        <div style="font-size:11.5px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Vista previa</div>
        <div style="background:#f1f5f9;border-radius:10px;padding:14px;display:flex;justify-content:center">
          <div id="ed-pl-preview" style="background:white;width:280px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.08);max-height:600px;overflow:auto"></div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//  Datos demo para la vista previa segun el tipo
// ============================================================

function ventaDemo(tipo) {
  const baseFecha = new Date().toISOString().slice(0, 10);
  if (tipo === 'cierre') {
    return {
      numero: 'CIERRE-' + baseFecha,
      fecha: baseFecha,
      cliente_nombre: 'Cierre de caja',
      cliente: { id: 'demo', nombre: 'Cierre de caja', negocio: '', telefono: '' },
      items: [
        { producto_id: 'v', nombre: 'Ventas del día', precio: 1450000, cantidad: 1, descuento: 0 },
        { producto_id: 'g', nombre: 'Gastos del día', precio: 120000, cantidad: 1, descuento: 0 },
        { producto_id: 'c', nombre: 'Compras del día', precio: 380000, cantidad: 1, descuento: 0 },
      ],
      subtotal: 1450000,
      impuesto: 0,
      descuento: 0,
      descuentoLineas: 0,
      total: 950000,
      metodo_pago: 'Efectivo',
      data: { timestamp: new Date().toISOString() },
    };
  }
  if (tipo === 'reporte') {
    return {
      numero: 'REP-' + baseFecha,
      fecha: baseFecha,
      cliente_nombre: 'Reporte general',
      cliente: { id: 'demo', nombre: 'Reporte general', negocio: '', telefono: '' },
      items: [
        { producto_id: 'v', nombre: 'Total Ventas', precio: 4800000, cantidad: 1, descuento: 0 },
        { producto_id: 'u', nombre: 'Total Utilidad', precio: 1320000, cantidad: 1, descuento: 0 },
        { producto_id: 'c', nombre: 'Total Compras', precio: 2100000, cantidad: 1, descuento: 0 },
        { producto_id: 'g', nombre: 'Total Gastos', precio: 480000, cantidad: 1, descuento: 0 },
      ],
      subtotal: 4800000,
      impuesto: 0,
      descuento: 0,
      descuentoLineas: 0,
      total: 2220000,
      metodo_pago: '—',
      data: { timestamp: new Date().toISOString() },
    };
  }
  // venta (default)
  return {
    numero: '0001',
    fecha: baseFecha,
    cliente_nombre: 'Cliente de Ejemplo',
    cliente: {
      id: 'demo',
      nombre: 'Cliente de Ejemplo',
      negocio: 'Veterinaria El Roble',
      telefono: '315 444 1122',
    },
    items: [
      { producto_id: 'p1', nombre: 'Concentrado Perro 15kg', precio: 124900, cantidad: 1, descuento: 0 },
      { producto_id: 'p2', nombre: 'Snacks Dentales x12', precio: 16900, cantidad: 2, descuento: 1000 },
    ],
    subtotal: 158700,
    impuesto: 0,
    descuento: 0,
    descuentoLineas: 2000,
    total: 156700,
    metodo_pago: 'Efectivo',
    data: { timestamp: new Date().toISOString(), recibido: 160000, cambio: 3300 },
  };
}
