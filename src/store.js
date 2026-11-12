import fs from "node:fs";
import path from "node:path";
import { newId, newToken } from "./tokens.js";

const MAX_MESSAGES = 5000;

export function createState(name = "room") {
  return {
    version: 1,
    room: {
      id: newId(6),
      name,
      createdAt: Date.now(),
      joinToken: newToken("join"),
      hostToken: newToken("host"),
    },
    peers: [],
    messages: [],
    claims: [],
    files: [],
    seq: 0,
  };
}

function statePath(dir) {
  return path.join(dir, "state.json");
}

export function loadState(dir, name = "room") {
  const file = statePath(dir);
  if (!fs.existsSync(file)) {
    const fresh = createState(name);
    saveState(dir, fresh);
    return fresh;
  }
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 1)
    throw new Error("unsupported state file version");
  return parsed;
}

/** Atomic write, mode 600, so a crash never leaves a half-written room. */
export function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  if (state.messages.length > MAX_MESSAGES) {
    state.messages = state.messages.slice(-MAX_MESSAGES);
  }
  const file = statePath(dir);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

export function appendMessage(
  state,
  { from, to = null, type = "note", payload = null },
) {
  const message = {
    seq: state.seq + 1,
    ts: Date.now(),
    from,
    to,
    type,
    payload,
  };
  state.seq = message.seq;
  state.messages.push(message);
  return message;
}
