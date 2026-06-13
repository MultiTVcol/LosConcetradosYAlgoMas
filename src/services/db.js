/**
 * services/db.js — Base de datos local (IndexedDB)
 *
 * Wrapper sobre IndexedDB para guardar y leer datos directamente en el
 * navegador del cliente. Funciona SIN internet, instantáneo, persiste
 * incluso si se cierra la pestaña.
 *
 * Estrategia offline-first:
 *   - Toda venta/producto/cliente se guarda PRIMERO acá.
 *   - Después se sincroniza a Supabase (cuando hay internet).
 *   - Si se cae internet, el POS sigue funcionando sin interrupciones.
 *
 * Uso típico:
 *   import * as db from '../services/db.js';
 *
 *   await db.init();                          // Inicializar (una sola vez)
 *   await db.put('productos', producto);       // Guardar/actualizar
 *   const p = await db.get('productos', id);   // Leer uno
 *   const todos = await db.getAll('productos'); // Leer todos
 *   await db.remove('productos', id);          // Borrar
 *   const cuantos = await db.count('ventas');  // Contar
 *   await db.clear('cierres');                 // Vaciar tabla completa
 */

// ============================================================
//  CONFIGURACIÓN DE LA BASE DE DATOS
// ============================================================

/** Nombre de la base de datos dentro del navegador */
const DB_NAME = 'pospunto';

/**
 * Versión del esquema. Si cambia la estructura (agregar stores,
 * cambiar índices), hay que subir este número para que IndexedDB
 * sepa que tiene que aplicar la migración.
 */
const DB_VERSION = 6;

/**
 * Lista de stores (tablas) que tendrá la BD.
 * Si necesitás agregar una nueva tabla, agregala acá y subí DB_VERSION.
 */
const STORES = [
  'productos',
  'ventas',
  'clientes',
  'compras',
  'proveedores',
  'gastos',
  'cierres',
  'usuarios',
  'ajustes_inventario',  // conteos físicos: ajustes de stock por sobrante/faltante
  'kvs',  // key-value store: configs, preferencias, contadores
];

/**
 * Índices por store. Permiten consultar por rango sin cargar toda la tabla
 * (ej: ventas de un rango de fechas) — clave para que el historial y los
 * reportes escalen cuando hay decenas de miles de ventas.
 *
 * Si agregás un índice nuevo, subí DB_VERSION para que se cree.
 */
const INDICES = {
  ventas: [{ nombre: 'fecha', keyPath: 'fecha' }],
};

/**
 * Crea (si faltan) los stores y sus índices dentro de una transacción de
 * upgrade. Se usa tanto en el alta inicial como en la auto-reparación.
 */
function aplicarEsquema(db, tx) {
  for (const storeName of STORES) {
    const store = db.objectStoreNames.contains(storeName)
      ? tx.objectStore(storeName)
      : db.createObjectStore(storeName, { keyPath: 'id' });
    for (const idx of (INDICES[storeName] || [])) {
      if (!store.indexNames.contains(idx.nombre)) {
        store.createIndex(idx.nombre, idx.keyPath, { unique: false });
        console.log(`📑 Índice creado: ${storeName}.${idx.nombre}`);
      }
    }
  }
}

// ============================================================
//  CONEXIÓN A LA BD (se abre una sola vez y se reusa)
// ============================================================

let _dbPromise = null;

/**
 * Abre la conexión a IndexedDB. Si ya está abierta, devuelve la misma.
 * Esto es interno — usá init() para inicializar explícitamente.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = (async () => {
    // Paso 1: descubrir la versión actual de la BD (sin pasar versión)
    // Esto evita el error "requested version (N) is less than existing version (M)"
    // que ocurre cuando el navegador ya tiene una versión mayor por upgrades previos.
    let versionActual;
    try {
      versionActual = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const v = req.result.version;
          req.result.close();
          resolve(v);
        };
        req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
      });
    } catch (e) {
      console.warn('No se pudo leer versión actual de IndexedDB, asumiendo nueva:', e);
      versionActual = 0;
    }

    // Paso 2: abrir con max(versionActual, DB_VERSION) — nunca pedimos menos
    const versionFinal = Math.max(versionActual, DB_VERSION);

    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, versionFinal);

      req.onerror = () => {
        console.error('❌ Error abriendo IndexedDB:', req.error);
        reject(req.error);
      };

      req.onsuccess = () => {
        resolve(req.result);
      };

      // Se dispara cuando es la primera vez (o cuando subimos la versión).
      // Acá se crean los stores que no existen.
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        aplicarEsquema(db, event.target.transaction);
      };
    });
  })();

  return _dbPromise;
}

// ============================================================
//  API PÚBLICA
// ============================================================

/**
 * Inicializa la base de datos. Llamala una sola vez al arrancar la app.
 *
 * @returns {Promise<boolean>}
 *
 * @example
 *   await db.init();
 */
