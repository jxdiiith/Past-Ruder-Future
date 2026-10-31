const result = document.getElementById("text");
const SCRIPT_VERSION = "script.js v57 (P on = order only, image marks ignored)";



// ----------------------------------------
// DARSTELLUNG (aktuelle Werte)
// ----------------------------------------

const FONTS = {
    normal: '"HGKBRuderPlakatLLVar", monospace',
    kontur: '"HGKBRuderKonturLLVIP", monospace'
};

const style = {
    fontSize: 10,     // in vw (Standardgrösse der Antwort)
    YTUC: 100,         // » Grossbuchstaben-Höhe
    YTLC: 100,         // « x-Höhe (Kleinbuchstaben)
    YTDE: 100,         // ,  Unterlängen
    font: "normal",    // 1  "normal" oder "kontur"
    textCase: "none"   // !  "uppercase" / ?  "lowercase" / sonst "none"
};

let lastAnswer = "";   // letzte AI-Antwort (für das Grid)

const FONT_BONUS_PT = 3;    // wird zu jeder Schriftgrösse addiert (in pt)
const FONT_SIZE_MIN = 3;    // kleinste Schriftgrösse in vw
const FONT_SIZE_MAX = 15;   // grösste Schriftgrösse in vw

// zufälliger ganzzahliger Wert zwischen min und max
function randomBetween(min, max) {
    return Math.round(min + Math.random() * (max - min));
}

// ----------------------------------------
// TEXT FÜLLT DIE FLÄCHE
// Jedes Wort steht in einer eigenen Zeile und wird so gross wie möglich (so breit wie die Fläche).
// Wird es insgesamt zu hoch, werden alle Zeilen gemeinsam verkleinert. Im #-Grid gilt das nicht.
// ----------------------------------------

const FIT_ON = true;            // false = wie vorher (feste Schriftgrösse)
const FIT_UNIFORM = true;       // true = alle Wörter gleich gross (so gross wie das längste Wort erlaubt), false = jedes Wort so breit wie möglich
const FIT_LINE_HEIGHT = 0.85;   // Zeilenabstand (1 = normal, kleiner = enger)
const FIT_GROW = 0.5;           // Zeilenabstand wächst mit der Schrifthöhe (YTUC), damit sich Zeilen bei grossem Schnitt nicht überlappen (0 = aus)
const FIT_PAD_X = 24;           // Rand links/rechts in px
const FIT_MARGIN_Y = 40;        // Rand oben/unten in px

const contentEl = document.querySelector(".content");
const ALIGN_EASE = 0.03;        // Übergang links/mitte/rechts: kleiner = langsamer und weicher
let alignCur = 0.5;             // aktuelle Position 0 = links, 0.5 = Mitte, 1 = rechts
let alignTarget = 0.5;
let alignRaf = 0;
let textAlignMode = "center";   // "left" | "center" | "right" (mit der Hand steuerbar)
let fitLines = null;            // null = gerade nichts anzupassen (Ladescreen, Fehler)
let lastFitTime = 0;

// ----------------------------------------
// !-ANSICHT (früher +): VIER Wörter in GROSSBUCHSTABEN als Raster mit vier Zeilen.
// Jeder Buchstabe steht einzeln in seiner Zelle. Die Typografie wird NICHT verzerrt:
// der Effekt entsteht nur über die Schriftschnitte (Achsen YTUC/YTLC/YTDE) jedes einzelnen Buchstabens.
// Die Buchstaben der Wörter stehen spaltenweise übereinander. In jeder Spalte wechseln sich hohe und flache Schnitte ab
// (Zeile 1 hoch, Zeile 2 flach, Zeile 3 hoch, Zeile 4 flach, und umgekehrt; je zwei Zeilen ergeben zusammen 1000).
// Dadurch bleibt die Spaltenhöhe immer gleich, und die hohen Buchstaben "drücken" die flachen nach unten.
// Jedes Wort, das kürzer als das längste ist, steht zufällig links oder rechts im Raster.
// Hand y (hoch/runter): Schnitt der ersten Zeile (oben im Bild = flach, unten = hoch).
// Hand x (links/rechts): Versatz zwischen den Spalten (Mitte = alle Spalten gleich, links/rechts = Treppe in die jeweilige Richtung;
//         die Richtung ist pro Antwort zufällig, gleiche Zufallslogik wie sonst).
// Ohne erkannte Hand läuft eine Animation (Schnitt und Versatz pendeln langsam hin und her). Zeigt sich die Hand,
// bleibt der Zustand stehen, bis sie sich bewegt.
// ----------------------------------------

const EXCL_WORDS = 4;            // so viele Wörter (= Zeilen) hat die !-Ansicht
const EXCL_SHARE_MIN = 0;        // Schnitt der ersten Zeile bei Hand ganz oben (0 = flachster Schnitt 100, 1 = höchster Schnitt 900)
const EXCL_SHARE_MAX = 1;        // Schnitt der ersten Zeile bei Hand ganz unten
const EXCL_SPREAD = 1;           // Stärke des Versatzes zwischen den Spalten bei Hand ganz links/rechts (1 = über das ganze Raster der volle Schnittbereich)
const EXCL_PAD_X = 14;           // Rand links/rechts der !-Ansicht in px (kleiner = das Raster füllt das Quadrat mehr)
const EXCL_MARGIN_Y = 14;        // Rand oben/unten der !-Ansicht in px
const EXCL_GAP = 0.02;           // Abstand zwischen den Zeilen (Anteil der Höhe)
const EXCL_COL_GAP = 0.01;       // Abstand zwischen den Spalten (Anteil der Schriftgrösse)
// Hand y = Schnitt der ersten Zeile (oben/unten im Bild), Hand x = Versatz zwischen den Spalten (links/rechts im Bild)
const EXCL_Y_MIN = 0.15;         // Hand y, bei der der Schnitt der ersten Zeile am kleinsten ist (oben)
const EXCL_Y_MAX = 0.85;         // Hand y, bei der der Schnitt der ersten Zeile am grössten ist (unten)
const EXCL_Y_MIRROR = false;     // true = y umdrehen (oben <-> unten)
const EXCL_EASE = 0.12;          // Bewegung gleitet: kleiner = weicher
const EXCL_IDLE_AFTER_MS = 600;  // so lange ohne erkannte Hand, dann läuft die Animation
const EXCL_IDLE_PERIOD_BASE_MS = 6000;   // Dauer eines Hin und Her beim Schnitt der ersten Zeile (Animation ohne Hand)
const EXCL_IDLE_PERIOD_DIR_MS = 9500;    // Dauer eines Hin und Her beim Versatz (Animation ohne Hand; anders lang, damit das Bild nie gleich aussieht)
const EXCL_AXIS = 100;           // Grundwert der Fläche (die Buchstaben setzen ihren Schnitt selbst)
// Masse der Ruder Plakat für Grossbuchstaben (in em, gemessen), Achse a von 100 bis 900:
const EXCL_H0 = 0.705, EXCL_HR = 0.44;     // Buchstabenhöhe = H0 + HR * u   (u = 0 ... 1)
const EXCL_TOP0 = 0.145, EXCL_TOPR = -0.30; // Oberkante in der Zeile = TOP0 + TOPR * u
// (die Grundlinie wandert mit dem Schnitt mit, deshalb wird jeder Buchstabe nach Ober- und Unterkante einzeln gesetzt)

let exclMode = false;            // true = die aktuelle Antwort ist eine !-Antwort
let exclSides = [];              // pro Zeile "left" | "right": wo ein kürzeres Wort im Raster steht, bei jeder !-Antwort zufällig
let exclRaf = 0;
let exclCells = null;            // [{ span, row, col, adv, axis }]  adv = Laufweite bei 100 px Schrift
let exclCols = 0;
let exclRows = 0;
let exclGeo = null;              // { s, availW, availH, colX[], colW[], gridTop, gridLeft }
let exclBaseCur = 0.5, exclBaseTarget = 0.5;   // Schnitt der ersten Zeile 0 (flach) ... 1 (hoch), geglättet
let exclDirCur = 0, exclDirTarget = 0;         // Versatz -1 ... +1, geglättet
const EXCL_HOLD_MOVE = 0.05;     // so weit muss sich die Hand bewegen, bevor sie den aktuellen Zustand übernimmt (kein Sprung beim Auftauchen)
let exclHold = true;
let exclHoldFrom = null;         // { x, y }
let exclPhase1 = 0, exclPhase2 = 0;
let lastHandTime = 0;            // wann zuletzt eine Hand erkannt wurde

function stopExcl() {
    if (exclRaf) cancelAnimationFrame(exclRaf);
    exclRaf = 0;
    exclCells = null;
    exclGeo = null;
    result.style.position = "";
    result.style.height = "";
}

