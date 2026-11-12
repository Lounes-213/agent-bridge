export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Bridge - Room Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f5f5f5; color: #111; }
  header { background: #171717; color: #fff; padding: 16px 24px; font-size: 20px; display: flex; justify-content: space-between; align-items: center; }
  header a { color: #93c5fd; text-decoration: none; margin-left: 16px; }
  main { max-width: 980px; margin: 24px auto; padding: 0 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 700px) { main { grid-template-columns: 1fr; } }
  .card { background: #fff; border: 1px solid #e5e7e5; border-radius: 12px; padding: 20px; }
  h2 { font-size: 16px; margin: 0 0 16px; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px; color: #6b7280; border-bottom: 1px solid #e5e7e5; }
  td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:hover { background: #f9fafb; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #e5e7eb; color: #111; }
  .host { background: #dcfce7; color: #166534; }
  .peer { background: #dbeafe; color: #1e40af; }
  .claim { background: #fef3c7; color: #92400e; }
  button { background: #171717; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  button:hover { background: #374151; }
  button.danger { background: #dc2626; }
  button.danger:hover { background: #b91c1c; }
  .empty { color: #9ca3af; font-style: italic; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .row-actions { display: flex; gap: 6px; }
  .refresh { margin-top: 12px; font-size: 13px; color: #6b7280; cursor: pointer; }
  .refresh:hover { color: #111; }
  .api { margin-top: 16px; font-size: 12px; color: #6b7280; background: #f9fafb; padding: 10px; border-radius: 8px; }
  .api code { color: #111827; }
</style>
</head>
<body>
<header>
  <div>Agent Bridge <span class="badge">Room: <span id="roomId">-</span></span></div>
  <div>
    <a href="/">JSON API</a>
    <a href="/health">Health</a>
    <button id="refreshBtn">Refresh</button>
  </div>
</header>
<main>
  <section class="card">
    <h2>Peers</h2>
    <table id="peersTable">
      <thead><tr><th>Agent</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Action</th></tr></thead>
      <tbody id="peersBody"><tr><td colspan="5" class="empty">Loading...</td></tr></tbody>
    </table>
  </section>
  <section class="card">
    <h2>Claims (file locks)</h2>
    <table id="claimsTable">
      <thead><tr><th>Path</th><th>Owner</th><th>Expires</th><th>Action</th></tr></thead>
      <tbody id="claimsBody"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody>
    </table>
  </section>
  <section class="card" style="grid-column: 1 / -1;">
    <h2>Recent messages</h2>
    <table id="messagesTable">
      <thead><tr><th>Seq</th><th>Time</th><th>From</th><th>To</th><th>Type</th><th>Payload</th></tr></thead>
      <tbody id="messagesBody"><tr><td colspan="6" class="empty">Loading...</td></tr></tbody>
    </table>
  </section>
  <section class="card api">
    <h2>Quick actions (API)</h2>
    <p>Send message:</p>
    <pre class="mono">curl -X POST http://localhost:8787/v1/messages \\
  -H "Authorization: Bearer &lt;token&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"hello","type":"note"}'</pre>
  </section>
</main>
<script>
const base = window.location.origin;
let peers = [], claims = [], messages = [];

async function load() {
  const res = await fetch(base + "/v1/status");
  const data = await res.json();
  document.getElementById("roomId").textContent = data.room.id;
  peers = data.peers || [];
  claims = data.claims || [];
  messages = (data.messages && data.messages.list) ? data.messages.list : [];
  render();
}

function fmt(ts) {
  if (!ts) return "-";
  return new Date(Number(ts)).toLocaleString();
}

function render() {
  const pb = document.getElementById("peersBody");
  pb.innerHTML = "";
  if (!peers.length) { pb.innerHTML = '&lt;tr&gt;&lt;td colspan=&quot;5&quot; class=&quot;empty&quot;&gt;No peers&lt;/td&gt;&lt;/tr&gt;'; }
  for (const p of peers) {
    pb.innerHTML += '&lt;tr&gt;' +
      '&lt;td&gt;&lt;span class=&quot;mono&quot;&gt;' + escape(p.agent) + '&lt;/span&gt;&lt;/td&gt;' +
      '&lt;td&gt;&lt;span class=&quot;badge ' + (p.role === 'host' ? 'host' : 'peer') + '&quot;&gt;' + escape(p.role) + '&lt;/span&gt;&lt;/td&gt;' +
      '&lt;td&gt;' + fmt(p.joinedAt) + '&lt;/td&gt;' +
      '&lt;td&gt;' + fmt(p.lastSeen) + '&lt;/td&gt;' +
      '&lt;td&gt;&lt;div class=&quot;row-actions&quot;&gt;' +
      (p.role !== 'host'
        ? '&lt;button class=&quot;danger&quot; onclick=&quot;disconnect(\'' + escapeJs(p.agent) + '\')&quot;&gt;Disconnect&lt;/button&gt;'
        : '&lt;span class=&quot;badge&quot;&gt;host&lt;/span&gt;') +
      '&lt;/div&gt;&lt;/td&gt;&lt;/tr&gt;';
  }

  const cb = document.getElementById("claimsBody");
  cb.innerHTML = "";
  if (!claims.length) { cb.innerHTML = '&lt;tr&gt;&lt;td colspan=&quot;4&quot; class=&quot;empty&quot;&gt;No active claims&lt;/td&gt;&lt;/tr&gt;'; }
  for (const c of claims) {
    cb.innerHTML += '&lt;tr&gt;' +
      '&lt;td&gt;&lt;span class=&quot;mono&quot;&gt;' + escape(c.path) + '&lt;/span&gt;&lt;/td&gt;' +
      '&lt;td&gt;&lt;span class=&quot;mono&quot;&gt;' + escape(c.owner) + '&lt;/span&gt;&lt;/td&gt;' +
      '&lt;td&gt;' + fmt(c.expiresAt) + '&lt;/td&gt;' +
      '&lt;td&gt;&lt;div class=&quot;row-actions&quot;&gt;&lt;button class=&quot;danger&quot; onclick=&quot;revoke(\'' + escapeJs(c.id) + '\')&quot;&gt;Revoke&lt;/button&gt;&lt;/div&gt;&lt;/td&gt;&lt;/tr&gt;';
  }

  const mb = document.getElementById("messagesBody");
  mb.innerHTML = "";
  if (!messages.length) { mb.innerHTML = '&lt;tr&gt;&lt;td colspan=&quot;6&quot; class=&quot;empty&quot;&gt;No messages&lt;/td&gt;&lt;/tr&gt;'; }
  for (const m of messages.slice().reverse().slice(0, 50)) {
    const payload = typeof m.payload === 'object' ? JSON.stringify(m.payload) : String(m.payload ?? '');
    mb.innerHTML += '&lt;tr&gt;' +
      '&lt;td&gt;' + m.seq + '&lt;/td&gt;' +
      '&lt;td&gt;' + fmt(m.ts) + '&lt;/td&gt;' +
      '&lt;td&gt;&lt;span class=&quot;mono&quot;&gt;' + escape(m.from) + '&lt;/span&gt;&lt;/td&gt;' +
      '&lt;td&gt;' + escape(m.to ?? '-') + '&lt;/td&gt;' +
      '&lt;td&gt;' + escape(m.type) + '&lt;/td&gt;' +
      '&lt;td&gt;&lt;span class=&quot;mono&quot;&gt;' + escape(payload) + '&lt;/span&gt;&lt;/td&gt;&lt;/tr&gt;';
  }
}

async function disconnect(agent) {
  if (!confirm('Disconnect agent ' + agent + '?')) return;
  await fetch(base + '/v1/peers/' + encodeURIComponent(agent) + '/disconnect', { method: 'POST' });
  load();
}

async function revoke(id) {
  if (!confirm('Revoke claim ' + id + '?')) return;
  await fetch(base + '/v1/claims/' + encodeURIComponent(id) + '/revoke', { method: 'POST' });
  load();
}

function escape(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function escapeJs(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

document.getElementById('refreshBtn').onclick = load;
setInterval(load, 5000);
load();
</script>
</body>
</html>`;

export async function handleAdmin(req, res, ctx) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/ui") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    return res.end(UI_HTML);
  }

  const peerMatch = pathname.match(/^\/v1\/peers\/([^/]+)\/disconnect$/);
  if (peerMatch && method === "POST") {
    const principal = await authenticate(req, ctx);
    if (!principal || principal.role !== "host") {
      return sendJson(res, 403, { error: "host only" });
    }
    const agent = decodeURIComponent(peerMatch[1]);
    ctx.state.peers = ctx.state.peers.filter((p) => p.agent !== agent);
    ctx.persist();
    ctx.append({
      from: "system",
      type: "status",
      payload: { event: "leave", agent },
    });
    return sendJson(res, 200, { disconnected: agent });
  }

  const claimMatch = pathname.match(/^\/v1\/claims\/([^/]+)\/revoke$/);
  if (claimMatch && method === "POST") {
    const principal = await authenticate(req, ctx);
    if (!principal || principal.role !== "host") {
      return sendJson(res, 403, { error: "host only" });
    }
    const id = decodeURIComponent(claimMatch[1]);
    const idx = ctx.state.claims.findIndex((c) => c.id === id);
    if (idx === -1) return sendJson(res, 404, { error: "claim not found" });
    const claim = ctx.state.claims.splice(idx, 1)[0];
    ctx.persist();
    ctx.append({
      from: "system",
      type: "claim",
      payload: {
        id: claim.id,
        path: claim.path,
        revoked: true,
        owner: claim.owner,
      },
    });
    return sendJson(res, 200, { revoked: claim });
  }

  return null;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

async function authenticate(req, ctx) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const { safeEqual } = await import("./tokens.js");
  if (safeEqual(token, ctx.state.room.hostToken))
    return { agent: "host", role: "host" };
  for (const peer of ctx.state.peers) {
    if (safeEqual(token, peer.token)) {
      peer.lastSeen = Date.now();
      return { agent: peer.agent, role: "peer" };
    }
  }
  return null;
}
