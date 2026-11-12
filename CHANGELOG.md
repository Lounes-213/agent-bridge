# Changelog

## [0.1.0] - 2026-11-12

### Ajouté

- Serveur relais HTTP avec état persistant dans `state.json`
- Authentification par bearer token (join token, peer token, host token)
- Envoi de messages entre agents (`POST /v1/messages`)
- Récupération de messages avec long-poll (`GET /v1/messages?since=&wait=`)
- Pairs (peers) : rejoindre une salle avec un token d'invitation
- Pivots de fichiers (claims) avec TTL et renouvellement (`heartbeat`)
- Revendication et libération de pivots
- Téléchargement et téléversement de fichiers (jusqu'à 25 Mo)
- Interface web dashboard (`/ui`) pour visualiser pairs, pivots, messages
- Rotation du token d'invitation (hôte uniquement)
- Déconnexion d'un pair (hôte uniquement)
- Revendication de pivot (hôte uniquement)
- Client HTTP minimal (`src/client.js`)
- Serveur MCP pour IDE (`src/mcp.js`) avec outils : `ab_status`, `ab_send`, `ab_poll`, `ab_claim`, `ab_release`, `ab_list_files`, `ab_put_file`, `ab_get_file`, `ab_rotate_invite`, `ab_whoami`
- CLI complet (`src/cli.js`) : `host`, `join`, `status`, `whoami`, `send`, `poll`, `claim`, `release`, `files`, `put`, `get`, `rotate-invite`
- Licence MIT
- Documentation : `README.md`, `docs/PROTOCOL.md`, `docs/QUICKSTART.md`
