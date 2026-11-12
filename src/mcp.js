import { BridgeClient } from "./client.js";

/**
 * Minimal MCP server over stdio for agent-bridge.
 *
 * Exposes these tools:
 *   ab_status         Room status, peers, claims, files, message counts
 *   ab_send           Send a message to another agent or the whole room
 *   ab_poll           Pull new messages (long-poll supported)
 *   ab_claim          Claim a file path with a lease TTL
 *   ab_release        Release a file claim
 *   ab_put_file       Upload a file attachment
 *   ab_get_file       Download a file attachment
 *
 * It never makes decisions for the agent: every call is an explicit tool call,
 * and every claim carries an owner and expiry so no two agents collide silently.
 */

const serverInfo = { name: "agent-bridge", version: "0.1.0" };
let client = null;
let configRead = false;

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

function notification(method, params) {
  return { jsonrpc: "2.0", method, params };
}

function ensureClient() {
  if (client) return client;
  const url = process.env.AB_URL;
  const token = process.env.AB_TOKEN;
  const agent = process.env.AB_AGENT ?? "mcp-agent";
  if (!url || !token)
    throw new Error(
      "AB_URL and AB_TOKEN are required for the agent-bridge MCP server",
    );
  client = new BridgeClient({ url, token, agent });
  return client;
}

function ensureConfig() {
  if (configRead) return;
  const url = process.env.AB_URL;
  const token = process.env.AB_TOKEN;
  if (!url || !token) {
    process.stdout.write(
      JSON.stringify(
        notification("$/log", {
          level: "warn",
          message:
            "agent-bridge: AB_URL or AB_TOKEN is missing; tools will fail until they are set",
        }),
      ) + "\n",
    );
  }
  configRead = true;
}

