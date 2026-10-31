// ***************
// Kamera + Texterkennung (tesseract.js) + rote Kästchen
// ***************
let latestText = "";   // zuletzt erkannter Text (für script.js)
let latestGoodText = "";   // nur sichere Wörter (für die Frage an Gemini)
// --- einstellige ---
const SPRACHE   = 'eng';   // z.b. 'eng+deu' für Deutsch dazu
const MAX_BREITE = 1280;    // bild wird für die erkennung verkleinert (schneller)
const MIN_CONF  = 60;      // ab wie viel % sicherheit ein wort ein kästchen kriegt (0-100)
const PADDING   = 6;       // abstand kästchen zum text (in bildpixeln)
const LABELS    = true;    // erkannter text über dem kästchen zeigen
const SCAN_DELAY     = 0;    // pause zwischen zwei erkennungen in ms (0 = die Erkennung läuft ununterbrochen, grösser = weniger last)
const WORKER_RESTART = 400;  // nach so vielen scans wird tesseract neu gestartet (speicher aufräumen)

const TEXT_HISTORY   = 5;      // so viele der letzten Scans werden für die Zeichen-Zählung zusammen betrachtet
const DEBUG_SYMBOLS  = false;  // true = reine Zeichen-Tokens (auch unsichere) gelb einzeichnen, zum Testen

// --- bild-vorverarbeitung (macht den text für tesseract klarer) ---
const ADAPTIVE      = true;   // true = lokaler schwellwert (gut bei schatten/ungleichem licht), false = ein globaler wert
const CONTRAST_CLIP = 0.02;   // dunkelste/hellste 2% abschneiden und den rest auf 0-255 strecken (0 = aus)
const ADAPT_DIV     = 64;     // fenstergrösse = bildbreite / ADAPT_DIV (kleiner = grösseres fenster)
const ADAPT_BIAS    = 12;     // ein pixel muss so viel dunkler als seine umgebung sein, um schwarz zu werden (höher = weniger rauschen)
const DARK_FLOOR    = 0.5;    // alles unter (otsu-wert * DARK_FLOOR) ist immer schwarz (füllt grosse schwarze flächen)
const SHOW_PROCESSED = false; // true = das schwarz-weisse bild von tesseract halbtransparent einblenden (zum einstellen)

const recentTexts = [];      // erkannter text der letzten scans (script.js liest das)
let scanPaused = false;      // script.js setzt das auf true, während die AI antwortet
let scanCount  = 0;

const cameraBox = document.querySelector('.camera');

// video (live bild) + overlay (rote kästchen) übereinander
const video = document.createElement('video');
video.autoplay = true;
video.muted = true;
video.playsInline = true;

const overlay = document.createElement('canvas');
const octx = overlay.getContext('2d');

// unsichtbares canvas: hier wird das bild für tesseract vorbereitet
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });

cameraBox.append(video, overlay);

let worker = null;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();

  // welche auflösung hat die kamera wirklich? (steht in der konsole)
  const track = stream.getVideoTracks()[0];
  console.log('Kamera:', video.videoWidth + 'x' + video.videoHeight, track.getSettings());

  // wenn möglich: dauerhaft scharf stellen (wichtig für kleine zeichen auf papier)
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch (err) {
    console.warn('Fokus konnte nicht gesetzt werden:', err.message);
  }

  // overlay hät genau di gliich grössi wie s video -> koordinate stimmed 1:1
  overlay.width  = video.videoWidth;
  overlay.height = video.videoHeight;

  const scale = Math.min(1, MAX_BREITE / video.videoWidth);
  grab.width  = Math.round(video.videoWidth * scale);
  grab.height = Math.round(video.videoHeight * scale);

  await startWorker();
  scan();
}

async function startWorker() {
  worker = await Tesseract.createWorker(SPRACHE);
  // SPARSE_TEXT = findet einzelne wörter/buchstaben überall im bild
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
}

// schwarz-weiss machen: kontrast strecken, dann (lokal oder global) schwellwert
// <binarize-core>
function binarizeData(d, w, h) {
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
    gray[i] = g;
    hist[g]++;
  }

  // 1) kontrast strecken: hellster/dunkelster rand weg, rest auf volle breite
  let lo = 0, hi = 255, acc = 0;
  const clip = n * CONTRAST_CLIP;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > clip) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > clip) { hi = i; break; } }
  if (hi - lo < 20) { lo = 0; hi = 255; }   // fast einfarbiges bild: nicht strecken
  const scale = 255 / (hi - lo);
  hist.fill(0);
  for (let i = 0; i < n; i++) {
    let g = (gray[i] - lo) * scale;
    g = g < 0 ? 0 : (g > 255 ? 255 : (g | 0));
    gray[i] = g;
    hist[g]++;
  }

  // 2) globaler schwellwert (otsu)
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const diff = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * diff * diff;
    if (between > best) { best = between; t = i; }
  }

  // 3) schwarz/weiss setzen
  if (!ADAPTIVE) {
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = gray[i] > t ? 255 : 0;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    return;
  }

  // lokaler schwellwert: vergleich mit dem mittelwert der umgebung (integralbild = schnell)
  const W1 = w + 1;
  const integral = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W1 + (x + 1)] = integral[y * W1 + (x + 1)] + row;
    }
  }
  const r = Math.max(8, Math.round(w / ADAPT_DIV));
  const darkLimit = t * DARK_FLOOR;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r) + 1;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r) + 1;
      const s = integral[y1 * W1 + x1] - integral[y0 * W1 + x1] - integral[y1 * W1 + x0] + integral[y0 * W1 + x0];
      const mean = s / ((x1 - x0) * (y1 - y0));
      const g = gray[y * w + x];
      const v = (g < mean - ADAPT_BIAS || g < darkLimit) ? 0 : 255;
      const p = (y * w + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
  }
}
// </binarize-core>