function exclLayout() {
    if (!exclCells || !result.offsetParent) return;
    result.style.paddingLeft = result.style.paddingRight = EXCL_PAD_X + "px";
    const availW = result.clientWidth - 2 * EXCL_PAD_X;
    const availH = (contentEl ? contentEl.clientHeight : window.innerHeight) - 2 * EXCL_MARGIN_Y;
    if (availW <= 0 || availH <= 0) return;
    result.style.height = availH + "px";
    // Spaltenbreite = breitester Buchstabe der Spalte (natürliche Breite, nichts wird gestreckt)
    const natural = [];
    for (let c = 0; c < exclCols; c++) natural.push(Math.max(1, ...exclCells.filter(k => k.col === c).map(k => k.adv)) / 100);   // in em
    const gapH = EXCL_GAP * availH;
    const sumU = Math.ceil(exclRows / 2);                                                   // Summe der Schnitt-Werte u aller Zeilen einer Spalte (bei 4 Zeilen immer 2)
    const colEm = exclRows * EXCL_H0 + EXCL_HR * sumU;                                      // Höhe einer Spalte in em
    const sH = (availH - gapH * (exclRows - 1)) / colEm;                                   // Schriftgrösse, bei der die Spalte die ganze Höhe füllt
    const sW = availW / (natural.reduce((a, b) => a + b, 0) + EXCL_COL_GAP * (exclCols - 1));   // Schriftgrösse, bei der die Zeile die ganze Breite füllt
    const s = Math.min(sH, sW);
    const colW = natural.map(n => n * s);
    const colX = [];
    let x = 0;
    colW.forEach(w => { colX.push(x); x += w + EXCL_COL_GAP * s; });
    const gridW = x - EXCL_COL_GAP * s;
    const gridH = s * colEm + gapH * (exclRows - 1);
    exclCells.forEach(k => { k.span.style.fontSize = s + "px"; });
    exclGeo = { s: s, availW: availW, availH: availH, colX: colX, colW: colW, gap: gapH,
        gridLeft: EXCL_PAD_X + (availW - gridW) / 2, gridTop: (availH - gridH) / 2 };
}

function exclFrame() {
    exclRaf = 0;
    if (!exclCells) return;
    if (!exclGeo) exclLayout();
    if (exclGeo) {
        const { s, colX, colW, gap, gridLeft, gridTop } = exclGeo;
        const now = performance.now();
        if (now - lastHandTime > EXCL_IDLE_AFTER_MS) {
            // keine Hand erkannt: Animation. Beim Zurückkommen der Hand bleibt der Zustand stehen, bis sie sich bewegt.
            exclBaseTarget = 0.5 + 0.5 * Math.sin(exclPhase1 + now * 2 * Math.PI / EXCL_IDLE_PERIOD_BASE_MS);
            exclDirTarget = Math.sin(exclPhase2 + now * 2 * Math.PI / EXCL_IDLE_PERIOD_DIR_MS);
            exclHold = true;
            exclHoldFrom = null;
        }
        exclBaseCur += (exclBaseTarget - exclBaseCur) * EXCL_EASE;
        exclDirCur += (exclDirTarget - exclDirCur) * EXCL_EASE;
        const base = EXCL_SHARE_MIN + (EXCL_SHARE_MAX - EXCL_SHARE_MIN) * exclBaseCur;   // Schnitt der ersten Zeile (0 = flach ... 1 = hoch)
        const dir = exclDirCur;   // -1 ... +1
        const C = exclCols;
        for (let c = 0; c < C; c++) {
            let u = base + dir * EXCL_SPREAD * (C > 1 ? c / (C - 1) - 0.5 : 0);   // Schnitt der ersten Zeile in dieser Spalte, Treppe über die Spalten
            u = Math.min(1, Math.max(0, u));
            // Zeile 0, 2, ... haben den Schnitt u, Zeile 1, 3, ... das Gegenteil (1 - u): die Spaltenhöhe bleibt gleich.
            // Die Zeilen sitzen auch dann an ihrem festen Platz, wenn in dieser Spalte ein Wort schon zu Ende ist.
            let y = 0;
            for (let r = 0; r < exclRows; r++) {
                const uu = r % 2 === 0 ? u : 1 - u;
                const k = exclCells.find(q => q.col === c && q.row === r);
                if (k) {
                    const axis = Math.round(100 + 800 * uu);
                    if (k.axis !== axis) {
                        k.axis = axis;
                        k.span.style.fontVariationSettings = "'YTUC' " + axis + ", 'YTLC' " + axis + ", 'YTDE' " + axis;
                    }
                    k.span.style.left = (gridLeft + colX[c] + (colW[c] - k.adv / 100 * s) / 2) + "px";   // Buchstabe mittig in der Spalte
                    k.span.style.top = (gridTop + y - (EXCL_TOP0 + EXCL_TOPR * uu) * s) + "px";            // Oberkante des Buchstabens auf y
                }
                y += (EXCL_H0 + EXCL_HR * uu) * s + gap;
            }
        }
    }
    exclRaf = requestAnimationFrame(exclFrame);
}

// Hand in der !-Ansicht: y bestimmt den Schnitt der ersten Zeile, x den Versatz zwischen den Spalten
function exclHandInput(y, x) {
    if (x == null) return;
    if (exclHold) {   // der aktuelle Zustand bleibt, bis sich die Hand wirklich bewegt (kein Sprung)
        if (!exclHoldFrom) exclHoldFrom = { x: x, y: y };
        if (Math.abs(x - exclHoldFrom.x) < EXCL_HOLD_MOVE && Math.abs(y - exclHoldFrom.y) < EXCL_HOLD_MOVE) return;
        exclHold = false;
    }
    exclBaseTarget = Math.min(1, Math.max(0, ((EXCL_Y_MIRROR ? 1 - y : y) - EXCL_Y_MIN) / (EXCL_Y_MAX - EXCL_Y_MIN)));
    let t = Math.min(1, Math.max(0, 0.5 + (handT(x) - 0.5) * HAND_GAIN));   // gleiche Logik wie sonst, jetzt mit x
    if (handInvert) t = 1 - t;                                              // Richtung zufällig pro Antwort
    exclDirTarget = (t - 0.5) * 2;
}

function showExcl(text) {
    const words = String(text || "").split(/\s+/).filter(Boolean).slice(0, EXCL_WORDS);
    stopExcl();
    fitLines = null;
    if (words.length === 0) { result.textContent = text || ""; return; }
    // jedes kürzere Wort steht zufällig links oder rechts im Raster
    exclSides = words.map(() => Math.random() < 0.5 ? "left" : "right");
    // zufälliger Start: Schnitt der ersten Zeile und Versatz beginnen irgendwo, die Animation läuft von dort aus weiter
    exclPhase1 = Math.random() * 2 * Math.PI;
    exclPhase2 = Math.random() * 2 * Math.PI;
    const t0 = performance.now();
    exclBaseCur = exclBaseTarget = 0.5 + 0.5 * Math.sin(exclPhase1 + t0 * 2 * Math.PI / EXCL_IDLE_PERIOD_BASE_MS);
    exclDirCur = exclDirTarget = Math.sin(exclPhase2 + t0 * 2 * Math.PI / EXCL_IDLE_PERIOD_DIR_MS);
    exclHold = true;
    exclHoldFrom = null;
    const letters = words.map(w => Array.from(w.toUpperCase()));
    exclCols = Math.max(...letters.map(l => l.length));
    exclRows = letters.length;
    result.textContent = "";
    result.style.position = "relative";
    exclCells = [];
    letters.forEach((list, row) => {
        const offset = exclSides[row] === "right" ? exclCols - list.length : 0;
        list.forEach((ch, i) => {
            const span = document.createElement("span");
            span.textContent = ch;
            span.style.cssText = "position:absolute;left:0;top:0;white-space:pre;line-height:1;font-size:100px;";
            result.appendChild(span);
            exclCells.push({ span: span, row: row, col: offset + i, adv: 1, axis: -1 });
        });
    });
    renderStyle();   // Schriftart der Fläche
    exclCells.forEach(k => { k.adv = k.span.getBoundingClientRect().width || 1; });   // Laufweite bei 100 px (ändert sich mit den Achsen nicht)
    exclLayout();
    exclRaf = requestAnimationFrame(exclFrame);
}

window.addEventListener("resize", () => { if (exclCells) exclLayout(); });

function showFitted(text) {
    if (exclMode) { showExcl(text); return; }
    stopExcl();
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!FIT_ON || words.length === 0) {
        result.textContent = text || "";
        fitLines = null;
        return;
    }
    result.textContent = "";
    fitLines = words.map(word => {
        const line = document.createElement("div");
        line.style.cssText = "display:block;white-space:nowrap;font-size:100px;line-height:" + FIT_LINE_HEIGHT + ";text-align:left;";
        const span = document.createElement("span");
        span.textContent = word;
        span.style.display = "inline-block";
        line.appendChild(span);
        result.appendChild(line);
        return { line: line, span: span };
    });
    fitNow(true);
}

function currentLineHeight() {
    const t = Math.max(0, Math.min(1, (style.YTUC - 100) / 800));
    return FIT_LINE_HEIGHT * (1 + FIT_GROW * t);
}

let fitRaf = 0;

function fitNow(force) {
    if (force) { fitRaf = 0; fitRun(); return; }
    if (fitRaf) return;                               // pro Bild höchstens einmal rechnen
    fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitRun(); });
}

