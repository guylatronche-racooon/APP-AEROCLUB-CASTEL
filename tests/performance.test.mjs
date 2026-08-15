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
const documentListeners = new Map();
let fetchImplementation = async () => {
  throw new Error('Aucun acces reseau reel ne doit etre effectue par les tests');
};

const context = vm.createContext({
  console,
  confirm: () => true,
  document: {
    addEventListener: (name, listener) => documentListeners.set(name, listener),
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
  'loadDensityContext, densityAltitudeResult, ' +
  'selectPublishedRunway, setDepartureNumericValue, invalidateConditionsAfterEdit, ' +
  'normalizeSurfaceValue, surfaceFamily, surfaceIsDryAndSupported, availableSurfaceOptions, ' +
  'defaultDrySurface, conservativeMetarWindComponent, metarWindAnalysis, recommendedRunwayFromWeather, runwayHeadingDegrees, defaultLoad, ' +
  'DEPARTURE_DEFAULTS, homeView, balanceView, performanceView, densityAltitudeView, calculationBasesView' +
  '};';

new vm.Script(source, { filename: APP_URL.pathname }).runInContext(context, { timeout: 5_000 });

const {
  sportStarPerformance,
  dr400Performance,
  sportStarBalance,
  dr400Balance,
  aircraftList,
  state,
  atmosphereResult,
  interpolateSportStar,
  performanceAtConditions,
  performanceResult,
  headwindFactor,
  loadDepartureContext,
  loadDensityContext,
  densityAltitudeResult,
  selectPublishedRunway,
  setDepartureNumericValue,
  invalidateConditionsAfterEdit,
  normalizeSurfaceValue,
  surfaceFamily,
  surfaceIsDryAndSupported,
  availableSurfaceOptions,
  defaultDrySurface,
  conservativeMetarWindComponent,
  metarWindAnalysis,
  recommendedRunwayFromWeather,
  runwayHeadingDegrees,
  defaultLoad,
  DEPARTURE_DEFAULTS,
  homeView,
  balanceView,
  performanceView,
  densityAltitudeView,
  calculationBasesView,
} = context.__performanceTestApi;

const sportStar = aircraftList.find((aircraft) => aircraft.id === 'f-hdlt');
const dr400 = aircraftList.find((aircraft) => aircraft.id === 'f-gghl');

test('Les en-têtes mobiles respectent la zone de sécurité supérieure iOS', () => {
  assert.match(html, /height: calc\(64px \+ env\(safe-area-inset-top\)\)/);
  assert.match(html, /top: calc\(64px \+ env\(safe-area-inset-top\)\)/);
  assert.match(html, /top: calc\(104px \+ env\(safe-area-inset-top\)\)/);
  assert.match(html, /max\(14px, env\(safe-area-inset-left\)\)/);
});

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

function setDr400Mass(targetMass) {
  const fixedMass = 844.8;
  const additionalPayload = targetMass - fixedMass;
  assert.ok(additionalPayload >= 0, 'La masse cible doit conserver au moins le pilote et les pleins');
  const rearPassengers = Math.min(250, additionalPayload);
  const frontPassenger = additionalPayload - rearPassengers;
  state.loads['f-gghl'] = {
    pilot: 80,
    frontPassenger,
    rearPassengers,
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

function setDensity(overrides = {}) {
  state.density = {
    icao: 'LFBL',
    useMetarData: true,
    elevation: '',
    qnh: '',
    temperature: '',
    dewPoint: '',
    useHumidity: false,
    ...overrides,
  };
  state.densityAirfield = { status: 'idle', message: '', record: null, cycle: '' };
  state.densityWeather = { status: 'idle', message: '', rawMetar: '', observedAt: '' };
}

function surfaceOptionPairs(record) {
  return Array.from(availableSurfaceOptions(record), (option) => [option.value, option.label]);
}

test('Les pleins, la pente, le vent et la marge ont des valeurs initiales explicites', () => {
  assert.equal(defaultLoad(sportStarBalance).fuelLitres, 120);
  assert.equal(defaultLoad(dr400Balance).mainFuelLitres, 110);
  assert.equal(defaultLoad(dr400Balance).wingFuelLitres, 80);
  assert.equal(DEPARTURE_DEFAULTS.windComponent, 0);
  assert.equal(DEPARTURE_DEFAULTS.slope, 0);
  assert.equal(DEPARTURE_DEFAULTS.safetyMarginPercent, 0);
  assert.equal(DEPARTURE_DEFAULTS.useHumidity, false);
});

test('Le parcours Masse et centrage vers Performances et les statuts obligatoire/facultatif sont visibles', () => {
  state.aircraftId = 'f-hdlt';
  setSportStarLoad();
  setDeparture();

  const balance = balanceView();
  assert.match(balance, /data-action="confirm-load-and-performance"/);
  assert.match(balance, /Chargement vérifié — passer aux performances/);

  const performance = performanceView();
  assert.match(performance, /Retour à masse &amp; centrage|Retour à masse & centrage/);
  assert.equal((performance.match(/requirement-tag required/g) || []).length, 3);
  assert.equal((performance.match(/requirement-tag optional/g) || []).length, 1);
  assert.match(performance, /Piste et distances vérifiées[^]*Obligatoire/);
  assert.match(performance, /Comparer avec l’air humide[^]*Facultatif/);
});

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

test('Les surfaces sèches utilisent leur colonne et les surfaces mouillées restent hors table', () => {
  state.aircraftId = 'f-hdlt';
  setSportStarLoad();

  setDeparture({ surface: 'hard' });
  const hardDry = performanceResult(sportStar);
  assert.equal(hardDry.valid, true);
  assert.equal(hardDry.base.roll, 143);
  assert.equal(hardDry.base.total, 361);

  setDeparture({ surface: 'grass' });
  const grassDry = performanceResult(sportStar);
  assert.equal(grassDry.valid, true);
  assert.equal(grassDry.base.roll, 185);
  assert.equal(grassDry.base.total, 407);

  for (const [surface, expectedIssue] of [
    ['hard_wet', 'Piste dure mouillée'],
    ['grass_wet', 'Herbe mouillée'],
  ]) {
    setDeparture({ surface });
    const wet = performanceResult(sportStar);
    assert.equal(wet.valid, false, surface);
    assert.equal(wet.outOfTable, true, surface);
    assert.equal(wet.sufficient, false, surface);
    assert.ok(wet.issues.some((issue) => issue.includes(expectedIssue)), surface);
    const rendered = performanceView();
    assert.match(rendered, /HORS TABLE/);
    assert.doesNotMatch(rendered, /class="performance-metrics"/);
  }
});

test('Les choix de surface dépendent des surfaces publiées et privilégient le dur sec', () => {
  const hardOnly = { runways: [{ id: '11', surface: 'hard' }] };
  const grassOnly = { runways: [{ id: '11', surface: 'grass' }] };
  const mixed = {
    runways: [
      { id: '11D', availableSurfaces: ['hard'] },
      { id: '11H', availableSurfaces: ['grass'] },
    ],
  };
  const combinedRunway = { runways: [{ id: '11', availableSurfaces: ['grass', 'hard'] }] };

  assert.deepEqual(surfaceOptionPairs(hardOnly), [
    ['hard', 'Dur sec'],
    ['hard_wet', 'Dur mouillé'],
  ]);
  assert.deepEqual(surfaceOptionPairs(grassOnly), [
    ['grass', 'Herbe sèche'],
    ['grass_wet', 'Herbe mouillée'],
  ]);
  assert.deepEqual(surfaceOptionPairs(mixed), [
    ['hard', 'Dur sec'],
    ['hard_wet', 'Dur mouillé'],
    ['grass', 'Herbe sèche'],
    ['grass_wet', 'Herbe mouillée'],
  ]);
  assert.deepEqual(surfaceOptionPairs(null), surfaceOptionPairs(mixed));
  assert.equal(defaultDrySurface(mixed, null), 'hard');
  assert.equal(defaultDrySurface(grassOnly, grassOnly.runways[0]), 'grass');
  assert.equal(defaultDrySurface(combinedRunway, combinedRunway.runways[0]), 'hard');
  assert.equal(normalizeSurfaceValue('hard_dry'), 'hard');
  assert.equal(normalizeSurfaceValue('grass_dry'), 'grass');
  assert.equal(surfaceFamily('grass_wet'), 'grass');
  assert.equal(surfaceIsDryAndSupported('hard_wet'), false);
});

test('La liste rendue ne propose que les états de la piste sélectionnée', () => {
  state.aircraftId = 'f-hdlt';
  setSportStarLoad();
  setDeparture({ runwayId: '11D', surface: 'hard' });
  state.airfield = {
    status: 'loaded',
    cycle: 'TEST',
    record: {
      icao: 'TEST',
      name: 'Terrain mixte',
      elevationFt: 0,
      runways: [
        { id: '11D', label: '11 dur', toraM: 800, todaM: 800, surface: 'hard' },
        { id: '11H', label: '11 herbe', toraM: 650, todaM: 650, surface: 'grass' },
      ],
    },
  };

  const hardRunway = performanceView();
  assert.match(hardRunway, />Dur sec</);
  assert.match(hardRunway, />Dur mouillé</);
  assert.doesNotMatch(hardRunway, />Herbe sèche</);
  assert.doesNotMatch(hardRunway, />Herbe mouillée</);

  state.departure.runwayId = '11H';
  state.departure.surface = 'grass';
  const grassRunway = performanceView();
  assert.doesNotMatch(grassRunway, />Dur sec</);
  assert.match(grassRunway, />Herbe sèche</);
  assert.match(grassRunway, />Herbe mouillée</);
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

test('La composante METAR distingue le vent moyen, le secteur variable et les rafales', () => {
  const weather = {
    windDirectionDeg: 280,
    windSpeedKt: 12,
    windGustKt: 20,
    windVariableFromDeg: 240,
    windVariableToDeg: 310,
  };

  const runway29 = conservativeMetarWindComponent(weather, { id: '29' });
  assert.equal(runwayHeadingDegrees({ id: '29' }), 290);
  assert.equal(runway29.value, 11.8, 'le champ doit reprendre le vent moyen');
  assert.equal(runway29.minimum, 7.7, 'le minimum du secteur doit rester visible séparément');
  assert.equal(runway29.maximum, 12);
  assert.equal(runway29.gustComponent, 19.7, 'la rafale est informative, pas appliquée au champ');
  assert.equal(runway29.crossesZero, false);

  const runway11 = conservativeMetarWindComponent(weather, { id: '11' });
  assert.equal(runway11.value, -11.8, 'le vent moyen arrière reste identifié');
  assert.equal(runway11.gustComponent, -19.7);

  const steadyHeadwind = conservativeMetarWindComponent(
    { windDirectionDeg: 290, windSpeedKt: 12, windGustKt: 20 },
    { id: '29', trueHeadingDeg: 290 },
  );
  assert.equal(steadyHeadwind.value, 12, 'une rafale de face ne doit pas être comptée comme un gain');
  assert.match(steadyHeadwind.note, /relèvement publié/);

  assert.equal(
    conservativeMetarWindComponent({ windDirectionDeg: null, windSpeedKt: 12 }, { id: '29' }),
    null,
  );
  assert.equal(conservativeMetarWindComponent({ windDirectionDeg: 0, windSpeedKt: 0 }, { id: '36' }).value, 0);
});

test('Quimper : le vent moyen du 350 propose le QFU 27 et la variation traversante retient 0 kt', () => {
  const weather = {
    station: 'LFRQ',
    windDirectionDeg: 350,
    windSpeedKt: 9,
    windGustKt: null,
    windVariableFromDeg: 320,
    windVariableToDeg: 40,
  };
  const record = {
    icao: 'LFRQ',
    runways: [
      { id: '09', trueHeadingDeg: 93.5, surface: 'hard', toraM: 2_150 },
      { id: '27', trueHeadingDeg: 273.5, surface: 'hard', toraM: 2_113 },
    ],
  };

  const recommendation = recommendedRunwayFromWeather(record, weather);
  assert.equal(recommendation.runway.id, '27');
  assert.equal(recommendation.component, 2.1);
  assert.match(recommendation.note, /Piste 27 proposée/);
  assert.match(recommendation.note, /350° \/ 9 kt/);

  const analysis = metarWindAnalysis(weather, recommendation.runway);
  assert.equal(analysis.mean, 2.1);
  assert.equal(analysis.minimum, -5.4);
  assert.equal(analysis.maximum, 6.2);
  assert.equal(analysis.crossesZero, true);
  assert.equal(analysis.value, 0);
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

test('DR400 générique : les masses sous 900 kg utilisent la ligne 900 kg sans extrapolation', () => {
  state.aircraftId = 'f-gghl';

  for (const mass of [844.8, 899.9]) {
    setDr400Mass(mass);
    setDeparture({ loadConfirmed: 'f-gghl', tora: 2_000, toda: 2_000 });
    const result = performanceResult(dr400);

    closeTo(result.mass, mass, 1e-8);
    assert.equal(result.calculationMass, 900);
    assert.equal(result.useMinimumPublishedMass, true);
    assert.equal(result.valid, true);
    assert.equal(result.base.roll, 200);
    assert.equal(result.base.total, 400);
    assert.equal(result.advisories.length, 1);
    assert.match(result.advisories[0], /Calcul conservateur effectué à 900 kg/);
  }

  setDr400Mass(844.8);
  setDeparture({ loadConfirmed: 'f-gghl', tora: 2_000, toda: 2_000 });
  assert.match(performanceView(), /Calcul conservateur de masse/);
  assert.match(performanceView(), /844,8 kg \/ 900 kg/);
});

test('DR400 générique : frontières et interpolation de masse restent exactes', () => {
  const cases = [
    { mass: 900, roll: 200, total: 400 },
    { mass: 1_000, roll: 257.5, total: 505 },
    { mass: 1_100, roll: 315, total: 610 },
  ];

  for (const scenario of cases) {
    setDr400Mass(scenario.mass);
    setDeparture({ loadConfirmed: 'f-gghl', tora: 2_000, toda: 2_000 });
    const result = performanceResult(dr400);

    closeTo(result.mass, scenario.mass, 1e-8);
    closeTo(result.calculationMass, scenario.mass, 1e-8);
    assert.equal(result.useMinimumPublishedMass, false);
    assert.equal(result.valid, true);
    closeTo(result.base.roll, scenario.roll, 1e-8);
    closeTo(result.base.total, scenario.total, 1e-8);
    assert.equal(result.advisories.length, 0);
  }

  setDr400Mass(1_100.1);
  setDeparture({ loadConfirmed: 'f-gghl', tora: 2_000, toda: 2_000 });
  const aboveMaximum = performanceResult(dr400);
  assert.equal(aboveMaximum.valid, false);
  assert.equal(aboveMaximum.outOfTable, true);
  assert.equal(aboveMaximum.base, null);
  assert.equal(aboveMaximum.roll, null);
  assert.ok(aboveMaximum.issues.some((issue) => issue.includes('maximum publié 1100 kg')));
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

test('Un terrain sans METAR propose deux observations voisines puis charge le choix explicite', async () => {
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
            latitude: 43.3125,
            longitude: 1.9206,
            runways: [{ id: '11', label: '11', toraM: 810, surface: 'hard' }],
          }],
        }),
      };
    }
    if (String(url).startsWith('/api/weather?icao=LFMW&')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          metar: { status: 'no_data', data: null },
          taf: { status: 'no_data', data: null },
          alternatives: [
            { station:'LFMK', name:'Carcassonne', distanceKm:33.2, elevationDifferenceFt:-119, ageMinutes:20, rawMetar:'LFMK TEST' },
            { station:'LFBO', name:'Toulouse-Blagnac', distanceKm:66.4, elevationDifferenceFt:-54, ageMinutes:25, rawMetar:'LFBO TEST' },
          ],
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

  assert.ok(requestedUrls.some((url) => url.includes('/api/weather?icao=LFMW&lat=43.3125&lon=1.9206&elevationFt=553')));
  assert.equal(state.departure.elevation, 553);
  assert.equal(state.departure.tora, 810);
  assert.equal(state.departure.toda, 810);
  assert.equal(state.departure.todaDerived, true);
  assert.equal(state.departure.surface, 'hard');
  assert.equal(state.departure.temperature, '');
  assert.equal(state.weather.status, 'partial');
  assert.equal(state.weather.alternatives.length, 2);
  assert.match(performanceView(),/Aucun METAR publié pour LFMW/);
  assert.match(performanceView(),/LFMK · Carcassonne/);
  assert.match(performanceView(),/LFBO · Toulouse-Blagnac/);
  assert.match(performanceView(),/ne décrit pas nécessairement les conditions à LFMW/);

  await loadDepartureContext('LFMK');

  assert.ok(requestedUrls.some((url) => url === '/api/weather?icao=LFMK'));
  assert.equal(state.departure.temperature, 20);
  assert.equal(state.departure.dewPoint, 10);
  assert.equal(state.departure.qnh, 1015);
  assert.equal(state.weather.status, 'loaded');
  assert.equal(state.weather.station, 'LFMK');
  assert.match(state.weather.stationNote, /Observation voisine choisie pour LFMW/);
  assert.match(state.weather.stationNote, /ne décrit pas nécessairement les conditions au terrain/);
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
  assert.equal(state.departure.slope,0);
  assert.equal(state.departure.slopeSource,'default');
  assert.equal(state.departure.runwayConfirmed,false);
});

test('Le chargement de Quimper présélectionne le QFU 27 avec un vent moyen du 350', async () => {
  setSportStarLoad();
  setDeparture({ icao: 'LFRQ', loadConfirmed: 'f-hdlt' });
  const observedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  fetchImplementation = async (url) => {
    if (String(url) === '/data/airfields.json') {
      return {
        ok: true,
        json: async () => ({
          cycle: 'TEST',
          effectiveDate: new Date().toISOString(),
          airfields: [{
            icao: 'LFRQ',
            name: 'QUIMPER PLUGUFFAN',
            elevationFt: 297,
            runways: [
              { id: '09', trueHeadingDeg: 93.5, surface: 'hard', toraM: 2_150, todaM: 2_150 },
              { id: '27', trueHeadingDeg: 273.5, surface: 'hard', toraM: 2_113, todaM: 2_113 },
            ],
          }],
        }),
      };
    }
    if (String(url) === '/api/weather?icao=LFRQ') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          metar: {
            status: 'fresh',
            data: {
              station: 'LFRQ',
              raw: 'METAR LFRQ TEST 35009KT 320V040 CAVOK 27/18 Q1017',
              observedAt,
              reportStatus: 'current',
              temperatureC: 27,
              dewpointC: 18,
              qnhHpa: 1017,
              windDirectionDeg: 350,
              windSpeedKt: 9,
              windVariableFromDeg: 320,
              windVariableToDeg: 40,
            },
          },
          taf: { status: 'no_data', data: null },
        }),
      };
    }
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDepartureContext();

  assert.equal(state.departure.runwayId, '27');
  assert.equal(state.departure.runwaySelectionSource, 'metar');
  assert.equal(state.departure.tora, 2_113);
  assert.equal(state.departure.toda, 2_113);
  assert.equal(state.departure.windComponent, 0);
  assert.match(state.departure.runwaySelectionNote, /Piste 27 proposée/);
  const rendered = performanceView();
  assert.match(rendered, /Vent METAR sur le QFU 27/);
  assert.match(rendered, /Variation 320V040/);
  assert.match(rendered, /Valeur proposée dans le calcul : 0 kt/);
});

test('Altitude-densité : un terrain et son METAR exact remplissent toutes les données exploitables', async () => {
  setDensity({ icao: 'LFBL' });
  const observedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const requestedUrls = [];
  fetchImplementation = async (url) => {
    requestedUrls.push(String(url));
    if (String(url) === '/data/airfields.json') {
      return {
        ok: true,
        json: async () => ({
          cycle: 'TEST',
          airfields: [{ icao: 'LFBL', name: 'Limoges', elevationFt: 1_300, runways: [] }],
        }),
      };
    }
    if (String(url) === '/api/weather?icao=LFBL') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          metar: {
            status: 'fresh',
            data: {
              station: 'LFBL',
              raw: 'METAR LFBL TEST 19003KT CAVOK 25/13 Q1016',
              observedAt,
              reportStatus: 'current',
              temperatureC: 25,
              dewpointC: 13,
              qnhHpa: 1016,
            },
          },
        }),
      };
    }
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDensityContext();

  assert.deepEqual(requestedUrls, ['/data/airfields.json', '/api/weather?icao=LFBL']);
  assert.equal(state.density.useMetarData, true);
  assert.equal(state.density.elevation, 1_300);
  assert.equal(state.density.qnh, 1016);
  assert.equal(state.density.temperature, 25);
  assert.equal(state.density.dewPoint, 13);
  assert.equal(state.densityAirfield.status, 'loaded');
  assert.equal(state.densityWeather.status, 'loaded');
  assert.equal(state.densityWeather.station, 'LFBL');
  assert.equal(densityAltitudeResult().valid, true);
});

