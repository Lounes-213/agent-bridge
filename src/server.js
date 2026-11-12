import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { appendMessage, loadState, saveState } from "./store.js";
import {
  BridgeError,
  claimPath,
  clampTtl,
  extendClaim,
  normalizePath,
  pruneClaims,
  releaseClaim,
} from "./claims.js";
import { newId, newToken, safeEqual } from "./tokens.js";
import { handleAdmin, UI_HTML } from "./ui.js";

const MAX_PEERS = 64;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const AGENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const MESSAGE_TYPES = new Set(["note", "handoff", "status", "claim", "file"]);
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

async function readBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new BridgeError(413, "request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = MAX_JSON_BYTES) {
  const buffer = await readBody(req, limit);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new BridgeError(400, "request body is not valid JSON");
  }
}

function bearer(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function cleanFileName(input) {
  const raw = String(input ?? "file")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const name = raw === "" ? "file" : raw;
  return name.length > 120 ? name.slice(-120) : name;
}

/**
 * Start a bridge. One process owns one room: its invite token, peers, message
 * log, file claims, and uploaded files.
 */
export async function createBridge(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? ".agent-bridge-data");
  const roomName = options.name ?? "room";
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const host = options.host ?? "127.0.0.1";
  const state = loadState(dataDir, roomName);
  const filesDir = path.join(dataDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });

  const waiters = new Set();
  const buckets = new Map();
  const startedAt = Date.now();

  function persist() {
    saveState(dataDir, state);
  }

  function principalFor(token) {
    if (!token) return null;
    if (safeEqual(token, state.room.hostToken))
      return { agent: "host", role: "host" };
    for (const peer of state.peers) {
      if (safeEqual(token, peer.token)) {
        peer.lastSeen = Date.now();
        return { agent: peer.agent, role: "peer" };
      }
    }
    return null;
  }

  function authenticate(req) {
    const principal = principalFor(bearer(req));
    if (!principal) throw new BridgeError(401, "missing or invalid token");
    return principal;
  }

  function allow(token) {
    const now = Date.now();
    const bucket = buckets.get(token);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(token, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= RATE_LIMIT;
  }

  function append({ from, to = null, type = "note", payload = null }) {
    if (!MESSAGE_TYPES.has(type))
      throw new BridgeError(400, `unknown message type: ${type}`);
    const encoded = JSON.stringify(payload ?? null);
    if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
      throw new BridgeError(413, "message payload is larger than 64 KB");
    }
    if (to !== null) {
      const target = state.peers.find((peer) => peer.agent === to);
      if (!target && to !== "host")
        throw new BridgeError(404, `unknown agent: ${to}`);
    }
    const message = appendMessage(state, { from, to, type, payload });
    persist();
    flushWaiters();
    return message;
  }

  function visibleFor(agent, since) {
    return state.messages.filter(
      (message) =>
        message.seq > since &&
        (message.to === null || message.to === agent || message.from === agent),
    );
  }

  function finishWaiter(waiter, messages) {
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
    sendJson(waiter.res, 200, { messages, next: state.seq });
  }

  function flushWaiters() {
    for (const waiter of [...waiters]) {
      const messages = visibleFor(waiter.agent, waiter.since);
      if (messages.length > 0) finishWaiter(waiter, messages);
    }
  }

  function publicStatus() {
    pruneClaims(state.claims);
    return {
      room: {
        id: state.room.id,
        name: state.room.name,
        createdAt: state.room.createdAt,
      },
      peers: state.peers.map((peer) => ({
        agent: peer.agent,
        joinedAt: peer.joinedAt,
        lastSeen: peer.lastSeen,
      })),
      claims: state.claims.map((claim) => ({ ...claim })),
      files: state.files.map((file) => ({ ...file })),
      messages: { count: state.messages.length, lastSeq: state.seq },
      uptimeMs: Date.now() - startedAt,
    };
  }

  function invitePage(baseUrl, token) {
    const command = `agent-bridge join ${baseUrl}/j/${token}`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Bridge invite</title>
<style>
  body { font: 16px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 48px 24px; background: #fafafa; color: #171717; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { margin: 0 0 24px; color: #525252; }
  pre { background: #171717; color: #fafafa; padding: 16px; overflow-x: auto; }
  code { font: inherit; }
</style>
</head>
<body>
<main>
  <h1>Agent Bridge invite</h1>
  <p>Room ${escapeHtml(state.room.id)}. Run this on the other machine:</p>
  <pre><code>${escapeHtml(command)}</code></pre>
  <p>Then try <code>agent-bridge status</code>, <code>agent-bridge claim &lt;path&gt;</code>, and <code>agent-bridge send "hello"</code>.</p>
</main>
</body>
</html>`;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        room: state.room.id,
        peers: state.peers.length,
      });
    }

    if (method === "GET" && pathname === "/") {
      return sendJson(res, 200, {
        name: "agent-bridge",
        room: state.room.id,
        peers: state.peers.length,
        docs: "https://github.com/agent-bridge/agent-bridge",
      });
    }

    if (method === "GET" && pathname.startsWith("/j/")) {
      const token = decodeURIComponent(pathname.slice(3));
      if (!safeEqual(token, state.room.joinToken)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("invite not found or rotated");
      }
      const hostHeader = String(req.headers.host ?? "127.0.0.1");
      const baseUrl = `http://${hostHeader}`;
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      });
      return res.end(invitePage(baseUrl, token));
    }

    if (method === "POST" && pathname === "/v1/join") {
      const body = await readJson(req);
      if (!safeEqual(body.token ?? "", state.room.joinToken)) {
        throw new BridgeError(403, "invite token is not valid");
      }
      const agent = String(body.agent ?? "");
      if (!AGENT_PATTERN.test(agent)) {
        throw new BridgeError(
          400,
          "agent must be 1-32 characters: letters, digits, dot, dash, underscore",
        );
      }
      if (state.peers.length >= MAX_PEERS)
        throw new BridgeError(429, "room is full");
      if (
        state.peers.some((peer) => peer.agent === agent) ||
        agent === "host"
      ) {
        throw new BridgeError(409, `agent name is already in use: ${agent}`);
      }
      const peer = {
        agent,
        token: newToken("peer"),
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };
      state.peers.push(peer);
      persist();
      append({
        from: "system",
        type: "status",
        payload: { event: "join", agent },
      });
      return sendJson(res, 201, {
        agent,
        token: peer.token,
        room: { id: state.room.id, name: state.room.name },
      });
    }

    // Public UI dashboard (read-only for actions; disconnect/revoke need host token)
    if (method === "GET" && pathname === "/ui") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(UI_HTML);
    }

    // Every route below needs a peer or host token.
    const principal = authenticate(req);
    if (!allow(bearer(req)))
      throw new BridgeError(429, "too many requests, slow down");

    if (method === "GET" && pathname === "/v1/whoami") {
      return sendJson(res, 200, {
        agent: principal.agent,
        role: principal.role,
        room: state.room.id,
      });
    }

    if (method === "GET" && pathname === "/v1/status") {
      return sendJson(res, 200, publicStatus());
    }

    if (method === "POST" && pathname === "/v1/messages") {
      const body = await readJson(req);
      const message = append({
        from: principal.agent,
        to:
          body.to === undefined || body.to === null || body.to === ""
            ? null
            : String(body.to),
        type: body.type ?? "note",
        payload: body.payload ?? null,
      });
      return sendJson(res, 201, { message });
    }

    if (method === "GET" && pathname === "/v1/messages") {
      const since = Math.max(
        0,
        Math.trunc(Number(url.searchParams.get("since") ?? 0)) || 0,
      );
      const wait = Math.min(
        30,
        Math.max(0, Number(url.searchParams.get("wait") ?? 0) || 0),
      );
      const messages = visibleFor(principal.agent, since);
      if (messages.length > 0 || wait === 0) {
        return sendJson(res, 200, { messages, next: state.seq });
      }
      const waiter = { agent: principal.agent, since, res, timer: null };
      waiter.timer = setTimeout(() => finishWaiter(waiter, []), wait * 1000);
      waiters.add(waiter);
      res.on("close", () => {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
      });
      return undefined;
    }

    if (method === "POST" && pathname === "/v1/claims") {
      const body = await readJson(req);
      const ttlMs = clampTtl(body.ttlSeconds);
      const { claim, renewed } = claimPath(state.claims, {
        path: body.path,
        owner: principal.agent,
        ttlMs,
      });
      persist();
      append({
        from: "system",
        type: "claim",
        payload: {
          id: claim.id,
          path: claim.path,
          owner: claim.owner,
          expiresAt: claim.expiresAt,
          renewed,
        },
      });
      return sendJson(res, renewed ? 200 : 201, { claim });
    }

    const claimMatch = pathname.match(
      /^\/v1\/claims\/([a-f0-9]+)\/(heartbeat)$/,
    );
    if (claimMatch && method === "POST") {
      const body = await readJson(req);
      const ttlMs = clampTtl(body.ttlSeconds);
      const claim = extendClaim(state.claims, {
        id: claimMatch[1],
        owner: principal.agent,
        ttlMs,
      });
      persist();
      return sendJson(res, 200, { claim });
    }

    const releaseMatch = pathname.match(/^\/v1\/claims\/([a-f0-9]+)$/);
    if (releaseMatch && method === "DELETE") {
      const claim = releaseClaim(state.claims, {
        id: releaseMatch[1],
        owner: principal.agent,
        isHost: principal.role === "host",
      });
      persist();
      append({
        from: "system",
        type: "claim",
        payload: {
          id: claim.id,
          path: claim.path,
          released: true,
          owner: claim.owner,
        },
      });
      return sendJson(res, 200, { released: claim });
    }

    if (method === "POST" && pathname === "/v1/files") {
      const name = cleanFileName(url.searchParams.get("name"));
      const buffer = await readBody(req, maxFileBytes);
      const file = {
        id: newId(10),
        name,
        size: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        by: principal.agent,
        createdAt: Date.now(),
      };
      await fsp.writeFile(path.join(filesDir, file.id), buffer, {
        mode: 0o600,
      });
      state.files.push(file);
      persist();
      append({
        from: principal.agent,
        type: "file",
        payload: { id: file.id, name: file.name, size: file.size },
      });
      return sendJson(res, 201, { file });
    }

    if (method === "GET" && pathname === "/v1/files") {
      return sendJson(res, 200, { files: state.files });
    }

    const fileMatch = pathname.match(/^\/v1\/files\/([a-f0-9]+)$/);
    if (fileMatch && method === "GET") {
      const file = state.files.find((entry) => entry.id === fileMatch[1]);
      if (!file) throw new BridgeError(404, "file not found");
      const location = path.join(filesDir, file.id);
      if (!fs.existsSync(location))
        throw new BridgeError(410, "file content is missing on disk");
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": file.size,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      return fs.createReadStream(location).pipe(res);
    }

    if (method === "POST" && pathname === "/v1/invite/rotate") {
      if (principal.role !== "host")
        throw new BridgeError(403, "only the host may rotate the invite");
      state.room.joinToken = newToken("join");
      persist();
      return sendJson(res, 200, { joinToken: state.room.joinToken });
    }

    const admin = await handleAdmin(req, res, { state, persist, append });
    if (admin !== null) return admin;

    throw new BridgeError(404, `no route for ${method} ${pathname}`);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof BridgeError ? error.status : 500;
      const message =
        error instanceof BridgeError ? error.message : "internal error";
      if (!(error instanceof BridgeError)) console.error(error);
      sendJson(res, status, { error: message, ...(error.extra ?? {}) });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8787, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : options.port;

  return {
    server,
    state,
    dataDir,
    host,
    port,
    url: `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`,
    inviteToken: () => state.room.joinToken,
    hostToken: () => state.room.hostToken,
    async close() {
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timer);
        waiter.res.destroy();
      }
      waiters.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
