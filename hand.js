// ***************
// Handtracking mit MediaPipe Hands (wie in deiner Hand-Datei)
// Nur die RECHTE Hand zählt. Bounding Box "Paint Roller" um die Hand, Höhe = Mittelwert aller Fingerspitzen.
// script.js bekommt die Position der Hand (y: 0 = oben, 1 = unten; x: 0 = links, 1 = rechts) über onHandMove(...)
// und die Pinch-Geste (rechte Hand, zwei Schritte: erst Zeigefinger + Daumen, dann kleiner Finger + Daumen) über onPinch(...): das löst das Foto an Gemini aus.
// ***************
const HAND_JS_VERSION = 'hand.js v19 (auto restart when tracking hangs)';
const HAND_SIDE = 'right';        // 'right' = nur rechte Hand, 'left' = nur linke, 'any' = jede
const CAMERA_MIRRORED = false;    // false = Kamerabild ist nicht gespiegelt (normal). Reagiert die falsche Hand: true setzen.
const HAND_INPUT = 'hand';        // 'hand' = Mittelpunkt der ganzen Hand (alle 21 Punkte), 'fingertips' = nur die fünf Fingerspitzen
const FINGER_TIPS = [4, 8, 12, 16, 20];   // MediaPipe-Nummern der Fingerspitzen
const HAND_DOT_COLOR = 'red';   // Farbe der Box
const HAND_SHOW_DOT = false;    // true = roten Punkt auf dem Finger zeigen
const HAND_DOT_SIZE = 120;      // Punktradius = Bildbreite / diese Zahl (kleiner = grösser)
const HAND_BOX_NAME = 'Paint Roller';   // Beschriftung der Bounding Box um die Hand
const HAND_BOX_PAD = 0.04;        // Abstand der Box zur Hand (Anteil der Bildbreite)
const HAND_BOX_SCALE = 1.5;       // Box um diesen Faktor grösser als die Hand (1 = eng)
// --- Pinch-Geste in ZWEI Schritten (damit sich beim Drehen der Hand nicht aus Versehen ein Foto auslöst) ---
// Schritt 1: Daumenspitze (4) berührt die Zeigefingerspitze (8). Schritt 2 (innerhalb von PINCH_SEQUENCE_MS): Daumen berührt die Spitze des kleinen Fingers (20).
// Erst nach Schritt 2 wird das Foto ausgelöst. Zwischen den Schritten muss der Zeigefinger den Daumen wieder loslassen.
// Gemessen wird der Abstand der Spitzen, geteilt durch die Handgrösse (Handgelenk 0 bis Mittelfinger-Grundgelenk 9),
// so funktioniert es nah und fern von der Kamera gleich.
const PINCH_ON = 0.14;          // Abstand kleiner als das -> Berührung gilt als geschlossen (kleiner = die Finger müssen sich fester berühren)
const PINKY_ON = 0.22;          // nur für den kleinen Finger (er ist schwerer zu berühren): grösser = leichter
const PINKY_FRAMES = 5;         // so viele Bilder muss der kleine Finger geschlossen sein
const PINCH_OFF = 0.30;         // erst wenn der Abstand wieder grösser ist, gilt die Berührung als gelöst.
                                // Nicht zu gross wählen: bleibt eine entspannte Hand darunter, gilt sie für immer als "geschlossen".
const PINCH_FRAMES = 8;         // so viele Bilder hintereinander muss eine Berührung geschlossen sein (Schutz gegen Fehlerkennung)
const PINCH_SEQUENCE_MS = 2000; // so viel Zeit hast du nach Schritt 1 für Schritt 2
const PINCH_COOLDOWN_MS = 6000; // nach einem ausgelösten Foto kurz Pause
// Leertaste = Auslöser scharf (ARMED) oder gesperrt (LOCKED). Gesperrt löst die Geste nie aus (zum Beispiel vor dem Auftritt oder zwischen den Fragen).
const TRIGGER_ARMED_START = true;
let triggerArmed = TRIGGER_ARMED_START;
function showTrigger() { if (typeof diagSet === 'function') diagSet('Trigger', triggerArmed ? 'ARMED (space = lock)' : 'LOCKED (space = arm)'); }
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  triggerArmed = !triggerArmed;
  pinchStep = 0; idxFrames = 0; pinkyFrames = 0;
  showTrigger();
});
showTrigger();
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';   // gleiche Version wie in deiner Hand-Datei

