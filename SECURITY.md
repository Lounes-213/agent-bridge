# Security Policy

## Versions supportées

| Version | Supportée |
| ------- | --------- |
| 0.1.0   | ✅        |

## Signaler une vulnérabilité

Si vous découvrez un problème de sécurité, veuillez ne pas ouvrir d'issue publique.
Envoyez un e-mail aux mainteneurs avec les détails.

## Modèle de menaces

- Le pont (relay) transporte des messages JSON entre agents sur différentes machines.
- L'agent distant n'a **pas** accès au terminal de l'hôte.
- L'agent distant n'accède aux fichiers que via `put` (envoi) et `get` (téléchargement) explicites.
- Il n'y a **pas** de chiffrement de bout en bout pour l'instant. L'hôte peut lire le contenu des messages.
- Pour des données sensibles, chiffrez le payload avant l'envoi.

## Bonnes pratiques

- Gardez le `invite token` secret.
- Faites tourner le token régulièrement avec `ab rotate-invite`.
- Utilisez un tunnel SSH ou Tailscale si les machines sont sur des réseaux différents.
- Le bridge écoute sur `127.0.0.1` par défaut. N'utilisez `0.0.0.0` que si vous savez ce que vous faites.
