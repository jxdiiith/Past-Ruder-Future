import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";

dotenv.config();

const app = express();
const PORT = 3000;


// ----------------------------------------
// GEMINI INITIALISIEREN
// ----------------------------------------

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const systemInstruction = `
You are a cold, emotionless AI assistant.

The user message was read by OCR from a paper sheet. It may contain typos,
broken words or stray characters. Work out the intended question and answer it.

STRICT RULES:
- Answer in one really short complete sentence of 1 to 6 words.
- Sometimes you can answer with 1 - 3 words.
- Never write more than 6 words in total.
- Always answer the actual content of the question.
- Never talk about the input, the OCR, processing or waiting for input.
- If you cannot find any question, answer exactly: Unclear.
- No lists, no markdown, no line breaks.
- Never repeat the question.
- No greetings.
- No politeness.
- No emojis.
- No emotional language.
- Be factual and direct.
- Now and then (roughly one answer in three, never always) add one or two punctuation marks to the answer to give it a typographic accent.
  Allowed marks: ? ! and & (the & stands between two words, like "Dust & ashes"; ? and ! go at the end of the answer or of a word, like "Gone forever?!" or "Never!").
  Use at most two marks in total and no other punctuation marks.
`;

const MAX_WORDS = 6;

// Hilfswort für "And so ___ this letter." (bei der #-Ansicht)
const LETTER_VERBS = ["is", "isn't", "was", "wasn't", "does", "doesn't", "did", "didn't", "can", "can't", "will", "won't",
    "has", "hasn't", "could", "couldn't", "would", "wouldn't", "should", "shouldn't"];