const handCanvas = document.createElement('canvas');
const hctx = handCanvas.getContext('2d');
handCanvas.style.pointerEvents = 'none';
handCanvas.style.zIndex = '4';
cameraBox.appendChild(handCanvas);   // cameraBox kommt aus camera.js

let handListener = null;
function onHandMove(fn) { handListener = fn; }

let pinchListener = null;
function onPinch(fn) { pinchListener = fn; }
let pinchStep = 0;              // 0 = Warten auf Schritt 1, 1 = Schritt 1 (Zeigefinger + Daumen) ist erledigt, Schritt 2 (kleiner Finger + Daumen) fehlt
let pinchStepTime = 0;          // wann Schritt 1 erledigt wurde
let idxFrames = 0, pinkyFrames = 0;   // wie viele Bilder hintereinander geschlossen
let idxLatched = false;         // Schritt 1 wurde erkannt und der Zeigefinger hat den Daumen noch nicht losgelassen
let lastPinchTime = 0;

let lastHandStatus = 0;
function handStatus(text, force) {
  const now = Date.now();
  if (!force && now - lastHandStatus < 250) return;   // nicht öfter als 4x pro Sekunde aktualisieren
  lastHandStatus = now;
  if (typeof diagSet === 'function') diagSet('Hand', text);
}

// MediaPipe meldet "Left"/"Right" für ein gespiegeltes Bild. Bei einer normalen (nicht gespiegelten) Kamera ist es umgekehrt.
function physicalSide(label) {
  const l = String(label || '').toLowerCase();
  if (CAMERA_MIRRORED) return l;
  return l === 'left' ? 'right' : (l === 'right' ? 'left' : l);
}

// Höhe des Fingers relativ zum SICHTBAREN Kamerabild auf dem Bildschirm (0 = oberer Rand, 1 = unterer Rand).
// Die Kamera füllt die linke Bildschirmhälfte (object-fit: cover), dabei kann oben/unten etwas abgeschnitten sein.
function screenY(yNorm) {
  const box = cameraBox.getBoundingClientRect();
  if (!box.width || !box.height || !video.videoWidth) return yNorm;
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const shownH = video.videoHeight * scale;
  const offset = (box.height - shownH) / 2;   // negativ, wenn oben/unten abgeschnitten wird
  return Math.min(1, Math.max(0, (yNorm * shownH + offset) / box.height));
}

// Gleiches für die Seite: 0 = linker Rand des sichtbaren Kamerabildes, 1 = rechter Rand
function screenX(xNorm) {
  const box = cameraBox.getBoundingClientRect();
  if (!box.width || !box.height || !video.videoWidth) return xNorm;
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const shownW = video.videoWidth * scale;
  const offset = (box.width - shownW) / 2;   // negativ, wenn links/rechts abgeschnitten wird
  return Math.min(1, Math.max(0, (xNorm * shownW + offset) / box.width));
}

let lastResultTime = Date.now();
function onResult(result) {
  lastResultTime = Date.now();
  try { onResultInner(result); }
  catch (err) { console.error('hand.js result error:', err); handStatus('result error (skipped): ' + (err && err.message || err)); }
}

