/**
 * modules/terceros/terceros.repo.js — Terceros (NIT, cédula, roles)
 *
 * Un tercero es cualquier persona o empresa con la que se mueve plata:
 * clientes, proveedores, empleados u otros. Los clientes y proveedores
 * del POS siguen viviendo en sus tablas de siempre; aquí se les agrega la
 * ficha tributaria (tipo y número de documento, DV, responsabilidades)
 * en la tabla `terceros`, con el MISMO id. Así los asientos, que ya
 * guardan el id del cliente o proveedor, quedan ligados a su NIT.
 *
 * Los terceros que no son ni clientes ni proveedores (empleados, socios,
 * entidades) viven solo en `terceros`.
 */

import * as db from '../../services/db.js';
import * as Sync from '../../services/sync.js';
import { uid } from '../../core/strings.js';
import { nowISO } from '../../core/dates.js';
import { exigirTablas } from '../contabilidad/contabilidad.service.js';

export const TABLA = 'terceros';

export const TIPOS_DOC = {
  CC: 'Cédula de ciudadanía', NIT: 'NIT', CE: 'Cédula de extranjería', PP: 'Pasaporte',
  TI: 'Tarjeta de identidad', PEP: 'Permiso especial de permanencia', NE: 'NIT de otro país',
};

export const ROLES = { cliente: 'Cliente', proveedor: 'Proveedor', empleado: 'Empleado', otro: 'Otro' };

/** Responsabilidades fiscales más comunes (RUT, casilla 53). */
export const RESPONSABILIDADES = {
  'O-13': 'Gran contribuyente',
  'O-15': 'Autorretenedor',
  'O-23': 'Agente de retención en el impuesto sobre las ventas',
  'O-47': 'Régimen simple de tributación',
  'R-99-PN': 'No responsable',
};

/**
 * Dígito de verificación de un NIT según el algoritmo de la DIAN
 * (pesos primos de derecha a izquierda, módulo 11).
 */
