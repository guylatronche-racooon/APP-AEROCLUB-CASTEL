# Outils de vol — Aéroclub Jean-Doudiès

Application de préparation regroupant check-lists, masse et centrage, altitude-densité,
performances de décollage, données terrain et météo. La documentation approuvée et les
consignes du club restent seules opposables.

## Parcours de préparation

1. **Altitude-densité depuis un METAR.** Le calculateur accepte toujours une saisie
   manuelle. L'option « Utiliser les données du METAR » permet aussi de choisir un
   aérodrome : l'altitude publiée vient du jeu terrain local et le relais météo complète
   le QNH, la température et le point de rosée lorsqu'un METAR récent est disponible.
   Terrain et météo restent indépendants, afin qu'une donnée absente n'efface pas celles
   qui sont utilisables. Les écrans Altitude-densité et Performances donnent aussi un
   accès permanent à AÉROWEB pour consulter les cartes TEMSI et WINTEM.
2. **Carburant prérempli au plein.** Masse & centrage initialise chaque réservoir à sa
   capacité publiée : 120 l sur les SportStar, 110 l dans le principal et 80 l dans les
   ailes sur le DR400. Le pilote réduit ensuite les quantités pour représenter le
   chargement réel ; les 10 l inutilisables du réservoir principal du DR400 ne sont pas
   comptés une seconde fois.
3. **Passage direct entre les calculs.** Après avoir contrôlé le chargement, « Passer à
   Performances » ouvre la préparation piste sans changer d'avion. L'écran Performances
   propose symétriquement « Retour à masse & centrage ».
4. **Terrains partiellement documentés.** Un terrain peut être présent dans les données
   SIA sans publier de METAR, ne pas avoir de VAC dans l'Atlas, ou être absent du jeu
   local. L'application conserve alors les informations certaines, signale précisément
   ce qui manque et laisse la saisie manuelle disponible. Si aucun METAR local n'est
   publié, deux observations voisines récentes au maximum sont proposées selon la
   distance, l'écart d'altitude et leur fraîcheur. Aucune n'est appliquée sans choix
   explicite ; l'avertissement de station voisine reste ensuite visible.
5. **Nature et état de piste.** Les choix sont « Dur sec », « Dur mouillé », « Herbe
   sèche » et « Herbe mouillée ». Les familles proposées suivent les surfaces publiées
   pour la piste sélectionnée ; lorsqu'il existe du dur et de l'herbe, le dur sec est le
   choix initial. Les états mouillés restent hors table tant qu'aucune correction du
   manuel applicable n'a été validée.
6. **Vent, pente et marge.** Le vent moyen du METAR propose automatiquement le QFU
   offrant la meilleure composante longitudinale, sans remplacer la piste en service,
   la VAC ni les NOTAM. La composante du vent moyen préremplit le calcul ; le secteur
   variable et les rafales restent affichés séparément. Si le secteur traverse vent de
   face et vent arrière, 0 kt est proposé et doit être confirmé ou ajusté. La pente
   publiée est reprise ; sinon 0 % est proposé et doit être vérifié.
   La marge pilote/club vaut 0 % par défaut et reste réglable. Pour un terrain de
   montagne ou une altisurface, la documentation du terrain et la réglementation propre
   aux conditions particulières doivent être consultées.
7. **Obligatoire et facultatif sont séparés.** Chargement, conditions du jour, piste et
   distances portent un repère « Obligatoire » et leurs confirmations expirent. La
   comparaison avec l'air humide porte un repère « Facultatif » : elle complète la table
   par une estimation théorique non prévue par le constructeur et ne peut jamais rendre
   acceptable un résultat constructeur défavorable.
8. **Masse DR400 sous le premier point publié.** Le manuel générique fournit des lignes
   à 900 et 1 100 kg. Entre ces valeurs, le moteur interpole. Sous 900 kg, il conserve la
   ligne publiée à 900 kg sans extrapoler vers le bas et affiche l'écart comme calcul
   conservateur. Au-dessus de 1 100 kg, le résultat reste « HORS TABLE ».

