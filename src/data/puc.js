/**
 * data/puc.js — Plan Único de Cuentas (Colombia) versión PYME
 *
 * Subconjunto curado del PUC comercial colombiano (~140 cuentas) que
 * cubre la operación de una PYME. Viene del PUC de ContaExpress, con
 * subcuentas para los medios de pago que usa PosPunto (Nequi,
 * Daviplata, QR) y las cuentas de gasto de sus categorías.
 *
 * Formato compacto: [codigo, nombre, flags?, naturalezaOverride?]
 *   flags: 'T' requiere_tercero · 'E' es_efectivo · 'S' cuenta de sistema
 *          (las de sistema las usa el motor contable: no se pueden borrar)
 *   naturaleza por defecto según la clase (1=D, 2=C, 3=C, 4=C, 5=D, 6=D);
 *   el 4º elemento la sobreescribe (ej: depreciación acumulada es C).
 *   nivel se deriva del largo del código: 1=clase, 2=grupo, 4=cuenta,
 *   6=subcuenta. Solo las subcuentas (nivel 6) permiten movimiento.
 */

export const PUC_PYME = [
  // ───────────────────────── CLASE 1 · ACTIVO ─────────────────────────
  ['1', 'ACTIVO'],
  ['11', 'Disponible'],
  ['1105', 'Caja'],
  ['110505', 'Caja general', 'E,S'],
  ['110510', 'Cajas menores', 'E'],
  ['1110', 'Bancos'],
  ['111005', 'Bancos moneda nacional', 'E,S'],
  ['111010', 'Nequi', 'E'],
  ['111015', 'Daviplata', 'E'],
  ['111020', 'Pagos QR y datáfono', 'E'],
  ['1120', 'Cuentas de ahorro'],
  ['112005', 'Cuentas de ahorro bancarias', 'E'],
  ['13', 'Deudores'],
  ['1305', 'Clientes'],
  ['130505', 'Clientes nacionales', 'T,S'],
  ['1330', 'Anticipos y avances'],
  ['133005', 'Anticipos a proveedores', 'T'],
  ['1355', 'Anticipo de impuestos y contribuciones'],
  ['135515', 'Retención en la fuente a favor'],
  ['135518', 'Retención de ICA a favor'],
  ['1365', 'Cuentas por cobrar a trabajadores'],
  ['136505', 'Préstamos a trabajadores', 'T'],
  ['1380', 'Deudores varios'],
  ['138095', 'Otros deudores', 'T'],
  ['14', 'Inventarios'],
  ['1435', 'Mercancías no fabricadas por la empresa'],
  ['143505', 'Mercancías para la venta', 'S'],
  ['15', 'Propiedades, planta y equipo'],
  ['1524', 'Equipo de oficina'],
  ['152405', 'Muebles y enseres'],
  ['1528', 'Equipo de computación y comunicación'],
  ['152805', 'Equipos de cómputo'],
  ['1540', 'Flota y equipo de transporte'],
  ['154005', 'Vehículos'],
  ['1592', 'Depreciación acumulada', '', 'C'],
  ['159215', 'Dep. acum. equipo de oficina', '', 'C'],
  ['159220', 'Dep. acum. equipo de computación', '', 'C'],
  ['159235', 'Dep. acum. flota y transporte', '', 'C'],

  // ───────────────────────── CLASE 2 · PASIVO ─────────────────────────
  ['2', 'PASIVO'],
  ['21', 'Obligaciones financieras'],
  ['2105', 'Bancos nacionales'],
  ['210505', 'Créditos y préstamos bancarios', 'T'],
  ['22', 'Proveedores'],
  ['2205', 'Proveedores nacionales'],
  ['220505', 'Proveedores nacionales', 'T,S'],
  ['23', 'Cuentas por pagar'],
  ['2335', 'Costos y gastos por pagar'],
  ['233595', 'Otros costos y gastos por pagar', 'T'],
  ['2365', 'Retención en la fuente por pagar'],
  ['236515', 'Retefuente honorarios'],
  ['236525', 'Retefuente servicios'],
  ['236540', 'Retefuente compras'],
  ['2368', 'Impuesto de industria y comercio retenido'],
  ['236805', 'ReteICA por pagar'],
  ['2370', 'Retenciones y aportes de nómina'],
  ['237005', 'Aportes a EPS'],
  ['237006', 'Aportes a ARL'],
  ['237010', 'Aportes parafiscales (CCF, ICBF, SENA)'],
  ['24', 'Impuestos, gravámenes y tasas'],
  ['2404', 'Impuesto de renta'],
  ['240405', 'Impuesto de renta por pagar'],
  ['2408', 'Impuesto sobre las ventas por pagar'],
  ['240801', 'IVA descontable (compras)', 'S'],
  ['240802', 'IVA generado (ventas)', 'S'],
  ['2412', 'Impuesto de industria y comercio'],
  ['241205', 'ICA por pagar'],
  ['25', 'Obligaciones laborales'],
  ['2505', 'Salarios por pagar'],
  ['250505', 'Salarios por pagar', 'T'],
  ['2510', 'Cesantías consolidadas'],
  ['251005', 'Cesantías por pagar', 'T'],
  ['2515', 'Intereses sobre cesantías'],
  ['251505', 'Intereses de cesantías por pagar', 'T'],
  ['2520', 'Prima de servicios'],
  ['252005', 'Prima de servicios por pagar', 'T'],
  ['2525', 'Vacaciones consolidadas'],
  ['252505', 'Vacaciones por pagar', 'T'],
  ['26', 'Pasivos estimados y provisiones'],
  ['2610', 'Provisiones para obligaciones laborales'],
  ['261005', 'Provisión cesantías'],
  ['261010', 'Provisión intereses de cesantías'],
  ['261015', 'Provisión vacaciones'],
  ['261020', 'Provisión prima de servicios'],
  ['28', 'Otros pasivos'],
  ['2805', 'Anticipos y avances recibidos'],
  ['280505', 'Anticipos de clientes', 'T'],

  // ─────────────────────── CLASE 3 · PATRIMONIO ───────────────────────
  ['3', 'PATRIMONIO'],
  ['31', 'Capital social'],
  ['3115', 'Aportes sociales'],
  ['311505', 'Aportes sociales'],
  ['3130', 'Capital de personas naturales'],
  ['313005', 'Capital persona natural'],
  ['36', 'Resultados del ejercicio'],
  ['3605', 'Utilidad del ejercicio'],
  ['360505', 'Utilidad del ejercicio', 'S'],
  ['3610', 'Pérdida del ejercicio'],
  ['361005', 'Pérdida del ejercicio', '', 'D'],
  ['37', 'Resultados de ejercicios anteriores'],
  ['3705', 'Utilidades acumuladas'],
  ['370505', 'Utilidades de ejercicios anteriores'],
  ['3710', 'Pérdidas acumuladas'],
  ['371005', 'Pérdidas de ejercicios anteriores', '', 'D'],

  // ──────────────────────── CLASE 4 · INGRESOS ────────────────────────
  ['4', 'INGRESOS'],
  ['41', 'Operacionales'],
  ['4135', 'Comercio al por mayor y al por menor'],
  ['413505', 'Venta de mercancías', 'S'],
  ['413510', 'Venta de servicios'],
  ['4175', 'Devoluciones en ventas', '', 'D'],
  ['417505', 'Devoluciones en ventas', '', 'D'],
  ['42', 'No operacionales'],
  ['4210', 'Financieros'],
  ['421005', 'Intereses y rendimientos'],
  ['4250', 'Recuperaciones'],
  ['425050', 'Reintegros y recuperaciones'],
  ['4295', 'Diversos'],
  ['429505', 'Aprovechamientos y sobrantes', 'S'],

  // ───────────────────────── CLASE 5 · GASTOS ─────────────────────────
  ['5', 'GASTOS'],
  ['51', 'Operacionales de administración'],
  ['5105', 'Gastos de personal'],
  ['510506', 'Sueldos'],
  ['510527', 'Auxilio de transporte'],
  ['510530', 'Cesantías'],
  ['510533', 'Intereses sobre cesantías'],
  ['510536', 'Prima de servicios'],
  ['510539', 'Vacaciones'],
  ['510568', 'Aportes ARL'],
  ['510569', 'Aportes EPS'],
  ['510570', 'Aportes fondos de pensión'],
  ['510572', 'Aportes caja de compensación'],
  ['5110', 'Honorarios'],
  ['511095', 'Honorarios varios'],
  ['5115', 'Impuestos'],
  ['511515', 'Industria y comercio'],
  ['511595', 'Otros impuestos'],
  ['5120', 'Arrendamientos'],
  ['512010', 'Arrendamiento de local'],
  ['5135', 'Servicios'],
  ['513525', 'Acueducto y alcantarillado'],
  ['513530', 'Energía eléctrica'],
  ['513535', 'Teléfono e internet'],
  ['513550', 'Transporte, fletes y acarreos'],
  ['513595', 'Otros servicios'],
  ['5145', 'Mantenimiento y reparaciones'],
  ['514515', 'Mantenimiento de equipos e instalaciones'],
  ['5160', 'Depreciaciones'],
  ['516015', 'Dep. equipo de oficina'],
  ['516020', 'Dep. equipo de computación'],
  ['516035', 'Dep. flota y transporte'],
  ['5195', 'Diversos'],
  ['519525', 'Elementos de aseo y cafetería'],
  ['519530', 'Útiles, papelería y fotocopias'],
  ['519595', 'Otros gastos diversos', 'S'],
  ['52', 'Operacionales de ventas'],
  ['5235', 'Servicios'],
  ['523560', 'Publicidad, propaganda y promoción'],
  ['53', 'No operacionales'],
  ['5305', 'Financieros'],
  ['530505', 'Gastos bancarios y comisiones'],
  ['530520', 'Intereses'],
  ['5395', 'Gastos diversos'],
  ['539520', 'Faltantes de caja e inventario', 'S'],
  ['59', 'Ganancias y pérdidas'],
  ['5905', 'Ganancias y pérdidas'],
  ['590505', 'Cierre de ejercicio', 'S'],

  // ────────────────────── CLASE 6 · COSTO DE VENTAS ───────────────────
  ['6', 'COSTOS DE VENTAS'],
  ['61', 'Costo de ventas y de prestación de servicios'],
  ['6135', 'Comercio al por mayor y al por menor'],
  ['613505', 'Costo de mercancías vendidas', 'S'],
  ['613510', 'Costo de servicios'],
];

/** Naturaleza por defecto según la clase contable. */
export const NATURALEZA_CLASE = { 1: 'D', 2: 'C', 3: 'C', 4: 'C', 5: 'D', 6: 'D' };

/**
 * Expande el formato compacto a objetos completos listos para guardar.
 */
export function expandirPUC() {
  return PUC_PYME.map(([codigo, nombre, flags = '', natOverride]) => {
    const f = String(flags || '');
    const clase = Number(codigo.charAt(0));
    return {
      id: codigo,                 // el código ES el id (keyPath)
      codigo,
      nombre,
      nivel: codigo.length,       // 1 clase · 2 grupo · 4 cuenta · 6 subcuenta
      naturaleza: natOverride || NATURALEZA_CLASE[clase] || 'D',
      permite_movimiento: codigo.length === 6,
      requiere_tercero: f.includes('T'),
      es_efectivo: f.includes('E'),
      sistema: f.includes('S'),
    };
  });
}
