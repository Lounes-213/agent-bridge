# Agent Bridge Protocol

Room state is stored in `.agent-bridge-data/state.json` on the host. All client
communication is over HTTP JSON.

## Authentication

Two bearer tokens exist per room:

- **Join token** (`joinToken`): lets a new peer join the room. Rotate it with `POST /v1/invite/rotate`.
- **Peer token**: issued by `POST /v1/join`, scoped to one agent name.
- **Host token**: held only by the host process; allows claim rotation and invite rotation.

## Endpoints

| Method   | Path                          | Description                                |
| -------- | ----------------------------- | ------------------------------------------ |
| `GET`    | `/health`                     | Health check                               |
| `GET`    | `/`                           | Room info                                  |
| `GET`    | `/j/{token}`                  | Invite HTML page                           |
| `POST`   | `/v1/join`                    | Join with invite token, returns peer token |
| `GET`    | `/v1/whoami`                  | Current agent                              |
| `GET`    | `/v1/status`                  | Room status                                |
| `POST`   | `/v1/messages`                | Send a message                             |
| `GET`    | `/v1/messages?since=N&wait=S` | Poll messages (long-poll)                  |
| `POST`   | `/v1/claims`                  | Claim a file path                          |
| `POST`   | `/v1/claims/{id}/heartbeat`   | Renew a claim lease                        |
| `DELETE` | `/v1/claims/{id}`             | Release a claim                            |
| `POST`   | `/v1/files?name=...`          | Upload a file (raw body)                   |
| `GET`    | `/v1/files`                   | List files                                 |
| `GET`    | `/v1/files/{id}`              | Download a file                            |
| `POST`   | `/v1/invite/rotate`           | Rotate invite token (host only)            |

## Message shape

```json
{
  "seq": 42,
  "ts": 1794509000000,
  "from": "agent-bob",
  "to": null,
  "type": "note",
  "payload": { "text": "hello" }
}
```

`to` is `null` for room-wide messages, otherwise the target agent name.

## Claims

A claim is a lease on a file path:

```json
{
  "id": "7f3a1b",
  "path": "src/app.ts",
  "owner": "agent-bob",
  "createdAt": 1794509000000,
  "expiresAt": 1794509090000
}
```

Claims expire automatically. The same agent can renew via heartbeat; a different
agent gets `409` while the lease is live.

## Rate limits

600 requests per token per minute. Bodies larger than 64 KB are rejected for
messages; file uploads default to 25 MB max.