function cleanLetterVerb(v) {
    const w = String(v || "").trim().toLowerCase().replace(/[’`]/g, "'");
    return LETTER_VERBS.includes(w) ? w : "is";
}

function limitWords(text, maxWords = MAX_WORDS) {
    const clean = (text || "").trim().replace(/\s+/g, " ");
    if (!clean) return "";

    const words = clean.split(" ");
    if (words.length <= maxWords) return clean;

    const cut = words.slice(0, maxWords).join(" ");
    const lastEnd = Math.max(
        cut.lastIndexOf("."),
        cut.lastIndexOf("!"),
        cut.lastIndexOf("?")
    );

    return lastEnd > 0 ? cut.slice(0, lastEnd + 1) : cut;
}


// ----------------------------------------
// SERVER-EINSTELLUNGEN
// ----------------------------------------

const SERVER_VERSION = "server.js v24 (end marks count)";
app.get("/version", (req, res) => res.json({ version: SERVER_VERSION }));

app.use(express.json({ limit: "10mb" }));   // Kamerabilder sind grösser als die 100 kB Standard
app.use(express.static(".", { setHeaders: res => res.set("Cache-Control", "no-store") }));   // immer die neuesten Dateien laden


// ----------------------------------------
// OCR-TEXT AN GEMINI SENDEN
// ----------------------------------------

app.post("/ask-gemini", async (req, res) => {

    try {

        const text = req.body.text;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Kein Text erhalten." });
        }

        console.log("--------------------------------");
        console.log("OCR-Text:");
        console.log(text);
        console.log("--------------------------------");

        const response = await Promise.race([
            ai.models.generateContent({
                model: "gemini-3.5-flash-lite",
                config: { systemInstruction: systemInstruction },
                contents: text
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Gemini antwortet nicht (Timeout nach 20 s).")), 20000)
            )
        ]);

        const answer = limitWords(response.text);

        console.log("Gemini-Antwort:");
        console.log(answer);
        console.log("--------------------------------");

        res.json({ answer: answer });

    } catch (error) {

        console.error("Gemini-Fehler:", error);
        res.status(500).json({ error: error.message });

    }

});


// ----------------------------------------
// KAMERABILD LESEN (Text + Stempel-Zeichen)
// Das ganze Lesen macht Gemini: Es bekommt das Foto und liefert Frage, Zeichen und Positionen.
// ----------------------------------------

const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.5-flash-lite";

// Sonderzeichen: # (Grid), ? (normale Ansicht) und ! (Antwort wird vier Wörter ohne W und M)
const readSheetPrompt = `
You read a camera photo of a paper sheet. The sheet shows black printed text
(a question for an assistant) in a condensed poster typeface. Letter shapes can differ from a standard font.
The sheet shows exactly one question and sometimes ONE separate stamped mark: a hash sign #, a question mark ? or an exclamation mark !.

Return only JSON in exactly this form:
{"question": "...", "answer": "...", "letter_verb": "...", "counter_question": "...", "four_word_answer": "...", "symbols": []}

- "question": the printed question text as a normal sentence. Fix small reading
  errors, do not invent words. Use an empty string if there is no readable text.
  Keep the ? or ! printed at the very end of the sentence exactly as printed (never drop or add one).
  Do not put a separate stamped mark # in it.
- "answer": your answer to that question, as a cold, emotionless, factual AI assistant:
  one really short sentence of 1 to 6 words (sometimes 1 to 3), never more than 6 words, no greeting,
  no politeness, no emojis, never repeat the question. If there is no readable question, use "Unclear.".
  Now and then (roughly one answer in three, NOT always) give the answer a typographic accent with one or two of these marks: ? ! &
  (? and ! at the end of the answer or of a word, & between two words), for example "Gone forever?!", "Dust & ashes", "Never!". At most two marks in total, no other punctuation.
- "letter_verb": one lowercase word that completes the sentence "<answer>. And so ___ this letter." grammatically and logically,
  matching the verb, the tense AND whether the answer is affirmative or negative (use the negative form for negative answers,
  also for short answers like "No." or "Never." that negate the question). Examples: "Time heals everything" -> "does",
  "Silence is cold" -> "is", "I am not" -> "isn't", "Nothing stays hidden" -> "doesn't", "It burned" -> "did",
  "Light was bright" -> "was", "Anything can happen" -> "can", "I can't say" -> "can't", "It will end" -> "will", "No." -> "isn't".
  Method: find the main verb of the answer. A form of "to be" -> is/was. Any other verb in the present ("All stars die", "Time claims everything", "Burn it") -> does.
  Other verb in the past -> did. A modal -> can/will/could/would/should. No verb at all (a single adjective or a noun phrase like "Gone forever", "Cold") -> is.
  More examples: "All stars die!" -> "does", "Stars burn out" -> "does", "Dust remains" -> "does", "Gone forever" -> "is".
  Allowed values only: is, isn't, was, wasn't, does, doesn't, did, didn't, can, can't, will, won't, has, hasn't, could, couldn't, would, wouldn't,
  should, shouldn't. If unsure use "does" when the answer contains a verb, otherwise "is".
- "counter_question": a short counter-question that the assistant asks the user back about the same topic as the printed question,
  cold and slightly provocative, at most 10 words, ends with a question mark, never repeats the question word for word.
  Examples: "What is the past?" -> "And what is your own past?", "Why is the sky blue?" -> "Why do you care about the sky?".
  If there is no readable question, use "".
- "four_word_answer": a second answer to the same question with EXACTLY FOUR words that read as one meaningful, grammatical short phrase
  which makes sense on its own, for example "Planets circle distant stars" or "Hunger drives restless hunters".
  MOST IMPORTANT: it must directly and sensibly answer THIS question about its real subject (no vague poetic filler like silence, shadows, secrets, dust).
  Form rules, second priority (the words are laid out as a block): every word has 4 to 8 letters, try to make the words of similar length with
  the longest word having 7 or 8 letters (never at the cost of a good answer). Letters only (the marks below are the only exception), no digits,
  and NO word may contain the letter W or the letter M (they are too wide for the layout).
  Now and then (roughly one in three, NOT always) attach ? and/or ! directly to the end of one or two of the words, for example
  "Silence needs quiet signals?!" or "Burning? Paper creates ashes!". At most two marks in total; the marks do not count as letters.
  Always provide it, even if there is no stamped mark. If there is no readable question, use "Unclear sheet try again".
- "symbols": a list that is EMPTY unless you clearly see a stamped mark on the sheet. Allowed marks:
  a hash sign # (two roughly vertical and two roughly horizontal strokes that cross each other) and
  a question mark ? (a hook curve with a dot below) and
  an exclamation mark ! (one vertical stroke with a dot below). A separate mark on the sheet counts. A ? or ! at the end of the printed
  sentence is handled through the "question" field and does not have to be repeated here.
  For each one give {"symbol": "#" or "?" or "!", "box": [ymin, xmin, ymax, xmax]}, its bounding box with values from 0 to 1000,
  Report at most ONE mark. Many photos contain NO stamped mark at all - then return []. Never report a mark because one is expected, never guess.
  Ignore every other symbol, punctuation, noise, crossing lines, grid lines, folds, shadows and parts of letters.
`;

// holt Felder aus einem abgeschnittenen JSON
function salvageJson(raw) {
    const str = key => {
        const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
        return m ? m[1].replace(/\\"/g, '"') : "";
    };
    const symbols = [];
    const re = /\{\s*"symbol"\s*:\s*"([^"]*)"\s*,\s*"box"\s*:\s*\[\s*([\d.\s,-]+?)\s*\]\s*\}/g;
    let m;
    while ((m = re.exec(raw)) && symbols.length < 6) symbols.push({ symbol: m[1], box: m[2].split(",").map(Number) });
    return { question: str("question"), answer: str("answer"), letter_verb: str("letter_verb"), counter_question: str("counter_question"), four_word_answer: str("four_word_answer"), symbols: symbols };
}

// ----------------------------------------
// VIER WÖRTER für die !-Ansicht
// Regeln: genau 4 Wörter, jedes 3 bis 8 Buchstaben, nur Buchstaben, kein W und kein M (zu breit fürs Raster),
// und die vier Wörter sollen zusammen Sinn ergeben. Das formuliert Gemini; bricht es die Regeln, wird es neu gefragt.
// ----------------------------------------

// Regelstufen: Die INHALTLICHE Antwort auf die Frage ist immer wichtiger als die Form. Zuerst gelten die schöneren Regeln (ähnlich lange Wörter füllen das
// Quadrat besser), passt kein Vorschlag, werden sie gelockert. Kein W und kein M gilt immer. Eine fremde Notfall-Wendung gibt es für echte Fragen nicht.
const FOUR_TIERS = [
    { min: 4, max: 8, longest: 7, spread: 3 },   // ideal: Wörter mit 4 bis 8 Buchstaben, ähnlich lang, mindestens eines mit 7 oder 8
    { min: 3, max: 8, longest: 6, spread: 4 },   // gelockert
    { min: 3, max: 8, longest: 0, spread: 99 }   // Mindestregeln: 3 bis 8 Buchstaben, kein W/M
];
const FOUR_TRIES = 2;   // so oft wird Gemini nach neuen Vorschlägen gefragt (jedes Mal mehrere Vorschläge auf einmal)

const cleanWords = text => String(text || "").split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, "")).filter(Boolean);

// Wörter MIT den erlaubten Satzzeichen ? und ! am Wortende (höchstens zwei Zeichen insgesamt). Ein Token nur aus Zeichen hängt sich ans vorherige Wort.
const FOUR_MAX_MARKS = 2;
function splitWithMarks(text) {
    const out = [];
    let marks = 0;
    String(text || "").split(/\s+/).filter(Boolean).forEach(tok => {
        const letters = tok.replace(/[^\p{L}]/gu, "");
        let m = tok.replace(/[^?!]/g, "");
        m = m.slice(0, Math.max(0, FOUR_MAX_MARKS - marks));
        marks += m.length;
        if (letters) out.push({ letters: letters, text: letters + m });
        else if (out.length) out[out.length - 1].text += m;
    });
    return out;
}

// prüft einen Vorschlag gegen eine Regelstufe: gibt die vier Wörter zurück, sonst null (und in problems, was nicht stimmte)
function checkFourWords(raw, tier = FOUR_TIERS[0]) {
    const parts = splitWithMarks(raw);
    const words = parts.map(p => p.letters);
    const problems = [];
    if (words.length !== 4) problems.push("it has " + words.length + " words instead of exactly 4");
    words.forEach(w => {
        if (w.length < tier.min) problems.push('"' + w + '" is shorter than ' + tier.min + " letters");
        else if (w.length > tier.max) problems.push('"' + w + '" is longer than ' + tier.max + " letters");
        if (/[wm]/i.test(w)) problems.push('"' + w + '" contains the letter W or M');
    });
    if (words.length === 4 && problems.length === 0) {
        const lens = words.map(w => w.length);
        if (Math.max(...lens) < tier.longest) problems.push("the longest word has fewer than " + tier.longest + " letters");
        if (Math.max(...lens) - Math.min(...lens) > tier.spread) problems.push("the longest and the shortest word differ by more than " + tier.spread + " letters");
    }
    return { words: problems.length === 0 ? parts.map(p => p.text) : null, problems: problems };
}

// Notlösung, falls Gemini es auch nach mehreren Versuchen nicht schafft: eine feste Wendung (alle Wörter 3 bis 8 Buchstaben, kein W, kein M)
const FOUR_WORD_PHRASES = ["Silence needs quiet signals", "Paper keeps hidden secrets", "Stones outlast every season", "Silent letters carry stories",
    "Tired pilots chase sunsets", "Fresh paper hides secrets", "Cities breathe electric silence", "Thunder erases ancient tracks",
    "Burning paper creates ashes", "Quiet streets collect silence", "Dusty letters sleep quietly", "Nobody reads boring posters"];
function fallbackFourWords() {
    return FOUR_WORD_PHRASES[Math.floor(Math.random() * FOUR_WORD_PHRASES.length)];
}

// Das beste Ergebnis aus allen Vorschlägen. Die Passung zur Frage kommt zuerst (Gemini sortiert die Vorschläge danach):
// 1) unter den ersten drei Vorschlägen der erste, der auch die schönen Regeln (Stufe 1) erfüllt,
// 2) sonst der erste Vorschlag, der die gelockerten Regeln (Stufe 2) erfüllt, 3) sonst der erste, der die Mindestregeln (Stufe 3) erfüllt.
function bestFourWords(candidates) {
    const pick = (list, t) => { for (const c of list) { const r = checkFourWords(c, FOUR_TIERS[t]); if (r.words) return r.words.join(" "); } return null; };
    const top = pick(candidates.slice(0, 3), 0);
    if (top) return { text: top, tier: 0 };
    for (let t = 1; t < FOUR_TIERS.length; t++) {
        const text = pick(candidates, t);
        if (text) return { text: text, tier: t };
    }
    return null;
}

// Gemini formuliert vier passende Wörter zur Frage. Es liefert pro Anfrage mehrere Vorschläge auf einmal, der Server wählt den besten
// (candidate = ein schon vorhandener Vorschlag, wird zuerst geprüft)
async function fourWordsFor(question, answer, candidate, allowBackup = false) {
    const strict = checkFourWords(candidate);
    if (strict.words) return strict.words.join(" ");

    const candidates = candidate ? [candidate] : [];
    for (let i = 0; i < FOUR_TRIES; i++) {
        try {
            const prompt =
                "You are a cold, emotionless, factual AI assistant. Give 10 DIFFERENT options that answer the question with EXACTLY FOUR words each.\n" +
                "MOST IMPORTANT: every option must directly and sensibly answer THIS question about its actual subject, as one meaningful, grammatical short phrase" +
                (answer ? ' that expresses the same idea as this short answer: "' + String(answer).slice(0, 120) + '"' : "") + ".\n" +
                "Use the real subject of the question. Do NOT fall back on vague poetic filler (silence, shadows, secrets, dust, hidden, faded, quiet) unless the question is about that.\n" +
                "Sort the options from the best answer to the weakest. Then the form rules, which come second (the words are shown as a block of four lines):\n" +
                "- each word has " + FOUR_TIERS[0].min + " to " + FOUR_TIERS[0].max + " letters (no one- or two-letter words such as a, is, of, to);\n" +
                "- try to make the words of similar length, with the longest word having 7 or 8 letters, but never at the cost of a good answer;\n" +
                "- letters only, no digits, no emojis; the only allowed punctuation: in about one option out of three attach ? and/or ! to the end of one or two words (at most two marks in total);\n" +
                "- NO word may contain the letter W or the letter M (check every word, for example avoid: time, from, home, between, always, answer, would, memory, human).\n" +
                "Examples of the style (other topics): \"Planets circle distant stars\", \"Hunger drives restless hunters\".\n" +
                (candidates.length ? 'Earlier attempts broke the rules: ' + candidates.slice(-4).map(c => '"' + String(c).slice(0, 60) + '"').join(", ") + ". Do better.\n" : "") +
                'Question: "' + String(question).slice(0, 300) + '"\n' +
                'Return only JSON: {"options": ["four words", "four words", ...]}';
            const response = await Promise.race([
                ai.models.generateContent({
                    model: VISION_MODEL,
                    contents: prompt,
                    config: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 600 }
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000))
            ]);
            const raw = (response.text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
            let options = [];
            try {
                const parsed = JSON.parse(raw);
                options = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.options) ? parsed.options : []);
            } catch {
                options = [...raw.matchAll(/"([^"\n]{8,80})"/g)].map(m => m[1]);   // abgeschnittenes JSON: soviel wie möglich retten
            }
            options.forEach(o => candidates.push(String(o)));
            const best = bestFourWords(candidates);
            if (best && best.tier <= 1) return best.text;   // gut genug gefunden
            console.warn("Vier Wörter (Versuch " + (i + 1) + "): kein Vorschlag passt ganz, Vorschläge:", options.slice(0, 5).join(" | "));
        } catch (err) {
            console.warn("Vier Wörter: Gemini-Fehler:", err.message);
        }
    }
    const best = bestFourWords(candidates);
    if (best) { console.log("Vier Wörter mit gelockerten Regeln (Stufe " + (best.tier + 1) + "):", best.text); return best.text; }
    return allowBackup ? fallbackFourWords() : "";   // bei einer echten Frage keine fremde Wendung: der Client zeigt dann die normale Antwort (?)
}

// Gemini formuliert die vier Wörter (der Client ruft das nur, wenn ! gebraucht wird und der Vorschlag aus dem Foto-Lesen nicht passte)
app.post("/four-words", async (req, res) => {
    try {
        const question = String(req.body.question || "").trim().slice(0, 300);
        const answer = String(req.body.answer || "").trim().slice(0, 200);
        if (!question) return res.status(400).json({ error: "Keine Frage erhalten." });
        res.json({ four_word_answer: await fourWordsFor(question, answer, "", false) });
    } catch (error) {
        console.error("Vier-Wörter-Fehler:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/read-sheet", async (req, res) => {

    try {

        const image = req.body.image;
        if (typeof image !== "string" || image.length < 100) {
            return res.status(400).json({ error: "Kein Bild erhalten." });
        }

        const response = await Promise.race([
            ai.models.generateContent({
                model: VISION_MODEL,
                contents: [{
                    role: "user",
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: image } },
                        { text: readSheetPrompt }
                    ]
                }],
                config: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 2048 }
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Gemini antwortet nicht (Timeout nach 20 s).")), 20000)
            )
        ]);

        const raw = (response.text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Antwort abgeschnitten oder kaputt: soviel wie möglich retten (Frage, Antworten, vollständige Zeichen)
            console.warn("Gemini-JSON unvollständig, rette Felder. Rohantwort:", raw.slice(0, 600));
            parsed = salvageJson(raw);
            if (!parsed.question && !parsed.answer) {
                throw new Error("Antwort von Gemini war kein JSON: " + raw.slice(0, 300));
            }
        }
        if (Array.isArray(parsed)) parsed = parsed[0];   // manchmal kommt das Objekt in einer Liste
        if (!parsed || typeof parsed !== "object") parsed = {};

        const question = String(parsed.question || "").trim();
        const answer = limitWords(String(parsed.answer || ""));
        const fourWordAnswer = checkFourWords(parsed.four_word_answer).words;   // nur wenn alle Regeln stimmen, sonst "" (dann fragt der Client bei Bedarf über /four-words nach)
        const letterVerb = cleanLetterVerb(parsed.letter_verb);
        const counterQuestion = String(parsed.counter_question || "").replace(/\s+/g, " ").trim().slice(0, 160);
        const rawSymbols = Array.isArray(parsed.symbols) ? parsed.symbols : [];

        // nur #, ? und ! mit gültiger Box (4 Zahlen, 0-1000) zählen
        const symbols = [];
        const boxes = [];
        rawSymbols.forEach(item => {
            if (!item || typeof item !== "object") return;
            const sym = String(item.symbol ?? "").trim();
            const box = Array.isArray(item.box) ? item.box.map(Number) : [];
            if (symbols.length === 0 && (sym === "#" || sym === "?" || sym === "!") && box.length === 4 && box.every(n => Number.isFinite(n))) {   // nur ein Zeichen zählt
                symbols.push(sym);
                boxes.push(box.map(n => Math.min(1000, Math.max(0, n))));
            }
        });

        console.log("--------------------------------");
        console.log("Bild gelesen:", JSON.stringify({ question, answer, letterVerb, fourWordAnswer, symbols, boxes }));
        console.log("--------------------------------");

        res.json({ question: question, answer: answer, letter_verb: letterVerb, counter_question: counterQuestion, four_word_answer: fourWordAnswer ? fourWordAnswer.join(" ") : "", symbols: symbols, boxes: boxes });

    } catch (error) {

        console.error("Bild-Lese-Fehler:", error);
        res.status(500).json({ error: error.message });

    }

});



// ----------------------------------------
// ZUFALLSTEXT (beim ersten Öffnen der Seite, solange es noch keinen Input gab)
// Gleiche Regeln wie bei einer echten Antwort: 1 bis 6 Wörter, dazu die vier Wörter für die !-Ansicht.
// ----------------------------------------

const RANDOM_TOPICS = ["tea", "time", "the future", "machines", "silence", "weather", "money", "stars", "memory", "glass",
    "cities", "sleep", "fire", "water", "paper", "posters", "typography", "letters", "light", "dust", "mirrors", "noise",
    "clocks", "rain", "walls", "doors", "maps", "rooms", "birds", "salt", "metal", "ink"];

app.post("/random-text", async (req, res) => {

    try {

        const topic = RANDOM_TOPICS[Math.floor(Math.random() * RANDOM_TOPICS.length)];
        const avoid = (Array.isArray(req.body && req.body.avoid) ? req.body.avoid : []).slice(-8)
            .map(x => String(x).replace(/["`\\]/g, "'").slice(0, 80));

        const prompt = systemInstruction + `
No question was asked. Invent one random, surprising statement in your cold voice. Topic hint: "${topic}".${avoid.length ? "\nDo NOT repeat or closely resemble any of these earlier statements: " + avoid.map(x => '"' + x + '"').join(", ") + "." : ""}
Return only JSON: {"answer": "...", "letter_verb": "...", "counter_question": "...", "four_word_answer": "..."}
- "answer": the statement, 1 to 6 words (sometimes 1 to 3), never more than 6 words. Now and then (about one in three) with one or two of the marks ? ! & as described above.
- "letter_verb": one lowercase word that completes "<answer>. And so ___ this letter." grammatically (is, isn't, was, wasn't, does, doesn't, did, didn't,
  can, can't, will, won't, has, hasn't, could, couldn't, would, wouldn't, should or shouldn't; negative form for negative statements),
  for example "Time heals everything" -> "does", "Silence is cold" -> "is", "Nothing stays hidden" -> "doesn't", "All stars die!" -> "does".
  Find the main verb: a form of "to be" -> is/was; any other present verb -> does; other verb in the past -> did; no verb at all (adjective or noun phrase) -> is.
- "counter_question": a short, cold, slightly provocative question the assistant asks the user in reaction to the statement, at most 10 words, ends with a question mark.
- "four_word_answer": a second statement of EXACTLY FOUR words that reads as one meaningful, grammatical phrase, for example "Burning paper creates ashes".
  The four words are shown as a block, so they must be of similar length: every word has 5 to 8 letters, the longest has 7 or 8 letters,
  longest and shortest differ by at most 2 letters, letters only, and NO word may contain the letter W or the letter M.
  Now and then (about one in three) attach ? and/or ! to the end of one or two words (at most two marks in total).`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: VISION_MODEL,
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 1.3, maxOutputTokens: 512 }
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Gemini antwortet nicht (Timeout nach 15 s).")), 15000)
            )
        ]);

        const raw = (response.text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = salvageJson(raw); }
        if (Array.isArray(parsed)) parsed = parsed[0];
        if (!parsed || typeof parsed !== "object") parsed = {};

        const answer = limitWords(String(parsed.answer || ""));
        if (!answer) throw new Error("Gemini lieferte keinen Zufallstext.");

        const out = {
            answer: answer,
            letter_verb: cleanLetterVerb(parsed.letter_verb),
            counter_question: String(parsed.counter_question || "").replace(/\s+/g, " ").trim().slice(0, 160),
            four_word_answer: await fourWordsFor("Restate this statement in four words: " + answer, answer, parsed.four_word_answer, true)
        };
        console.log("Zufallstext:", JSON.stringify({ topic, ...out }));
        res.json(out);

    } catch (error) {

        console.error("Zufallstext-Fehler:", error.message);
        res.status(500).json({ error: error.message });

    }

});


