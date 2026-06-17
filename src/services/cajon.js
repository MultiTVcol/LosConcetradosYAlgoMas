/**
 * services/cajon.js — Apertura del cajón monedero (gaveta de dinero)
 *
 * El cajón se abre con un "pulso" eléctrico que envía la impresora cuando
 * recibe el comando ESC/POS de kick (ESC p m t1 t2). Desde el navegador la
 * única forma de enviar bytes crudos es la Web Serial API (Chrome/Edge en
 * computador), conectando con la impresora/caja por un puerto COM serial.
 *
 * OJO: si la impresora es USB "clase impresora" (no COM serial), Web Serial
 * no la verá; en ese caso el cajón debe abrirse desde el DRIVER de Windows
 * ("abrir cajón al imprimir"), que funciona con la impresión por navegador.
 *
 * Este módulo es best-effort: si algo falla, no rompe la venta.
 */

// Comando ESC/POS estándar para abrir el cajón (pin 2, ~25/250 ms).
const KICK = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);

let _port = null;

/** ¿El navegador soporta Web Serial? */
export function soportado() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/** ¿Ya hay un puerto conectado en esta sesión? */
export function conectado() {
  return !!(_port && _port.readable);
}

/**
 * Pide al usuario elegir el puerto de la impresora/cajón (requiere un
 * gesto del usuario: llamar desde el click de un botón).
 */
export async function conectar(baud = 9600) {
  if (!soportado()) {
    throw new Error('Este navegador no soporta Web Serial. Usa Chrome o Edge en el computador.');
  }
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: baud });
  _port = port;
  return true;
}

/** Reusa un puerto ya autorizado antes (sin pedir permiso de nuevo). */
async function puertoListo(baud) {
  if (_port && _port.readable) return _port;
  if (!soportado()) return null;
  try {
    const ports = await navigator.serial.getPorts();
    if (ports && ports[0]) {
      _port = ports[0];
      if (!_port.readable) {
        try { await _port.open({ baudRate: baud }); } catch (e) { /* ya abierto o sin permiso */ }
      }
      return _port.readable ? _port : null;
    }
  } catch (e) { /* sin puertos autorizados */ }
  return null;
}

/**
 * Envía el pulso para abrir el cajón. Devuelve true si se pudo enviar.
 * No lanza: ante cualquier problema devuelve false (no debe frenar la venta).
 */
export async function abrir(baud = 9600) {
  try {
    const port = await puertoListo(baud);
    if (!port || !port.writable) return false;
    const writer = port.writable.getWriter();
    try {
      await writer.write(KICK);
      return true;
    } finally {
      writer.releaseLock();
    }
  } catch (e) {
    console.warn('No se pudo abrir el cajón:', e);
    return false;
  }
}

/**
 * Botón "Probar": conecta (pidiendo el puerto si hace falta) y dispara el
 * pulso. Lanza si el usuario cancela o el navegador no soporta.
 */
export async function probar(baud = 9600) {
  if (!conectado()) {
    const ya = await puertoListo(baud);
    if (!ya) await conectar(baud);
  }
  return abrir(baud);
}