export function calcularDV(nit) {
  const digitos = String(nit || '').replace(/\D/g, '');
  if (!digitos) return '';
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let suma = 0;
  const inv = digitos.split('').reverse();
  for (let i = 0; i < inv.length && i < pesos.length; i++) suma += Number(inv[i]) * pesos[i];
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

/** "900123456-7" o "CC 1094..." para mostrar. */
export function documentoTexto(t) {
  if (!t?.numero_doc) return '';
  return t.tipo_doc === 'NIT' && t.dv !== '' && t.dv != null ? `NIT ${t.numero_doc}-${t.dv}` : `${t.tipo_doc || 'CC'} ${t.numero_doc}`;
}

/**
 * Lista unificada: clientes + proveedores del POS (con su ficha si la
 * tienen) + terceros sueltos. Cada uno: { id, origen, roles, nombre,
 * tipo_doc, numero_doc, dv, …, ficha }.
 */
export async function listar() {
  const [clientes, proveedores, fichas] = await Promise.all([db.getAll('clientes'), db.getAll('proveedores'), db.getAll(TABLA)]);
  const porId = new Map(fichas.map((f) => [f.id, f]));
  const out = [];
  const base = (f) => ({
    tipo_doc: f?.tipo_doc || '', numero_doc: f?.numero_doc || '', dv: f?.dv ?? '',
    tipo_persona: f?.tipo_persona || 'natural', nombre_comercial: f?.nombre_comercial || '',
    responsabilidades: f?.responsabilidades || [], responsable_iva: !!f?.responsable_iva,
    departamento: f?.departamento || '', ficha: !!f,
  });
  for (const c of clientes) {
    const f = porId.get(c.id);
    out.push({
      ...base(f), id: c.id, origen: 'cliente', roles: f?.roles?.length ? f.roles : ['cliente'],
      nombre: c.nombre || f?.nombre || '', telefono: c.telefono || f?.telefono || '', email: c.email || f?.email || '',
      direccion: c.direccion || f?.direccion || '', ciudad: c.ciudad || f?.ciudad || '',
      numero_doc: f?.numero_doc || c.documento || '',
    });
  }
  for (const p of proveedores) {
    const f = porId.get(p.id);
    out.push({
      ...base(f), id: p.id, origen: 'proveedor', roles: f?.roles?.length ? f.roles : ['proveedor'],
      nombre: p.nombre || f?.nombre || '', telefono: p.telefono || f?.telefono || '', email: p.email || f?.email || '',
      direccion: p.direccion || f?.direccion || '', ciudad: p.ciudad || f?.ciudad || '',
      tipo_doc: f?.tipo_doc || (p.nit ? 'NIT' : ''), numero_doc: f?.numero_doc || String(p.nit || '').split('-')[0],
      dv: f?.dv ?? (String(p.nit || '').split('-')[1] || ''),
    });
  }
  const ligados = new Set(out.map((t) => t.id));
  for (const f of fichas) {
    if (ligados.has(f.id)) continue;
    out.push({ ...base(f), ...f, origen: 'tercero', roles: f.roles?.length ? f.roles : ['otro'], ficha: true });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function obtener(id) {
  return (await listar()).find((t) => t.id === id) || null;
}

function validar(t) {
  if (!String(t.nombre || '').trim()) throw new Error('El nombre o razón social es obligatorio');
  const num = String(t.numero_doc || '').replace(/[^\dA-Za-z]/g, '');
  if (num && !t.tipo_doc) throw new Error('Escoge el tipo de documento');
  if (t.tipo_doc === 'NIT' && num && !/^\d{5,15}$/.test(num)) throw new Error('El NIT solo lleva números (sin el dígito de verificación)');
  if (t.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t.email).trim())) throw new Error('El correo no tiene un formato válido');
}

/**
 * ¿Ya existe otro tercero con el mismo documento? (para avisar, no bloquea:
 * una misma empresa puede ser cliente y proveedor a la vez).
 */
export async function duplicadoDe(t) {
  const num = String(t.numero_doc || '').replace(/\D/g, '');
  if (!num) return null;
  return (await listar()).find((x) => x.id !== t.id && String(x.numero_doc || '').replace(/\D/g, '') === num) || null;
}

/**
 * Guarda la ficha de un tercero. Si es cliente o proveedor del POS,
 * también actualiza su registro allá (nombre, documento, contacto), para
 * que el POS y la contabilidad muestren lo mismo.
 */
export async function guardar(datos) {
  await exigirTablas();
  validar(datos);
  const numero = String(datos.numero_doc || '').replace(/[^\dA-Za-z]/g, '');
  const ficha = {
    id: datos.id || uid(),
    tipo_doc: datos.tipo_doc || '',
    numero_doc: numero,
    dv: datos.tipo_doc === 'NIT' && numero ? calcularDV(numero) : '',
    tipo_persona: datos.tipo_persona === 'juridica' ? 'juridica' : 'natural',
    nombre: String(datos.nombre || '').trim(),
    nombre_comercial: String(datos.nombre_comercial || '').trim(),
    roles: Array.isArray(datos.roles) && datos.roles.length ? datos.roles : ['otro'],
    responsable_iva: !!datos.responsable_iva,
    responsabilidades: Array.isArray(datos.responsabilidades) ? datos.responsabilidades : [],
    email: String(datos.email || '').trim().toLowerCase(),
    telefono: String(datos.telefono || '').trim(),
    direccion: String(datos.direccion || '').trim(),
    ciudad: String(datos.ciudad || '').trim(),
    departamento: String(datos.departamento || '').trim(),
    activo: datos.activo !== false,
    creado: datos.creado || nowISO(),
  };

  const docTexto = ficha.tipo_doc === 'NIT' && ficha.numero_doc ? `${ficha.numero_doc}-${ficha.dv}` : ficha.numero_doc;
  const cliente = await db.get('clientes', ficha.id);
  const proveedor = await db.get('proveedores', ficha.id);

  // Si se marcó como cliente o proveedor y aún no existe allá, se crea
  // (así aparece en el punto de venta o en compras).
  if (cliente || ficha.roles.includes('cliente')) {
    await Sync.guardar('clientes', {
      ...(cliente || { preciosEspeciales: {}, negocio: '', obs: '', data: null }),
      id: ficha.id, nombre: ficha.nombre, documento: docTexto,
      telefono: ficha.telefono, email: ficha.email, direccion: ficha.direccion, ciudad: ficha.ciudad,
    });
  }
  if (proveedor || ficha.roles.includes('proveedor')) {
    await Sync.guardar('proveedores', {
      ...(proveedor || { contacto: '', nota: '' }),
      id: ficha.id, nombre: ficha.nombre, nit: docTexto,
      telefono: ficha.telefono, email: ficha.email, direccion: ficha.direccion, ciudad: ficha.ciudad,
    });
  }
  await Sync.guardar(TABLA, ficha);
  return ficha;
}

/** Texto de búsqueda: nombre, documento o teléfono. */
export function coincide(t, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  return `${t.nombre} ${t.nombre_comercial} ${t.numero_doc} ${t.telefono}`.toLowerCase().includes(s);
}