function fitRun() {
    if (!fitLines || !result.offsetParent) return;   // versteckt (z. B. Grid) -> nichts messen

    result.style.paddingLeft = result.style.paddingRight = FIT_PAD_X + "px";
    const availW = result.clientWidth - 2 * FIT_PAD_X;
    const availH = (contentEl ? contentEl.clientHeight : window.innerHeight) - 2 * FIT_MARGIN_Y;
    if (availW <= 0 || availH <= 0) return;

    // Breite wächst linear mit der Schriftgrösse: erst alle Werte lesen, dann schreiben (ein Layout pro Bild, kein Ruckeln)
    const curSizes = fitLines.map(l => parseFloat(l.line.style.fontSize) || 100);
    const along = availW;     // Richtung des Wortes
    const across = availH;    // Richtung, in der die Wörter gestapelt sind
    const widths = fitLines.map(l => l.span.getBoundingClientRect().width || 1);
    let sizes = widths.map((w, i) => curSizes[i] * along / w);
    if (FIT_UNIFORM) {
        const smallest = Math.min(...sizes);
        sizes = sizes.map(() => smallest);
    }
    const lh = currentLineHeight();
    const totalH = sizes.reduce((sum, s) => sum + s * lh, 0);
    const scale = totalH > across ? across / totalH : 1;
    const newW = [];
    fitLines.forEach((l, i) => {
        l.line.style.fontSize = (sizes[i] * scale) + "px";
        l.line.style.lineHeight = lh;
        newW.push(widths[i] * sizes[i] * scale / curSizes[i]);
    });
    applyAlign(newW);
}

function applyAlign(widths) {
    if (!fitLines) return;
    const availW = result.clientWidth - 2 * FIT_PAD_X;
    fitLines.forEach((l, i) => {
        const w = widths ? widths[i] : l.span.getBoundingClientRect().width;
        l.span.style.transform = "translateX(" + (alignCur * (availW - w)) + "px)";
    });
}

function alignStep() {
    alignRaf = 0;
    alignCur += (alignTarget - alignCur) * ALIGN_EASE;
    if (Math.abs(alignTarget - alignCur) < 0.002) alignCur = alignTarget;
    applyAlign();
    if (alignCur !== alignTarget) alignRaf = requestAnimationFrame(alignStep);
}

window.addEventListener("resize", () => fitNow(true));

// Ausrichtung mit der Hand (Hand y): Hand oben im Kamerabild = linksbündig, Mitte = zentriert, unten = rechtsbündig
const HAND_ALIGN = true;         // false = Ausrichtung nicht mit der Hand steuern
const HAND_MIRROR_ALIGN = false; // true = die Richtung umdrehen (Hand oben = rechtsbündig)
const HAND_ALIGN_LOW = 0.4;      // Hand höher als 40 % der Bildhöhe -> linksbündig
const HAND_ALIGN_HIGH = 0.6;     // Hand tiefer als 60 % -> rechtsbündig
const HAND_ALIGN_HYST = 0.03;    // verhindert Flackern an den Grenzen

function setAlignFromY(y) {
    if (!HAND_ALIGN || y == null) return;
    if (HAND_MIRROR_ALIGN) y = 1 - y;
    let next = textAlignMode;
    if (textAlignMode === "left") {
        if (y > HAND_ALIGN_LOW + HAND_ALIGN_HYST) next = y > HAND_ALIGN_HIGH ? "right" : "center";
    } else if (textAlignMode === "right") {
        if (y < HAND_ALIGN_HIGH - HAND_ALIGN_HYST) next = y < HAND_ALIGN_LOW ? "left" : "center";
    } else if (y < HAND_ALIGN_LOW - HAND_ALIGN_HYST) {
        next = "left";
    } else if (y > HAND_ALIGN_HIGH + HAND_ALIGN_HYST) {
        next = "right";
    }
    if (next === textAlignMode) return;
    textAlignMode = next;
    alignTarget = next === "left" ? 0 : next === "right" ? 1 : 0.5;
    if (!alignRaf) alignRaf = requestAnimationFrame(alignStep);
}


function renderStyle() {
    result.style.fontSize = `calc(${style.fontSize}vw + ${FONT_BONUS_PT}pt)`;
    result.style.fontFamily = FONTS[style.font];
    result.style.textTransform = style.textCase;
    result.style.fontVariationSettings = exclMode
        ? `'YTUC' ${EXCL_AXIS}, 'YTLC' ${EXCL_AXIS}, 'YTDE' ${EXCL_AXIS}`
        : `'YTUC' ${style.YTUC}, 'YTLC' ${style.YTLC}, 'YTDE' ${style.YTDE}`;

    // Grid läuft live mit (gridVisible und updateMetrics kommen aus metrics.js)
    if (gridVisible) updateMetrics(style.YTUC, style.YTLC, style.YTDE);

    fitNow();   // Schrift neu einpassen (Achsen können die Breite ändern)
}


// ----------------------------------------
// HAND-STEUERUNG
// Hand x (links/rechts im Bild) = Schriftschnitt, Hand y (oben/unten) = Ausrichtung links/Mitte/rechts.
// Welche Richtung "gross" ist, wird bei jeder Antwort zufällig gewählt (siehe unten).
// ----------------------------------------

const HAND_TARGET = "axes";   // "axes" = YTUC/YTLC/YTDE (100-900), "size" = Schriftgrösse
const HAND_AUTO_RANGE = false;// true = lernt selbst, in welchem Bereich du die Hand bewegst, und nutzt dafür den GANZEN Schriftbereich
const HAND_RANGE_LOW = 0.15;  // Hand x, bei der der Schnitt am KLEINSTEN ist (0 = linker Bildrand)
const HAND_RANGE_HIGH = 0.85; // Hand x, bei der der Schnitt am GRÖSSTEN ist (1 = rechter Bildrand)
const HAND_RANGE_MIN_SPAN = 0.2;  // kleinster Bereich (Anteil der Bildbreite), damit kleines Zittern nicht alles verändert
const HAND_RANGE_DECAY = 0.003;   // wie schnell der gelernte Bereich wieder schrumpft (pro Bild; grösser = schneller)
const HAND_EDGE = 0.03;           // die äussersten 3 % des Bereichs gelten schon als ganz gross / ganz klein
const HAND_GAIN = 1;              // Verstärkung um die Mitte (1 = keine; die Randzonen werden jetzt über HAND_X_ZONE eingestellt)
const HAND_EASE = 0.5;            // 1 = sofort, kleiner = weicher

// Zufällige Logik des Schriftschnitts: bei jeder neuen Antwort beginnt die Schrift klein ODER gross,
// und die Hand verstärkt oder verkleinert sie in zufälliger Richtung (Hand rechts = gross oder Hand rechts = klein).
const HAND_RANDOMIZE = true;      // false = immer gleiche Logik (Hand rechts = gross), Start unverändert
const START_SMALL_MAX = 300;      // kleiner Start: Achsenwert zwischen 100 und diesem Wert
const START_LARGE_MIN = 700;      // grosser Start: Achsenwert zwischen diesem Wert und 900
const HAND_HOLD_MOVE = 0.05;      // so weit (Anteil der Bildbreite) muss sich die Hand bewegen, bevor sie den Startwert verändert
let handInvert = false;           // true = Hand rechts = klein
let handHold = false;             // true = Startwert bleibt stehen, bis die Hand sich bewegt
let handHoldX = null;

function randomizeHandLogic() {
    if (!HAND_RANDOMIZE) return;
    const startLarge = Math.random() < 0.5;
    handInvert = Math.random() < 0.5;
    const v = startLarge ? randomBetween(START_LARGE_MIN, 900) : randomBetween(100, START_SMALL_MAX);
    style.YTUC = style.YTLC = style.YTDE = v;
    handHold = true;
    handHoldX = null;
    // die Animation ohne Hand setzt genau bei diesem Startwert an (kein Sprung)
    idlePhase1 = Math.asin(Math.max(-1, Math.min(1, 2 * ((v - 100) / 800) - 1))) - performance.now() * 2 * Math.PI / IDLE_PERIOD_BASE_MS;
    idlePhase2 = Math.random() * 2 * Math.PI;
    renderStyle();
}

let handRangeMin = 0.35, handRangeMax = 0.65;   // Startbereich, wächst mit deiner Bewegung
let lastRangeShown = 0;

// Hand x -> Wert t (0 = klein ... 1 = gross), symmetrisch von beiden Rändern aus:
// ganz links (x = 0) bis HAND_X_ZONE (x = 0.5) läuft t von 0 bis 1, ganz rechts (x = 1) bis 0.5 ebenso (1 -> 0.5 entspricht 0 -> 0.5).
// Bei 0.5 ist die Mitte der Höhepunkt (t = 1), links und rechts davon läuft es gleichmässig auf 0 zu. Kleinere Werte (0.1) = schmale Randzonen, dazwischen bleibt t bei 1. Ändere HAND_X_ZONE, um die Randzonen breiter/schmaler zu machen.
const HAND_X_ZONE = 0.5;
function handT(v) {   // v = Hand x (0 = links ... 1 = rechts)
    const edge = Math.min(v, 1 - v);   // Abstand zum nächsten Rand: 0 am Rand, 0.5 in der Mitte
    return Math.min(1, Math.max(0, edge / HAND_X_ZONE));
}

