import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const datasetUrl = new URL('../app/data/airfields.json', import.meta.url);
const dataset = JSON.parse(await readFile(datasetUrl, 'utf8'));
const airfields = dataset.airfields;

function byIcao(icao) {
  return airfields.find((airfield) => airfield.icao === icao);
}

function byQfu(icao, qfu) {
  return byIcao(icao).runways.find((runway) => runway.id === qfu);
}

test('le jeu SIA AD 1.3 AIRAC 08/26 est valide et daté', () => {
  assert.equal(dataset.cycle, 'AIRAC 08/26');
  assert.equal(dataset.effectiveDate, '2026-08-06');
  assert.equal(dataset.effectiveFrom, dataset.effectiveDate);
  assert.equal(dataset.effectiveUntil, '2026-09-02');
  assert.match(dataset.sourceUrl, /FR-AD-1\.3-fr-FR\.html$/);
  assert.equal(dataset.scope.airfieldCount, 432);
  assert.equal(airfields.length, 432);
});

test('les 432 indicateurs OACI et les QFU sont uniques', () => {
  const icaoCodes = airfields.map((airfield) => airfield.icao);
  assert.equal(new Set(icaoCodes).size, 432);
  for (const icao of icaoCodes) assert.match(icao, /^[A-Z]{4}$/);

  for (const airfield of airfields) {
    assert.ok(airfield.runways.length > 0, `${airfield.icao}: aucune piste`);
    const qfus = airfield.runways.map((runway) => runway.id);
    assert.equal(
      new Set(qfus).size,
      qfus.length,
      `${airfield.icao}: QFU dupliqué`,
    );
  }
});

test('les surfaces et valeurs numériques restent plausibles', () => {
  const knownSurfaceValues = new Set(['hard', 'grass', 'unpaved', 'water', 'unknown']);
  const performanceSurfaceValues = new Set(['hard', 'grass']);

  for (const airfield of airfields) {
    assert.ok(
      Number.isFinite(airfield.latitude)
        && airfield.latitude >= -90
        && airfield.latitude <= 90,
      `${airfield.icao}: latitude ARP absente ou invalide`,
    );
    assert.ok(
      Number.isFinite(airfield.longitude)
        && airfield.longitude >= -180
        && airfield.longitude <= 180,
      `${airfield.icao}: longitude ARP absente ou invalide`,
    );
    assert.ok(
      Number.isFinite(airfield.elevationFt)
        && airfield.elevationFt >= -1500
        && airfield.elevationFt <= 16000,
      `${airfield.icao}: altitude invraisemblable`,
    );
    assert.ok(airfield.vacUrl.startsWith('https://www.sia.aviation-civile.gouv.fr/'));
    assert.ok(airfield.sourceNote.length > 20);

    for (const runway of airfield.runways) {
      assert.ok(knownSurfaceValues.has(runway.surface), `${airfield.icao} ${runway.id}: surface inconnue`);
      assert.ok(runway.lengthM >= 1 && runway.lengthM <= 6000);
      assert.ok(runway.widthM === null || (runway.widthM >= 1 && runway.widthM <= 500));
      assert.ok(
        runway.trueHeadingDeg === null
          || (runway.trueHeadingDeg >= 0 && runway.trueHeadingDeg <= 360),
      );
      for (const elevationField of [
        'thresholdElevationFt',
        'physicalThresholdElevationFt',
        'displacedThresholdElevationFt',
      ]) {
        const elevation = runway[elevationField];
        assert.ok(elevation === null || (elevation >= -1500 && elevation <= 16000));
      }
      if (!performanceSurfaceValues.has(runway.surface)) {
        assert.ok(
          ['unpaved', 'water', 'unknown'].includes(runway.surface),
          `${airfield.icao} ${runway.id}: surface non prise en charge mal classée`,
        );
      }
    }
  }
});

test('LFRQ reprend les caps vrais et distances déclarées de l’AD 2 courant', () => {
  assert.deepEqual(
    ['09', '27'].map((qfu) => {
      const runway = byQfu('LFRQ', qfu);
      return {
        qfu,
        heading: runway.trueHeadingDeg,
        dimensions: [runway.lengthM, runway.widthM],
        surface: runway.surface,
        distances: [runway.toraM, runway.todaM, runway.asdaM, runway.ldaM],
      };
    }),
    [
      { qfu: '09', heading: 93.5, dimensions: [2150, 45], surface: 'hard', distances: [2150, 2150, 2150, 2045] },
      { qfu: '27', heading: 273.5, dimensions: [2150, 45], surface: 'hard', distances: [2113, 2113, 2113, 2113] },
    ],
  );
});

test('LFMW reprend les distances déclarées officielles et garde la surface par QFU', () => {
  assert.deepEqual(
    ['11', '29'].map((qfu) => {
      const runway = byQfu('LFMW', qfu);
      return {
        qfu,
        heading: runway.trueHeadingDeg,
        dimensions: [runway.lengthM, runway.widthM],
        surface: runway.surface,
        distances: [runway.toraM, runway.todaM, runway.asdaM, runway.ldaM],
      };
    }),
    [
      { qfu: '11', heading: 110, dimensions: [810, 30], surface: 'hard', distances: [810, 810, 810, 773] },
      { qfu: '29', heading: 290, dimensions: [810, 30], surface: 'hard', distances: [810, 810, 810, 699] },
    ],
  );
});

test('une distance non publiée demeure null et ne devient ni zéro ni longueur physique', () => {
  const runway = byQfu('LFMK', '09');
  assert.equal(runway.lengthM, 2050);
  assert.equal(runway.toraM, null);
  assert.equal(runway.todaM, null);
  assert.equal(runway.asdaM, null);
  assert.equal(runway.ldaM, null);
  assert.notEqual(runway.toraM, 0);
  assert.notEqual(runway.toraM, runway.lengthM);
});
