// ***************
// Diagnose-Anzeige + rote Balken (unabhängig von camera.js und style.css)
// Wird als ERSTES Skript geladen.
// ***************
const APP_VERSION = "v15";   // steht unten links im Bild: so siehst du, ob die neuen Dateien geladen sind

// Schrift des Fensters: die Unica in deinem Fonts-Ordner ist eine variable Schrift mit der Strichstärke-Achse wght (32 = Thin ... 228 = am dicksten),
// dazu wdth (80 = schmal ... 100) und slnt (0 ... 24 = schräg). Ohne Angabe nimmt der Browser die dickste Stärke.
const DIAG_FONT_FAMILY = "'HGKBUnica77VIPBeta',sans-serif";
const DIAG_FONT_WGHT = 32;       // Strichstärke: 32 = Thin (dünnster Schnitt), höher = dicker (bis 228)
const DIAG_FONT_PX = 15;         // Schriftgrösse des Fensters in px
const DIAG_FONT_WDTH = 80;       // Breite: 80 = schmal, 100 = normal breit

// Schriften früh laden: Unica fürs Panel, Ruder Plakat Linie für die Beschriftung der Boxen (Canvas lädt Schriften sonst zu spät)
if (document.fonts && document.fonts.load) {
  document.fonts.load("20px HGKBUnica77VIPBeta");
  document.fonts.load("20px HGKBRuderKonturLLVIP");
}

const diagPanel = document.createElement("div");
diagPanel.style.cssText =
  "position:absolute;left:12px;bottom:12px;z-index:99999;max-width:calc(100% - 24px);padding:0;" +
  "font:" + DIAG_FONT_PX + "px/1.4 " + DIAG_FONT_FAMILY + ";font-variation-settings:'wght' " + DIAG_FONT_WGHT + ",'wdth' " + DIAG_FONT_WDTH + ";color:red;background:none;text-shadow:none;pointer-events:none;white-space:pre;";
const diagLines = {};
// Feste Umbrüche: kein Satz läuft mehr ins Bild. Zeilen werden nach DIAG_WRAP Zeichen umgebrochen, Folgezeilen eingerückt.
// Mit "\n" im Text kann man selbst einen Umbruch setzen.
const DIAG_WRAP = 48;       // so viele Zeichen pro Zeile (kleiner = schmaleres Fenster)
const DIAG_INDENT = "    "; // Einrückung der Folgezeilen
function diagWrap(text) {
  const out = [];
  String(text).split("\n").forEach(part => {
    let line = "";
    part.split(" ").forEach(w => {
      const next = line ? line + " " + w : w;
      if (line && next.length > DIAG_WRAP) { out.push(line); line = w; } else line = next;
    });
    out.push(line);
  });
  return out.map((l, i) => (i ? DIAG_INDENT : "") + l).join("\n");
}
function diagSet(key, text) {
  diagLines[key] = text;
  diagPanel.textContent = APP_VERSION + "\n" +
    Object.keys(diagLines).map(k => diagWrap(k + ": " + diagLines[k])).join("\n");
}
// Das Fenster sitzt unten links IM Kamerabild (die Kamera-Hälfte ist .camera)
function attachPanel() {
  const cam = document.querySelector(".camera");
  (cam || document.body).appendChild(diagPanel);
}
document.addEventListener("DOMContentLoaded", attachPanel);
if (document.body) attachPanel();
diagSet("Start", "page loaded");

// JavaScript-Fehler sichtbar machen
window.addEventListener("error", e => diagSet("ERROR", (e.message || "?") + " (" + (e.filename || "").split("/").pop() + ":" + e.lineno + ")"));
window.addEventListener("unhandledrejection", e => diagSet("ERROR", String((e.reason && e.reason.message) || e.reason)));

// zwei rote Balken oben und unten über der Kamera-Hälfte
const BAR_HEIGHT_PX = 14;
const BAR_SHOW_MS = 500;    // so lange bleiben die Balken sichtbar (nach dem Pinch), danach verschwinden sie von selbst
const barEls = [0, 1].map(() => {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;z-index:99998;background:red;pointer-events:none;display:none;";
  return el;
});
function attachBars() { barEls.forEach(el => document.body.appendChild(el)); }
document.addEventListener("DOMContentLoaded", attachBars);
if (document.body) attachBars();

let barTimer = null;
function setBars(on) {
  clearTimeout(barTimer);
  if (on) barTimer = setTimeout(() => setBars(false), BAR_SHOW_MS);
  const cam = document.querySelector(".camera");
  const r = cam ? cam.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth / 2, bottom: window.innerHeight };
  barEls[0].style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${BAR_HEIGHT_PX}px;display:${on ? "block" : "none"}`;
  barEls[1].style.cssText += `;left:${r.left}px;top:${r.bottom - BAR_HEIGHT_PX}px;width:${r.width}px;height:${BAR_HEIGHT_PX}px;display:${on ? "block" : "none"}`;
}