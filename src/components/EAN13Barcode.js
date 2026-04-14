import React from 'react';

function lCodes(d) {
  const map = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  return map[d];
}
function gCodes(d) {
  const map = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  return map[d];
}
function rCodes(d) {
  const map = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  return map[d];
}
const parityMap = {
  '0': 'LLLLLL',
  '1': 'LLGLGG',
  '2': 'LLGGLG',
  '3': 'LLGGGL',
  '4': 'LGLLGG',
  '5': 'LGGLLG',
  '6': 'LGGGLL',
  '7': 'LGLGLG',
  '8': 'LGLGGL',
  '9': 'LGGLGL'
};

function ean13CheckDigit(d12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(d12[i]);
    sum += (i % 2 === 0) ? d : d * 3;
  }
  const mod = sum % 10;
  return String((10 - mod) % 10);
}

function encodeEAN13(digits13) {
  const d = digits13.split('').map(ch => Number(ch));
  const first = String(d[0]);
  const parity = parityMap[first];
  let pattern = '101';
  for (let i = 1; i <= 6; i++) {
    const digit = d[i];
    const side = parity[i - 1];
    const bits = side === 'L' ? lCodes(digit) : gCodes(digit);
    pattern += bits;
  }
  pattern += '01010';
  for (let i = 7; i <= 12; i++) {
    const digit = d[i];
    const bits = rCodes(digit);
    pattern += bits;
  }
  pattern += '101';
  return pattern;
}

export default function EAN13Barcode({ value, width = 2, height = 60, fontSize = 12, displayValue = true }) {
  let raw = String(value || '');
  raw = raw.replace(/\D/g, '');
  if (raw.length === 12) raw = raw + ean13CheckDigit(raw);
  if (raw.length !== 13) return null;
  const encoded = encodeEAN13(raw);
  const modules = encoded.split('').map(c => c === '1');
  const w = modules.length * width;
  const textHeight = displayValue ? fontSize + 6 : 0;
  const H = height + textHeight;

  const bars = [];
  let i = 0;
  while (i < modules.length) {
    if (!modules[i]) { i++; continue; }
    let run = 1;
    while (i + run < modules.length && modules[i + run]) run++;
    const x = i * width;
    let h = height;
    if (i === 0 || (i === 2) || (i === 45) || (i === 47) || (i === 92) || (i === 94)) {
      h = height + 6;
    }
    bars.push({ x, w: run * width, h });
    i += run;
  }

  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width={w} height={H} fill="#ffffff" />
      {bars.map((b, idx) => (
        <rect key={idx} x={b.x} y="0" width={b.w} height={b.h} fill="#000000" />
      ))}
      {displayValue && (
        <text x={w / 2} y={height + fontSize} fontFamily="monospace" fontSize={fontSize} textAnchor="middle" fill="#000000">
          {raw}
        </text>
      )}
    </svg>
  );
}
