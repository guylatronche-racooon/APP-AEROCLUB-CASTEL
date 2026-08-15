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
  assert.equal(dataset.vacImport.vacAvailable, 420);
  assert.equal(dataset.vacImport.runwaysMatched, 1248);
  assert.equal(dataset.vacImport.runwaysEnriched, 1247);
  assert.equal(dataset.vacImport.runwaysTakeoffNotPublished, 1);
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
    assert.ok(['direct', 'not_published_in_atlas'].includes(airfield.vacAvailability));
    if (airfield.vacAvailability === 'direct') {
      assert.match(
        airfield.vacUrl,
        /\/media\/dvd\/eAIP_06_AUG_2026\/Atlas-VAC\/PDF_AIPparSSection\/VAC\/AD\/AD-2\.[A-Z]{4}\.pdf$/,
      );
      assert.equal(airfield.vacSource.cycle, dataset.cycle);
    }

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
      if (runway.declaredDistanceStatus === 'published') {
        assert.ok(runway.toraM > 0, `${airfield.icao} ${runway.id}: TORA publiée absente`);
        assert.ok(runway.todaM >= runway.toraM, `${airfield.icao} ${runway.id}: TODA < TORA`);
        assert.ok(runway.asdaM >= runway.toraM, `${airfield.icao} ${runway.id}: ASDA < TORA`);
        assert.ok(runway.ldaM === null || runway.ldaM > 0);
        assert.equal(runway.declaredDistanceSource, 'SIA VAC');
      }
    }
  }
});

test('les VAC disponibles sont directes et les absences Atlas restent explicites', () => {
  const direct = airfields.filter((airfield) => airfield.vacAvailability === 'direct');
  const unavailable = airfields.filter((airfield) => airfield.vacAvailability === 'not_published_in_atlas');
  assert.equal(direct.length, 420);
  assert.deepEqual(
    unavailable.map((airfield) => airfield.icao).sort(),
    ['LFOA', 'LFBC', 'LFXQ', 'LFOE', 'LFSX', 'LFBM', 'LFKK', 'LFSO', 'LFMO', 'LFSI', 'LFKS', 'LFPV'].sort(),
  );
  for (const airfield of unavailable) {
    assert.equal(airfield.vacUrl, 'https://www.sia.aviation-civile.gouv.fr/atlas-vac.html');
    assert.equal(airfield.vacSource, undefined);
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

test('les formats VAC complexes sont lus sans confondre piste, configuration ou intersection', () => {
  assert.deepEqual(
    ['10', '28', '14', '32', '14L', '32R'].map((qfu) => {
      const runway = byQfu('LFRN', qfu);
      return [qfu, runway.toraM, runway.todaM, runway.asdaM, runway.ldaM];
    }),
    [
      ['10', 2102, 2102, 2102, 2031],
      ['28', 2102, 2102, 2102, 2102],
      ['14', 850, 850, 850, 850],
      ['32', 850, 850, 850, 850],
      ['14L', 549, 549, 549, 549],
      ['32R', 549, 549, 549, 549],
    ],
  );

  assert.deepEqual(
    ['14L', '32R', '14R', '32L'].map((qfu) => [qfu, byQfu('LFBO', qfu).toraM]),
    [['14L', 3025], ['32R', 3025], ['14R', 3503], ['32L', 3503]],
  );

  assert.equal(byQfu('LFPN', '25L').toraM, 945);
  assert.equal(byQfu('LFPN', '25L').toraMethod, 'explicit');
  assert.equal(byQfu('LFPB', '09').toraM, 1847, 'la distance réduite depuis TWY A1 est exclue');
  assert.equal(byQfu('LFPB', '27').declaredDistanceStatus, 'takeoff_not_published');
  assert.equal(byQfu('LFPB', '27').toraM, null);
  assert.equal(byQfu('LFPB', '27').todaM, null);

  for (const qfu of ['09', '27']) {
    const conditional = byQfu('LFCI', qfu);
    assert.equal(conditional.declaredDistanceStatus, 'conditional_or_ambiguous');
    assert.equal(conditional.toraM, null);
    assert.equal(conditional.todaM, null);
  }
});