test('Altitude-densité : un terrain connu conserve son altitude quand aucun METAR n’est disponible', async () => {
  setDensity({ icao: 'LFAQ' });
  fetchImplementation = async (url) => {
    if (String(url) === '/data/airfields.json') {
      return {
        ok: true,
        json: async () => ({
          cycle: 'TEST',
          airfields: [{ icao: 'LFAQ', name: 'Terrain sans METAR', elevationFt: 364, runways: [] }],
        }),
      };
    }
    if (String(url) === '/api/weather?icao=LFAQ') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ metar: { status: 'no_data', data: null } }),
      };
    }
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDensityContext();

  assert.equal(state.densityAirfield.status, 'loaded');
  assert.equal(state.density.elevation, 364);
  assert.equal(state.densityWeather.status, 'partial');
  assert.equal(state.density.qnh, '');
  assert.equal(state.density.temperature, '');
  assert.equal(state.density.dewPoint, '');
});

test('Altitude-densité : deux METAR voisins sont proposés sans préremplissage avant le choix', async () => {
  setDensity({ icao:'LFCB' });
  const observedAt=new Date(Date.now()-15*60*1000).toISOString();
  fetchImplementation=async (url) => {
    const address=String(url);
    if(address==='/data/airfields.json')return {ok:true,json:async()=>({
      cycle:'TEST',airfields:[{icao:'LFCB',name:'Bagnères de Luchon',elevationFt:2028,latitude:42.8005556,longitude:0.6011111,runways:[]}],
    })};
    if(address.startsWith('/api/weather?icao=LFCB&'))return {ok:true,status:200,json:async()=>({
      metar:{status:'no_data',data:null},alternatives:[
        {station:'LFBT',name:'Tarbes Lourdes Pyrénées',distanceKm:65,elevationDifferenceFt:-768,ageMinutes:15,rawMetar:'METAR LFBT TEST'},
        {station:'LFBO',name:'Toulouse Blagnac',distanceKm:112,elevationDifferenceFt:-1529,ageMinutes:20,rawMetar:'METAR LFBO TEST'},
      ],
    })};
    if(address==='/api/weather?icao=LFBT')return {ok:true,status:200,json:async()=>({metar:{status:'fresh',data:{
      station:'LFBT',raw:'METAR LFBT TEST 31004KT CAVOK 22/12 Q1018',observedAt,reportStatus:'current',temperatureC:22,dewpointC:12,qnhHpa:1018,
    }}})};
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDensityContext();

  assert.equal(state.density.elevation,2028);
  assert.equal(state.density.qnh,'');
  assert.equal(state.densityWeather.alternatives.length,2);
  assert.match(densityAltitudeView(),/Aucun METAR publié pour LFCB/);
  assert.match(densityAltitudeView(),/LFBT · Tarbes Lourdes Pyrénées/);
  assert.match(densityAltitudeView(),/Observation voisine/);

  await loadDensityContext('LFBT');

  assert.equal(state.density.qnh,1018);
  assert.equal(state.density.temperature,22);
  assert.equal(state.density.dewPoint,12);
  assert.equal(state.densityWeather.station,'LFBT');
  assert.match(state.densityWeather.stationNote,/Observation voisine choisie pour LFCB/);
  assert.match(densityAltitudeView(),/STATION VOISINE/);
});

test('Altitude-densité : un METAR exact reste utilisable quand le terrain est absent du jeu local', async () => {
  setDensity({ icao: 'LFXA' });
  const observedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fetchImplementation = async (url) => {
    if (String(url) === '/data/airfields.json') {
      return { ok: true, json: async () => ({ cycle: 'TEST', airfields: [] }) };
    }
    if (String(url) === '/api/weather?icao=LFXA') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          metar: {
            status: 'fresh',
            data: {
              station: 'LFXA',
              raw: 'METAR LFXA TEST 00000KT CAVOK 18/08 Q1020',
              observedAt,
              reportStatus: 'current',
              temperatureC: 18,
              dewpointC: 8,
              qnhHpa: 1020,
            },
          },
        }),
      };
    }
    throw new Error(`URL inattendue : ${url}`);
  };

  await loadDensityContext();

  assert.equal(state.densityAirfield.status, 'missing');
  assert.equal(state.density.elevation, '');
  assert.equal(state.densityWeather.status, 'loaded');
  assert.equal(state.density.qnh, 1020);
  assert.equal(state.density.temperature, 18);
  assert.equal(state.density.dewPoint, 8);
});

