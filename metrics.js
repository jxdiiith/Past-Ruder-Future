const q = document.getElementById('q');

const GLYPHS = {
  // Buchstabe: [Breite (advance), linker Abstand (LSB), rechter Abstand (RSB)]
  A: [466, 0, 0],
  B: [442, 5, 5],
  C: [442, 5, 5],
  D: [442, 5, 5],
  E: [376, 5, 5],
  F: [376, 5, 5],
  G: [442, 5, 5],
  H: [436, 5, 5],
  I: [172, 5, 5],
  J: [412, 5, 5],
  K: [444, 5, 0],
  L: [376, 5, 5],
  M: [668, 5, 5],
  N: [460, 5, 5],
  O: [442, 5, 5],
  P: [442, 5, 5],
  Q: [442, 5, 5],
  R: [442, 5, 5],
  S: [442, 5, 5],
  T: [442, 5, 5],
  U: [442, 5, 5],
  V: [456, 0, 0],
  W: [744, 0, 0],
  X: [522, 0, 0],
  Y: [479, 0, 0],
  Z: [396, 5, 5],
  a: [382, 5, 5],
  b: [382, 5, 5],
  c: [382, 5, 5],
  d: [382, 5, 5],
  e: [382, 5, 5],
  f: [284, 5, 5],
  g: [382, 5, 5],
  h: [382, 5, 5],
  i: [152, 5, 5],
  j: [152, -73, 5],
  k: [393, 5, 0],
  l: [152, 5, 5],
  m: [600, 5, 5],
  n: [382, 5, 5],
  o: [382, 5, 5],
  p: [382, 5, 5],
  q: [382, 5, 5],
  r: [352, 5, 5],
  s: [382, 5, 5],
  t: [268, 5, 5],
  u: [382, 5, 5],
  v: [398, 0, 0],
  w: [654, 0, 0],
  x: [444, 0, 0],
  y: [450, 0, 0],
  z: [337, 5, 5],
};

// Mitte der Zeichenfläche (viewBox -700 bis 1142): hier steht der Buchstabe immer mittig, egal wie breit er ist (I, M, W ...)
const GLYPH_CENTER_X = 221;
const lsbLine = document.querySelector('.metrics line[x1="0"][x2="0"]');   // senkrechte Linie am linken Rand des Buchstabens

// setzt Buchstabe + die zwei senkrechten Linien + die Zahlen unten (alles um den Buchstaben herum wird mit verschoben, damit er in der Mitte steht)
function setGlyph(ch) {
  const [adv, lsb, rsb] = GLYPHS[ch];
  const off = GLYPH_CENTER_X - adv / 2;   // Verschiebung nach rechts (negativ = nach links)
  q.textContent = ch;
  q.setAttribute('x', off);
  if (lsbLine) { lsbLine.setAttribute('x1', off); lsbLine.setAttribute('x2', off); }
  document.getElementById('advLine').setAttribute('x1', adv + off);
  document.getElementById('advLine').setAttribute('x2', adv + off);
  const l = document.getElementById('lsbNum');
  const a = document.getElementById('advNum');
  const r = document.getElementById('rsbNum');
  l.textContent = lsb;
  l.setAttribute('x', off - 20);
  a.setAttribute('x', off + adv / 2);
  a.textContent = adv;
  r.setAttribute('x', off + adv + 20);
  r.textContent = rsb;
}

// gmässeni wärt us de font (knoteputkt vo de masters)
const UC_K = [100, 250, 900];
const LC_K = [100, 500, 900];
const CAP = [706, 792, 1142];
const X_TAB = [
  [532, 560, 565],
  [570, 628, 651],
  [815, 905, 1001]
];
const DESC_EXTRA = [26, 56, 161];

// linear zwüsche de knoteputkt interpoliere
function lerp(knots, vals, v) {
  let i = 0;
  while (i < knots.length - 2 && v > knots[i + 1]) i++;
  const t = (v - knots[i]) / (knots[i + 1] - knots[i]);
  return vals[i] * (1 - t) + vals[i + 1] * t;
}

// setzt Linie + Label + Zahl auf richtige Höhe
function setLine(name, y, number) {
  const line = document.getElementById(name + 'Line');
  line.setAttribute('y1', y);
  line.setAttribute('y2', y);
  document.getElementById(name + 'Label').setAttribute('y', y - 14);
  const num = document.getElementById(name + 'Num');
  num.setAttribute('y', y - 14);
  num.textContent = number;
}

// Werte kommen jetzt von aussen (aus dem style-Objekt in script.js)
function updateMetrics(uc, lc, de) {
  q.style.fontVariationSettings = `'YTUC' ${uc}, 'YTLC' ${lc}, 'YTDE' ${de}`;

  const cap = lerp(UC_K, CAP, uc);
  const asc = cap + 204;
  const xh = lerp(UC_K, X_TAB.map(row => lerp(LC_K, row, lc)), uc);
  const desc = 204 + ((de - 100) / 800) * lerp(UC_K, DESC_EXTRA, uc);

  setLine('asc', -asc, Math.round(asc));
  setLine('cap', -cap, Math.round(cap));
  setLine('x', -xh, Math.round(xh));
  setLine('de', desc, -Math.round(desc));
}


// ----------------------------------------
// GRID ANZEIGEN / VERSTECKEN
// ----------------------------------------

const metricsSvg = document.querySelector('.metrics');
const textRow = document.getElementById('text');
let gridVisible = false;

function showGrid(answer) {
  // nur Buchstaben, für die es ein Grid gibt (A-Z, a-z)
  const letters = (answer || "").split("").filter(c => GLYPHS[c]);
  if (letters.length === 0) {
    console.log("Kein Buchstabe in der Antwort für das Grid.");
    return;
  }

  let ch = letters[Math.floor(Math.random() * letters.length)];

  // wie im Text dargestellt (wenn ! oder ? aktiv ist)
  if (style.textCase === "uppercase") ch = ch.toUpperCase();
  if (style.textCase === "lowercase") ch = ch.toLowerCase();

  setGlyph(ch);
  gridVisible = true;
  updateMetrics(style.YTUC, style.YTLC, style.YTDE);
  metricsSvg.classList.remove('hidden');
  textRow.classList.add('hidden');
}

function hideGrid() {
  gridVisible = false;
  metricsSvg.classList.add('hidden');
  textRow.classList.remove('hidden');
}

function toggleGrid(answer) {
  if (gridVisible) hideGrid();
  else showGrid(answer);
}