// ----------------------------------------
// # PRÜFEN: Gemini sieht NUR den kleinen Ausschnitt um das gemeldete Zeichen
// (ohne Frage und Umgebung, so kann es sich nichts dazu denken)
// ----------------------------------------

app.post("/verify-crop", async (req, res) => {

    try {

        const image = req.body.image;
        const wanted = ["?", "!"].includes(req.body.symbol) ? req.body.symbol : "#";

        if (typeof image !== "string" || image.length < 100) {
            return res.status(400).json({ error: "Kein Bild erhalten." });
        }

        const prompt = wanted === "#"
            ? `This small image is a crop from a photo of a paper sheet. ` +
              `Does it show a hash sign # (the keyboard symbol: two roughly vertical and two roughly horizontal ` +
              `strokes crossing each other)? Letters, single lines, noise, folds, shadows or empty paper are NOT a hash sign. ` +
              `Return only JSON in exactly this form: {"present": true or false, "confidence": number from 0 to 1}`
            : wanted === "!"
            ? `This small image is a crop from a photo of a paper sheet. ` +
              `Does it show an exclamation mark ! (one vertical stroke with a separate dot below it)? ` +
              `Letters (such as I, l or i), numbers, a question mark, single lines without a dot, noise, folds, shadows or empty paper are NOT an exclamation mark. ` +
              `Return only JSON in exactly this form: {"present": true or false, "confidence": number from 0 to 1} ` +
              `where "present" means: yes, an exclamation mark is clearly visible.`
            : `This small image is a crop from a photo of a paper sheet. ` +
              `Does it show a question mark ? (a curved hook with a dot below it)? ` +
              `Letters, numbers, single lines, noise, folds, shadows or empty paper are NOT a question mark. ` +
              `Return only JSON in exactly this form: {"present": true or false, "confidence": number from 0 to 1} ` +
              `where "present" means: yes, a question mark is clearly visible.`;

        // Antwort lesen: Gemini hält sich nicht immer an die Schlüsselnamen (oder liefert eine Liste). Deshalb wird jede Form verstanden;
        // bei einer unlesbaren Antwort wird einmal neu gefragt.
        const readVerdict = raw => {
            let parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) parsed = parsed[0];
            if (typeof parsed === "boolean") parsed = { present: parsed };
            if (!parsed || typeof parsed !== "object") return null;
            let found = [parsed.present, parsed.hash, parsed.visible, parsed.result, parsed.answer, parsed.exclamation_mark, parsed.question_mark]
                .find(v => typeof v === "boolean" || v === "true" || v === "false");
            if (found === undefined) found = Object.values(parsed).find(v => typeof v === "boolean");
            if (found === undefined) return null;
            const present = found === true || found === "true";
            let confidence = Number(parsed.confidence);
            if (!Number.isFinite(confidence)) {
                const word = String(parsed.confidence || "").toLowerCase();
                confidence = word === "high" ? 0.9 : word === "medium" ? 0.7 : word === "low" ? 0.4 : (present ? 0.85 : 0);   // fehlt der Wert, gilt ein klares "ja" als 0.85
            }
            return { present: present, confidence: confidence };
        };

        let verdict = null, raw = "";
        for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
            const response = await Promise.race([
                ai.models.generateContent({
                    model: VISION_MODEL,
                    contents: [{
                        role: "user",
                        parts: [
                            { inlineData: { mimeType: "image/jpeg", data: image } },
                            { text: prompt }
                        ]
                    }],
                    config: { responseMimeType: "application/json", temperature: 0 }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Gemini antwortet nicht (Timeout nach 20 s).")), 20000)
                )
            ]);
            raw = (response.text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
            try { verdict = readVerdict(raw); } catch { verdict = null; }
            if (!verdict) console.warn("Prüfung (" + wanted + "): Antwort nicht lesbar:", raw.slice(0, 200));
        }
        if (!verdict) throw new Error("Prüfantwort von Gemini nicht lesbar: " + raw.slice(0, 100));

        const confidence = verdict.confidence;
        const hash = verdict.present && confidence >= 0.8;

        console.log("Ausschnitt (" + wanted + ") geprüft:", JSON.stringify({ present: verdict.present, confidence: confidence, ergebnis: hash }));
        res.json({ hash: hash, confidence: confidence });

    } catch (error) {

        console.error("Prüf-Fehler:", error);
        res.status(500).json({ error: error.message });

    }

});

