# Contributing to Agent Bridge

Merci pour votre intérêt à contribuer à Agent Bridge. Ce projet est ouvert à tous.

## Comment contribuer

1. **Fork** le dépôt
2. Créez une branche : `git checkout -b feature/nom-de-la-fonctionnalite`
3. Apportez vos modifications
4. Testez : `npm test`
5. Commitez : `git commit -m "feat: description courte"`
6. Poussez : `git push origin feature/nom-de-la-fonctionnalite`
7. Ouvrez une Pull Request

## Règles de code

- Utilisez des modules ES (`type: "module"`)
- Pas de dépendances externes (Node.js built-in uniquement)
- Format Prettier (2 espaces)
- Commentaires en anglais ou français

## Signer vos commits

Nous utilisons les conventional commits :

| Type       | Quand l'utiliser                            |
| ---------- | ------------------------------------------- |
| `feat`     | Nouvelle fonctionnalité                     |
| `fix`      | Correction de bug                           |
| `docs`     | Documentation uniquement                    |
| `refactor` | Refactoring sans changement de comportement |
| `test`     | Ajout ou modification de tests              |

Exemple : `feat: add web UI dashboard for room monitoring`

## Licence

En contribuant, vous acceptez que vos contributions soient sous licence MIT.