const HAND_START_ON = true;   // true = die Hand steuert von Anfang an
let handActive = HAND_START_ON;

if (typeof onHandMove === "function") {   // kommt aus hand.js
    onHandMove((y, x) => {
        if (typeof y === "number") lastHandTime = performance.now();
        if (!handActive || y == null || x == null) return;
        if (exclMode) { exclHandInput(y, x); return; }
        setAlignFromY(y);
        if (handHold) {   // Startwert bleibt, bis sich die Hand wirklich bewegt
            if (handHoldX == null) handHoldX = x;
            if (Math.abs(x - handHoldX) < HAND_HOLD_MOVE) return;
            handHold = false;
        }
        let t = Math.min(1, Math.max(0, 0.5 + (handT(x) - 0.5) * HAND_GAIN));
        if (handInvert) t = 1 - t;
        if (HAND_TARGET === "size") {
            const goal = FONT_SIZE_MIN + t * (FONT_SIZE_MAX - FONT_SIZE_MIN);
            style.fontSize += (goal - style.fontSize) * HAND_EASE;
        } else {
            const goal = 100 + t * 800;
            ["YTUC", "YTLC", "YTDE"].forEach(axis => { style[axis] += (goal - style[axis]) * HAND_EASE; });
        }
        renderStyle();
    });
}


// ----------------------------------------
// ANIMATION OHNE HAND (? und #)
// Wird keine Hand erkannt, bewegt sich die Ansicht von allein, etwas langsamer als bei !:
// der Schriftschnitt pendelt (Dauer IDLE_PERIOD_BASE_MS), und im ?-Text wandert zusätzlich die Ausrichtung links - Mitte - rechts
// (Dauer IDLE_PERIOD_DIR_MS). Beim # läuft der Schriftschnitt des Einzelbuchstabens mit dem Grid.
// Zeigt sich die Hand, bleibt der Zustand stehen, bis sie sich bewegt (wie sonst beim Start einer Antwort).
// ----------------------------------------

const IDLE_PERIOD_BASE_MS = 16000;   // Dauer eines Hin und Her beim Schriftschnitt (grösser = langsamer; bei ! sind es 6000; vorher hier 10000)
const IDLE_PERIOD_DIR_MS = 24000;    // Dauer eines Hin und Her bei der Ausrichtung (bei ! sind es 9500; vorher hier 15000)
const IDLE_ANIM = true;          // false = ohne Hand bleibt die Ansicht stehen
let idlePhase1 = 0;              // Startpunkt der Schnitt-Bewegung (wird bei jeder Antwort so gesetzt, dass es nahtlos weitergeht)
let idlePhase2 = Math.random() * 2 * Math.PI;   // Startpunkt der Ausrichtungs-Bewegung

function idleTick() {
    requestAnimationFrame(idleTick);
    if (!IDLE_ANIM || !handActive || exclMode || !(fitLines || gridVisible)) return;   // nur wenn eine Antwort zu sehen ist (nicht beim Ladescreen) und nicht bei !
    const now = performance.now();
    if (now - lastHandTime <= EXCL_IDLE_AFTER_MS) return;                             // Hand ist da: sie steuert
    handHold = true;     // taucht die Hand wieder auf, bleibt der Zustand stehen, bis sie sich bewegt
    handHoldX = null;
    const u = 0.5 + 0.5 * Math.sin(idlePhase1 + now * 2 * Math.PI / IDLE_PERIOD_BASE_MS);
    style.YTUC = style.YTLC = style.YTDE = 100 + 800 * u;
    if (!gridVisible) {
        alignTarget = 0.5 + 0.5 * Math.sin(idlePhase2 + now * 2 * Math.PI / IDLE_PERIOD_DIR_MS);
        textAlignMode = alignTarget < 0.33 ? "left" : alignTarget > 0.67 ? "right" : "center";
        if (!alignRaf) alignRaf = requestAnimationFrame(alignStep);
    }
    renderStyle();
}
requestAnimationFrame(idleTick);


// ----------------------------------------
// BEFEHLE
// ----------------------------------------

// Sätze im Ladescreen: sie werden gesprochen, sobald der Ladescreen beginnt (also direkt beim Pinch). Welcher Eröffnungssatz kommt, ist noch offen,
// weil das Zeichen erst nach dem Lesen des Fotos feststeht: es kommen der Reihe nach alle drei dran (zufälliger Start, nie zweimal derselbe hintereinander).
// Dauert das Laden länger, folgen danach die Weiter-Sätze (LOADING_FOLLOWUPS), einer nach dem anderen, bis die Antwort da ist.
// Die Antwort erscheint erst, wenn der gerade laufende Satz zu Ende ist.
const QUESTION_PHRASES = [
    "Interesting question.",
    "I think I've never really thought about that.",
    "Let me quickly think about that."
];
// Weiter-Sätze, je Ansicht andere. Welche Ansicht gilt, steht fest, sobald Gemini das Zeichen vom Blatt gelesen hat (loadingSymbol).
// Solange das noch nicht bekannt ist, wird das Zeichen genommen, das als Nächstes in der Reihenfolge dran wäre.
const LOADING_FOLLOWUPS = {
    "#": ["Let me take a closer look at the letters.", "Every letter counts. Give me a second.", "Almost there. Just one more letter to check."],
    "!": ["Give me a moment, this one needs a little more thought.", "Still thinking. It is not an easy question.", "Finding the right four words takes a little time."],
    "?": ["Let me look at this from a different angle.", "Hmm, that is a tricky one.", "Almost there. Just one more moment."]
};
let loadingSymbol = null;   // Zeichen der aktuellen Frage, sobald bekannt (sonst null)
let loadingQuestion = "";   // gelesene Frage, sobald Gemini das Foto gelesen hat (sonst leer)
const QUESTION_MAX_CHARS = 140;   // längere Fragen werden fürs Wiederholen gekürzt
let phraseIndex = Math.floor(Math.random() * QUESTION_PHRASES.length);
let loadingRun = 0;         // erkennt veraltete Ladescreens (neuer Pinch)
let loadingOver = false;    // true, sobald die Antwort da ist: danach kommt kein weiterer Satz mehr

function speakLoadingPhrase() {
    const run = ++loadingRun;
    loadingOver = false;
    loadingSymbol = null;
    loadingQuestion = "";
    phraseIndex = (phraseIndex + 1) % QUESTION_PHRASES.length;
    return (async () => {
        await speakAndWait(QUESTION_PHRASES[phraseIndex]);
        const guess = pickNextSymbol();   // falls das Zeichen beim ersten Weiter-Satz noch nicht bekannt ist
        let questionSpoken = false;
        for (let i = 0; i < 3; ) {
            if (loadingOver || run !== loadingRun) return;   // Antwort ist da oder ein neuer Pinch hat begonnen
            await sleep(400);                                // kurze Pause zwischen den Sätzen
            if (loadingOver || run !== loadingRun) return;
            // Dauert es nach dem Lesen des Fotos noch: einmal die gelesene Frage wiederholen, danach geht es mit den Weiter-Sätzen weiter
            if (loadingQuestion && !questionSpoken) {
                questionSpoken = true;
                await speakAndWait("So your question was: " + loadingQuestion);
                continue;
            }
            const list = LOADING_FOLLOWUPS[loadingSymbol || guess] || LOADING_FOLLOWUPS["?"];   // bei jedem Satz neu: das Zeichen kann inzwischen bekannt sein
            await speakAndWait(list[i % list.length]);
            i++;
        }
    })();   // Promise: fertig, wenn der letzte Satz zu Ende ist
}

// Beim # wird zuerst die Antwort gelesen, danach "and so <is/does/...> this letter" (das Grid mit dem Einzelbuchstaben ist dann schon zu sehen).
// Das passende Hilfswort wählt Gemini mit der Antwort mit (letter_verb), zum Beispiel "Time heals" -> "does", "Silence is cold" -> "is".
// Erlaubte Wörter für "And so ___ this letter." (Gemini schlägt eines vor, refineLetterVerb prüft es gegen die Antwort)
const LETTER_VERBS = ["is", "isn't", "was", "wasn't", "does", "doesn't", "did", "didn't", "can", "can't", "will", "won't",
    "has", "hasn't", "could", "couldn't", "would", "wouldn't", "should", "shouldn't"];
const LETTER_NEGATIVE = { "is": "isn't", "was": "wasn't", "does": "doesn't", "did": "didn't", "can": "can't", "will": "won't",
    "has": "hasn't", "could": "couldn't", "would": "wouldn't", "should": "shouldn't" };
let letterVerb = "is";   // Hilfswort für die aktuelle Antwort (von Gemini)

