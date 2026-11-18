// sync.js — one small room, shared between the teacher's screen and every
// Chromebook. Two backends behind the same four calls:
//
//   firebase : a free Realtime Database, reached over plain REST + EventSource.
//              No SDK, no build step, no npm. Works from a static page.
//   local    : no config at all. Tabs of the same browser share the room through
//              localStorage and BroadcastChannel. This is what runs before you
//              have a Firebase project, and what the tests use.
//
// Everything is one JSON object per room:
//   { set, phase, round, roundStart, players: {pid: {name}}, rounds: {r: {pid: {...}}} }

const Room = (function () {
  const cfg = window.CARD_CODE_FIREBASE || "";
  const LIVE = String(cfg).startsWith("http");
  const LISTENERS = new Set();
  const MODE = LIVE ? "firebase" : "local";

  let code = null;
  let state = null;
  let source = null;

  function emit() {
    for (const fn of LISTENERS) {
      try { fn(state); } catch (e) { console.error(e); }
    }
  }

  // ---- two ways to write into a snapshot, because Firebase has two.
  // `put` replaces the node; `patch` merges into it. Getting these confused
  // loses data: a merge where a replace belongs leaves a stale player record,
  // a replace where a merge belongs deletes a solve time.

  function setAt(target, path, value) {
    const parts = String(path).split("/").filter(Boolean);
    if (!parts.length) return value;
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete node[last];
    else node[last] = value;
    return target;
  }

  function put(target, path, value) {
    const parts = String(path).split("/").filter(Boolean);
    if (!parts.length) {
      // A patch at the room root is a merge, not a replacement: writing
      // {phase:"play"} must not delete the players.
      if (value === null) return null;
      Object.assign(target, value);
      return target;
    }
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value === null) {
      delete node[last];
    } else if (value && typeof value === "object" && node[last] && typeof node[last] === "object") {
      // Firebase's PATCH merges at the leaf; a record like {solvedAt, wrong}
      // must survive the host adding {place} to it.
      Object.assign(node[last], value);
    } else {
      node[last] = value;
    }
    return target;
  }

  // ================================================================ local
  const key = () => "cc:room:" + code;
  let channel = null;

  function localRead() {
    try { return JSON.parse(localStorage.getItem(key()) || "null"); }
    catch (e) { return null; }
  }

  function localWrite(next) {
    state = next;
    localStorage.setItem(key(), JSON.stringify(next));
    emit();
    if (channel) channel.postMessage({ at: Date.now() });
  }

  function localOpen() {
    try {
      channel = new BroadcastChannel("cc:" + code);
      channel.onmessage = () => { state = localRead(); emit(); };
    } catch (e) { channel = null; }
    window.addEventListener("storage", e => {
      if (e.key === key()) { state = localRead(); emit(); }
    });
  }

  // ================================================================ firebase
  const base = () => String(cfg).replace(/\/+$/, "") + "/games/" + code;

  async function fbGet(path) {
    const r = await fetch(base() + "/" + path + ".json", { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  }

  async function fbPut(path, value) {
    const r = await fetch(base() + "/" + path + ".json", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!r.ok) throw new Error("firebase write failed: " + r.status);
    return r.json().catch(() => null);
  }

  async function fbPatch(path, value) {
    const r = await fetch(base() + "/" + path + ".json", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!r.ok) throw new Error("firebase write failed: " + r.status);
    return r.json().catch(() => null);
  }

  function fbListen() {
    if (source) source.close();
    source = new EventSource(base() + ".json");
    source.addEventListener("put", e => {
      const msg = JSON.parse(e.data);
      state = setAt(state || {}, msg.path, msg.data);
      emit();
    });
    source.addEventListener("patch", e => {
      const msg = JSON.parse(e.data);
      for (const [path, value] of Object.entries(msg.data || {})) {
        state = setAt(state || {}, (msg.path === "/" ? "" : msg.path) + "/" + path, value);
      }
      emit();
    });
    source.onerror = () => { /* EventSource retries on its own */ };
  }

  // ================================================================ the api
  return {
    MODE,
    get code() { return code; },
    get state() { return state; },
    get live() { return MODE === "firebase"; },

    onChange(fn) {
      LISTENERS.add(fn);
      if (state) fn(state);
    },

    // Read a room without joining it (used before writing anything).
    async peek(wanted) {
      code = String(wanted);
      if (LIVE) return await fbGet("");
      return localRead();
    },

    // The teacher's page: claim a code and write the opening state.
    async create(wanted, opening) {
      code = String(wanted);
      if (LIVE) {
        const existing = await fbGet("");
        if (existing && existing.players && Object.keys(existing.players).length) return false;
        if (existing && existing.phase && existing.phase !== "done") return false;
        await fbPut("", opening);
        fbListen();
        return true;
      }
      localOpen();
      if (localRead()) return false;
      localWrite(opening);
      return true;
    },

    // A player's page: subscribe to an existing room.
    async enter(wanted) {
      code = String(wanted);
      if (LIVE) {
        const first = await fbGet("");
        if (!first) return null;
        state = first;
        fbListen();
        return state;
      }
      localOpen();
      state = localRead();
      return state;
    },

    // Write one value at a path, e.g. patch("players/p4f2", {name:"Ada"}).
    async patch(path, value) {
      if (LIVE) {
        await fbPatch(path, value);
        return;
      }
      const next = localRead() || {};
      put(next, path, value);
      localWrite(next);
    },

    close() {
      if (source) source.close();
      source = null;
      if (channel) channel.close();
      channel = null;
      LISTENERS.clear();
    },
  };
})();
