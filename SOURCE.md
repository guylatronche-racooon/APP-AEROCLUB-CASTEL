# Source du déploiement

Le déploiement est construit directement depuis la révision courante du dépôt public
`guylatronche-racooon/APP-AEROCLUB-CASTEL`.

La commande `npm run build` exécute `build.mjs`, qui délègue à
`scripts/build.mjs` et copie le répertoire local `app/` vers `dist/app/`.
La fonction `api/weather.js` est jointe au même déploiement par Vercel.

Le build ne télécharge plus une archive d’un ancien commit : le contenu publié est donc
exactement celui de la révision Git qui déclenche le déploiement. Le SHA de cette
révision, affiché par GitHub et Vercel, constitue l’identifiant immuable à conserver pour
la traçabilité d’une livraison.
