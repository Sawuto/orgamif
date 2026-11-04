# Notre maison – Express + Vue 3

Gestion familiale : planning en grille horaire, tâches, courses, liens, membres.
Répétitions (Lun–Ven, week-end, tous les jours), raccourcis (Réveil, Bus), import .ics,
alerte de conflit d'horaire pour une même personne, connexion par code PIN.

- **Backend** : Express 5 (`server.js`) – API REST, PIN haché (scrypt), sessions par jeton,
  verrou 30 s après 3 codes faux, contrôle des conflits côté serveur.
- **Frontend** : Vue 3 sans build (`public/`), Vue embarqué dans `public/vendor/`.
  Synchro automatique toutes les 15 s entre les appareils de la famille.

## Lancer en local
    npm install
    npm start        # http://localhost:3000
Les données sont écrites dans `data/db.json` (variable `DB_FILE` pour changer).

## Déployer
**Serveur classique (Render, Railway, Fly, VPS)** : `npm start`, avec un disque persistant
monté sur `data/`.

**Vercel** : le disque est éphémère, il faut donc une base. Le code gère Upstash Redis :
créez une base Upstash (Marketplace Vercel) puis définissez `UPSTASH_REDIS_REST_URL` et
`UPSTASH_REDIS_REST_TOKEN`. `server.js` exporte l'app Express, que Vercel détecte.

## Sécurité
Protection légère, adaptée à une famille : PIN à 4 chiffres, jetons de session stockés
dans le navigateur. Servez le site en HTTPS (automatique sur Vercel). Un PIN oublié se
réinitialise depuis l'onglet Membres par un autre membre connecté.
