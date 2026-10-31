// ----------------------------------------
// VORLESEN mit der Browser-Stimme (ElevenLabs gibt es nicht mehr)
// Welche Stimme aktiv ist, steht im Panel unten links (diag.js).
// Chrome blockiert die Browser-Stimme, solange man noch nicht auf die Seite geklickt hat. Damit es trotzdem immer geht,
// spricht in dem Fall der Server auf dem Mac mit der Systemstimme (say), siehe TTS_FALLBACK_SAY.
// ----------------------------------------

const TTS_FALLBACK_SAY = true;   // false = nur die Browser-Stimme (kein Ersatz, wenn Chrome sie blockiert)
let sayActive = false;           // true = die letzte Ausgabe lief über den Server (say)
const TTS_LANG = "en";   // Sprache der Antworten, z. B. "de" für Deutsch
const TTS_RATE = 1;      // Tempo der Stimme

let ttsRun = 0;          // erkennt veraltete Anfragen
let ttsUtterance = null; // Referenz behalten: Chrome wirft die Stimme sonst manchmal vorzeitig weg
let ttsTimer = null;
const TTS_START_DELAY = 150;   // Chrome verschluckt speak() direkt nach cancel() -> kurz warten


// grobe Einschätzung, wie natürlich eine Stimme klingt
function voiceScore(v) {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 100;
    if (/premium|enhanced/.test(n)) s += 80;
    if (/siri/.test(n)) s += 70;
    if (/online/.test(n)) s += 60;
    if (/google/.test(n)) s += 40;
    if (!v.localService) s += 10;
    if (/espeak|compact/.test(n)) s -= 50;
    return s;
}

function pickBrowserVoice() {
    const list = speechSynthesis.getVoices().filter(v =>
        v.lang.toLowerCase().replace("_", "-").startsWith(TTS_LANG));
    list.sort((a, b) => voiceScore(b) - voiceScore(a));
    return list[0] || null;
}

// Die Stimme wird im Dialogfenster nicht mehr angezeigt (es ist immer dieselbe).
function showVoice() {}

// Notlösung: der Server spricht den Text (macOS)
async function speakSystem(text, run, done) {
    if (!TTS_FALLBACK_SAY) { if (done) done(); return; }
    try {
        if (run !== ttsRun) return;
        const r = await fetch("/api/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text })
        });
        sayActive = r.ok;
        showVoice(r.ok ? "blocked by the browser, using the system voice" : "blocked by the browser, no system voice available");
        // der Server meldet nicht, wann say fertig ist: Dauer grob schätzen
        if (done) setTimeout(done, r.ok ? estimateSpeechMs(text) : 0);
    } catch (e) {
        console.warn("Systemstimme nicht erreichbar:", e.message);
        if (done) done();
    }
}

// grobe Dauer eines Satzes (für den Fall, dass der Browser kein "fertig" meldet)
function estimateSpeechMs(text) {
    return 600 + String(text || "").length * 75;
}

function speakBrowser(text, run, done) {
    if (!("speechSynthesis" in window)) {
        console.warn("Dieser Browser hat keine Sprachausgabe.");
        if (done) done();
        return;
    }

    speechSynthesis.cancel();
    clearTimeout(ttsTimer);

    ttsTimer = setTimeout(() => {
        if (run !== ttsRun) return;   // inzwischen kam ein Stopp oder eine neue Ausgabe

        const u = new SpeechSynthesisUtterance(text);
        const voice = pickBrowserVoice();
        if (voice) {
            u.voice = voice;
            u.lang = voice.lang;
        } else {
            u.lang = TTS_LANG;
        }
        u.rate = TTS_RATE;
        u.onend = () => { if (done) done(); };
        u.onerror = (e) => {
            console.warn("Stimme Fehler:", e.error);
            if (e.error === "not-allowed") speakSystem(text, run, done);   // Chrome blockiert: der Server spricht
            else if (done) done();
        };

        ttsUtterance = u;
        speechSynthesis.resume();   // falls die Ausgabe hängengeblieben ist
        speechSynthesis.speak(u);
    }, TTS_START_DELAY);
}

if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", () => showVoice());
showVoice();


// ---------- von script.js benutzt ----------

function stopSpeaking() {
    ttsRun++;
    clearTimeout(ttsTimer);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (sayActive) {
        sayActive = false;
        fetch("/api/say-stop", { method: "POST" }).catch(() => {});
    }
}

// done (optional) wird aufgerufen, sobald der Satz zu Ende gesprochen ist (oder spätestens nach einer geschätzten Zeit)
function speak(text, done) {
    if (!text || !text.trim()) { if (done) done(); return; }

    stopSpeaking();
    const run = ++ttsRun;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(safety); if (done) done(); };
    const safety = setTimeout(finish, estimateSpeechMs(text) + 2500);   // Sicherung: Chrome meldet das Ende manchmal nicht
    speakBrowser(text, run, finish);
}

// Wartet, bis der Satz gesprochen ist (zum Beispiel: erst der Satz im Ladescreen, dann die Antwort)
function speakAndWait(text) {
    return new Promise(resolve => speak(text, resolve));
}