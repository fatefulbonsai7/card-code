// host.js — the teacher's screen: the game code, the room filling up, the round
// clock, who has cracked it, the reveal, and the final table.

const root = document.getElementById("app");

let code = null;
let lastView = "";
let tickTimer = null;
let placing = false;
let answers = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  drop(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const tab = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
};

function joinUrl() {
  const base = location.origin + location.pathname.replace(/host\.html$/, "");
  return base.replace(/\/$/, "") + "/";
}

function shortUrl() {
  try {
    const u = new URL(joinUrl());
    return u.host + u.pathname.replace(/\/$/, "") + "/";
  } catch (e) { return joinUrl(); }
}

// ---------------------------------------------------------------- screens

function renderSetup(message) {
  lastView = "setup";
  root.className = "wrap landing";
  root.innerHTML = `
    <div class="brand">CARD<span>CODE</span></div>
    <p class="lede">Three rounds of four cards out of twenty-six.<br>
      Five clues a round. Every clue is needed — nothing is padding.</p>
    ${message ? `<div class="warnbox">${esc(message)}</div>` : ""}
    <div class="joincard">
      <button class="primary big" id="make">Host a game</button>
      <div class="dim small">You get a four-digit code to put on the board.
        Students open <b>${esc(shortUrl())}</b> and type it.</div>
      <div class="foot">${Room.live ? "" : demoNote()}</div>
    </div>`;
  document.getElementById("make").onclick = makeRoom;
}

function demoNote() {
  return `<span class="pilldemo">Demo mode</span> no server configured, so this screen and
    the players must share one browser. Add a Firebase URL in <code>config.js</code> to
    play across a class.`;
}

async function makeRoom() {
  const btn = document.getElementById("make");
  btn.disabled = true;
  btn.textContent = "Making a room…";
  const sets = await loadSets();
  let tries = 0;
  while (tries < 12) {
    tries += 1;
    const candidate = String(1000 + Math.floor(Math.random() * 9000));
    const opening = {
      v: 1,
      build: sets.build,
      set: setFor(candidate, sets),
      phase: "lobby",
      round: 0,
      roundStart: 0,
      createdAt: Date.now(),
      players: {},
      rounds: {},
    };
    let ok = false;
    try { ok = await Room.create(candidate, opening); } catch (e) { ok = false; }
    if (ok) {
      code = candidate;
      store.set("cc:hosting", code);
      lastView = "";
      Room.onChange(render);
      startHostTick();
      return;
    }
  }
  renderSetup("Couldn't open a room. Check the server address in config.js.");
}

function render(state) {
  if (!state) {
    if (lastView !== "setup") renderSetup();
    return;
  }
  if (staleRoom(state)) return renderStale(state);
  if (state.phase === "lobby") return renderLobby(state);
  if (state.phase === "play") return renderPlayHost(state);
  if (state.phase === "reveal") return renderRevealHost(state);
  return renderDoneHost(state);
}

function renderStale(state) {
  const k = "cc:stale:" + (state.build || "");
  if (!tab.get(k)) {
    tab.set(k, "1");
    location.reload();
    return;
  }
  lastView = "stale";
  root.className = "wrap center";
  root.innerHTML = `<div class="warnbox">${esc(STALE_TEXT)}</div>`;
}

function renderLobby(state) {
  const players = Object.entries(state.players || {});
  if (lastView === "lobby") {
    const list = document.getElementById("lobbylist");
    if (list) list.innerHTML = names(players);
    const btn = document.getElementById("start");
    if (btn) btn.disabled = players.length === 0;
    const n = document.getElementById("lobbycount");
    if (n) n.textContent = `${players.length} here`;
    return;
  }
  lastView = "lobby";
  root.className = "wrap hostwrap";
  root.innerHTML = `
    <div class="hosttop">
      <div class="brand small">CARD<span>CODE</span> ${Room.live ? "" : `<span class="pilldemo">Demo mode</span>`}</div>
      <div class="dim">Students open <b>${esc(shortUrl())}</b></div>
    </div>
    <div class="bigcode">${code}</div>
    <div class="dim center">the game code</div>
    <div class="lobbyrow">
      <div class="lobbybox">
        <div class="label">In the room <span id="lobbycount">${players.length} here</span></div>
        <div id="lobbylist" class="namelist">${names(players)}</div>
      </div>
      <div class="lobbybox">
        <div class="label">How it plays</div>
        <div class="dim small">Three rounds, five clues each. First to crack it gets the
          most points. Every wrong answer costs 20, a hint costs 20.</div>
        <button class="primary big" id="start" ${players.length ? "" : "disabled"}>Start round 1</button>
      </div>
    </div>`;
  document.getElementById("start").onclick = startRound;
}