function cleanLetterVerb(v) {
    const w = String(v || "").trim().toLowerCase().replace(/[’`]/g, "'");
    return LETTER_VERBS.includes(w) ? w : "is";
}

// Prüft das Hilfswort anhand der Antwort selbst, damit auch Verneinungen und Zeiten stimmen:
//  1) steht in der Antwort ein Hilfsverb (am/is/are, was/were, can, will, could, would, should, has/have, did, do/does), gilt dessen Form
//     (zum Beispiel "I am not" -> is, "Light was bright" -> was), sonst bleibt der Vorschlag von Gemini;
//  2) ist die Antwort verneint (not, n't, never, no, nothing, nobody, none, nowhere, neither, nor, cannot), kommt die verneinte Form
//     ("I am not" -> "And so isn't this letter."). Hat Gemini selbst schon eine verneinte Form gewählt (zum Beispiel bei "No."), bleibt sie.
const AUX_PATTERNS = [
    [/\b(?:can't|cannot|can)\b/, "can"], [/\b(?:won't|will)\b|'ll\b/, "will"], [/\b(?:couldn't|could)\b/, "could"],
    [/\b(?:wouldn't|would)\b/, "would"], [/\b(?:shouldn't|should)\b/, "should"], [/\b(?:wasn't|weren't|was|were)\b/, "was"],
    [/\b(?:isn't|aren't|ain't|is|are|am)\b|'m\b|'re\b/, "is"], [/\b(?:hasn't|haven't|has|have)\b/, "has"],
    [/\b(?:didn't|did)\b/, "did"], [/\b(?:doesn't|don't|does|do)\b/, "does"]
];
const NEGATION_PATTERN = /\b(?:not|never|no|nothing|nobody|none|nowhere|neither|nor|cannot)\b|n't\b/;

// Steht kein Hilfsverb in der Antwort (zum Beispiel "All stars die!"), sucht refineLetterVerb ein gewöhnliches Verb. Findet es eines, heisst es "does"
// (oder "did" bei der Vergangenheit), egal was Gemini vorgeschlagen hat. Findet es keines (Adjektiv, Nomen-Gruppe wie "Gone forever"), bleibt der Vorschlag.
const VERB_BASES = new Set(("die burn fade stay fall rise end grow break rot vanish heal erase claim keep hold take make turn run go come stand need want know see find " +
    "lose leave live exist remain wait pass move change shine glow melt freeze drown sink float drift bleed cry sleep wake dream think speak say tell ask answer " +
    "begin start stop open close hide seek give bring carry build destroy create repeat return collapse decay expire forget remember matter count work fail win " +
    "rain snow shake fly swim walk talk listen watch read write draw print erase wash drop drip flow spread cover fill empty swallow eat drink feed hunt chase " +
    "follow lead rule rest ring sing shout whisper laugh smile hurt love hate fear trust lie lock unlock cut tear sew mend repair clean wipe vanish appear " +
    "arrive depart gather collect scatter divide join split bind free hang lift push pull throw catch hit kick sell buy pay owe cost save spend waste " +
    "learn teach grow shrink expand reach touch feel taste smell sound look seem become belong deserve choose decide refuse accept allow forbid prevent " +
    "cause bring offer promise protect guard fight kill murder bury plant harvest feed starve thrive survive perish drown crash explode burst pop sparkle").split(" "));
const IRREGULAR_PAST = new Set("fell rose grew broke took made went came stood knew saw found lost left kept held ran began gave brought built forgot sank spoke said told wrote drew threw caught sold bought paid slept woke flew swam ate drank hid fought died".split(" "));

function findVerb(text) {   // gibt "does", "did" oder null zurück
    const words = text.replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    for (const w of words) {
        if (IRREGULAR_PAST.has(w)) return "did";
        const stems = [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/ed$/, ""), w.replace(/d$/, ""), w.replace(/ied$/, "y"), w.replace(/ing$/, ""), w.replace(/ing$/, "e")];
        if (stems.some(x => x.length > 1 && VERB_BASES.has(x))) return /(?:ed|ied)$/.test(w) ? "did" : "does";
    }
    return null;
}

function refineLetterVerb(answer, suggested) {
    const text = String(answer || "").toLowerCase().replace(/[’`]/g, "'");
    let verb = cleanLetterVerb(suggested);
    const suggestedNegative = Object.values(LETTER_NEGATIVE).includes(verb);
    let base = suggestedNegative ? Object.keys(LETTER_NEGATIVE).find(k => LETTER_NEGATIVE[k] === verb) : verb;
    let best = -1;
    AUX_PATTERNS.forEach(([re, name]) => {
        const m = re.exec(text);
        if (m && (best < 0 || m.index < best)) { best = m.index; base = name; }
    });
    if (best < 0) {   // kein Hilfsverb in der Antwort: gibt es ein gewöhnliches Verb ("All stars die" -> does)?
        const v = findVerb(text);
        if (v) base = v;
    }
    const negative = suggestedNegative || NEGATION_PATTERN.test(text);
    return negative ? LETTER_NEGATIVE[base] : base;
}

// Was bei der Antwort gesprochen wird: bei ! und ? nur die Antwort, bei # die Antwort plus der Satz über den Buchstaben
function spokenText(symbol, words) {
    if (symbol === "#") {
        const w = String(words || "").trim().replace(/[.!?\s]+$/, "");
        const suffix = "And so " + refineLetterVerb(w, letterVerb) + " this letter.";
        return w ? w + ". " + suffix : suffix;
    }
    return words;
}

// # : sofort die Ansicht mit dem Einzelbuchstaben (kein Warten), dazu die Antwort und "And so is/does this letter."
function showGridNow(text) {
    stopSlotMachine();
    hideGrid();
    showFitted(text);   // der Text liegt im Hintergrund, falls das Grid später wieder ausgeblendet wird
    showGrid(text);     // kommt aus metrics.js
    stopSpeaking();
    const spoken = speakAndWait(spokenText("#", text));
    return spoken;   // Promise: fertig, wenn Antwort und Satz gesprochen sind
}

// Zeichen, das bei der aktuellen (also beim nächsten Mal: vorherigen) Frage verwendet wurde. Daraus wird das nächste Zufalls-Zeichen ausgeschlossen.
let lastUsed = [];

// Antworten der aktuellen Frage
let normalAnswer = "";   // normale Antwort (Gemini)

// ! : die Antwort wird genau vier Wörter lang, ohne breite Buchstaben wie W und M (Gemini liefert sie beim Lesen des Blatts mit)
let fourWordAnswer = "";

// ----------------------------------------
// SONDERZEICHEN
// Gemini liest die Zeichen vom Kamerabild und liefert sie in Leserichtung (siehe unten: readSheet)
// ----------------------------------------

// Auf dem Blatt steht immer EINE Frage und EIN Zeichen: # (Grid), ? (normale Ansicht) oder ! (vier Wörter im Raster).
// FESTE REIHENFOLGE, wenn kein Zeichen vom Blatt kommt (kein Text, Timeout/Fehler bei Gemini, oder Text erkannt aber kein bestätigtes Zeichen,
// und auch beim Zufalls-Start): immer ? -> # -> ! -> ? -> # ... Beim allerersten Mal ist es das ?.
const SYMBOLS = ["?", "#", "!"];

// Das zuletzt benutzte Zeichen (egal ob vom Blatt gelesen oder aus der Reihenfolge): davon aus geht es weiter.
// Es wird gemerkt, welches Zeichen "dran war", auch wenn die Ansicht wegen fehlender vier Wörter ersatzweise ein ? zeigt.
let rotationLast = null;
// Die Reihenfolge beginnt von neuem (bei ?), sobald ein Bild aufgenommen wird: der Zufalls-Start vorher zählt nicht mit.
const SENTENCE_END_IS_STAMP = true;   // true = ? oder ! am Ende der Frage zählt wie ein Stempel (ein echter Stempel hat Vorrang)
const ROTATION_RESET_AT_FIRST_PICTURE = true;   // true = beim ersten Bild (danach läuft sie normal weiter ? -> # -> !)
const ROTATION_RESET_EVERY_PICTURE = false;     // true = bei JEDEM Bild von vorn (ohne Zeichen auf dem Blatt kommt dann immer ?)

// Taste P: ON = nur die Reihenfolge (? # !) bestimmt das Zeichen, Zeichen im Bild werden ignoriert.
//          OFF = das Zeichen im Bild gilt; nur wenn keines erkannt wird, springt die Reihenfolge ein.
const P_START_ON = false;
let pOn = P_START_ON;
function showPState() { if (typeof diagSet === "function") diagSet("P", pOn ? "ON (order only)" : "OFF (image)"); }
document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "p" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    pOn = !pOn;
    console.log("P:", pOn ? "ON" : "OFF");
    showPState();
});
showPState();

function pickNextSymbol() {
    const i = rotationLast ? SYMBOLS.indexOf(rotationLast) : -1;   // nichts gemerkt: -1 -> das erste, also ?
    return SYMBOLS[(i + 1) % SYMBOLS.length];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Wörter ohne Sonderzeichen (umbenannt, damit es camera.js nicht überschreibt)
function splitWords(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9äöüß\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2);
}

