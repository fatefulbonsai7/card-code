// play.js — the page on a kid's Chromebook: join, read the clues, pick four
// cards, submit, watch the answer come up.

const root = document.getElementById("app");

let pid = null;
let myName = "";
let code = null;
let picked = [];
let sending = false;
let submittedSig = "";   // the exact four cards already sent this round
let lastView = "";
let lastStatus = "";
let tickTimer = null;
let hintSeen = 0;

// Who this tab is lives in sessionStorage, not localStorage: three tabs on one
// Chromebook are three different students, and a reload still knows your seat.
// The last used game code goes in localStorage, because that is about the device.
const tab = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  drop(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
};
const device = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  drop(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

function newPid() {
  return "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function queriedCode() {
  const url = new URL(location.href);
  return (url.searchParams.get("g") || "").replace(/\D/g, "").slice(0, 4);
}

// ---------------------------------------------------------------- screens

function renderLanding(message) {
  lastView = "landing";
  const prefill = queriedCode() || device.get("cc:last") || "";
  root.className = "wrap landing";
  root.innerHTML = `
    <div class="brand">CARD<span>CODE</span></div>
    <p class="lede">Four cards out of twenty-six. The clues are on your screen.<br>
      Find the code before the rest of the class does.</p>
    ${message ? `<div class="warnbox">${esc(message)}</div>` : ""}
    <div class="joincard">
      <label class="label" for="g">Game code</label>
      <input id="g" class="codeinput" inputmode="numeric" maxlength="4"
             placeholder="0000" value="${esc(prefill)}" autocomplete="off">
      <label class="label" for="nm">Your name</label>
      <input id="nm" maxlength="14" placeholder="first name" autocomplete="off"
             value="${esc(tab.get("cc:name") || "")}">
      <button class="primary big" id="go">Join the game</button>
      <div class="dim small">Ask your teacher for the four-digit code on the board.</div>
    </div>
    <div class="foot">${Room.live ? "" : demoNote()}</div>`;

  const go = document.getElementById("go");
  const codeIn = document.getElementById("g");
  const nameIn = document.getElementById("nm");
  (codeIn.value ? nameIn : codeIn).focus();
  go.onclick = join;
  nameIn.onkeydown = e => { if (e.key === "Enter") join(); };
  codeIn.onkeydown = e => { if (e.key === "Enter") nameIn.focus(); };
}

function demoNote() {
  return `<span class="pilldemo">Demo mode</span> no server is configured, so only tabs in
    this browser can see each other. Add a Firebase URL in <code>config.js</code> to play
    across the class.`;
}

async function join() {
  const codeIn = document.getElementById("g");
  const nameIn = document.getElementById("nm");
  if (!codeIn || !nameIn) return;
  const wanted = codeIn.value.replace(/\D/g, "");
  const nm = nameIn.value.trim().slice(0, 14);
  if (wanted.length !== 4) return renderLanding("The game code is four digits — check the board.");
  if (!nm) return renderLanding("Put your name in first.");

  const btn = document.getElementById("go");
  btn.disabled = true;
  btn.textContent = "Joining…";

  code = wanted;
  myName = nm;
  tab.set("cc:name", nm);

  let state = null;
  try { state = await Room.enter(code); } catch (e) { state = null; }
  if (!state) {
    // Say which failure this is. Thirty Chromebooks all reading "no game with that
    // code" while the room is plainly running on the projector is a bad five minutes.
    return renderLanding(Room.live
      ? `No game called ${code} yet. Check the code on the board.`
      : `No game called ${code} in this browser. This copy has no server set up, so it
         can only play tabs of one computer — the page needs a Firebase URL in
         config.js before a class can join.`);
  }

  // Only a code that really is a game is remembered for next time, so a typo
  // does not leave the next person on this Chromebook staring at a dead code.
  device.set("cc:last", code);
  pid = tab.get("cc:pid:" + code);
  if (!pid) { pid = newPid(); tab.set("cc:pid:" + code, pid); }
  hintSeen = Number(tab.get("cc:hint:" + code + ":" + (state.round || 0)) || 0);

  // A phone that already had a seat keeps its name; a new one says hello.
  const mine = (state.players || {})[pid];
  const patch = mine ? {} : { name: nm, at: Date.now() };
  if (mine && mine.name !== nm) patch.name = nm;
  if (Object.keys(patch).length) await Room.patch("players/" + pid, patch);

  Room.onChange(render);
  if (Room.state) render(Room.state);
}

// ---------------------------------------------------------------- the room

function render(state) {
  if (!state) return renderLanding();
  const round = state.round || 0;
  const rec = recordOf(state, round, pid);

  if (state.phase === "lobby") return renderLobby(state);
  if (state.phase === "play") return renderPlay(state, round, rec);
  if (state.phase === "reveal") return renderReveal(state, round, rec);
  return renderDone(state);
}

function renderLobby(state) {
  stopClock();
  const count = Object.keys(state.players || {}).length;
  if (lastView === "lobby") {
    const c = document.getElementById("count");
    if (c) c.textContent = `${count} player${count === 1 ? "" : "s"} in`;
    return;
  }
  lastView = "lobby";
  root.className = "wrap center";
  root.innerHTML = `
    <div class="brand small">CARD<span>CODE</span></div>
    <div class="bigword">You're in.</div>
    <div class="dim" id="count">${count} player${count === 1 ? "" : "s"} in</div>
    <div class="three">
      <div><b>1</b><span>4 clues</span></div>
      <div><b>2</b><span>5 clues</span></div>
      <div><b>3</b><span>6 clues</span></div>
    </div>
    <div class="hint">${esc(myName || "Your name")}, wait for your teacher to start.</div>`;
}

function renderPlay(state, round, rec) {
  const view = "play:" + round;
  const solved = rec && rec.solvedAt != null;
  const startClock = () => {
    stopClock();
    tickTimer = setInterval(() => {
      const el = document.getElementById("clock");
      if (!el) return stopClock();
      el.textContent = clock((Date.now() - (state.roundStart || Date.now())) / 1000);
    }, 500);
  };

  if (lastView !== view) {
    lastView = view;
    picked = [];
    submittedSig = "";
    hintSeen = Number(tab.get("cc:hint:" + code + ":" + round) || 0);
    const set = SETS.sets[state.set];
    const puzzle = set.rounds[round];
    root.className = "wrap play";
    root.innerHTML = `
      <div class="topbar">
        <div class="roundpill">Round ${round + 1} <span>· ${puzzle.clues.length} clues</span></div>
        <div class="timer" id="clock">0:00</div>
      </div>
      <div class="clues">${puzzle.clues.map((c, i) =>
        `<div class="clue"><b>${i + 1}</b><span>${esc(c)}</span></div>`).join("")}</div>
      <div class="pickbar">
        <div class="slots" id="slots"></div>
        <button class="ghost small" id="clear">Clear</button>
      </div>
      <div class="grid" id="grid">${DECK.map(c => cardTile(c)).join("")}</div>
      <div class="actions">
        <button class="primary big" id="send" disabled>Submit code</button>
        <button class="ghost" id="hint">Hint · −20 if you solve</button>
      </div>
      <div id="status"></div>`;
    document.getElementById("grid").onclick = e => {
      const tile = e.target.closest("[data-card]");
      if (!tile || solved) return;
      const letter = tile.dataset.card;
      const at = picked.indexOf(letter);
      if (at >= 0) picked.splice(at, 1);
      else if (picked.length < 4) picked.push(letter);
      else return;
      paintSelection();
    };
    document.getElementById("clear").onclick = () => { picked = []; paintSelection(); };
    document.getElementById("send").onclick = () => submit(state, round);
    const hb = document.getElementById("hint");
    if (hb) hb.onclick = () => useHint(state, round, rec);
    paintSelection();
    startClock();
    lastStatus = "";
  }

  paintStatus(state, round, rec);
}

function paintSelection() {
  const slots = document.getElementById("slots");
  if (!slots) return;
  const sorted = picked.slice().sort();
  slots.innerHTML = [0, 1, 2, 3].map(i => {
    const l = sorted[i];
    return l
      ? `<span class="slot on" style="color:${INK[CARD[l].colour]}">${l}</span>`
      : `<span class="slot">·</span>`;
  }).join("");
  document.querySelectorAll("[data-card]").forEach(t => {
    t.classList.toggle("on", picked.includes(t.dataset.card));
  });
  const send = document.getElementById("send");
  if (send) send.disabled = picked.length !== 4 || sending || sameAsSent();
}

function sameAsSent() {
  return picked.length === 4 && submittedSig !== ""
    && picked.slice().sort().join("") === submittedSig;
}

function paintStatus(state, round, rec) {
  const box = document.getElementById("status");
  if (!box) return;
  const sig = JSON.stringify([rec && rec.wrong, rec && rec.hint, rec && rec.solvedAt, rec && rec.place, hintSeen]);
  if (sig === lastStatus) return;
  lastStatus = sig;

  const solved = rec && rec.solvedAt != null;
  const place = rec && rec.place;
  const hints = hintsFor(state, round);

  box.innerHTML = `
    ${solved
      ? `<div class="goodbox">${place
            ? `Solved — ${ordinal(place)} in the class. <b>${pointsFor(rec)} points</b>`
            : "Solved. Waiting for the teacher to reveal…"}</div>`
      : rec && rec.wrong
        ? `<div class="warnbox">Not it. That cost ${WRONG_COST} points — ${rec.wrong === 1
            ? "try again." : rec.wrong + " tries used."}</div>`
        : ""}
    ${hints.slice(0, hintSeen).map(h => `<div class="hintbox">${esc(h)}</div>`).join("")}`;

  const hb = document.getElementById("hint");
  if (hb) hb.style.display = solved || hintSeen >= hints.length ? "none" : "";

  const send = document.getElementById("send");
  if (send) {
    send.disabled = solved || picked.length !== 4 || sending || sameAsSent();
    send.textContent = solved ? "Answer sent"
      : sameAsSent() && !(rec && rec.wrong) ? "Answer sent" : "Submit code";
  }
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function hintsFor(state, round) {
  const set = SETS.sets[state.set];
  return (set.rounds[round].hints || []);
}

async function useHint(state, round, rec) {
  const hints = hintsFor(state, round);
  if (hintSeen >= hints.length) return;
  hintSeen += 1;
  tab.set("cc:hint:" + code + ":" + round, String(hintSeen));
  lastStatus = "";
  paintStatus(state, round, rec);
  await Room.patch(`rounds/${round}/${pid}`, { hint: true });
}

async function submit(state, round) {
  if (sending || picked.length !== 4) return;
  if (sameAsSent()) return;          // the same four cards are never a second guess
  sending = true;
  paintSelection();
  // Read the record fresh: the screen's copy was captured when the round was
  // drawn, and a wrong guess since then would otherwise be overwritten with 0.
  const fresh = Room.state || state;
  const rec = recordOf(fresh, round, pid) || {};
  if (rec.solvedAt != null) { sending = false; return; }

  const puzzle = SETS.sets[(fresh.set !== undefined ? fresh.set : state.set)].rounds[round];
  const mine = {
    wrong: rec.wrong || 0,
    hint: !!rec.hint,
    solvedAt: rec.solvedAt == null ? null : rec.solvedAt,
  };
  submittedSig = picked.slice().sort().join("");
  const right = comboIndex(picked) === puzzle.code;
  if (right) {
    mine.solvedAt = Math.max(0, (Date.now() - (fresh.roundStart || Date.now())) / 1000);
  } else {
    mine.wrong = (rec.wrong || 0) + 1;
  }
  try {
    await Room.patch(`rounds/${round}/${pid}`, mine);
  } catch (e) {
    sending = false;
    const box = document.getElementById("status");
    if (box) box.innerHTML = `<div class="warnbox">That didn't reach the game — tap Submit again.</div>`;
    return;
  }
  sending = false;
  lastStatus = "";
  if (right) picked = [];
  paintSelection();
  paintStatus(Room.state || state, round, recordOf(Room.state || state, round, pid));
}

// ---------------------------------------------------------------- reveal

async function renderReveal(state, round, rec) {
  stopClock();
  const view = "reveal:" + round;
  if (lastView === view) return;
  lastView = view;
  root.className = "wrap reveal";
  root.innerHTML = `<div class="center"><div class="dim">Fetching the answer…</div></div>`;

  let answer = null;
  try {
    const data = await loadAnswers();
    answer = data.sets[state.set].rounds[round];
  } catch (e) {
    root.innerHTML = `<div class="warnbox">Couldn't load the answer. Reload the page.</div>`;
    return;
  }
  if (lastView !== view) return;

  const puzzle = SETS.sets[state.set].rounds[round];
  const solved = rec && rec.place;
  root.innerHTML = `
    <div class="brand small">CARD<span>CODE</span></div>
    <div class="label">Round ${round + 1} · the code was</div>
    ${answerCards(answer.answer)}
    <div class="${solved ? "goodbox" : "warnbox"}">
      ${solved
        ? `${ordinal(rec.place)} to solve · <b>${pointsFor(rec)} points</b>`
        : "Not this time."}
    </div>
    <div class="clues tight">${puzzle.clues.map((c, i) =>
      `<div class="clue"><b>${i + 1}</b><span>${esc(c)}</span></div>`).join("")}</div>
    <details class="explain" ${solved ? "" : "open"}>
      <summary>Why that's the only code</summary>
      ${answer.explain.map(l => `<p>${esc(l)}</p>`).join("")}
    </details>
    <div class="hint">${state.round < ROUND_CLUES.length - 1
      ? "Next round starts when your teacher says." : "Last round — scores are coming up."}</div>`;
}

// ---------------------------------------------------------------- done

function renderDone(state) {
  stopClock();
  if (lastView === "done") return;
  lastView = "done";
  const table = standings(state);
  const row = table.find(r => r.pid === pid);
  const mine = row ? row.points : 0;
  const place = table.findIndex(r => r.pid === pid) + 1;
  root.className = "wrap center";
  root.innerHTML = `
    <div class="brand small">CARD<span>CODE</span></div>
    <div class="label">Your total</div>
    <div class="bigscore">${mine}</div>
    <div class="dim">${row && row.rounds.length
      ? `${place}${place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th"} of ${table.length} · solved ${row.rounds.length} of 3`
      : "No rounds solved this time."}</div>
    <div class="board">${table.slice(0, 12).map((r, i) => `
      <div class="brow ${r.pid === pid ? "me" : ""}">
        <span class="bplace">${i + 1}</span>
        <span class="bname">${esc(r.name)}</span>
        <span class="bpts">${r.points}</span>
      </div>`).join("")}</div>`;
}

function stopClock() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

// ---------------------------------------------------------------- start

(async function start() {
  try {
    await loadSets();
  } catch (e) {
    root.innerHTML = `<div class="wrap center"><div class="warnbox">
      The puzzle file is missing. If you opened this page straight from a folder,
      start a little web server instead — see the README.</div></div>`;
    return;
  }
  const saved = device.get("cc:last");
  const savedName = tab.get("cc:name");
  if (saved && savedName) {
    code = saved;
    myName = savedName;
    pid = tab.get("cc:pid:" + code) || newPid();
    tab.set("cc:pid:" + code, pid);
    let state = null;
    try { state = await Room.enter(code); } catch (e) { state = null; }
    if (state) {
      hintSeen = Number(tab.get("cc:hint:" + code + ":" + (state.round || 0)) || 0);
      Room.onChange(render);
      const mine = (state.players || {})[pid];
      if (!mine) await Room.patch("players/" + pid, { name: myName, at: Date.now() });
      return;
    }
  }
  renderLanding();
})();
