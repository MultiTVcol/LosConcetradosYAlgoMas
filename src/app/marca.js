/**
 * app/marca.js — Identidad visual de Los Concentrados y Algo Más
 *
 *   - logo():   huella cuyos dedos son granos de maíz (SVG)
 *   - marca():  logo + "Los Concentrados" (Fredoka) + "y algo más" (Caveat)
 *   - patron(): fondo sutil de huellas, huesos, croquetas y granos
 */

let _gid = 0;

export function logo(size = 44, aro = '#EE7623') {
  const dedos = [[29, 42, -28], [41.5, 29, -9], [58.5, 29, 9], [71, 42, 28]]
    .map(([x, y, r]) => `<g transform="rotate(${r} ${x} ${y})"><path d="M${x} ${y - 10}c5 0 7.4 5.4 7.4 10.4S${x + 4} ${y + 9.5} ${x} ${y + 9.5}s-7.4-4-7.4-9.1S${x - 5} ${y - 10} ${x} ${y - 10}z" fill="#F5B82E"/><path d="M${x} ${y - 6}v11" stroke="#D99A12" stroke-width="1.6" stroke-linecap="round"/></g>`)
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="display:block;flex-shrink:0" aria-label="Los Concentrados y Algo Más"><circle cx="50" cy="50" r="47" fill="#33200F" stroke="${aro}" stroke-width="5"/><path d="M50 49c-13 0-24 11-22 21 1.4 7 8.3 9.6 14 7.6 3.4-1.2 5.6-1.9 8-1.9s4.6.7 8 1.9c5.7 2 12.6-.6 14-7.6 2-10-9-21-22-21z" fill="#EE7623"/>${dedos}</svg>`;
}

export function marca({ size = 42, titulo = 16.5, sub = 19, color = '#fff' } = {}) {
  return `
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      ${logo(size)}
      <div style="min-width:0">
        <b style="font-family:var(--font-marca);font-weight:600;display:block;line-height:1;font-size:${titulo}px;color:${color};white-space:nowrap">Los Concentrados</b>
        <span style="font-family:'Caveat',cursive;font-weight:700;color:#EE7623;display:block;line-height:.95;font-size:${sub}px">y algo más</span>
      </div>
    </div>`;
}

export function patron(color = '#fff', opacidad = 0.07) {
  const id = 'patron-' + (++_gid);
  const huella = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="3" rx="5" ry="4"/><circle cx="-5" cy="-2" r="1.9"/><circle cx="-2" cy="-5.6" r="1.9"/><circle cx="2" cy="-5.6" r="1.9"/><circle cx="5" cy="-2" r="1.9"/></g>`;
  const hueso = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-6" y="-1.6" width="12" height="3.2" rx="1"/><circle cx="-6" cy="-2" r="2.2"/><circle cx="-6" cy="2" r="2.2"/><circle cx="6" cy="-2" r="2.2"/><circle cx="6" cy="2" r="2.2"/></g>`;
  const aro = (x, y) => `<circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="${color}" stroke-width="2.2"/>`;
  const grano = (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="2.3" ry="3.6" transform="rotate(${r} ${x} ${y})"/>`;
  return `<svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;opacity:${opacidad};pointer-events:none"><defs><pattern id="${id}" width="150" height="150" patternUnits="userSpaceOnUse"><g fill="${color}">${huella(22, 24, 1.1)}${hueso(92, 30, -25)}${aro(130, 70)}${grano(60, 72, 20)}${grano(66, 78, -15)}${huella(108, 112, 0.9)}${aro(30, 110)}${grano(140, 140, 35)}${hueso(52, 132, 30)}${aro(84, 4)}</g></pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
}

/** Color e ícono por animal/categoría (para chips y miniaturas de producto). */
const ANIMALES = [
  [/perr|can(?!asta)|dog|chunky|pedigree|cachorr/i, '#EE7623', 'dog', 'Perros'],
  [/gat|felin|cat\b|arena/i, '#7B4FD6', 'cat', 'Gatos'],
  [/ave|poll|gallin|ponedor|pato|codorn|pájar|pajar|loro/i, '#E0A100', 'bird', 'Aves y granja'],
  [/cerd|porc|ganad|bovin|vaca|equin|caball|bestia|terner|cabr|oveja/i, '#3E8E41', 'tractor', 'Ganado y caballos'],
  [/salud|veterin|desparas|vacun|medic|vitamin|antipulg/i, '#2F6FD0', 'pill', 'Salud'],
  [/higien|aseo|shampoo|champ/i, '#1C9AA0', 'sparkles', 'Higiene'],
  [/grano|maíz|maiz|salvado|sal |trigo|sorgo|soya|melaza/i, '#C98A0B', 'wheat', 'Granos'],
  [/pez|peces|acuar/i, '#0E8FB0', 'fish', 'Peces'],
  [/accesor|juguet|collar|correa|cama|comeder|bebeder|hueso/i, '#8C5A3C', 'bone', 'Accesorios'],
];

/** Busca primero por la categoría del producto y, si no dice nada, por su nombre. */
export function estiloAnimal(categoria, nombre = '') {
  for (const t of [categoria, nombre]) {
    const s = String(t || '');
    if (!s) continue;
    for (const [re, color, icono, grupo] of ANIMALES) if (re.test(s)) return { color, icono, grupo };
  }
  return { color: '#8C5A3C', icono: 'package', grupo: 'Otros' };
}
