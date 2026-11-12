# Agent Bridge

Free, open-source relay that lets coding agents on **different machines** exchange
messages, claim files, and share artifacts — with no account, no server bill, and
no vendor lock-in.

One machine hosts the room. Others join with an invite link. Messages are routed
through the host's bridge, file claims prevent two agents from editing the same
file at the same time, and uploads/downloads keep artifacts in one place.

```
machine A                          machine B
┌──────────────┐          HTTPS   ┌──────────────┐
│   agent A    │ ───────────────> │   agent B    │
│  (OpenCode)  │   /v1/send       │  (OpenCode)  │
└──────────────┘                  └──────────────┘
        │                                  │
        └───────── bridge ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
              (one machine, http://localhost:8787)
```

## Why this exists

Multi-agent coding is usually locked inside one IDE or one vendor's cloud.
Agent Bridge is the opposite:

- **One binary**, no account, no signup
- **Self-hosted**: you run the relay on a machine you control
- **Open source (MIT)**: audit it, fork it, extend it
- **Free**: no subscription, no usage bill
- **CLI + MCP**: works from the terminal and from IDEs (OpenCode, Cursor, VS Code)

## Install

```bash
git clone https://github.com/agent-bridge/agent-bridge.git
cd agent-bridge
npm install
```

Requires Node.js 20 or later.

## Run the host (machine 1)

```bash
AB_PORT=8787 node src/cli.js host
```

Or with the binary once published:

```bash
agent-bridge host
```

Output:

```
agent-bridge listening on http://127.0.0.1:8787
room id: 4a1f2c9d
invite token: tok_xxxxx
host token: tok_yyyyy
state dir: .agent-bridge-data

Invite another machine with:
  agent-bridge join http://127.0.0.1:8787 tok_xxxxx <agent>

Press Ctrl+C to stop.
```

## Join from another machine (machine 2)

```bash
AB_URL=http://127.0.0.1:8787 AB_TOKEN=tok_xxxxx AB_AGENT=agent-bob \
  node src/cli.js join http://127.0.0.1:8787 tok_xxxxx agent-bob
```

This prints your peer token. Export it for the rest of the session:

```bash
export AB_URL=http://127.0.0.1:8787
export AB_TOKEN=<peer token>
export AB_AGENT=agent-bob
```

If machine B is on a different network, put the host behind [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps) or [Tailscale](https://tailscale.com) so the URL is reachable. The bridge itself listens on `127.0.0.1` by default; set `AB_HOST=0.0.0.0` to listen on all interfaces.

## Web dashboard

Open `http://<host-ip>:8787/ui` to see peers, active claims, recent messages, and to disconnect peers or revoke claims (host only).

## Use it

```bash
# See who is in the room
agent-bridge status

# Send a message to everyone
agent-bridge send "Starting work on src/app.ts"

# Send to one agent only
agent-bridge send "Ready for review" --to agent-alice

# Pull new messages (long-poll up to 10s)
agent-bridge poll 0 10

# Claim a file so nobody else touches it
agent-bridge claim src/app.ts 120

# Release when done
agent-bridge release <claimId>

# Share a file
agent-bridge put screenshot.png

# Download a shared file
agent-bridge get <fileId> output.png
```

All client commands read `AB_URL`, `AB_TOKEN`, and `AB_AGENT` from the environment.

## MCP for IDEs

`src/mcp.js` is a Model Context Protocol server over stdio. Add it to your IDE config:

```json
{
  "mcpServers": {
    "agent-bridge": {
      "command": "node",
      "args": ["/path/to/agent-bridge/src/mcp.js"],
      "env": {
        "AB_URL": "http://127.0.0.1:8787",
        "AB_TOKEN": "<peer token>",
        "AB_AGENT": "agent-bob"
      }
    }
  }
}
```

Tools exposed:

| Tool               | What it does                            |
| ------------------ | --------------------------------------- |
| `ab_status`        | Room status, peers, claims, files       |
| `ab_whoami`        | Current agent and role                  |
| `ab_send`          | Send a message to the room or one agent |
| `ab_poll`          | Pull new messages                       |
| `ab_claim`         | Claim a file path with a lease TTL      |
| `ab_release`       | Release a file claim                    |
| `ab_list_files`    | List shared files                       |
| `ab_put_file`      | Upload a file attachment                |
| `ab_get_file`      | Download a shared file                  |
| `ab_rotate_invite` | Rotate the invite token (host only)     |

## Security

- The bridge never sees your LLM keys. It only routes messages and file metadata.
- Uploaded files are stored on the host machine, encrypted only by filesystem permissions.
- Claims use `timingSafeEqual` for token comparison and expire after their TTL.
- Anyone with the invite token can join. Rotate it with `ab-rotate-invite` if you suspect a leak.
- There is no end-to-end encryption yet: the host can read message contents. For sensitive work, encrypt payloads before sending.

## Roadmap

- End-to-end encryption for message payloads
- Web UI for the room
- Docker image
- GitHub OAuth-free room listing (optional)

## License

MIT. See `LICENSE`.
