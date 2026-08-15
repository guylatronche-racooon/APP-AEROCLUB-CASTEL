import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const APP_URL = new URL('../app/index.html', import.meta.url);
const html = readFileSync(APP_URL, 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);

assert.ok(inlineScript, 'Le script principal de app/index.html doit être present');

const appElement = { innerHTML: '' };
const storage = new Map([['acjd-flight-tools-disclaimer-v1', 'accepted']]);
let fetchImplementation = async () => {
  throw new Error('Aucun acces reseau reel ne doit etre effectue par les tests');
};

const context = vm.createContext({
  console,
  confirm: () => true,
  document: {
    addEventListener: () => {},
    documentElement: { style: {} },
    getElementById: () => appElement,
    querySelector: () => null,
  },
  fetch: (...arguments_) => fetchImplementation(...arguments_),
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  navigator: {},
  scrollTo: () => {},
});

const source = `${inlineScript[1]}\n` +
  'globalThis.__performanceTestApi = {' +
  'sportStarPerformance, dr400Performance, sportStarBalance, dr400Balance, ' +
  'aircraftList, state, atmosphereResult, interpolateSportStar, interpolateDr400, ' +
  'performanceAtConditions, performanceResult, headwindFactor, loadDepartureContext, ' +
  'selectPublishedRunway, setDepartureNumericValue, invalidateConditionsAfterEdit, homeView, balanceView, performanceView, densityAltitudeView, calculationBasesView' +
  '};';

new vm.Script(source, { filename: APP_URL.pathname }).runInContext(context, { timeout: 5_000 });

const {
  sportStarPerformance,
  dr400Performance,
  aircraftList,
  state,
  atmosphereResult,
  interpolateSportStar,
  performanceAtConditions,
  performanceResult,
  headwindFactor,
  loadDepartureContext,
  selectPublishedRunway,
  setDepartureNumericValue,
  invalidateConditionsAfterEdit,
  homeView,
  balanceView,
  performanceView,
  densityAltitudeView,
  calculationBasesView,
} = context.__performanceTestApi;