const tools = [
  {
    name: "ab_status",
    description: "Show room status: id, peers, claims, files, message counts.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ab_whoami",
    description: "Show the current agent name and role.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ab_send",
    description:
      "Send a message. Payload may be free text or a structured object.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Message text" },
        to: {
          type: "string",
          description: "Target agent name, or null for the whole room",
        },
        type: {
          type: "string",
          enum: ["note", "handoff", "status", "claim", "file"],
          default: "note",
        },
        payload: { type: "object", description: "Optional structured payload" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_poll",
    description: "Pull new messages since a sequence number.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "integer", default: 0, minimum: 0 },
        wait: { type: "integer", default: 0, minimum: 0, maximum: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_claim",
    description:
      "Claim a file path so no other agent touches it while you work.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "File path relative to project root",
        },
        ttlSeconds: { type: "integer", default: 90, minimum: 5, maximum: 3600 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_release",
    description: "Release a file claim by its claim id.",
    inputSchema: {
      type: "object",
      required: ["claimId"],
      properties: {
        claimId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_list_files",
    description: "List files shared in this room.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ab_put_file",
    description: "Upload a file attachment to the room.",
    inputSchema: {
      type: "object",
      required: ["name", "base64"],
      properties: {
        name: { type: "string", description: "File name" },
        base64: { type: "string", description: "Base64-encoded file content" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_get_file",
    description: "Download a shared file as base64.",
    inputSchema: {
      type: "object",
      required: ["fileId"],
      properties: {
        fileId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ab_rotate_invite",
    description: "Rotate the room invite token (host only).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function toolSchemas() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function formatStatus(status) {
  const lines = [
    `room: ${status.room.id} (${status.room.name})`,
    `created: ${new Date(status.room.createdAt).toISOString()}`,
    `peers: ${status.peers.length}`,
    `messages: ${status.messages.count} total, last seq ${status.messages.lastSeq}`,
    `claims: ${status.claims.length}`,
    `files: ${status.files.length}`,
    `uptime: ${Math.floor(status.uptimeMs / 1000)}s`,
  ];
  if (status.claims.length > 0) {
    lines.push("", "claims:");
    for (const claim of status.claims) {
      lines.push(
        `  - ${claim.id}  ${claim.path}  owner=${claim.owner}  expires=${new Date(claim.expiresAt).toISOString()}`,
      );
    }
  }
  if (status.files.length > 0) {
    lines.push("", "files:");
    for (const file of status.files) {
      lines.push(
        `  - ${file.id}  ${file.name}  ${file.size} bytes  by=${file.by}`,
      );
    }
  }
  return lines.join("\n");
}

function parseParams(raw) {
  if (!raw) return {};
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}

export async function runStdio() {
  ensureConfig();
  const stdin = process.stdin;
  const stdout = process.stdout;

  stdin.setEncoding("utf8");
  stdin.resume();

  let buffer = "";
  let processing = false;

  stdin.on("data", (chunk) => {
    buffer += chunk;
    if (processing) return;
    processing = true;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    processLines(lines);
    processing = false;
    if (buffer.length > 0) processLine(buffer).catch(() => {});
  });

  stdin.on("end", () => {
    if (buffer.trim()) processLine(buffer).catch(() => {});
  });

  async function processLines(lines) {
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        await processLine(line);
      } catch (error) {
        stdout.write(
          JSON.stringify(errorResponse(null, -32603, error.message)) + "\n",
        );
      }
    }
  }

  async function processLine(line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return; // ignore malformed lines silently
    }

    const id = request.id;
    const method = request.method;

    if (method === "initialize") {
      stdout.write(
        JSON.stringify(
          response(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo,
          }),
        ) + "\n",
      );
      return;
    }

    if (method === "initialized") return; // notification, no response

    if (method === "tools/list") {
      stdout.write(
        JSON.stringify(response(id, { tools: toolSchemas() })) + "\n",
      );
      return;
    }

    if (method === "tools/call") {
      const name = request.params?.name;
      const rawArgs = request.params?.arguments;
      const args = parseParams(rawArgs);

      try {
        const bridge = ensureClient();
        let result;

        switch (name) {
          case "ab_status": {
            const status = await bridge.status();
            result = { type: "text", text: formatStatus(status) };
            break;
          }

          case "ab_whoami": {
            const info = await bridge.whoami();
            result = {
              type: "text",
              text: `agent: ${info.agent}\nrole: ${info.role}`,
            };
            break;
          }

          case "ab_send": {
            const message = await bridge.send(args.text, {
              to: args.to ?? null,
              type: args.type ?? "note",
              payload: args.payload ?? null,
            });
            result = {
              type: "text",
              text: `sent seq ${message.seq} at ${new Date(message.ts).toISOString()}`,
            };
            break;
          }

          case "ab_poll": {
            const result_ = await bridge.poll(args.since ?? 0, args.wait ?? 0);
            result = { type: "text", text: JSON.stringify(result_, null, 2) };
            break;
          }

          case "ab_claim": {
            const claim = await bridge.claim(args.path, args.ttlSeconds ?? 90);
            result = { type: "text", text: JSON.stringify(claim, null, 2) };
            break;
          }

          case "ab_release": {
            const released = await bridge.release(args.claimId);
            result = {
              type: "text",
              text: `released ${released.id} (${released.path})`,
            };
            break;
          }

          case "ab_list_files": {
            const files = await bridge.listFiles();
            result = { type: "text", text: JSON.stringify(files, null, 2) };
            break;
          }

          case "ab_put_file": {
            const file = await bridge.putFile(
              args.name,
              Buffer.from(args.base64, "base64"),
            );
            result = {
              type: "text",
              text: `uploaded ${file.id} (${file.size} bytes)`,
            };
            break;
          }

          case "ab_get_file": {
            const buffer = await bridge.getFile(args.fileId);
            const base64 = Buffer.from(buffer).toString("base64");
            result = {
              type: "text",
              text: `data:application/octet-stream;base64,${base64}`,
            };
            break;
          }

          case "ab_rotate_invite": {
            const rotated = await bridge.rotateInvite();
            result = {
              type: "text",
              text: `new invite token: ${rotated.joinToken}`,
            };
            break;
          }

          default:
            throw new Error(`unknown tool: ${name}`);
        }

        stdout.write(
          JSON.stringify(response(id, { content: [result] })) + "\n",
        );
      } catch (error) {
        stdout.write(
          JSON.stringify(
            errorResponse(id, -32603, error.message, error.extra ?? {}),
          ) + "\n",
        );
      }
      return;
    }

    // Unknown methods: ignore silently for forward compatibility.
  }
}
