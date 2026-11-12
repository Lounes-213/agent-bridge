mkdir .agent-bridge-data
AB_PORT=8787 node src/cli.js host

````

Terminal 2 (machine B):

```bash
export AB_URL=http://127.0.0.1:8787
export AB_TOKEN=<peer token from step 2>
export AB_AGENT=agent-bob

node src/cli.js send "hello from machine B"
node src/cli.js poll 0 5
node src/cli.js claim src/app.ts 120
node src/cli.js status
````

Expected output for `status`:

```json
{
  "room": {
    "id": "4a1f2c9d",
    "name": "room",
    "createdAt": 1794509000000
  },
  "peers": [
    { "agent": "host", "joinedAt": ..., "lastSeen": ... },
    { "agent": "agent-bob", "joinedAt": ..., "lastSeen": ... }
  ],
  "claims": [ ... ],
  "files": [ ... ],
  "messages": { "count": 3, "lastSeq": 3 }
}
```

## Test with two machines on different networks

1. Install cloudflared: `winget install --id Cloudflare.cloudflared`
2. On the host, start the bridge: `AB_PORT=8787 node src/cli.js host`
3. In another terminal: `cloudflared tunnel --url http://127.0.0.1:8787`
4. Use the public `trycloudflare.com` URL as `AB_URL` from machine B.
5. For a permanent link, create a named tunnel with a domain on Cloudflare.