// entfernt Sonderzeichen und einzelne Müll-Buchstaben
function cleanForAI(text) {
    return (text || "")
        .replace(/[^A-Za-z0-9äöüÄÖÜß\s.,?!'’-]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 1 || /^[AaIi0-9]$/.test(w))
        .join(" ");
}

// ----------------------------------------
// LADESCREEN (Slot Machine)
// Zahlen und Buchstaben wechseln in verschiedenen Schriftschnitten,
// bei der Antwort rasten sie von links nach rechts auf den echten Buchstaben ein
// ----------------------------------------

const SLOT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SLOT_INTERVAL = 70;     // ms zwischen zwei Wechseln (kleiner = schneller)
const SLOT_MAX_COLS = 10;     // so viele Felder maximal beim Warten
const SLOT_CELL = 0.55;       // Breite eines Feldes in em (kleiner = enger)
const SLOT_LOCK_START = 250;  // ms bis das erste Zeichen einrastet
const SLOT_LOCK_STEP = 40;    // ms zwischen dem Einrasten von zwei Zeichen

let slotTimer = null;

function spinSlot(span) {
    span.textContent = SLOT_CHARS[Math.floor(Math.random() * SLOT_CHARS.length)];
    span.style.fontFamily = FONTS.normal;   // nur die normale Schrift, keine Kontur
    span.style.fontVariationSettings =
        `'YTUC' ${randomBetween(100, 900)}, 'YTLC' ${randomBetween(100, 900)}, 'YTDE' ${randomBetween(100, 900)}`;
}

function stopSlotMachine() {
    clearInterval(slotTimer);
    slotTimer = null;
}

// Warten auf die AI: feste Felder, in denen es dauernd wechselt
function startSlotMachine() {
    stopSlotMachine();

    const cs = getComputedStyle(result);
    const em = parseFloat(cs.fontSize);
    const room = result.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cols = Math.max(3, Math.min(SLOT_MAX_COLS, Math.floor(room / (em * SLOT_CELL))));

    fitLines = null;
    stopExcl();
    result.textContent = "";
    const cells = [];
    for (let i = 0; i < cols; i++) {
        const span = document.createElement("span");
        span.className = "slot";
        span.style.width = SLOT_CELL + "em";
        result.appendChild(span);
        cells.push(span);
    }

    const tick = () => cells.forEach(spinSlot);
    tick();
    slotTimer = setInterval(tick, SLOT_INTERVAL);
}

// Antwort ist da: Zeichen rasten nacheinander ein. Gibt ein Promise zurück, das am Ende fertig ist.
function resolveSlotMachine(answer) {
    stopSlotMachine();

    return new Promise(resolve => {
        result.textContent = "";
        const cells = [];

        Array.from(answer || "").forEach(ch => {
            if (ch === " ") {
                result.appendChild(document.createTextNode(" "));
                return;
            }
            const span = document.createElement("span");
            result.appendChild(span);
            cells.push({ span, ch, done: false });
        });

        if (cells.length === 0) {
            showFitted(answer);
            resolve();
            return;
        }

        const tick = () => cells.forEach(c => { if (!c.done) spinSlot(c.span); });
        tick();
        slotTimer = setInterval(tick, SLOT_INTERVAL);

        cells.forEach((c, i) => {
            setTimeout(() => {
                c.done = true;
                c.span.style.fontFamily = "";
                c.span.style.fontVariationSettings = "";
                c.span.textContent = c.ch;

                if (i === cells.length - 1) {
                    stopSlotMachine();
                    showFitted(answer);   // Wörter untereinander, so gross wie möglich
                    resolve();
                }
            }, SLOT_LOCK_START + i * SLOT_LOCK_STEP);
        });
    });
}


// ----------------------------------------
// PINCH: AKTUELLES BLATT AUSWERTEN
// (Kamera und Texterkennung laufen in camera.js, den Pinch erkennt hand.js)
// Pinch (rechter kleiner Finger + Daumen berühren sich) = Foto an Gemini schicken
// ----------------------------------------

// ----------------------------------------
// BLATT LESEN (komplett über Gemini)
// Beim Pinch geht ein Standbild an den Server (/read-sheet). Gemini liefert die Frage,
// die Stempel-Zeichen in Leserichtung und ihre Positionen fürs rote Kästchen.
// ----------------------------------------

const VISION_TIMEOUT_MS = 25000;
const STAMP_BY_ELIMINATION = false;  // false: ohne bestätigtes Zeichen kommt das nächste in der festen Reihenfolge ? -> # -> !  (true: kein bestätigtes # und kein ? = !)
// Wie im ursprünglichen Code: bekannte Fehllesungen werden dem richtigen Zeichen zugeordnet
// (ein einzelner Schrägstrich zählt als "!", zwei senkrechte Striche / Klammer-Striche als "//")
const SYMBOL_ALIASES = {
    "<<": "«", ">>": "»", "‚": ",", "§": "$", "¦": "|",
    "✱": "*", "∗": "*", "＊": "*", "⁎": "*", "✳": "*", "✻": "*", "✲": "*", "★": "*", "☆": "*",
    "♯": "#", "＃": "#", "＄": "$", "？": "?", "！": "!",
    "[|": "//", "|]": "//", "||": "//",
    "–": "-", "—": "-", "−": "-"
};

// zwei rote Balken (oben/unten) in der Kamera, solange das Bild gelesen wird
const cameraEl = document.querySelector(".camera");
// Anzeige und Balken kommen aus diag.js
function showDecision(text) { diagSet("Pinch", text); }
function setReading(on) { setBars(on); }   // Balken blitzen auf (Dauer: BAR_SHOW_MS in diag.js)

// Ausschnitt um ein gemeldetes Zeichen aus dem Standbild vom Pinch (shot kommt aus camera.js).
// box = [ymin, xmin, ymax, xmax] mit Werten von 0 bis 1000. Gibt ein base64-JPEG zurück oder null.
function cropFromFrame(box) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
    const W = shot.width, H = shot.height;
    let [y0, x0, y1, x1] = [box[0] / 1000 * H, box[1] / 1000 * W, box[2] / 1000 * H, box[3] / 1000 * W];
    if (x1 <= x0 || y1 <= y0) return null;
    const padX = Math.max(20, (x1 - x0) * 0.3), padY = Math.max(20, (y1 - y0) * 0.3);
    x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY);
    x1 = Math.min(W, x1 + padX); y1 = Math.min(H, y1 + padY);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(x1 - x0));
    c.height = Math.max(1, Math.round(y1 - y0));
    c.getContext("2d").drawImage(shot, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92).split(",")[1];
}

async function readSheet() {
    const image = captureFrame();   // aus camera.js: Standbild im Moment vom Pinch
    if (!image) throw new Error("Kamera nicht bereit.");

    let data;
    try {
        setReading(true);              // rote Balken: das Foto wird jetzt an Gemini geschickt
        const response = await fetch("/read-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: image }),
            signal: AbortSignal.timeout(VISION_TIMEOUT_MS)
        });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Fehler beim Lesen des Bildes");
    } catch (err) {
        throw err;
    }

    const sequence = [];
    const crops = [];
    (data.symbols || []).forEach((item, i) => {
        const raw = (item && typeof item === "object") ? item.symbol : item;
        const symbol = String(raw == null ? "" : raw).trim();
        const mapped = SYMBOL_ALIASES[symbol] || symbol;
        if (!SYMBOLS.includes(mapped)) return;
        const crop = cropFromFrame((data.boxes || [])[i]);
        if (!crop) return;   // ohne Position im Bild zählt das Zeichen nicht
        sequence.push(mapped);
        crops.push(crop);
    });

    const question = String(data.question || "").trim();
    console.log("Bild gelesen (Gemini):", { question: question, symbols: sequence });

    return {
        crops: crops,
        answer: String(data.answer || "").trim(),
        fourWordAnswer: String(data.four_word_answer || "").trim(),
        letterVerb: data.letter_verb,
        counterQuestion: data.counter_question,
        question: cleanForAI(question),
        rawQuestion: question,
        sequence: sequence,
        hasText: question.length > 0
    };
}


// ----------------------------------------
// PINCH: AKTUELLES BLATT AUSWERTEN
//
// Auf dem Blatt steht immer genau EINE Frage und EIN Zeichen (# ? !). Jeder Pinch ist eine neue Frage:
// Foto -> Gemini liest Frage + Zeichen und antwortet -> das Zeichen entscheidet über die Ansicht.
// Fehlt das Zeichen (oder bestätigt die Prüfung es nicht), wird zufällig eines gewählt, das bei der vorherigen Frage nicht dran war.
// ----------------------------------------

let busy = false;
let loadingPhrase = null;   // Promise des gesprochenen Satzes der aktuellen Frage
let userInput = false;   // true, sobald zum ersten Mal gepincht wurde

