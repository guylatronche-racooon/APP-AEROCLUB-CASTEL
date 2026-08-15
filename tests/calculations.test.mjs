import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const APP_URL = new URL('../app/index.html', import.meta.url);
const html = readFileSync(APP_URL, 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);

assert.ok(inlineScript, 'Le script principal de app/index.html doit être présent');

const appElement = { innerHTML: '' };
const storage = new Map([['acjd-flight-tools-disclaimer-v1', 'accepted']]);
const context = vm.createContext({
  console,
  confirm: () => true,
  document: {
    addEventListener: () => {},
    documentElement: { style: {} },
    getElementById: () => appElement,
    querySelector: () => null,
  },
  fetch: async () => {
    throw new Error('Les tests de calcul ne doivent effectuer aucun accès réseau');
  },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  navigator: {},
  scrollTo: () => {},
});

const source = `${inlineScript[1]}\n` +
  'globalThis.__calculationsTestApi = {' +
  'sportStarBalance, dr400Balance, balanceResult, inputMass, pointInEnvelope, state' +
  '};';

new vm.Script(source, { filename: APP_URL.pathname }).runInContext(context, { timeout: 5_000 });

const {
  sportStarBalance,
  dr400Balance,
  balanceResult,
  inputMass,
  pointInEnvelope,
  state,
} = context.__calculationsTestApi;

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Valeur attendue ${expected}, valeur obtenue ${actual} (tolérance ${tolerance})`,
  );
}

function loadResult(id, balance, values) {
  const zeroLoad = Object.fromEntries(balance.inputs.map((input) => [input.key, 0]));
  state.loads[id] = { ...zeroLoad, ...values };
  return balanceResult({ id, balance });
}

function row(result, label) {
  const found = result.rows.find((candidate) => candidate.label === label);
  assert.ok(found, `La ligne « ${label} » doit exister`);
  return found;
}

test('F-HDLT : les constantes de la fiche de pesée sont conservées', () => {
  assert.equal(sportStarBalance.emptyMass, 358.8);
  assert.equal(sportStarBalance.emptyMoment, 95.64);
  closeTo(sportStarBalance.emptyArm, 0.26656, 1e-12);
  assert.equal(sportStarBalance.maxMass, 600);

  const byKey = Object.fromEntries(sportStarBalance.inputs.map((input) => [input.key, input]));
  assert.equal(byKey.pilot.arm, 0.545);
  assert.equal(byKey.copilot.arm, 0.545);
  assert.equal(byKey.baggage.arm, 1.083);
  assert.equal(byKey.baggage.max, 25);
  assert.equal(byKey.fuelLitres.arm, 0.68);
  assert.equal(byKey.fuelLitres.massFactor, 0.72);
  assert.equal(byKey.fuelLitres.max, 120);
  assert.deepEqual(
    Array.from(sportStarBalance.momentEnvelope, (point) => Array.from(point)),
    [[95, 375], [120, 375], [150, 400], [180, 450], [240, 600], [225, 600]],
  );
});

test('F-HDLT : les tables de postes donnent les masses et moments attendus', () => {
  const result = loadResult('test-hdlt-stations', sportStarBalance, {
    pilot: 150,
    copilot: 0,
    baggage: 10,
    fuelLitres: 50,
  });

  closeTo(row(result, 'Pilote').moment, 81.75);
  closeTo(row(result, 'Bagages').moment, 10.83);
  closeTo(row(result, 'Carburant').mass, 36);
  closeTo(row(result, 'Carburant').moment, 24.48);
  closeTo(inputMass(sportStarBalance.inputs.find((input) => input.key === 'fuelLitres'), 120), 86.4);
  closeTo(86.4 * 0.68, 58.752);
});

test('F-HDLT : cas documenté 150 kg équipage, 10 kg bagages et 50 l', () => {
  const result = loadResult('test-hdlt-document', sportStarBalance, {
    pilot: 150,
    copilot: 0,
    baggage: 10,
    fuelLitres: 50,
  });

  closeTo(result.totalMass, 554.8);
  closeTo(result.totalMoment, 212.7);
  closeTo(result.cg, 0.38338139870223503);
  assert.equal(result.insideEnvelope, true);
  assert.equal(result.safe, true);
});

test('F-HDLT : deux personnes de 90 kg et 85 l atteignent exactement 600 kg', () => {
  const result = loadResult('test-hdlt-mtow', sportStarBalance, {
    pilot: 90,
    copilot: 90,
    baggage: 0,
    fuelLitres: 85,
  });

  closeTo(result.totalMass, 600);
  closeTo(result.totalMoment, 235.356);
  closeTo(result.cg, 0.39226);
  assert.equal(result.insideEnvelope, true);
  assert.equal(result.safe, true);
});

test('F-HDLT : la limite arrière est rejetée même sous la masse maximale', () => {
  const result = loadResult('test-hdlt-aft', sportStarBalance, {
    pilot: 90,
    copilot: 90,
    baggage: 25,
    fuelLitres: 50,
  });

  closeTo(result.totalMass, 599.8);
  closeTo(result.totalMoment, 245.295);
  closeTo(result.cg, 0.4089613204401467);
  assert.equal(result.insideEnvelope, false);
  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('enveloppe')));
});

test('F-HDLT : 26 kg de bagages échouent même si le point géométrique est dedans', () => {
  const result = loadResult('test-hdlt-baggage', sportStarBalance, {
    pilot: 90,
    copilot: 0,
    baggage: 26,
    fuelLitres: 0,
  });

  closeTo(result.totalMass, 474.8);
  closeTo(result.totalMoment, 172.848);
  closeTo(result.cg, 0.3640438079191238);
  assert.equal(result.insideEnvelope, true);
  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('Bagages')));
});

test('F-HDLT : le domaine équipage de 220 kg est contrôlé', () => {
  const result = loadResult('test-hdlt-crew-limit', sportStarBalance, {
    pilot: 110.5,
    copilot: 110.5,
    baggage: 0,
    fuelLitres: 0,
  });

  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('Équipage')));
});

test('F-HDLT : le contrôle utilise bien le plan moment-masse', () => {
  assert.equal(pointInEnvelope([162.5, 500], sportStarBalance.momentEnvelope), false);

  const forwardMomentAt500 = 95 + ((500 - 375) / (600 - 375)) * (225 - 95);
  closeTo(forwardMomentAt500, 167.22222222222223);
  closeTo(forwardMomentAt500 / 500, 0.33444444444444443);
  assert.equal(pointInEnvelope([forwardMomentAt500, 500], sportStarBalance.momentEnvelope), true);
});

test('F-HDLT : les frontières à 600 kg sont incluses, leur extérieur est rejeté', () => {
  assert.equal(pointInEnvelope([225, 600], sportStarBalance.momentEnvelope), true);
  assert.equal(pointInEnvelope([240, 600], sportStarBalance.momentEnvelope), true);
  assert.equal(pointInEnvelope([224.99, 600], sportStarBalance.momentEnvelope), false);
  assert.equal(pointInEnvelope([240.01, 600], sportStarBalance.momentEnvelope), false);
});

test('F-GGHL : les constantes finales de la fiche de pesée sont conservées', () => {
  assert.equal(dr400Balance.emptyMass, 635.2);
  assert.equal(dr400Balance.emptyMoment, 201.488);
  closeTo(dr400Balance.emptyArm, 0.31720403022670024);
  assert.equal(dr400Balance.maxMass, 1100);
  assert.deepEqual(
    Array.from(dr400Balance.envelope, (point) => Array.from(point)),
    [[0.205, 635.2], [0.205, 750], [0.428, 1100], [0.564, 1100], [0.564, 635.2]],
  );
});

test('F-GGHL : le carburant principal ne recompte pas les 10 l inutilisables', () => {
  const mainFuel = dr400Balance.inputs.find((input) => input.key === 'mainFuelLitres');
  const wingFuel = dr400Balance.inputs.find((input) => input.key === 'wingFuelLitres');

  assert.equal(mainFuel.min, 10);
  assert.equal(mainFuel.max, 110);
  assert.equal(mainFuel.includedUnusableLitres, 10);
  closeTo(inputMass(mainFuel, 10), 0);
  closeTo(inputMass(mainFuel, 110), 72);
  closeTo(inputMass(wingFuel, 80), 57.6);

  const invalid = loadResult('test-dr400-fuel-min', dr400Balance, {
    pilot: 0,
    frontPassenger: 0,
    rearPassengers: 0,
    baggage: 0,
    mainFuelLitres: 9,
    wingFuelLitres: 0,
  });
  assert.equal(invalid.safe, false);
  assert.ok(invalid.violations.some((violation) => violation.includes('minimum cohérent 10')));
});

test('F-GGHL : l’exemple de chargement est reproduit sans arrondi intermédiaire', () => {
  const result = loadResult('test-dr400-example', dr400Balance, {
    pilot: 85,
    frontPassenger: 77,
    rearPassengers: 150,
    baggage: 22.8,
    mainFuelLitres: 110,
    wingFuelLitres: 80,
  });

  closeTo(result.totalMass, 1099.6);
  closeTo(result.totalMoment, 576.128);
  closeTo(result.cg, 0.5239432520916698);
  assert.equal(result.insideEnvelope, true);
  assert.equal(result.safe, true);
});

test('F-GGHL : les valeurs arrondies de la fiche papier restent documentées', () => {
  const paperMass = 635.2 + 162 + 150 + 72 + 58 + 22.8;
  const paperMoment = 201.488 + 66.42 + 178.5 + 80.64 + 5.8 + 43.32;

  closeTo(paperMass, 1100);
  closeTo(paperMoment, 576.168);
  closeTo(paperMoment / paperMass, 0.5237890909090909);
});

test('F-GGHL : les frontières normales à 1 100 kg sont correctement classées', () => {
  assert.equal(pointInEnvelope([0.428, 1100], dr400Balance.envelope), true);
  assert.equal(pointInEnvelope([0.564, 1100], dr400Balance.envelope), true);
  assert.equal(pointInEnvelope([0.4279, 1100], dr400Balance.envelope), false);
  assert.equal(pointInEnvelope([0.5641, 1100], dr400Balance.envelope), false);
});

test('Une valeur vide bloque le verdict au lieu d’être acceptée comme zéro', () => {
  const result = loadResult('test-invalid-value', sportStarBalance, {
    pilot: '',
    copilot: 90,
    baggage: 0,
    fuelLitres: 50,
  });

  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('valeur manquante ou invalide')));
});

test('La masse pilote doit être strictement positive sur le SportStar', () => {
  const result = loadResult('test-hdlt-zero-pilot', sportStarBalance, {
    pilot: 0,
    copilot: 90,
    baggage: 0,
    fuelLitres: 50,
  });

  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('Pilote') && violation.includes('strictement positive')));
});

test('La masse pilote doit être strictement positive sur le DR400', () => {
  const result = loadResult('test-dr400-zero-pilot', dr400Balance, {
    pilot: 0,
    frontPassenger: 80,
    rearPassengers: 0,
    baggage: 0,
    mainFuelLitres: 50,
    wingFuelLitres: 0,
  });

  assert.equal(result.safe, false);
  assert.ok(result.violations.some((violation) => violation.includes('Pilote avant') && violation.includes('strictement positive')));
});
