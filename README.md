# Toolbox

Mes apps perso (PWA) pour remplacer des apps payantes. HTML/CSS/JS sans build.
Chaque app est **une PWA indépendante** (son propre manifest + service worker) : on peut l'installer seule.

| App | Dossier | Description |
|---|---|---|
| Rounds | `rounds/` | Minuteur : Intervalles/Tabata, Boxe (rounds personnalisables un par un), EMOM, AMRAP, For Time. Bips, vibrations, écran maintenu allumé, presets. |
| Scanner | `scan/` | Photo → détection des bords → redressement + filtre → PDF → l'IA (Claude) reconnaît le document et le range dans le bon dossier Twake. |
| Gambit | `chess/` | Répertoire d'ouvertures (graphe de positions, transpositions, import/export PGN avec variantes), révision en répétition espacée (apprendre / réviser / points faibles / ligne au hasard / à l'aveugle), analyse Stockfish sur l'appareil + éval cloud, explorateur des parties de maîtres Lichess, puzzle du jour, stats et sauvegarde JSON. |
| Calc | `calc/` | Calculatrice standard + scientifique légère (trigo deg/rad, ln/log, puissances, racines, !), aperçu en direct, historique, clavier physique. |

## Lancer en local

```sh
npx serve .        # ou : python -m http.server 8080
```

## Hébergement

En ligne sur **https://jacques-herrmann.github.io/toolbox/** (GitHub Pages, branche `main`, racine ; déploiement auto à chaque push).
Pour installer une app seule sur le téléphone : ouvrir `https://jacques-herrmann.github.io/toolbox/rounds/` puis « Ajouter à l'écran d'accueil ».

`.nojekyll` : GitHub sert les fichiers tels quels (pas de Jekyll). Tous les chemins du site sont relatifs, il marche donc
dans le sous-dossier `/toolbox/` comme à la racine d'un domaine.
Ancien hébergement : Netlify (abandonné à cause du badge imposé sur l'offre gratuite ; `netlify.toml` conservé au cas où).

## Serveur du Scanner (`server/`, Cloudflare Worker, gratuit)

Le serveur garde les secrets (clé Claude, jetons Twake) hors du téléphone, et fait les appels
à Twake (son endpoint OAuth n'autorise pas les appels directs depuis un navigateur).

```sh
cd server
npm install
npx wrangler login
npx wrangler kv namespace create TOKENS      # copier l'id dans wrangler.toml
# éditer wrangler.toml : TWAKE_URL (ex. https://moi.twake.app) et ROOT_FOLDER
npx wrangler secret put ANTHROPIC_API_KEY    # clé sur https://console.anthropic.com
npx wrangler secret put APP_SECRET           # un long mot de passe au hasard
npx wrangler deploy
```

Puis dans le Scanner → ⚙️ : URL du worker + APP_SECRET → « Tester » → lien « connecter Twake »
(une seule fois, autorise l'accès aux fichiers).

Coût : Claude Opus 5.5 ≈ quelques centimes par document scanné.

## Ajouter une app

1. Créer `mon-app/` avec `index.html`, `app.js`, `manifest.webmanifest` (`"id"`, `"scope"` et `"start_url"` = `"./"`), `icon.svg`
   et `sw.js` (`importScripts('../shared/sw-factory.js'); toolboxSW('mon-app-v1', [...])`).
2. Ajouter une tuile dans `index.html` à la racine.

Partagé : `shared/style.css`, `shared/store.js` (stockage local par app), `shared/pwa.js`.