test('Altitude-densité : un METAR ancien ou provenant d’une autre station ne préremplit pas la météo', async () => {
  const scenarios = [
    {
      label: 'ancien',
      station: 'LFBL',
      observedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      reportStatus: 'old',
    },
    {
      label: 'station différente',
      station: 'LFMK',
      observedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      reportStatus: 'current',
    },
  ];

  for (const scenario of scenarios) {
    setDensity({ icao: 'LFBL', qnh: 999, temperature: 99, dewPoint: 98 });
    fetchImplementation = async (url) => {
      if (String(url) === '/data/airfields.json') {
        return {
          ok: true,
          json: async () => ({
            cycle: 'TEST',
            airfields: [{ icao: 'LFBL', name: 'Limoges', elevationFt: 1_300, runways: [] }],
          }),
        };
      }
      if (String(url) === '/api/weather?icao=LFBL') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            metar: {
              status: 'fresh',
              data: {
                station: scenario.station,
                raw: 'METAR TEST',
                observedAt: scenario.observedAt,
                reportStatus: scenario.reportStatus,
                temperatureC: 20,
                dewpointC: 10,
                qnhHpa: 1015,
              },
            },
          }),
        };
      }
      throw new Error(`URL inattendue : ${url}`);
    };

    await loadDensityContext();

    assert.equal(state.density.elevation, 1_300, scenario.label);
    assert.equal(state.densityWeather.status, 'partial', scenario.label);
    assert.equal(state.density.qnh, '', scenario.label);
    assert.equal(state.density.temperature, '', scenario.label);
    assert.equal(state.density.dewPoint, '', scenario.label);
  }
});

