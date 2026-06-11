/**
 * core/crypto.js — Hash de contraseñas con Web Crypto (PBKDF2-SHA256)
 *
 * Las contraseñas NUNCA se guardan en texto plano: se guarda un "hash"
 * (huella digital irreversible) + un "salt" aleatorio por usuario.
 * Al iniciar sesión se vuelve a calcular el hash de lo que el usuario
 * escribió y se compara con el guardado.
 *
 * Formato guardado: { salt: hex, iter: number, hash: hex }
 *
 * Requiere contexto seguro (https o localhost) — Vercel y `npm run dev`
 * cumplen ambos.
 */

const ITERACIONES_DEFAULT = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Calcula el hash PBKDF2 de una contraseña.
 *
 * @param {string} password - Texto plano a hashear
 * @param {string|null} saltHex - Salt existente (para verificar) o null (genera uno nuevo)
 * @param {number} iterations
 * @returns {Promise<{salt: string, iter: number, hash: string}>}
 */
export async function hashPassword(password, saltHex = null, iterations = ITERACIONES_DEFAULT) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: bytesToHex(salt), iter: iterations, hash: bytesToHex(new Uint8Array(bits)) };
}

/**
 * Verifica una contraseña contra un hash guardado.
 *
 * @param {string} password - Lo que el usuario escribió
 * @param {{salt: string, iter?: number, hash: string}} stored - Hash guardado
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false;
  try {
    const h = await hashPassword(password, stored.salt, stored.iter || ITERACIONES_DEFAULT);
    return h.hash === stored.hash;
  } catch (e) {
    console.error('Error verificando contraseña:', e);
    return false;
  }
}
