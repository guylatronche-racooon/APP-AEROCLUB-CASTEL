# Relais météo AWC

`GET /api/weather?icao=LFBL` récupère le METAR et le TAF auprès de l'API publique
de l'**Aviation Weather Center (NOAA/NWS)**. Le relais est nécessaire parce que
l'API AWC n'autorise pas les requêtes CORS directes depuis un navigateur.

Le handler ne dépend d'aucune bibliothèque et suit le format serverless Vercel
(`export default async function`). Il valide un identifiant ICAO de quatre lettres,
normalise notamment le texte brut, les horodatages, la température, le point de
rosée, le QNH, la direction et la vitesse du vent, les rafales et le secteur variable,
puis conserve en mémoire le METAR pendant 60 s et le TAF pendant 600 s. Si les champs
structurés du vent manquent, le groupe TAC (`dddffGggKT`, `VRBffKT`, `dddVddd`) est
analysé sans inventer de direction pour un vent variable. Le rapport doit correspondre
exactement à la station demandée. Pour le METAR,
`reportStatus` et `reportAgeSeconds` qualifient l'heure d'observation elle-même :
une heure absente, future de plus de cinq minutes ou vieille de plus de deux heures
n'est pas confondue avec un fetch récent. `receiptTime` n'est jamais utilisé comme
heure d'observation. Ce cache est opportuniste : une instance serverless froide
repart sans cache. La réponse HTTP ajoute aussi un cache partagé de 60 s.

Variables d'environnement facultatives :

- `AWC_USER_AGENT` : identifiant personnalisé envoyé à AWC ; en production, utiliser
  idéalement un nom d'application et un moyen de contact.
- `AWC_TIMEOUT_MS` : délai amont compris entre 1 000 et 20 000 ms (8 000 ms par défaut).

Les états `fresh`, `cached`, `stale`, `no_data`, `rate_limited` et `error` sont
distincts pour le METAR et le TAF. Une donnée expirée n'est renvoyée qu'en secours,
avec l'état `stale` et un avertissement explicite. Les réponses AWC 204 et 429 sont
traitées sans masquer leur signification. Le client affiche aussi le statut de cache
du TAF et recalcule en continu sa période de validité ; le TAF n'alimente jamais le
calcul de performance instantané.

Source et contraintes : <https://aviationweather.gov/data/api/>. Ces données météo
ne remplacent ni un briefing officiel ni les documents opérationnels applicables.