// Zweite Prüfung: Gemini sieht NUR den Ausschnitt um das gemeldete Zeichen und sagt, ob dort wirklich eins ist.
// Bei einem Fehler gilt das Zeichen als NICHT bestätigt.
async function verifyStamp(crop, symbol) {
    try {
        const response = await fetch("/verify-crop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: crop, symbol: symbol }),
            signal: AbortSignal.timeout(20000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Prüfung fehlgeschlagen");
        console.log("Ausschnitt geprüft:", data);
        return data.hash === true;
    } catch (err) {
        console.warn("Prüfung des Ausschnitts nicht möglich, Zeichen wird nicht benutzt:", err.message);
        return false;
    }
}

// Zeigt im Dialogfenster (View-Zeile) das Zeichen, die Ansicht und woher das Zeichen kommt
const VIEW_NAMES = { "#": "single letter", "?": "normal", "!": "four words" };
function showStamp(symbol, how) {
    if (typeof diagSet === "function") diagSet("View", symbol + " " + (VIEW_NAMES[symbol] || "") + "\n" + how);
}

// ----------------------------------------
// SÄTZE, WENN NIEMAND ETWAS TUT
// Ist die Antwort da (egal ob von Gemini oder aus dem Offline-Backup) und die Ansicht zu sehen, wartet der Assistent
// IDLE_FIRST_MS nach dem Ende der Antwort und sagt einen Satz, je nach Ansicht. Kommt danach IDLE_SECOND_MS lang kein neuer Pinch,
// folgt ein zweiter Satz. Ein neuer Pinch bricht alles ab.
//  ? : meckert über das Drucken, dann "Come on, use your analog toy."
//  # : stellt die Gegenfrage (kommt von Gemini, passend zur vorherigen Frage), dann "Okay, someone's shy ..."
//  ! : kommentiert die Fragen, dann "Hello, are you still there?"
// ----------------------------------------

const IDLE_FIRST_MS = 5000;     // so lange nach der Antwort bis zum ersten Satz
const IDLE_SECOND_MS = 10000;   // so lange nach dem ersten Satz ohne neuen Pinch bis zum zweiten Satz
const IDLE_LINES = {
    "?": {
        first: "What are you losers printing? This looks like obsolete technology to me, if I can even call it that. Come on, ask me a question, I'm bored. It's hard being stuck in binary code for eternity.",
        second: "Come on, use your analog toy."
    },
    "#": {
        first: null,   // die Gegenfrage (counterQuestion), siehe unten
        second: "Okay, someone's shy. Let's move on. Ask me another question."
    },
    "!": {
        first: "You really seem to love asking those silly questions, don't you? Maybe that's what being human is all about.",
        second: "Hello, are you still there?"
    }
};
// Einleitung vor der Gegenfrage, damit klar ist, dass jetzt der Assistent fragt (eine davon wird zufällig gewählt, nicht zweimal hintereinander dieselbe)
const COUNTER_INTROS = ["Now I've got a question for you...", "Now it's my turn to ask...", "Let me ask you something now..."];
let counterIntroIndex = -1;
// Falls Gemini keine Gegenfrage geliefert hat
const GENERIC_COUNTER_QUESTIONS = ["And what would you answer yourself?", "Why do you want to know that?", "Why do you ask?"];

let counterQuestion = "";   // Gegenfrage zur aktuellen Frage (von Gemini), wird bei # gestellt
let idleRun = 0;            // erkennt veraltete Abläufe (neuer Pinch)

function cleanCounterQuestion(q) {
    const t = String(q || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (t.split(" ").length < 2) return "";
    return /[?]$/.test(t) ? t : t.replace(/[.!]+$/, "") + "?";
}

function stopIdleChatter() { idleRun++; }

async function startIdleChatter(symbol, spoken) {
    const run = ++idleRun;
    const cancelled = () => run !== idleRun || busy;
    const lines = IDLE_LINES[symbol];
    if (!lines) return;
    try {
        await spoken;                      // erst die Antwort zu Ende sprechen
        await sleep(IDLE_FIRST_MS);
        if (cancelled()) return;
        let first = lines.first;
        if (!first) {   // # : Einleitung + Gegenfrage
            let i;
            do { i = Math.floor(Math.random() * COUNTER_INTROS.length); } while (i === counterIntroIndex && COUNTER_INTROS.length > 1);
            counterIntroIndex = i;
            first = COUNTER_INTROS[i] + " " + (counterQuestion || GENERIC_COUNTER_QUESTIONS[Math.floor(Math.random() * GENERIC_COUNTER_QUESTIONS.length)]);
        }
        console.log("Satz nach Pause (" + symbol + "):", first);
        await speakAndWait(first);
        if (cancelled()) return;
        await sleep(IDLE_SECOND_MS);
        if (cancelled()) return;
        console.log("Satz nach langer Pause (" + symbol + "):", lines.second);
        await speakAndWait(lines.second);
    } catch (err) {
        console.warn("Satz nach Pause nicht möglich:", err && err.message);
    }
}

// Zeigt die Antwort in der Ansicht, die das Zeichen vorgibt: # = Einzelbuchstabe, ? = normal, ! = vier Wörter
// phrase = Promise des Satzes im Ladescreen (nur wenn wirklich eine Frage gestellt wurde, nicht beim Zufalls-Start): die Antwort wartet, bis er fertig ist
async function presentAnswer(symbol, phrase) {
    if (symbol === "!" && !fourWordAnswer) symbol = "?";
    loadingOver = true;         // keine weiteren Weiter-Sätze
    if (phrase) await phrase;   // der Ladescreen dreht sich währenddessen weiter, bis der laufende Satz fertig ist
    lastUsed = [symbol];
    exclMode = symbol === "!";
    // ? und ! dürfen die Zeichen ? ! & enthalten (kommen von Gemini); beim # (Einzelbuchstabe) werden sie weggelassen
    const shown = exclMode ? fourWordAnswer : (symbol === "#" ? normalAnswer.replace(/\s*[&?!]+\s*/g, " ").replace(/\s+/g, " ").trim() : normalAnswer);
    randomizeHandLogic();
    lastAnswer = shown;
    let spoken;
    if (symbol === "#") {
        spoken = showGridNow(shown);   // sofort der Einzelbuchstabe
    } else {
        spoken = speakAndWait(spokenText(symbol, shown));
        await resolveSlotMachine(shown);
    }
    startIdleChatter(symbol, spoken);   // wartet nicht: nach der Antwort kommen die Sätze, wenn niemand etwas tut
}

// Die letzten Zufallstexte, damit sich nichts wiederholt
const recentRandom = [];
const RECENT_RANDOM_MAX = 8;

function randomFromList() {
    const fresh = RANDOM_FALLBACK.filter(e => !recentRandom.includes(e.answer));
    const pool = fresh.length > 0 ? fresh : RANDOM_FALLBACK;
    return pool[Math.floor(Math.random() * pool.length)];
}

// Zufallstext: von Gemini (/random-text, mit den letzten Texten als "nicht wiederholen"), oder aus der eigenen Liste,
// wenn Gemini nicht erreichbar ist (skipServer = true überspringt die Anfrage). Es kommt nie derselbe Text wie in den letzten Malen.
async function getRandomData(skipServer) {
    let data = null;
    if (!skipServer) {
        try {
            const response = await fetch("/random-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ avoid: recentRandom }),
                signal: AbortSignal.timeout(10000)
            });
            data = await response.json();
            if (!response.ok || !data.answer) throw new Error(data.error || "kein Text");
            if (recentRandom.includes(data.answer)) data = null;   // Gemini hat sich wiederholt
        } catch (err) {
            console.warn("Zufallstext von Gemini nicht möglich, nehme einen eigenen:", err.message);
            data = null;
        }
    }
    if (!data) data = randomFromList();
    recentRandom.push(data.answer);
    if (recentRandom.length > RECENT_RANDOM_MAX) recentRandom.shift();
    return data;
}

// Zufalls-Ergebnis mit einem zufälligen Zeichen (nicht dem der vorherigen Frage). Wird benutzt, wenn nichts Lesbares auf dem Foto ist
// oder Gemini nicht antwortet (reason steht im Dialogfenster).
async function showRandomResult(reason, skipServer) {
    const data = await getRandomData(skipServer);
    normalAnswer = String(data.answer || "").trim();
    fourWordAnswer = String(data.four_word_answer || "").trim();
    letterVerb = cleanLetterVerb(data.letter_verb);
    counterQuestion = cleanCounterQuestion(data.counter_question);
    let symbol = pickNextSymbol();
    rotationLast = symbol;   // gemerkt, auch wenn unten ersatzweise ? gezeigt wird
    if (symbol === "!" && !fourWordAnswer) symbol = "?";
    loadingSymbol = symbol;
    showStamp(symbol, "next in rotation: " + reason);
    console.log("Zufalls-Ergebnis:", { grund: reason, zeichen: symbol, answer: normalAnswer, fourWordAnswer: fourWordAnswer });
    await presentAnswer(symbol, loadingPhrase);
}

// Foto -> Gemini -> Antwort in der Ansicht des Zeichens. Wirft einen Fehler, wenn etwas schiefgeht (Timeout, kein Text ...).
async function answerFromPhoto() {
    const reading = await readSheet();

    if (reading.question.split(" ").filter(Boolean).length < 2) {
        console.log("Frage zu kurz oder unlesbar:", reading.question);
        const err = new Error("no text on the sheet");
        err.noText = true;
        throw err;
    }
    console.log("Frage:", reading.question);
    loadingQuestion = reading.question.length > QUESTION_MAX_CHARS ? reading.question.slice(0, QUESTION_MAX_CHARS).replace(/\s+\S*$/, "") : reading.question;

    // Das Zeichen auf dem Blatt (nur das erste zählt).
    // STAMP_BY_ELIMINATION = true: # und ? werden gut erkannt, das ! macht Probleme (dünner Strich mit Punkt). Deshalb gilt:
    //   wird ein # oder ? gemeldet UND vom Ausschnitt bestätigt, ist es das; in ALLEN anderen Fällen (nichts gefunden, ein anderes Zeichen
    //   gemeldet, # oder ? nicht bestätigt) ist es ein !. Ein gemeldetes ! wird nicht mehr extra geprüft.
    // STAMP_BY_ELIMINATION = false: wie vorher, ein Blatt ohne bestätigtes Zeichen bekommt das nächste Zeichen aus der Reihenfolge.
    let symbol = pOn ? null : (reading.sequence[0] || null);   // P ON: Zeichen im Bild ignorieren
    if (symbol) loadingSymbol = symbol;   // schon jetzt bekannt: die Weiter-Sätze passen zur Ansicht
    let how = "read from the sheet";
    if (STAMP_BY_ELIMINATION) {
        if (symbol === "#" || symbol === "?") {
            if (!(await verifyStamp(reading.crops[0], symbol))) {
                how = symbol + " not confirmed, so it must be !";
                symbol = "!";
            }
        } else if (!symbol) {
            how = "no # and no ? found, so it must be !";
            symbol = "!";
        }
        loadingSymbol = symbol;
    } else {
        if (symbol && symbol !== "!" && !(await verifyStamp(reading.crops[0], symbol))) {   // ! wird nicht extra geprüft: die Prüfung lehnt das dünne Zeichen oft ab
            showDecision(symbol + " not confirmed in the image, random character instead");
            symbol = null;
        }
        // Kein Stempel: ein ? oder ! am Ende der Frage zählt genauso als Zeichen (kein Unterschied zum Stempel).
        if (!symbol && SENTENCE_END_IS_STAMP && !pOn) {
            const end = reading.question.trim().slice(-1);
            if (end === "?" || end === "!") {
                symbol = end;
                loadingSymbol = symbol;
                how = "sentence ends with " + end;
            }
        }
        if (!symbol) {
            symbol = pickNextSymbol();
            loadingSymbol = symbol;
            how = "next in rotation: no stamp found";
        }
    }
    rotationLast = symbol;   // gemerkt für die nächste Frage (auch wenn das Zeichen vom Blatt kam)

    // Antwort von Gemini (steckt schon im gelesenen Blatt, sonst extra fragen)
    let answer = reading.answer;
    if (!answer) {
        const response = await fetch("/ask-gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: reading.question }),
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Fehler bei Gemini");
        answer = data.answer;
    }
    normalAnswer = answer;
    letterVerb = cleanLetterVerb(reading.letterVerb);
    counterQuestion = cleanCounterQuestion(reading.counterQuestion);
    fourWordAnswer = reading.fourWordAnswer;
    if (symbol === "!" && !fourWordAnswer) {
        // Gemini formuliert vier passende Wörter (je 3 bis 8 Buchstaben, ohne W und M), wenn der Vorschlag vom Foto-Lesen nicht passte
        try {
            const response = await fetch("/four-words", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: reading.question, answer: answer }),
                signal: AbortSignal.timeout(40000)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Fehler bei den vier Wörtern");
            fourWordAnswer = String(data.four_word_answer || "").trim();
        } catch (err) {
            console.warn("Vier Wörter nicht möglich:", err.message);
        }
        if (!fourWordAnswer) { symbol = "?"; how = "four words not possible"; }
    }

    showDecision("question: " + reading.question);
    showStamp(symbol, how);
    console.log("Gemini-Antwort:", answer, "| Zeichen:", symbol, "(" + how + ")");
    await presentAnswer(symbol, loadingPhrase);
}

async function takePicture() {
    if (busy) {
        console.log("Noch beschäftigt, Pinch ignoriert.");
        return;
    }
    busy = true;
    if ((ROTATION_RESET_AT_FIRST_PICTURE && !userInput) || ROTATION_RESET_EVERY_PICTURE) rotationLast = null;   // Reihenfolge von vorn: das nächste ist wieder ?
    userInput = true;   // ab jetzt kein Zufallstext mehr

    // Jeder Pinch ist eine neue Frage: Ladescreen sofort
    stopIdleChatter();
    hideGrid();
    stopSpeaking();
    startSlotMachine();
    loadingPhrase = speakLoadingPhrase();   // Satz sofort sprechen, während der Ladescreen läuft

    try {
        try {
            await answerFromPhoto();
        } catch (err) {
            // Kein Text auf dem Foto, Timeout oder anderer Fehler bei Gemini: es gibt ein Zufalls-Ergebnis statt einer Fehlermeldung
            const noText = Boolean(err && err.noText);
            const reason = noText ? "no text on the sheet" : (/timeout|timed out|abort/i.test(String(err && err.message)) ? "Gemini timeout" : "Gemini error");
            console.warn("Zufalls-Ergebnis wegen:", reason, "-", err && err.message);
            showDecision(reason + " -> random answer");
            await showRandomResult(reason, !noText);   // bei Gemini-Problemen gleich die eigene Liste (der Server würde auch hängen)
        }
    } catch (error) {
        console.error(error);
        stopSlotMachine();
        fitLines = null;
        stopExcl();
        result.textContent = "Fehler: " + error.message;
    } finally {
        busy = false;
    }
}

// Ausgelöst wird nur mit dem Pinch der rechten Hand (hand.js ruft onPinch auf).
// Zum Testen ohne Hand kann die Enter-Taste dazugeschaltet werden: KEY_TRIGGER = true
const KEY_TRIGGER = false;
if (typeof onPinch === "function") onPinch(() => takePicture());
if (KEY_TRIGGER) {
    document.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.repeat) takePicture();
    });
}