function names(players) {
  if (!players.length) return `<div class="dim small">Nobody yet — put the code on the board.</div>`;
  return players.map(([, p]) => `<span class="nametag">${esc(p.name || "?")}</span>`).join("");
}

function renderPlayHost(state) {
  const round = state.round || 0;
  const set = SETS.sets[state.set];
  const puzzle = set.rounds[round];
  const recs = (state.rounds || {})[round] || {};
  const players = Object.entries(state.players || {});
  const solved = players.filter(([p]) => recs[p] && recs[p].place)
    .sort((a, b) => recs[a[0]].place - recs[b[0]].place);

  if (lastView !== "play:" + round) {
    lastView = "play:" + round;
    root.className = "wrap hostwrap";
    root.innerHTML = `
      <div class="hosttop">
        <div class="roundpill">Round ${round + 1} <span>· ${puzzle.clues.length} clues</span>
          ${Room.live ? "" : `<span class="pilldemo">Demo mode</span>`}</div>
        <div class="timer" id="clock">0:00</div>
      </div>
      <div class="clues big">${puzzle.clues.map((c, i) =>
        `<div class="clue"><b>${i + 1}</b><span>${esc(c)}</span></div>`).join("")}</div>
      <div class="lobbyrow">
        <div class="lobbybox">
          <div class="label">Cracked it <span id="solvecount"></span></div>
          <div id="solvelist" class="namelist"></div>
        </div>
        <div class="lobbybox">
          <div class="label">Still working</div>
          <div id="workinglist" class="namelist"></div>
          <button class="primary big" id="reveal">Reveal the answer</button>
        </div>
      </div>`;
    document.getElementById("reveal").onclick = reveal;
    startClock(state);
  }
  paintSolved(state, recs, players, solved);
}

function paintSolved(state, recs, players, solved) {
  const box = document.getElementById("solvelist");
  if (!box) return;
  box.innerHTML = solved.length
    ? solved.map(([p, pl]) => {
        const rec = recs[p];
        return `<div class="solver"><span class="bplace">${rec.place}</span>
          <span class="bname">${esc(pl.name || "?")}</span>
          <span class="dim small">${clock(rec.solvedAt)}</span></div>`;
      }).join("")
    : `<div class="dim small">Nobody yet.</div>`;
  const working = players.filter(([p]) => !(recs[p] && recs[p].place));
  const wbox = document.getElementById("workinglist");
  if (wbox) {
    wbox.innerHTML = working.length
      ? working.map(([, pl]) => `<span class="nametag">${esc(pl.name || "?")}</span>`).join("")
      : `<div class="dim small">Everyone has it.</div>`;
  }
  const c = document.getElementById("solvecount");
  if (c) c.textContent = `${solved.length} / ${players.length}`;
}

async function renderRevealHost(state) {
  const round = state.round || 0;
  if (lastView === "reveal:" + round) return;
  lastView = "reveal:" + round;
  root.className = "wrap hostwrap";
  root.innerHTML = `<div class="center"><div class="dim">Loading the answer…</div></div>`;
  try {
    const data = await loadAnswers();
    if (answersOutOfDate()) {
      root.innerHTML = `<div class="warnbox">${esc(STALE_TEXT)}</div>`;
      return;
    }
    answers = data;
  } catch (e) {
    root.innerHTML = `<div class="warnbox">Answer file missing.</div>`;
    return;
  }
  if (lastView !== "reveal:" + round) return;

  const answer = answers.sets[state.set].rounds[round];
  const puzzle = SETS.sets[state.set].rounds[round];
  const recs = (state.rounds || {})[round] || {};
  const players = Object.entries(state.players || {});
  const solved = players.filter(([p]) => recs[p] && recs[p].place)
    .sort((a, b) => recs[a[0]].place - recs[b[0]].place);

  root.innerHTML = `
    <div class="hosttop">
      <div class="roundpill">Round ${round + 1} <span>· ${puzzle.clues.length} clues</span></div>
    </div>
    <div class="label center">the code was</div>
    ${answerCards(answer.answer)}
    <div class="lobbyrow">
      <div class="lobbybox">
        <div class="label">Order</div>
        <div class="namelist">${solved.length ? solved.map(([p, pl]) => {
          const rec = recs[p];
          return `<div class="solver"><span class="bplace">${rec.place}</span>
            <span class="bname">${esc(pl.name || "?")}</span>
            <span class="bpts">+${pointsFor(rec)}</span></div>`;
        }).join("") : `<div class="dim small">Nobody solved this one.</div>`}</div>
      </div>
      <div class="lobbybox">
        <div class="label">Why</div>
        <div class="explainlist">${answer.explain.map(l => `<p>${esc(l)}</p>`).join("")}</div>
      </div>
    </div>
    <div class="center">
      <button class="primary big" id="next">${round < ROUND_CLUES.length - 1
        ? `Start round ${round + 2}` : "Final scores"}</button>
    </div>`;
  document.getElementById("next").onclick = nextRound;
}