function onResultInner(result) {
  if (handCanvas.width !== video.videoWidth || handCanvas.height !== video.videoHeight) {
    handCanvas.width = video.videoWidth;
    handCanvas.height = video.videoHeight;
  }
  hctx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  const on = typeof handActive !== 'undefined' && handActive;
  const state = on ? 'control ON' : 'control OFF';
  const hands = (result && result.multiHandLandmarks) || [];

  let found = -1;
  const seen = [];
  for (let i = 0; i < hands.length; i++) {
    const cat = result.multiHandedness && result.multiHandedness[i];
    const side = physicalSide(cat && (cat.label || cat.categoryName));
    seen.push(side);
    if (found < 0 && (HAND_SIDE === 'any' || side === HAND_SIDE)) found = i;
  }

  if (found < 0) {
    handStatus((seen.length ? 'seen: ' + seen.join('+') + ', looking for: ' + HAND_SIDE : 'no hand visible') + '\n' + state);
    pinchStep = 0; idxFrames = 0; pinkyFrames = 0; idxLatched = false;
    if (handListener) handListener(null);
    return;
  }

  const landmarks = hands[found];
  if (!Array.isArray(landmarks) || landmarks.length < 21 || landmarks.some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number')) {
    handStatus('hand data incomplete, skipped\n' + state);   // kaputtes Einzelbild von MediaPipe: überspringen statt Fehler
    if (handListener) handListener(null);
    return;
  }
  const W = handCanvas.width, H = handCanvas.height;

  // Bounding Box um die ganze Hand: "Paint Roller" (vergrössert)
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  landmarks.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const cx = (minX + maxX) / 2 * W, cy = (minY + maxY) / 2 * H;
  const bw = (maxX - minX) * W * HAND_BOX_SCALE + HAND_BOX_PAD * W * 2;
  const bh = (maxY - minY) * H * HAND_BOX_SCALE + HAND_BOX_PAD * W * 2;
  const bx = cx - bw / 2, by = cy - bh / 2;
  const fontPx = Math.max(22, W / 30);
  hctx.strokeStyle = HAND_DOT_COLOR;
  hctx.fillStyle = HAND_DOT_COLOR;
  hctx.lineWidth = Math.max(0.5, W / 1000);   // Dicke der Hand-Box (grössere Zahl = dünner)
  hctx.strokeRect(bx, by, bw, bh);
  hctx.font = fontPx + 'px HGKBRuderKonturLLVIP, sans-serif';
  hctx.fillText(HAND_BOX_NAME, bx, Math.max(fontPx, by - 8));

  // Höhe der Hand: Mittelpunkt der ganzen Hand (oder der Fingerspitzen), egal welcher Finger wo ist
  const pts = HAND_INPUT === 'fingertips' ? FINGER_TIPS.map(i => landmarks[i]) : landmarks;
  const tipY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  const tipX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;

  if (HAND_SHOW_DOT) {
    hctx.beginPath();
    hctx.arc(tipX * W, tipY * H, Math.max(8, W / HAND_DOT_SIZE), 0, Math.PI * 2);
    hctx.fill();
  }

  // Pinch-Geste erkennen (zwei Schritte)
  const palm = Math.hypot((landmarks[0].x - landmarks[9].x) * W, (landmarks[0].y - landmarks[9].y) * H) || 1;
  const dist = i => Math.hypot((landmarks[4].x - landmarks[i].x) * W, (landmarks[4].y - landmarks[i].y) * H) / palm;
  const rIdx = dist(8), rPinky = dist(20);
  const now = Date.now();
  const stepBefore = pinchStep;
  if (!triggerArmed) { pinchStep = 0; idxFrames = 0; pinkyFrames = 0; }   // gesperrt: Geste zählt nicht
  if (pinchStep === 1 && now - pinchStepTime > PINCH_SEQUENCE_MS) pinchStep = 0;   // zu langsam: wieder von vorn
  if (rIdx > PINCH_OFF) idxLatched = false;
  const bothClosed = rIdx < PINCH_ON && rPinky < PINKY_ON;   // beide gleichzeitig = unklar (z. B. Hand gedreht), zählt nicht
  idxFrames = (rIdx < PINCH_ON && !bothClosed && !idxLatched) ? idxFrames + 1 : 0;
  pinkyFrames = (rPinky < PINKY_ON && rIdx > PINCH_OFF) ? pinkyFrames + 1 : 0;
  if (!triggerArmed) { /* nichts */ } else if (pinchStep === 0) {
    if (idxFrames >= PINCH_FRAMES) { pinchStep = 1; pinchStepTime = now; idxLatched = true; idxFrames = 0; }
  } else if (pinkyFrames >= PINKY_FRAMES) {
    pinchStep = 0; pinkyFrames = 0;
    if (triggerArmed && now - lastPinchTime > PINCH_COOLDOWN_MS) {
      lastPinchTime = now;
      if (pinchListener) pinchListener();
    }
  }
  const pinchText = pinchStep === 1
    ? 'step 1 done, now little finger + thumb (' + Math.max(0, Math.ceil((PINCH_SEQUENCE_MS - (now - pinchStepTime)) / 1000)) + ' s)'
    : 'step 1: index + thumb';

  handStatus((HAND_SIDE === 'right' ? 'right' : HAND_SIDE === 'left' ? 'left' : 'any') +
    ' hand, y ' + screenY(tipY).toFixed(2) + ', x ' + screenX(tipX).toFixed(2) +
    '\nindex ' + rIdx.toFixed(2) + ', little ' + rPinky.toFixed(2) + ' (closes below ' + PINCH_ON + ' / ' + PINKY_ON + ')' +
    '\n' + pinchText + '\n' + state, pinchStep !== stepBefore);
  if (handListener) handListener(screenY(tipY), screenX(tipX));
}