const sportStar = aircraftList.find((aircraft) => aircraft.id === 'f-hdlt');
const dr400 = aircraftList.find((aircraft) => aircraft.id === 'f-gghl');

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Valeur attendue ${expected}, valeur obtenue ${actual} (tolerance ${tolerance})`,
  );
}

function plainArray(value) {
  return Array.from(value);
}

function setSportStarLoad({ pilot = 90, copilot = 90, baggage = 0, fuelLitres = 50 } = {}) {
  state.loads['f-hdlt'] = { pilot, copilot, baggage, fuelLitres };
}

function setDr400Load() {
  state.loads['f-gghl'] = {
    pilot: 83,
    frontPassenger: 75,
    rearPassengers: 75,
    baggage: 0,
    mainFuelLitres: 110,
    wingFuelLitres: 80,
  };
}

function setDeparture(overrides = {}) {
  const defaults = {
    icao: 'TEST',
    elevation: 0,
    qnh: 1013.25,
    temperature: 15,
    dewPoint: 10,
    useHumidity: false,
    tora: 800,
    toda: 800,
    surface: 'hard',
    windComponent: 0,
    slope: 0,
    safetyMarginPercent: 0,
    runwayId: '',
    loadConfirmed: 'f-hdlt',
    loadConfirmedAt: Date.now(),
    conditionsConfirmed: true,
    conditionsConfirmedAt: Date.now(),
    runwayConfirmed: true,
    runwayConfirmedAt: Date.now(),
  };
  state.departure = { ...defaults, ...overrides };
  state.airfield = { status: 'idle', message: '', record: null, cycle: '' };
  state.weather = { status: 'idle', message: '', rawMetar: '', rawTaf: '', observedAt: '' };
}

test('SportStar RTC : les quatre colonnes et les noeuds publies sont restitues exactement', () => {
  const hard = performanceAtConditions(sportStarPerformance, 600, 4_000, 27.1, 'hard', 0);
  const grass = performanceAtConditions(sportStarPerformance, 600, 4_000, 27.1, 'grass', 0);

  assert.deepEqual(plainArray(hard.vector), [173, 436, 223, 491]);
  assert.equal(hard.roll, 173);
  assert.equal(hard.total, 436);
  assert.equal(grass.roll, 223);
  assert.equal(grass.total, 491);

  const upperBoundary = performanceAtConditions(
    sportStarPerformance,
    600,
    8_000,
    19.2,
    'grass',
    0,
  );
  assert.deepEqual(plainArray(upperBoundary.vector), [195, 493, 253, 556]);
});

test('SportStar RTC : interpolation bilineaire au milieu de la grille', () => {
  const result = performanceAtConditions(sportStarPerformance, 575, 3_000, 14.05, 'grass', 0);

  closeTo(result.isaTemperature, 9.05);
  closeTo(result.isaDeviation, 5);
  assert.deepEqual(plainArray(result.vector), [159.25, 401.75, 205.75, 453]);
  closeTo(result.roll, 205.75);
  closeTo(result.total, 453);
});

test('SportStar RTC : aucune extrapolation en altitude ou en ecart ISA', () => {
  assert.equal(interpolateSportStar(sportStarPerformance, -0.01, 0), null);
  assert.equal(interpolateSportStar(sportStarPerformance, 10_000.01, 0), null);
  assert.equal(interpolateSportStar(sportStarPerformance, 3_000, -10.01), null);
  assert.equal(interpolateSportStar(sportStarPerformance, 3_000, 20.01), null);

  assert.ok(interpolateSportStar(sportStarPerformance, 0, -10));
  assert.ok(interpolateSportStar(sportStarPerformance, 10_000, 20));
});

test('SportStar RTC : aucune correction favorable de masse ou de vent de face', () => {
  const light = performanceAtConditions(sportStarPerformance, 500, 0, 15, 'hard', 0);
  const maximum = performanceAtConditions(sportStarPerformance, 600, 0, 15, 'hard', 0);
  const headwind = performanceAtConditions(sportStarPerformance, 600, 0, 15, 'hard', 20);

  assert.deepEqual(plainArray(light.vector), plainArray(maximum.vector));
  assert.equal(headwind.roll, maximum.roll);
  assert.equal(headwind.total, maximum.total);
  assert.equal(headwind.windFactor, 1);
});

test('Cas demande : 3 000 ft et 38,5 C reste strictement HORS TABLE', () => {
  setSportStarLoad();
  setDeparture({
    elevation: 3_000,
    temperature: 38.5,
    surface: 'grass',
    loadConfirmed: 'f-hdlt',
  });

  const atmosphere = atmosphereResult(state.departure);
  closeTo(atmosphere.pressureAltitude, 3_000, 1e-8);
  const direct = performanceAtConditions(
    sportStarPerformance,
    574.8,
    atmosphere.pressureAltitude,
    atmosphere.temperature,
    'grass',
    0,
  );
  assert.equal(direct, null);

  const result = performanceResult(sportStar);
  closeTo(result.mass, 574.8);
  assert.equal(result.valid, false);
  assert.equal(result.base, null);
  assert.equal(result.roll, null);
  assert.equal(result.total, null);
  assert.equal(result.margin, null);
  assert.equal(result.sufficient, false);
  assert.ok(result.issues.some((issue) => issue.includes('Écart ISA +29,45')));
});

test('SportStar RTC : le resultat final est arrondi au metre superieur', () => {
  setSportStarLoad();
  setDeparture({ elevation: 3_000, temperature: 14.05, surface: 'grass' });

  const result = performanceResult(sportStar);
  assert.equal(result.valid, true);
  closeTo(result.base.roll, 205.75, 1e-8);
  closeTo(result.base.total, 453, 1e-8);
  assert.equal(result.roll, 206);
  assert.equal(result.total, 453);
  assert.equal(result.margin, 347);
  assert.match(performanceView(),/Distances piste indicatives/);
  assert.doesNotMatch(performanceView(),/performance-status safe/);
});

test('La marge additionnelle est appliquée après la table et arrondie vers le haut', () => {
  setSportStarLoad();
  setDeparture({ elevation: 3_000, temperature: 14.05, surface: 'grass', safetyMarginPercent: 10 });

  const result = performanceResult(sportStar);
  assert.equal(result.valid, true);
  assert.equal(result.rawRoll, 206);
  assert.equal(result.rawTotal, 453);
  assert.equal(result.roll, 227);
  assert.equal(result.total, 499);
  assert.equal(result.margin, 301);
});

test('Une marge additionnelle absente bloque le calcul sans prétendre être hors table', () => {
  setSportStarLoad();
  setDeparture({ safetyMarginPercent: '' });
  state.aircraftId = 'f-hdlt';

  const result = performanceResult(sportStar);
  assert.equal(result.valid, false);
  assert.equal(result.outOfTable, false);
  assert.ok(result.issues.some((issue) => issue.includes('Marge de sécurité manquante')));
  assert.match(performanceView(), /CALCUL BLOQUÉ/);
});

test('Une marge résiduelle exactement nulle est refusée', () => {
  setSportStarLoad();
  setDeparture({ tora:143, toda:361, surface:'hard' });

  const result = performanceResult(sportStar);
  assert.equal(result.valid,true);
  assert.equal(result.margin,0);
  assert.equal(result.sufficient,false);
  assert.match(performanceView(),/Aucune marge de piste résiduelle/);
});

test('Une nature de piste inconnue bloque sans être classée hors table', () => {
  setSportStarLoad();
  setDeparture({surface:'unknown'});

  const result = performanceResult(sportStar);
  assert.equal(result.valid,false);
  assert.equal(result.outOfTable,false);
  assert.ok(result.issues.some((issue)=>issue.includes('non renseignés')));
});

test('Humidite : la valeur la plus restrictive est retenue', () => {
  setSportStarLoad();
  setDeparture({
    elevation: 0,
    temperature: 30,
    dewPoint: 20,
    useHumidity: true,
    surface: 'grass',
  });

  const result = performanceResult(sportStar);
  assert.equal(result.valid, true);
  assert.ok(result.atmosphere.equivalentDryPressureAltitude > result.atmosphere.pressureAltitude);
  assert.ok(result.humidEstimate.total > result.base.total);
  closeTo(result.selected.total, result.humidEstimate.total);
  assert.equal(result.total, Math.ceil(result.humidEstimate.total));
});

test('Humidite : si lestimation sort de la table, aucun verdict nest produit', () => {
  setSportStarLoad();
  setDeparture({
    elevation: 0,
    temperature: 35,
    dewPoint: 30,
    useHumidity: true,
    surface: 'grass',
  });

  const result = performanceResult(sportStar);
  assert.ok(result.base, 'Le point constructeur sec ISA+20 doit rester dans la table');
  assert.equal(result.humidEstimate, null);
  assert.equal(result.selected, null);
  assert.equal(result.valid, false);
  assert.equal(result.total, null);
  assert.ok(result.issues.some((issue) => issue.includes("humidité hors domaine")));
});

test('Vent arriere et piste montante interdisent le verdict SportStar', () => {
  setSportStarLoad();
  setDeparture({ windComponent: -1, slope: 0 });
  const tailwind = performanceResult(sportStar);
  assert.equal(tailwind.valid, false);
  assert.equal(tailwind.margin, null);
  assert.ok(tailwind.issues.some((issue) => issue.includes('Vent arrière')));

  setDeparture({ windComponent: 0, slope: 0.1 });
  const uphill = performanceResult(sportStar);
  assert.equal(uphill.valid, false);
  assert.equal(uphill.margin, null);
  assert.ok(uphill.issues.some((issue) => issue.includes('Piste montante')));
});

test('DR400 generique : la correction de vent est bornee a 30 kt', () => {
  closeTo(headwindFactor(dr400Performance, 0), 1);
  closeTo(headwindFactor(dr400Performance, 10), 0.81);
  closeTo(headwindFactor(dr400Performance, 20), 0.67);
  closeTo(headwindFactor(dr400Performance, 30), 0.56);

  setDr400Load();
  setDeparture({ loadConfirmed: 'f-gghl', windComponent: 30 });
  const boundary = performanceResult(dr400);
  assert.equal(boundary.valid, true);

  setDeparture({ loadConfirmed: 'f-gghl', windComponent: 30.01 });
  const outside = performanceResult(dr400);
  assert.equal(outside.valid, false);
  assert.equal(outside.margin, null);
  assert.ok(outside.issues.some((issue) => issue.includes('Vent de face hors table')));
});

test('Le verdict exige une confirmation explicite du chargement courant', () => {
  setSportStarLoad();
  setDeparture({ loadConfirmed: '' });

  const result = performanceResult(sportStar);
  assert.equal(result.valid, false);
  assert.equal(result.margin, null);
  assert.ok(result.issues.some((issue) => issue.includes('Chargement non confirmé')));
});

test('La confirmation des conditions expire après soixante minutes', () => {
  setSportStarLoad();
  setDeparture({conditionsConfirmed:true,conditionsConfirmedAt:Date.now()-60*60*1000-1});

  const result=performanceResult(sportStar);
  assert.equal(result.valid,false);
  assert.ok(result.issues.some((issue)=>issue.includes('expirée')));
});

test('Les confirmations chargement et piste expirent aussi après soixante minutes',()=>{
  setSportStarLoad();
  setDeparture({loadConfirmedAt:Date.now()-60*60*1000-1,runwayConfirmedAt:Date.now()-60*60*1000-1});

  const result=performanceResult(sportStar);
  assert.equal(result.valid,false);
  assert.ok(result.issues.some((issue)=>issue.includes('chargement expirée')));
  assert.ok(result.issues.some((issue)=>issue.includes('piste expirée')));
});

test('Une confirmation METAR expire aussi lorsque l’observation dépasse deux heures', () => {
  setSportStarLoad();
  setDeparture({
    conditionsConfirmed:true,
    conditionsConfirmedAt:Date.now(),
    conditionsSource:'metar',
    conditionsObservedAt:new Date(Date.now()-2*60*60*1000-1).toISOString(),
  });

  const result=performanceResult(sportStar);
  assert.equal(result.valid,false);
  assert.ok(result.issues.some((issue)=>issue.includes('expirée')));
});

test('La saisie manuelle du vent conserve la provenance METAR de QNH et OAT',()=>{
  const observedAt=new Date(Date.now()-30*60*1000).toISOString();
  setDeparture({conditionsSource:'metar',conditionsObservedAt:observedAt,conditionsConfirmed:true,conditionsConfirmedAt:Date.now()});

  invalidateConditionsAfterEdit('windComponent');
  assert.equal(state.departure.conditionsSource,'metar');
  assert.equal(state.departure.conditionsObservedAt,observedAt);
  assert.equal(state.departure.conditionsConfirmed,false);

  invalidateConditionsAfterEdit('qnh');
  assert.equal(state.departure.conditionsSource,'manual');
  assert.equal(state.departure.conditionsObservedAt,'');
});

test('Contrat reel relais meteo/interface : ICAO, enveloppes data et terrain voisin', async () => {
  setSportStarLoad();
  setDeparture({ icao: 'LFMW', loadConfirmed: 'f-hdlt' });
  const requestedUrls = [];
  const observedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const tafValidFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const tafValidTo = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  fetchImplementation = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith('/data/airfields.json')) {
      return {
        ok: true,
        json: async () => ({
          cycle: 'TEST',
          airfields: [{
            icao: 'LFMW',
            name: 'Terrain test',
            elevationFt: 553,
            metarStation: 'LFMK',
            metarStationNote: 'Observation voisine',
            runways: [{ id: '11', label: '11', toraM: 810, surface: 'hard' }],
          }],
        }),
      };
    }
    if (String(url).startsWith('/api/weather?icao=LFMK')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          metar: {
            status: 'fresh',
            stale: false,
            ageSeconds: 10,
            data: {
              station: 'LFMK',
              raw: 'LFMK 141200Z 30005KT CAVOK 20/10 Q1015',
              observedAt,
              temperatureC: 20,
              dewpointC: 10,
              qnhHpa: 1015,
            },
          },
          taf: {
            status: 'fresh',
            stale: false,
            ageSeconds: 10,
            data: { raw: 'TAF LFMK 141100Z 1412/1512 30005KT CAVOK', validFrom:tafValidFrom, validTo:tafValidTo },
          },
        }),
      };
    }
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDepartureContext();

  assert.ok(requestedUrls.some((url) => url === '/api/weather?icao=LFMK'));
  assert.equal(state.departure.elevation, 553);
  assert.equal(state.departure.tora, 810);
  assert.equal(state.departure.toda, 810);
  assert.equal(state.departure.todaDerived, true);
  assert.equal(state.departure.surface, 'hard');
  assert.equal(state.departure.temperature, 20);
  assert.equal(state.departure.dewPoint, 10);
  assert.equal(state.departure.qnh, 1015);
  assert.equal(state.weather.status, 'loaded');
  assert.equal(state.weather.station, 'LFMK');
  assert.equal(state.weather.stationNote, 'Observation voisine');
  assert.match(state.weather.rawMetar, /^LFMK /);
  assert.match(state.weather.rawTaf, /^TAF LFMK /);
  assert.match(performanceView(),/STATION VOISINE/);
  assert.equal(state.weather.tafStatus,'current');
  assert.equal(state.departure.conditionsSource,'metar');
  assert.equal(state.departure.conditionsObservedAt,observedAt);

  state.weather.tafValidTo=new Date(Date.now()-1).toISOString();
  assert.match(performanceView(),/période de validité expirée/);
  state.weather.tafRelayStatus='stale';
  assert.match(performanceView(),/cache périmé/);
  state.weather.tafRelayStatus='fresh';
  state.weather.rawTaf='TAF LFMK 142300Z 1423/1523 CNL';
  state.weather.tafValidFrom=new Date(Date.now()-60*60*1000).toISOString();
  state.weather.tafValidTo=new Date(Date.now()+6*60*60*1000).toISOString();
  assert.match(performanceView(),/TAF annulé \(CNL\)/);

  setDepartureNumericValue('tora',700);
  assert.equal(state.departure.tora,700);
  assert.equal(state.departure.toda,'');
  assert.equal(state.departure.todaDerived,false);
  selectPublishedRunway('11');

  state.departure.runwayConfirmed=true;
  state.departure.runwayConfirmedAt=Date.now();
  selectPublishedRunway('');
  assert.equal(state.departure.runwayId,'');
  assert.equal(state.departure.tora,'');
  assert.equal(state.departure.toda,'');
  assert.equal(state.departure.surface,'unknown');
  assert.equal(state.departure.slope,'');
  assert.equal(state.departure.runwayConfirmed,false);
});

test('Un METAR trop ancien reste visible mais ne préremplit aucune condition', async () => {
  setSportStarLoad();
  setDeparture({icao:'LFBL'});
  const oldObservedAt=new Date(Date.now()-3*60*60*1000).toISOString();
  fetchImplementation=async (url)=>{
    if(String(url).startsWith('/data/airfields.json'))return {ok:true,json:async()=>({cycle:'TEST',effectiveDate:new Date().toISOString(),airfields:[]})};
    if(String(url).startsWith('/api/weather?icao=LFBL'))return {ok:true,status:200,json:async()=>({
      metar:{status:'fresh',data:{station:'LFBL',raw:'METAR LFBL OLD',observedAt:oldObservedAt,temperatureC:20,dewpointC:10,qnhHpa:1015,reportStatus:'old'}},
      taf:{status:'no_data',data:null},
    })};
    throw new Error('URL inattendue');
  };

  await loadDepartureContext();

  assert.equal(state.weather.status,'partial');
  assert.equal(state.departure.temperature,'');
  assert.equal(state.departure.qnh,'');
  assert.equal(state.departure.dewPoint,'');
  assert.match(performanceView(),/OBSERVATION NON ACTUELLE/);
});

test('Une date de cycle terrain absente, invalide ou future échoue en mode périmé', async () => {
  for(const effectiveDate of ['', 'date-invalide', new Date(Date.now()+24*60*60*1000).toISOString()]){
    setSportStarLoad();
    setDeparture({icao:'LFBL'});
    fetchImplementation=async (url)=>{
      if(String(url).startsWith('/data/airfields.json'))return {ok:true,json:async()=>({
        cycle:'TEST',effectiveDate,airfields:[{icao:'LFBL',name:'Terrain test',elevationFt:100,runways:[]}],
      })};
      if(String(url).startsWith('/api/weather?icao=LFBL'))return {ok:false,status:502,json:async()=>({error:{message:'indisponible'}})};
      throw new Error('URL inattendue');
    };

    await loadDepartureContext();
    assert.equal(state.airfield.stale,true,`date testée: ${effectiveDate}`);
  }
});

test('Les cinq écrans principaux se rendent sans erreur et exposent leurs avertissements', () => {
  setSportStarLoad();
  setDeparture({
    elevation: 3_000,
    temperature: 38.5,
    surface: 'grass',
    conditionsConfirmed: true,
    runwayConfirmed: true,
  });
  state.aircraftId = 'f-hdlt';

  assert.match(homeView(), /Méthodes & sources/);
  assert.match(balanceView(), /Dans l’enveloppe numérisée/);
  assert.match(performanceView(), /HORS TABLE/);
  assert.match(performanceView(), /ISA \+29,45/);
  assert.match(densityAltitudeView(), /Altitude-densité/);

  const methods = calculationBasesView();
  assert.match(methods, /Méthodes, données et limites/);
  assert.match(methods, /Prototype non approuvé/);
  assert.equal((methods.match(/class="document-card"/g) || []).length, 11);
});
