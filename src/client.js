export class BridgeClientError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "BridgeClientError";
    this.status = status;
    this.extra = extra;
  }
}

function trimUrl(url) {
  return String(url).replace(/\/+$/, "");
}

/**
 * Minimal client for the bridge HTTP API. Uses only the built-in fetch, so it
 * runs anywhere Node 20 runs: a laptop, a CI job, or an MCP server.
 */
export class BridgeClient {
  constructor({ url, token, agent = "agent", fetchImpl = fetch }) {
    if (!url) throw new Error("url is required");
    if (!token) throw new Error("token is required");
    this.url = trimUrl(url);
    this.token = token;
    this.agent = agent;
    this.fetch = fetchImpl;
  }

  async request(method, pathname, { body, raw, headers = {} } = {}) {
    const init = {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...headers,
      },
    };
    if (raw !== undefined) {
      init.body = raw;
      init.headers["content-type"] =
        headers["content-type"] ?? "application/octet-stream";
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }

    const response = await this.fetch(`${this.url}${pathname}`, init);
    if (!response.ok) {
      let detail = {};
      try {
        detail = await response.json();
      } catch {
        detail = {};
      }
      throw new BridgeClientError(
        response.status,
        detail.error ?? `request failed with status ${response.status}`,
        detail,
      );
    }
    if (response.status === 204) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("application/json"))
      return Buffer.from(await response.arrayBuffer());
    return response.json();
  }

  whoami() {
    return this.request("GET", "/v1/whoami");
  }

  status() {
    return this.request("GET", "/v1/status");
  }

  send(text, { to = null, type = "note", payload = null } = {}) {
    const body = {
      to,
      type,
      payload: payload ?? { text },
    };
    return this.request("POST", "/v1/messages", { body });
  }

  poll(since = 0, wait = 0) {
    const query = new URLSearchParams({
      since: String(since),
      wait: String(wait),
    });
    return this.request("GET", `/v1/messages?${query}`);
  }

  claim(filePath, ttlSeconds = 90) {
    return this.request("POST", "/v1/claims", {
      body: { path: filePath, ttlSeconds },
    });
  }

  heartbeat(claimId, ttlSeconds = 90) {
    return this.request("POST", `/v1/claims/${claimId}/heartbeat`, {
      body: { ttlSeconds },
    });
  }

  release(claimId) {
    return this.request("DELETE", `/v1/claims/${claimId}`);
  }

  listFiles() {
    return this.request("GET", "/v1/files");
  }

  putFile(name, buffer) {
    const query = new URLSearchParams({ name });
    return this.request("POST", `/v1/files?${query}`, {
      raw: buffer,
      headers: { "content-length": String(buffer.length) },
    });
  }

  getFile(fileId) {
    return this.request("GET", `/v1/files/${fileId}`);
  }

  rotateInvite() {
    return this.request("POST", "/v1/invite/rotate");
  }

  /** Join a room with an invite token. Returns the peer token, not a client. */
  static async join(url, token, agent, fetchImpl = fetch) {
    const response = await fetchImpl(`${trimUrl(url)}/v1/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, agent }),
    });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BridgeClientError(
        response.status,
        detail.error ?? "join failed",
        detail,
      );
    }
    return detail;
  }
}