export async function init() {
  const db = await openDB();

  // Verificación de seguridad: si faltan stores, forzar upgrade.
  // Esto cubre el caso en que un usuario ya tenía la BD creada antes de
  // que se agregaran nuevos stores (productos, proveedores, etc.).
  const faltantes = STORES.filter((s) => !db.objectStoreNames.contains(s));
  if (faltantes.length > 0) {
    console.warn(`📦 Stores faltantes en IndexedDB: ${faltantes.join(', ')}. Recreando…`);
    db.close();
    _dbPromise = null;
    // Subir a una versión mayor que la actual para forzar onupgradeneeded
    const versionActual = db.version;
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, versionActual + 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onupgradeneeded = (event) => {
        aplicarEsquema(event.target.result, event.target.transaction);
      };
    });
    // Reabrir con la versión nueva
    await openDB();
    console.log(`📦 IndexedDB reparada: stores faltantes creados (${faltantes.join(', ')})`);
  }

  const dbFinal = await openDB();
  console.log(`📦 IndexedDB lista: ${DB_NAME} v${dbFinal.version} — ${STORES.length} stores`);
  return true;
}

/**
 * Guarda o actualiza un registro en el store indicado.
 * El registro DEBE tener un campo `id` único.
 *
 * @param {string} storeName - Nombre del store ('productos', 'ventas', etc.)
 * @param {Object} item - El registro a guardar (debe tener `id`)
 * @returns {Promise<Object>} - El mismo item (útil para encadenar)
 *
 * @example
 *   await db.put('productos', { id: 'p1', nombre: 'Alimento', precio: 50000 });
 */
export async function put(storeName, item) {
  if (!item || !item.id) {
    throw new Error(`db.put: el item debe tener un campo 'id'. Recibí: ${JSON.stringify(item)}`);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Obtiene UN registro por su ID.
 *
 * @param {string} storeName - Nombre del store
 * @param {string} id - ID del registro
 * @returns {Promise<Object|null>} - El registro, o null si no existe
 *
 * @example
 *   const producto = await db.get('productos', 'p1');
 *   if (producto) console.log(producto.nombre);
 */
export async function get(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Obtiene TODOS los registros de un store.
 *
 * @param {string} storeName - Nombre del store
 * @returns {Promise<Array>} - Array con todos los registros (vacío si no hay)
 *
 * @example
 *   const productos = await db.getAll('productos');
 *   productos.forEach(p => console.log(p.nombre));
 */
export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Obtiene registros cuyo índice está dentro de un rango [lower, upper]
 * (ambos inclusive), SIN cargar toda la tabla. Ideal para traer solo las
 * ventas de un rango de fechas en bases con muchos registros.
 *
 * Si el índice no existe (BD vieja sin migrar), cae a getAll() filtrando
 * en memoria, para no romper nada.
 *
 * @param {string} storeName
 * @param {string} indexName - nombre del índice (ej: 'fecha')
 * @param {string|number} lower - límite inferior inclusivo
 * @param {string|number} upper - límite superior inclusivo
 * @returns {Promise<Array>}
 */
export async function getAllByIndexRange(storeName, indexName, lower, upper) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    if (!store.indexNames.contains(indexName)) {
      // Fallback: BD sin el índice todavía → traer todo y filtrar en JS
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter((x) => {
        const v = x?.[indexName];
        return v != null && v >= lower && v <= upper;
      }));
      req.onerror = () => reject(req.error);
      return;
    }
    const idx = store.index(indexName);
    const rango = IDBKeyRange.bound(lower, upper, false, false);
    const req = idx.getAll(rango);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Borra un registro por su ID.
 *
 * @param {string} storeName - Nombre del store
 * @param {string} id - ID del registro a borrar
 * @returns {Promise<boolean>} - true si se borró
 *
 * @example
 *   await db.remove('productos', 'p1');
 */
export async function remove(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Cuenta cuántos registros hay en un store.
 *
 * @param {string} storeName - Nombre del store
 * @returns {Promise<number>}
 *
 * @example
 *   const cuantas = await db.count('ventas');
 */
export async function count(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Vacía un store completo. ⚠️ ¡No se puede deshacer!
 *
 * @param {string} storeName - Nombre del store a vaciar
 * @returns {Promise<boolean>}
 *
 * @example
 *   await db.clear('cierres');  // Borra TODOS los cierres
 */
export async function clear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}