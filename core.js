// core.js — the deck, the scoring, the data. Shared by the player page and the
// teacher's page, so both agree on what a card is and what a solve is worth.

const SHAPES = ["star", "circle", "triangle", "square", "diamond"];
const COLOURS = ["cyan", "amber", "violet", "green"];
const GLYPH = { star: "★", circle: "●", triangle: "▲", square: "■", diamond: "◆" };
const INK = { cyan: "#22b8d0", amber: "#d9a02c", violet: "#8a6ee8", green: "#2f9b63" };
const TINT = {
  cyan: "rgba(34,184,208,.26)",
  amber: "rgba(217,160,44,.28)",
  violet: "rgba(138,110,232,.26)",
  green: "rgba(47,155,99,.26)",
};

// A–Z with numbers 1–26. The shape and colour cycle is the same one cards.py
// uses; change it in both places or the pictures stop matching the clues.
const DECK = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter, i) => ({
  letter,
  number: i + 1,
  shape: SHAPES[i % SHAPES.length],
  colour: COLOURS[i % COLOURS.length],
}));
const CARD = Object.fromEntries(DECK.map(c => [c.letter, c]));

const BONUS = [60, 45, 35, 25, 20, 15, 10, 10, 10, 10];
const WRONG_COST = 20;
const HINT_COST = 20;
const ROUND_CLUES = [4, 5, 6];

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

// n choose k, staying exact for the small numbers used here
function choose(n, k) {
  if (k < 0 || n < k) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

// Where these four letters fall among the 14,950 four-card codes, in
// alphabetical order — exactly the number build.py wrote into sets.json.
// Order of picking does not matter: the code is a set.
function comboIndex(picked) {
  const at = picked.map(l => l.charCodeAt(0) - 65).sort((a, b) => a - b);
  if (at.length !== 4) return -1;
  let rank = 0, start = 0;
  for (let t = 0; t < 4; t++) {
    for (let j = start; j < at[t]; j++) rank += choose(25 - j, 3 - t);
    start = at[t] + 1;
  }
  return rank;
}

function bonusFor(place) {
  if (!place) return 0;
  return BONUS[place - 1] === undefined ? 10 : BONUS[place - 1];
}

// A round record: { wrong, hint, solvedAt, place }. Points are derived, never
// stored, so a phone and the big screen can never disagree about a score.
function pointsFor(rec) {
  if (!rec || !rec.place) return 0;
  const cost = WRONG_COST * (rec.wrong || 0) + (rec.hint ? HINT_COST : 0);
  return Math.max(0, 100 + bonusFor(rec.place) - cost);
}

function recordOf(state, round, pid) {
  return (state && state.rounds && state.rounds[round] && state.rounds[round][pid]) || null;
}

function totalPoints(state, pid) {
  let sum = 0;
  for (const round of Object.keys((state && state.rounds) || {})) {
    sum += pointsFor(recordOf(state, Number(round), pid));
  }
  return sum;
}

function totalSolve(state, pid) {
  let sum = 0;
  for (const round of Object.keys((state && state.rounds) || {})) {
    const rec = recordOf(state, Number(round), pid);
    if (rec && rec.place) sum += rec.solvedAt || 0;
  }
  return sum;
}

function standings(state) {
  const players = Object.entries((state && state.players) || {});
  return players
    .map(([pid, p]) => ({
      pid,
      name: p.name || "?",
      points: totalPoints(state, pid),
      solve: totalSolve(state, pid),
      rounds: Object.keys((state && state.rounds) || {})
        .map(r => ({ round: Number(r), rec: recordOf(state, Number(r), pid) }))
        .filter(x => x.rec && x.rec.place),
    }))
    .sort((a, b) => b.points - a.points || a.solve - b.solve || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- data

let SETS = null;
let ANSWERS = null;

async function loadSets() {
  if (SETS) return SETS;
  // "no-cache" means revalidate: GitHub Pages answers with a cheap 304 unless
  // the puzzle really changed. "force-cache" would pin a class to the build it
  // first saw, which is how a screen ends up showing yesterday's clues.
  const r = await fetch("data/sets.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("puzzle file missing");
  SETS = await r.json();
  return SETS;
}

// Fetched only when a round is revealed, so the answer is not in the page (or
// in the network tab) while anyone is still solving.
async function loadAnswers() {
  if (ANSWERS) return ANSWERS;
  const r = await fetch("data/answers.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("answer file missing");
  ANSWERS = await r.json();
  return ANSWERS;
}

// Both data files carry the same build hash, and every room remembers the build
// it was made with. Without these two checks a tab can hold one build's clues
// and fetch another build's answer — two right answers for one puzzle, with no
// warning. A mismatch is never resolved by guessing: the page says so.
function answersOutOfDate() {
  return !!(SETS && ANSWERS && SETS.build && ANSWERS.build
    && SETS.build !== ANSWERS.build);
}

function staleRoom(state) {
  return !!(state && state.build && SETS && SETS.build
    && state.build !== SETS.build);
}

const STALE_TEXT = "This game was started with a different version of the page. "
  + "Reload this tab (Ctrl+Shift+R). If it says this again, ask your teacher to start a new game.";

function setFor(code, sets) {
  const n = sets.count || sets.sets.length;
  const digits = String(code).replace(/\D/g, "");
  const seed = digits ? Number(digits) : 0;
  return seed % n;
}

function cardTile(card, cls = "") {
  return `<div class="card ${cls}" data-card="${card.letter}"
       style="--c:${INK[card.colour]};--wash:${TINT[card.colour]}">
    <div class="cletter">${card.letter}</div>
    <div class="cnum">${card.number}</div>
    <div class="cmark" style="color:${INK[card.colour]}">${GLYPH[card.shape]}</div>
  </div>`;
}

function answerCards(letters) {
  return `<div class="answerrow">${letters.map(l => cardTile(CARD[l], "answer")).join("")}</div>`;
}