## Manuel utilisateur

Le guide complet est disponible dans l'application sous « Manuel d'utilisation » et dans
`app/documents/manuel-utilisation-outils-de-vol.pdf`. La source modifiable se trouve dans
`docs/manuel-utilisation-outils-de-vol.docx`. Il décrit le parcours utilisateur, les
messages, les modes de reprise manuelle, les méthodes de calcul et les réserves d'emploi.
Sa version 0.9 reste un document de travail soumis à validation par le club.

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

Le build de production se génère avec `npm run build` dans `dist/`. Il copie la version
locale de `app/` : il ne télécharge plus un ancien commit distant. Le script accepte aussi
des actifs binaires transmis sous forme de fichiers `.b64`, puis les reconstitue octet
pour octet pendant le build Vercel.

Les tests exécutent le vrai moteur inclus dans `app/index.html`. La suite
couvre les pesées, les enveloppes, les interpolations, les frontières de tables,
les refus hors table, le cas 3 000 ft / 38,5 °C, l'humidité facultative, TORA/TODA,
le traitement conservateur d'une masse DR400 inférieure à 900 kg, les expirations météo,
les stations discordantes, les dates de cycle et les replis du service worker.

## Déploiement Vercel

Le fichier `vercel.json` expose `app/index.html` à la racine, sert le manifeste, les
icônes, le service worker, les scans et le jeu terrain, et laisse `/api/weather` à la
fonction serverless. Définir si possible `AWC_USER_AGENT` avec un nom d'application et
un contact opérationnel. Les scans consultés sont ensuite disponibles hors ligne.

## Données terrain

`app/data/airfields.json` suit un schéma local simple : référence de cycle, date d'effet,
coordonnées ARP, élévation, pistes, QFU, surface, TORA/TODA, pente lorsqu'elle est publiée
et lien VAC. Il est conçu pour être régénéré et contrôlé à chaque
cycle AIRAC depuis les produits numériques du SIA. Une date absente, invalide, future ou
vieille de plus de 28 jours provoque un avertissement visible.

Sources et attribution :

- [SIA — produits numériques en libre disposition](https://www.sia.aviation-civile.gouv.fr/produits-numeriques-en-libre-disposition.html),
  sous Licence Ouverte / Etalab 2.0 ;
- [SIA — Atlas VAC](https://www.sia.aviation-civile.gouv.fr/atlas-vac.html), utilisé
  comme lien de contrôle vers la carte en vigueur ;
- métadonnées de cycle, date d'effet et provenance conservées dans le fichier local pour
  rendre chaque préremplissage traçable.

Le jeu local facilite la saisie mais ne constitue ni une API SIA temps réel, ni une copie
exhaustive de l'AIP. Une absence de fiche, de VAC, de pente, de TODA ou de station météo
n'autorise aucune valeur inventée. La VAC en vigueur, l'AIP, les NOTAM et les informations
opérationnelles du jour font foi.

Les METAR et TAF ne proviennent pas du fichier SIA. La fonction `api/weather.js` utilise
le relais de l'[Aviation Weather Center](https://aviationweather.gov/data/api/), contrôle
l'identité de la station et l'âge réel de l'observation, puis met les réponses en cache.
Les cartes TEMSI et WINTEM restent consultées sur le portail officiel
[AÉROWEB de Météo-France](https://aviation.meteo.fr/login.php) et n'alimentent aucun calcul.

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
- corrections applicables aux pistes mouillées, si elles existent dans les manuels
  approuvés ;
- couverture, cycle et exactitude du jeu terrain SIA ;
- données et check-lists encore incomplètes.

La page « Méthodes & sources » de l'application contient la description complète des
formules, tables, hypothèses, limites et scans utilisés.