test('Altitude-densité : décocher le METAR conserve les valeurs déjà chargées', () => {
  setDensity({
    icao: 'LFBL',
    useMetarData: true,
    elevation: 1_300,
    qnh: 1016,
    temperature: 25,
    dewPoint: 13,
  });
  state.densityAirfield = { status: 'loaded', message: '', record: { icao: 'LFBL' }, cycle: 'TEST' };
  state.densityWeather = { status: 'loaded', message: '', rawMetar: 'METAR LFBL TEST', observedAt: new Date().toISOString() };
  const changeListener = documentListeners.get('change');
  assert.equal(typeof changeListener, 'function');

  const checkbox = {
    type: 'checkbox',
    checked: false,
    dataset: { density: 'useMetarData' },
    closest(selector) {
      return selector === '[data-density]' ? this : null;
    },
  };
  changeListener({ target: checkbox });

  assert.equal(state.density.useMetarData, false);
  assert.equal(state.density.elevation, 1_300);
  assert.equal(state.density.qnh, 1016);
  assert.equal(state.density.temperature, 25);
  assert.equal(state.density.dewPoint, 13);
  assert.equal(state.densityAirfield.status, 'idle');
  assert.equal(state.densityWeather.status, 'idle');
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
  const performanceHtml=performanceView();
  assert.match(performanceHtml, /class="icao-entry"/);
  assert.match(performanceHtml, /placeholder="Ex\. LFRQ"/);
  assert.match(performanceHtml, /autocomplete="off"/);
  assert.match(performanceHtml, /Cartes TEMSI et WINTEM/);
  assert.match(performanceHtml, /https:\/\/aviation\.meteo\.fr\/login\.php/);
  const densityHtml=densityAltitudeView();
  assert.match(densityHtml, /Altitude-densité/);
  assert.match(densityHtml, /Calcul atmosphérique général, indépendant de l’avion/);
  assert.match(densityHtml, /Cartes TEMSI et WINTEM/);
  assert.match(densityHtml, /https:\/\/aviation\.meteo\.fr\/login\.php/);
  assert.doesNotMatch(densityHtml, /Méthode non prévue dans les tables constructeur/);

  const methods = calculationBasesView();
  assert.match(methods, /Méthodes, données et limites/);
  assert.match(methods, /Prototype non approuvé/);
  assert.equal((methods.match(/class="document-card"/g) || []).length, 11);
});
