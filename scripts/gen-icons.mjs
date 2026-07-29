/**
 * gen-icons.mjs — Genera los íconos PNG de la app (para instalarla en el celu).
 *
 * Dibuja el mismo logo que ves en la barra: un cuadrado redondeado azul con
 * "Mi" en blanco. Se escribe el PNG a mano (zlib de Node) para no depender de
 * ninguna librería de imágenes.
 *
 *   node scripts/gen-icons.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const AZUL = [52, 121, 246]; // brand-500
const BLANCO = [255, 255, 255];

/** Trazos de las letras M e i, en una grilla 0..1 (x, y, ancho, alto). */
const TRAZOS = [
  // M: dos patas, y dos diagonales aproximadas por escalones
  { x: 0.20, y: 0.34, w: 0.055, h: 0.32 },
  { x: 0.395, y: 0.34, w: 0.055, h: 0.32 },
  { x: 0.255, y: 0.34, w: 0.05, h: 0.10 },
  { x: 0.30, y: 0.40, w: 0.05, h: 0.10 },
  { x: 0.345, y: 0.34, w: 0.05, h: 0.10 },
  // i: punto y cuerpo
  { x: 0.52, y: 0.34, w: 0.055, h: 0.055 },
  { x: 0.52, y: 0.43, w: 0.055, h: 0.23 },
];

function dentroRedondeado(x, y, size, radio) {
  const r = radio;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function crc32(buf) {
  let c;
  const tabla = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(size) {
  const radio = size * 0.22;
  const filas = [];
  for (let y = 0; y < size; y++) {
    const fila = Buffer.alloc(1 + size * 4); // 1 byte de filtro + RGBA
    for (let x = 0; x < size; x++) {
      const i = 1 + x * 4;
      const dentro = dentroRedondeado(x + 0.5, y + 0.5, size, radio);
      if (!dentro) {
        fila[i] = 0; fila[i + 1] = 0; fila[i + 2] = 0; fila[i + 3] = 0; // transparente
        continue;
      }
      const u = x / size;
      const v = y / size;
      const esLetra = TRAZOS.some((t) => u >= t.x && u <= t.x + t.w && v >= t.y && v <= t.y + t.h);
      const c = esLetra ? BLANCO : AZUL;
      fila[i] = c[0]; fila[i + 1] = c[1]; fila[i + 2] = c[2]; fila[i + 3] = 255;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(filas), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync('public', { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(`public/icon-${size}.png`, png(size));
  console.log(`public/icon-${size}.png`);
}
// Apple usa el ícono sin transparencia alrededor; el mismo sirve.
fs.copyFileSync('public/icon-192.png', 'public/apple-touch-icon.png');
console.log('public/apple-touch-icon.png');