// Hängt das Tracking (kein Ergebnis mehr oder ein Fehler), wird MediaPipe neu aufgebaut (Watchdog).
const HAND_STALL_MS = 4000;        // so lange darf kein Ergebnis kommen, bevor neu gestartet wird
const HAND_ERRORS_BEFORE_RESTART = 3;

async function createHands() {
  const h = new Hands({ locateFile: file => MP_BASE + file });
  h.setOptions({
    maxNumHands: 2,               // 2, damit die rechte Hand gefunden wird, auch wenn die linke im Bild ist
    modelComplexity: 1,
    minDetectionConfidence: 0.5,   // niedriger = erkennt die Hand leichter (auch bei schlechterem Licht)
    minTrackingConfidence: 0.5
  });
  h.onResults(onResult);
  await h.initialize();
  return h;
}

async function startHandTracking() {
  if (typeof Hands === 'undefined') {
    handStatus('OFF: hands.js not loaded (internet? script in index.html?)', true);
    return;
  }
  try {
    handStatus('loading model (takes a while the first time)…', true);
    let hands = await createHands();
    handStatus('ready, no hand visible', true);

    let lastVideoTime = -1;
    let sending = false;
    let restarting = false;
    let errors = 0;
    let sendStart = 0;
    lastResultTime = Date.now();

    const restart = async (why) => {
      if (restarting) return;
      restarting = true;
      console.warn('hand tracking restart:', why);
      handStatus('restarting hand tracking (' + why + ')…', true);
      try { await hands.close(); } catch (e) { /* egal */ }
      try {
        hands = await createHands();
        errors = 0; sending = false; lastResultTime = Date.now();
        handStatus('ready, no hand visible', true);
      } catch (err) {
        handStatus('ERROR restarting: ' + (err && err.message || err), true);
      }
      restarting = false;
    };

    const loop = async () => {
      if (!restarting) {
        const stalled = Date.now() - lastResultTime > HAND_STALL_MS && (sending ? Date.now() - sendStart > HAND_STALL_MS : true) && video.readyState >= 2;
        if (stalled) restart('no result for ' + Math.round((Date.now() - lastResultTime) / 1000) + ' s');
        else if (!sending && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          sending = true; sendStart = Date.now();
          try { await hands.send({ image: video }); errors = 0; }
          catch (err) {
            console.error('hand.js error:', err);
            handStatus('ERROR while detecting: ' + (err && err.message || err));
            if (++errors >= HAND_ERRORS_BEFORE_RESTART) restart('errors');
          }
          sending = false;
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    handStatus('ERROR while loading: ' + (err && err.message || err), true);
  }
}

// erst starten, wenn das Kamerabild da ist
const handWait = setInterval(() => {
  if (video.videoWidth > 0 && video.readyState >= 2) {
    clearInterval(handWait);
    startHandTracking();
  }
}, 300);