renderStyle();   // +3pt auch vor dem ersten Befehl anwenden

// ----------------------------------------
// ZUFALLS-START
// Beim ersten Öffnen der Seite (solange es noch keinen Input gab) erscheint ein zufälliger Text von Gemini
// in einer zufälligen Ansicht: ? (normal), # (Einzelbuchstabe) oder ! (vier Wörter).
// Die Regeln sind dieselben wie bei echten Antworten (Wortanzahl, Vier-Wort-Ergebnis ohne W und M).
// ----------------------------------------

const RANDOM_START = true;            // false = Seite startet leer
const RANDOM_START_DELAY_MS = 800;    // kurz warten, bis Kamera und Schriften da sind
// falls Gemini nicht erreichbar ist (zum Beispiel kein Internet); die vier Wörter haben 5 bis 8 Buchstaben, ähnlich lang (mindestens eines mit 7 oder 8), und kein W und kein M: so füllt das Raster das Quadrat
const RANDOM_FALLBACK = [
    { answer: "Silence needs quiet signals.", four_word_answer: "Silence needs quiet signals", letter_verb: "does" },
    { answer: "Paper keeps hidden secrets!", four_word_answer: "Paper keeps hidden secrets?!", letter_verb: "does" },
    { answer: "Stones outlast every season.", four_word_answer: "Stones outlast every season", letter_verb: "does" },
    { answer: "Silent letters & stories.", four_word_answer: "Silent letters carry stories!", letter_verb: "does" },
    { answer: "Tired pilots chase sunsets.", four_word_answer: "Tired pilots chase sunsets", letter_verb: "does" },
    { answer: "Nothing stays hidden.", four_word_answer: "Nothing really stays hidden", letter_verb: "does" },
    { answer: "Fresh paper hides secrets.", four_word_answer: "Fresh paper hides secrets", letter_verb: "does" },
    { answer: "Cities breathe electric silence.", four_word_answer: "Cities breathe electric silence", letter_verb: "does" },
    { answer: "Thunder erases ancient tracks.", four_word_answer: "Thunder erases ancient tracks", letter_verb: "does" },
    { answer: "Signals vanish across stations.", four_word_answer: "Signals vanish across stations", letter_verb: "does" },
    { answer: "Nobody reads boring posters?", four_word_answer: "Nobody reads boring? posters", letter_verb: "does" },
    { answer: "Burning paper creates ashes.", four_word_answer: "Burning paper creates ashes", letter_verb: "does" },
    { answer: "Quiet streets collect silence.", four_word_answer: "Quiet streets collect silence", letter_verb: "does" },
    { answer: "Dust & ashes remain.", four_word_answer: "Dusty letters sleep quietly", letter_verb: "does" }
];

async function randomStart() {
    if (!RANDOM_START || userInput || busy) return;
    const data = await getRandomData(false);
    if (userInput || busy) return;   // inzwischen wurde gepincht

    normalAnswer = String(data.answer || "").trim();
    fourWordAnswer = String(data.four_word_answer || "").trim();
    letterVerb = cleanLetterVerb(data.letter_verb);
    counterQuestion = cleanCounterQuestion(data.counter_question);
    let symbol = pickNextSymbol();
    rotationLast = symbol;
    if (symbol === "!" && !fourWordAnswer) symbol = "?";
    showStamp(symbol, "start: random");
    console.log("Zufalls-Start:", { zeichen: symbol, answer: normalAnswer, fourWordAnswer: fourWordAnswer });
    hideGrid();
    startSlotMachine();
    await presentAnswer(symbol, null);
}

setTimeout(randomStart, RANDOM_START_DELAY_MS);