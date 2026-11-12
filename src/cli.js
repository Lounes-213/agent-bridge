#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createBridge } from "./server.js";
import { BridgeClient } from "./client.js";

const version = "0.1.0";
const scriptName = "agent-bridge";

function error(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printUsage() {
  process.stdout.write(`Usage: ${scriptName} <command> [args]

Commands:
  host [options]              Start a bridge room on this machine
  join <url> <token> <agent>  Join a room and print the peer token
  status                      Show room status (after join)
  send <text>                 Send a note message
  claim <path> [ttlSeconds]   Claim a file path
  release <claimId>           Release a file claim
  poll [since] [waitSeconds]  Pull messages (long-poll with wait)
  files                       List shared files
  put <file>                  Upload a file
  get <fileId> [outPath]      Download a file
  rotate-invite               Rotate the room invite token (host only)
  whoami                      Show current agent

Environment:
  AB_URL                      Bridge URL (required for client commands)
  AB_TOKEN                    Auth token (required for client commands)
  AB_AGENT                    Agent name (default: agent)
  AB_DATA_DIR                 Directory for room state (default: .agent-bridge-data)
  AB_HOST                     Listen host for host mode (default: 127.0.0.1)
  AB_PORT                     Listen port for host mode (default: 8787)
  AB_MAX_FILE_BYTES           Max upload size in bytes (default: 26214400)
  AB_NAME                     Room name (default: room)

Examples:
  AB_PORT=8787 agent-bridge host
  agent-bridge join http://127.0.0.1:8787 tok_xxx agent-bob
  agent-bridge send "I am starting work on src/app.ts"
  agent-bridge claim src/app.ts 120
  agent-bridge put screenshot.png
  agent-bridge status

See: https://github.com/agent-bridge/agent-bridge
`);
}

async function host() {
  const port = Number(process.env.AB_PORT ?? 8787);
  const host = process.env.AB_HOST ?? "127.0.0.1";
  const dataDir = process.env.AB_DATA_DIR ?? ".agent-bridge-data";
  const maxFileBytes = Number(process.env.AB_MAX_FILE_BYTES ?? 26_214_400);
  const name = process.env.AB_NAME ?? "room";

  const bridge = await createBridge({
    port,
    host,
    dataDir,
    maxFileBytes,
    name,
  });

  const joinCommand = `${scriptName} join ${bridge.url} ${bridge.inviteToken()} <agent>`;

  process.stdout.write(
    [
      `agent-bridge listening on ${bridge.url}`,
      `room id: ${bridge.state.room.id}`,
      `invite token: ${bridge.inviteToken()}`,
      `host token: ${bridge.hostToken()}`,
      `state dir: ${bridge.dataDir}`,
      "",
      "Invite another machine with:",
      `  ${joinCommand}`,
      "",
      "Press Ctrl+C to stop.",
    ].join("\n"),
  );

  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, async () => {
      process.stdout.write(`\nreceived ${signal}, shutting down...\n`);
      try {
        await bridge.close();
      } catch {
        // ignore close errors
      }
      process.exit(0);
    });
  }
}

async function join(args) {
  const [url, token, agent] = args;
  if (!url || !token || !agent)
    error("usage: agent-bridge join <url> <token> <agent>");

  const detail = await BridgeClient.join(url, token, agent);

  process.stdout.write(
    [
      `joined room ${detail.room.id} as ${detail.agent}`,
      `peer token: ${detail.token}`,
      `url: ${url}`,
      "",
      "Export these to run client commands:",
      `  export AB_URL=${url}`,
      `  export AB_TOKEN=${detail.token}`,
      `  export AB_AGENT=${detail.agent}`,
      "",
      "Then try: agent-bridge status, agent-bridge claim <path>, agent-bridge send <text>",
    ].join("\n"),
  );
}

function clientCommand(command, rest) {
  const url = process.env.AB_URL;
  const token = process.env.AB_TOKEN;
  const agent = process.env.AB_AGENT ?? "agent";

  if (!url || !token)
    error("AB_URL and AB_TOKEN are required for client commands");

  const client = new BridgeClient({ url, token, agent });

  switch (command) {
    case "status": {
      client
        .status()
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "whoami": {
      client
        .whoami()
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "send": {
      const text = rest.join(" ");
      if (!text) error("usage: agent-bridge send <text>");
      client
        .send(text)
        .then((message) => writeJson({ sent: message }))
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "poll": {
      const since = Number(rest[0] ?? 0);
      const wait = Number(rest[1] ?? 0);
      client
        .poll(since, wait)
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "claim": {
      const filePath = rest[0];
      const ttl = rest[1] ? Number(rest[1]) : undefined;
      if (!filePath) error("usage: agent-bridge claim <path> [ttlSeconds]");
      client
        .claim(filePath, ttl)
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "release": {
      const claimId = rest[0];
      if (!claimId) error("usage: agent-bridge release <claimId>");
      client
        .release(claimId)
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "files": {
      client
        .listFiles()
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "put": {
      const filePath = rest[0];
      if (!filePath) error("usage: agent-bridge put <file>");
      fs.readFile(filePath, (err, buffer) => {
        if (err) error(err.message ?? String(err));
        client
          .putFile(path.basename(filePath), buffer)
          .then(writeJson)
          .catch((e) => error(e.message ?? String(e)));
      });
      break;
    }
    case "get": {
      const fileId = rest[0];
      const outPath = rest[1];
      if (!fileId) error("usage: agent-bridge get <fileId> [outPath]");
      client
        .listFiles()
        .then((result) => {
          const file = result.files?.find((f) => f.id === fileId);
          if (!file) error(`file ${fileId} not found`);
          return client.getFile(fileId).then((buffer) => ({
            buffer,
            destination: outPath ?? path.basename(file.name ?? fileId),
          }));
        })
        .then(({ buffer, destination }) =>
          fs.writeFile(destination, buffer, (err) => {
            if (err) error(err.message ?? String(err));
            process.stdout.write(
              `wrote ${buffer.length} bytes to ${destination}\n`,
            );
          }),
        )
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    case "rotate-invite": {
      client
        .rotateInvite()
        .then(writeJson)
        .catch((err) => error(err.message ?? String(err)));
      break;
    }
    default:
      error(`unknown client command: ${command}`);
      break;
  }
}

const command = process.argv[2];
const rest = process.argv.slice(3);

switch (command) {
  case undefined:
  case "-h":
  case "--help":
    printUsage();
    break;
  case "host":
    host();
    break;
  case "join":
    join(rest);
    break;
  case "status":
  case "whoami":
  case "send":
  case "poll":
  case "claim":
  case "release":
  case "files":
  case "put":
  case "get":
  case "rotate-invite":
    clientCommand(command, rest);
    break;
  case "--version":
  case "-v":
    process.stdout.write(`${version}\n`);
    break;
  default:
    error(`unknown command: ${command}\nRun '${scriptName} --help' for usage.`);
    break;
}