function binarize() {
  const img = gctx.getImageData(0, 0, grab.width, grab.height);
  binarizeData(img.data, grab.width, grab.height);
  gctx.putImageData(img, 0, 0);
}

// tesseract v5 gibt data.words, v6 nur data.blocks -> beides abdecke
function getWords(data) {
  if (data.words) return data.words;
  const words = [];
  (data.blocks || []).forEach(b =>
    b.paragraphs.forEach(p => p.lines.forEach(l => l.words.forEach(w => words.push(w)))));
  return words;
}

function drawBoxes(words) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (SHOW_PROCESSED) {   // so sieht tesseract das bild
    octx.globalAlpha = 0.5;
    octx.drawImage(grab, 0, 0, overlay.width, overlay.height);
    octx.globalAlpha = 1;
  }
  const k = overlay.width / grab.width; // zrugg uf originalgrössi rechne
  octx.strokeStyle = 'red';
  octx.fillStyle = 'red';
  octx.lineWidth = Math.max(0.5, overlay.width / 1500);   // Dicke der roten Boxen (grössere Zahl = dünner)
  octx.font = `${Math.max(20, overlay.width / 30)}px HGKBRuderKonturLLVIP, sans-serif`;

  words.forEach(w => {
    const text = (w.text || '').trim();
    const hasLetter = /[A-Za-z0-9ÄÖÜäöüß]/.test(text);
    const show = w.confidence >= MIN_CONF && hasLetter;
    const debugSymbol = DEBUG_SYMBOLS && text.length > 0 && !hasLetter;
    if (!show && !debugSymbol) return;

    octx.strokeStyle = show ? 'red' : 'yellow';
    octx.fillStyle = show ? 'red' : 'yellow';
    const x = w.bbox.x0 * k - PADDING;
    const y = w.bbox.y0 * k - PADDING;
    const bw = (w.bbox.x1 - w.bbox.x0) * k + PADDING * 2;
    const bh = (w.bbox.y1 - w.bbox.y0) * k + PADDING * 2;
    octx.strokeRect(x, y, bw, bh);
    if (LABELS || debugSymbol) octx.fillText(text, x, y - 6);
  });
}

async function scan() {
  // nicht scannen, solange die AI antwortet oder der tab nicht sichtbar ist
  if (scanPaused || document.hidden) {
    setTimeout(scan, 200);
    return;
  }

  try {
    gctx.drawImage(video, 0, 0, grab.width, grab.height);
    binarize();
    const { data } = await worker.recognize(grab, {}, { blocks: true });
    const words = getWords(data);
    latestText = data.text || "";
    recentTexts.push(latestText);
    if (recentTexts.length > TEXT_HISTORY) recentTexts.shift();
    latestGoodText = words
      .filter(w => w.confidence >= MIN_CONF && /[A-Za-z0-9ÄÖÜäöüß]/.test(w.text || ""))
      .map(w => w.text.trim())
      .join(" ");
    drawBoxes(words);

    // der speicher von tesseract wächst mit der zeit -> ab und zu neu starten
    if (++scanCount >= WORKER_RESTART) {
      scanCount = 0;
      await worker.terminate();
      await startWorker();
    }
  } catch (err) {
    console.error('OCR Fehler:', err);
  }

  // kurze pause, damit der browser zwischendurch frei atmen kann
  setTimeout(scan, SCAN_DELAY);
}

// ---- standbild für gemini (volle farbe, ohne schwarz-weiss) ----
const VISION_MAX_BREITE = 1600;   // grösste breite des bildes, das an gemini geht
const VISION_QUALITY    = 0.85;   // jpeg-qualität (0-1)
const shot = document.createElement('canvas');

// gibt das aktuelle kamerabild als base64-jpeg zurück (ohne "data:..."-vorspann)
function captureFrame() {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, VISION_MAX_BREITE / video.videoWidth);
  shot.width  = Math.round(video.videoWidth * scale);
  shot.height = Math.round(video.videoHeight * scale);
  shot.getContext('2d').drawImage(video, 0, 0, shot.width, shot.height);
  return shot.toDataURL('image/jpeg', VISION_QUALITY).split(',')[1];
}

startCamera().catch(err => {
  console.error('Kamera konnte nicht gestartet werden:', err);
  const msg = document.createElement('div');   // eigenes Element, damit das Dialogfenster (diag.js) im Kamerabild stehen bleibt
  msg.style.cssText = 'position:absolute;left:12px;top:12px;color:white;font:14px sans-serif;';
  msg.textContent = 'Kamera nicht verfügbar (Zugriff erlauben, localhost oder https nötig)';
  cameraBox.appendChild(msg);
});