async function renderDoneHost(state) {
  if (lastView === "done") return;
  lastView = "done";
  const table = standings(state);
  root.className = "wrap hostwrap";
  root.innerHTML = `
    <div class="brand small center">CARD<span>CODE</span></div>
    <div class="label center">Final scores</div>
    <div class="board wide">${table.map((r, i) => `
      <div class="brow ${i === 0 ? "win" : ""}">
        <span class="bplace">${i + 1}</span>
        <span class="bname">${esc(r.name)}</span>
        <span class="brounds dim">${r.rounds.map(x => `R${x.round + 1} ${pointsFor(x.rec)}`).join(" · ")}</span>
        <span class="bpts">${r.points}</span>
      </div>`).join("") || `<div class="dim">Nobody played.</div>`}</div>
    <div class="center">
      <button class="primary big" id="again">Host another game</button>
    </div>`;
  document.getElementById("again").onclick = () => {
    store.drop("cc:hosting");
    Room.close();
    code = null;
    lastView = "";
    renderSetup();
  };
}

// ---------------------------------------------------------------- controls

async function startRound() {
  const state = Room.state;
  if (!state) return;
  const btn = document.getElementById("start");
  if (btn) btn.disabled = true;
  await Room.patch("", { phase: "play", round: state.round || 0, roundStart: Date.now() });
}

async function reveal() {
  const btn = document.getElementById("reveal");
  if (btn) btn.disabled = true;
  await Room.patch("", { phase: "reveal" });
}

async function nextRound() {
  const state = Room.state;
  const round = state.round || 0;
  const btn = document.getElementById("next");
  if (btn) btn.disabled = true;
  if (round < ROUND_CLUES.length - 1) {
    await Room.patch("", { phase: "play", round: round + 1, roundStart: Date.now() });
  } else {
    await Room.patch("", { phase: "done" });
  }
}

// ---------------------------------------------------------------- places

// The host alone decides the order of solving, so every clock in the room is
// judged by one clock. A phone only says "I have it, and how long I took".
async function assignPlaces() {
  if (placing) return;
  const state = Room.state;
  if (!state || !state.rounds) return;
  const round = state.round || 0;
  const recs = state.rounds[round] || {};
  const pending = Object.entries(recs)
    .filter(([, rec]) => rec.solvedAt != null && !rec.place)
    .sort((a, b) => a[1].solvedAt - b[1].solvedAt);
  if (!pending.length) return;
  placing = true;
  try {
    const taken = new Set(Object.values(recs).filter(r => r.place).map(r => r.place));
    let next = 1;
    for (const [id] of pending) {
      while (taken.has(next)) next += 1;
      await Room.patch(`rounds/${round}/${id}`, { place: next });
      taken.add(next);
    }
  } catch (e) {
    console.error(e);
  }
  placing = false;
}

function startHostTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const state = Room.state;
    if (!state) return;
    if (state.phase === "play") assignPlaces();
    const el = document.getElementById("clock");
    if (el && state.phase === "play") {
      el.textContent = clock((Date.now() - (state.roundStart || Date.now())) / 1000);
    }
  }, 500);
}

function startClock(state) {
  const el = document.getElementById("clock");
  if (el) el.textContent = clock((Date.now() - (state.roundStart || Date.now())) / 1000);
}

// ---------------------------------------------------------------- start

(async function start() {
  try {
    await loadSets();
  } catch (e) {
    root.innerHTML = `<div class="wrap center"><div class="warnbox">
      The puzzle file is missing. Serve the folder over http — see the README.</div></div>`;
    return;
  }
  const saved = store.get("cc:hosting");
  if (saved) {
    code = saved;
    let state = null;
    try { state = await Room.enter(code); } catch (e) { state = null; }
    if (state) {
      Room.onChange(render);
      startHostTick();
      return;
    }
    store.drop("cc:hosting");
  }
  renderSetup();
})();
