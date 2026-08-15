# Outils de vol — Aéroclub Jean-Doudiès

Application de préparation regroupant check-lists, masse et centrage, altitude-densité,
performances de décollage, données terrain et météo. La documentation approuvée et les
consignes du club restent seules opposables.

## Prévisualisation locale

```bash
python3 -m http.server 4173 -d app
```

Ouvrir ensuite `http://localhost:4173`. Le site statique fonctionne sans le relais météo ;
les valeurs peuvent alors être saisies manuellement. Pour tester METAR/TAF, déployer aussi
la fonction `api/weather.js` sur une plateforme compatible avec les handlers Vercel.

## Tests

```bash
node --test tests/*.test.mjs
```

Le build de production se génère avec `npm run build` dans `dist/`. Le script accepte
aussi des actifs binaires transmis sous forme de fichiers `.b64`, puis les reconstitue
octet pour octet pendant le build Vercel.

Les tests exécutent le vrai moteur inclus dans `app/index.html`. La suite
couvrent les pesées, les enveloppes, les interpolations, les frontières de tables,
les refus hors table, le cas 3 000 ft / 38,5 °C, l'humidité facultative, TORA/TODA,
les expirations météo, les stations discordantes, les dates de cycle et les replis du
service worker.

## Déploiement Vercel

Le fichier `vercel.json` expose `app/index.html` à la racine, sert le manifeste, les
icônes, le service worker, les scans et le jeu terrain, et laisse `/api/weather` à la
fonction serverless. Définir si possible `AWC_USER_AGENT` avec un nom d'application et
un contact opérationnel. Les scans consultés sont ensuite disponibles hors ligne.

## Données terrain

`app/data/airfields.json` suit un schéma local simple : référence de cycle, date d'effet,
élévation, pistes, surface, TORA/TODA, lien VAC et éventuelle station METAR voisine.
L'unique entrée LFMW est une transcription pilote non validée, et non un import SIA
certifié. En production, ce fichier devra être régénéré et contrôlé à chaque cycle AIRAC
depuis les données XML/AIXM sous licence ouverte du SIA. Une date absente, invalide,
future ou vieille de plus de 28 jours provoque un avertissement visible.

## Persistance et confirmations

- les cases de check-list ne quittent pas l'onglet courant ; un rechargement repart vide ;
- « Nouveau vol » efface explicitement toute progression en cours ;
- les conditions météo, confirmations de chargement et confirmations piste ne sont jamais
  restaurées comme valides après rechargement ;
- une confirmation des conditions expire après 60 minutes et, si elle vient d'un METAR,
  au plus tard lorsque l'observation atteint deux heures ;
- l'avertissement général réapparaît à chaque ouverture.

## Points encore soumis à validation club

- pesée F-HDLT appliquée provisoirement au F-HDLV ;
- numérisation de l'enveloppe SportStar ;
- conditions générales complètes de la série de performances SportStar RTC ;
- manuel, hélice et suppléments applicables au F-GGHL ;
- limites structurelles par poste et catégorie Utilitaire du DR400 ;
- données et check-lists encore incomplètes.

La page « Méthodes & sources » de l'application contient la description complète des
formules, tables, hypothèses, limites et scans utilisés.