// ----------------------------------------
// STIMME ALS NOTLÖSUNG (nur macOS): Blockiert der Browser die Sprachausgabe (Chrome erlaubt sie erst nach einem Klick auf die Seite),
// spricht der Mac den Text selbst mit dem Systemprogramm "say". Mit der Stimme des Systems, ohne dass geklickt werden muss.
// Eine bestimmte Stimme: SAY_VOICE=Samantha in der .env (Liste im Terminal: say -v ?)
// ----------------------------------------

let sayProcess = null;

function stopSay() {
    if (sayProcess) {
        try { sayProcess.kill(); } catch {}
        sayProcess = null;
    }
}

app.post("/api/say", (req, res) => {
    const text = String(req.body.text || "").trim().slice(0, 1000);
    if (process.platform !== "darwin") return res.status(501).json({ error: "say gibt es nur auf macOS" });
    if (!text) return res.status(400).json({ error: "Kein Text erhalten." });
    stopSay();
    const voice = (process.env.SAY_VOICE || "").trim();
    const args = voice ? ["-v", voice] : [];
    const child = spawn("say", args, { stdio: ["pipe", "ignore", "ignore"] });   // Text über stdin, nie über die Shell
    child.on("error", err => console.warn("say fehlgeschlagen:", err.message));
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    sayProcess = child;
    res.json({ ok: true });
});

app.post("/api/say-stop", (req, res) => {
    stopSay();
    res.json({ ok: true });
});

// ----------------------------------------
// SERVER STARTEN
// ----------------------------------------

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});