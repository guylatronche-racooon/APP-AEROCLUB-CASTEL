import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerPath = new URL('../api/weather.js', import.meta.url);

async function loadHandler(label) {
  // A data URL gives every scenario an isolated copy of the module-level cache.
  const source = await readFile(handlerPath, 'utf8');
  const encoded = Buffer.from(source).toString('base64');
  const module = await import(`data:text/javascript;base64,${encoded}#${label}`);
  return module.default;
}

function upstreamResponse({ status = 200, body = null, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return normalizedHeaders[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}

function responseRecorder() {
  const state = { status: null, headers: {}, body: null };
  const response = {
    setHeader(name, value) {
      state.headers[name.toLowerCase()] = String(value);
      return this;
    },
    status(value) {
      state.status = value;
      return this;
    },
    json(value) {
      state.body = value;
      return this;
    },
  };
  return { response, state };
}

async function invoke(handler, { method = 'GET', icao, query, url } = {}) {
  const request = {
    method,
    query: query ?? (icao === undefined ? {} : { icao }),
    url: url ?? '/api/weather',
  };
  const { response, state } = responseRecorder();
  await handler(request, response);
  return state;
}

test('relais météo AWC', async (suite) => {
  const originalFetch = globalThis.fetch;

  try {
    await suite.test('refuse toute méthode autre que GET avec 405', async () => {
      const handler = await loadHandler('method');
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('fetch ne devrait pas être appelé');
      };

      const result = await invoke(handler, { method: 'POST', icao: 'LFBL' });

      assert.equal(result.status, 405);
      assert.equal(result.headers.allow, 'GET');
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, 'method_not_allowed');
      assert.equal(fetchCalls, 0);
    });

    await suite.test('refuse un identifiant ICAO invalide avec 400', async () => {
      const handler = await loadHandler('invalid-icao');
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('fetch ne devrait pas être appelé');
      };

      const result = await invoke(handler, { icao: 'LF1X' });

      assert.equal(result.status, 400);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, 'invalid_icao');
      assert.equal(fetchCalls, 0);
    });

    await suite.test('normalise METAR et TAF puis sert le cache mémoire', async () => {
      const handler = await loadHandler('normalization-cache');
      const requestedUrls = [];
      const observationSeconds = Math.floor((Date.now() - 30 * 60 * 1000) / 1000);
      const issueSeconds = Math.floor((Date.now() - 45 * 60 * 1000) / 1000);
      const validFromSeconds = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
      const validToSeconds = Math.floor((Date.now() + 17 * 60 * 60 * 1000) / 1000);

      globalThis.fetch = async (url, options) => {
        requestedUrls.push(String(url));
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Accept, 'application/json');
        assert.match(options.headers['User-Agent'], /Outils-de-vol-ACJD/);

        if (String(url).includes('/metar?')) {
          return upstreamResponse({
            body: [
              {
                icaoId: 'LFBL',
                receiptTime: new Date().toISOString(),
                obsTime: observationSeconds,
                reportTime: new Date(observationSeconds * 1000).toISOString(),
                temp: 25,
                dewp: 13,
                wdir: 190,
                wspd: 3,
                visib: '6+',
                altim: 1016,
                rawOb:
                  'METAR LFBL 142230Z AUTO 19003KT CAVOK 25/13 Q1016 TEMPO BKN080TCU',
                fltCat: 'VFR',
              },
            ],
          });
        }

        assert.match(String(url), /\/taf\?/);
        return upstreamResponse({
          body: [
            {
              icaoId: 'LFBL',
              issueTime: new Date(issueSeconds * 1000).toISOString(),
              validTimeFrom: validFromSeconds,
              validTimeTo: validToSeconds,
              rawTAF:
                'TAF AMD LFBL 142206Z 1422/1518 20005KT CAVOK TEMPO 1422/1503 -SHRA',
              fcsts: [
                {
                  timeFrom: validFromSeconds,
                  timeTo: validFromSeconds + 2 * 60 * 60,
                  fcstChange: null,
                  wdir: 200,
                  wspd: 5,
                  visib: '6+',
                  wxString: 'NSW',
                },
              ],
            },
          ],
        });
      };

      const fresh = await invoke(handler, { icao: 'lfbl' });

      assert.equal(fresh.status, 200);
      assert.equal(fresh.body.ok, true);
      assert.equal(fresh.body.complete, true);
      assert.equal(fresh.body.station, 'LFBL');
      assert.equal(fresh.body.metar.status, 'fresh');
      assert.equal(fresh.body.metar.data.raw.startsWith('METAR LFBL'), true);
      assert.equal(fresh.body.metar.data.timestamp, new Date(observationSeconds * 1000).toISOString());
      assert.equal(fresh.body.metar.data.reportStatus, 'current');
      assert.ok(fresh.body.metar.data.reportAgeSeconds >= 29 * 60);
      assert.ok(fresh.body.metar.data.reportAgeSeconds <= 31 * 60);
      assert.equal(fresh.body.metar.data.temperatureC, 25);
      assert.equal(fresh.body.metar.data.dewpointC, 13);
      assert.equal(fresh.body.metar.data.qnhHpa, 1016);
      assert.equal(fresh.body.metar.data.windDirectionDeg, 190);
      assert.equal(fresh.body.metar.data.windSpeedKt, 3);
      assert.equal(fresh.body.metar.data.windGustKt, null);
      assert.equal(fresh.body.metar.data.windVariable, false);
      assert.equal(fresh.body.metar.data.windVariableFromDeg, null);
      assert.equal(fresh.body.metar.data.windVariableToDeg, null);
      assert.ok(fresh.body.metar.data.relativeHumidityPercent > 0);
      assert.ok(fresh.body.metar.data.relativeHumidityPercent <= 100);
      assert.equal(fresh.body.taf.status, 'fresh');
      assert.equal(fresh.body.taf.data.raw.startsWith('TAF AMD LFBL'), true);
      assert.equal(fresh.body.taf.data.timestamp, new Date(issueSeconds * 1000).toISOString());
      assert.equal(fresh.body.taf.data.validFrom, new Date(validFromSeconds * 1000).toISOString());
      assert.equal(fresh.body.taf.data.validTo, new Date(validToSeconds * 1000).toISOString());
      assert.equal(fresh.body.taf.data.amended, true);
      assert.equal(fresh.body.taf.data.forecastGroups[0].windSpeedKt, 5);
      assert.equal(requestedUrls.length, 2);

      const cached = await invoke(handler, { icao: 'LFBL' });

      assert.equal(cached.status, 200);
      assert.equal(cached.body.metar.status, 'cached');
      assert.equal(cached.body.taf.status, 'cached');
      assert.equal(cached.body.metar.cached, true);
      assert.equal(cached.body.taf.cached, true);
      assert.equal(requestedUrls.length, 2, 'le second appel ne doit pas joindre AWC');
    });

    await suite.test('extrait direction, vitesse, rafale et secteur variable depuis le METAR brut', async () => {
      const handler = await loadHandler('raw-wind-fallback');
      const observationSeconds = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);
      globalThis.fetch = async (url) => String(url).includes('/metar?')
        ? upstreamResponse({
          body: [{
            icaoId: 'LFBL',
            obsTime: observationSeconds,
            rawOb: 'METAR LFBL TEST 28012G20KT 240V310 CAVOK 18/08 Q1015',
          }],
        })
        : upstreamResponse({ status: 204 });

      const result = await invoke(handler, { icao: 'LFBL' });

      assert.equal(result.status, 200);
      assert.equal(result.body.metar.data.windDirectionDeg, 280);
      assert.equal(result.body.metar.data.windSpeedKt, 12);
      assert.equal(result.body.metar.data.windGustKt, 20);
      assert.equal(result.body.metar.data.windVariable, false);
      assert.equal(result.body.metar.data.windVariableFromDeg, 240);
      assert.equal(result.body.metar.data.windVariableToDeg, 310);
    });

    await suite.test('conserve VRB et les rafales quand le vent n’existe que dans le METAR brut', async () => {
      const handler = await loadHandler('raw-variable-wind');
      const observationSeconds = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);
      globalThis.fetch = async (url) => String(url).includes('/metar?')
        ? upstreamResponse({
          body: [{
            icaoId: 'LFBL',
            obsTime: observationSeconds,
            rawOb: 'METAR LFBL TEST VRB15G25KT CAVOK 18/08 Q1015',
          }],
        })
        : upstreamResponse({ status: 204 });

      const result = await invoke(handler, { icao: 'LFBL' });

      assert.equal(result.status, 200);
      assert.equal(result.body.metar.data.windDirectionDeg, null);
      assert.equal(result.body.metar.data.windSpeedKt, 15);
      assert.equal(result.body.metar.data.windGustKt, 25);
      assert.equal(result.body.metar.data.windVariable, true);
      assert.equal(result.body.metar.data.windVariableFromDeg, null);
      assert.equal(result.body.metar.data.windVariableToDeg, null);
    });

    await suite.test('transforme deux réponses 204 en états no_data', async () => {
      const handler = await loadHandler('no-data');
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return upstreamResponse({ status: 204 });
      };

      const result = await invoke(handler, { icao: 'ZZZZ' });

      assert.equal(result.status, 200);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.complete, false);
      assert.equal(result.body.metar.status, 'no_data');
      assert.equal(result.body.taf.status, 'no_data');
      assert.equal(result.body.metar.data, null);
      assert.equal(result.body.taf.data, null);
      assert.equal(fetchCalls, 2);
    });

    await suite.test('refuse un rapport qui ne correspond pas exactement à la station demandée', async () => {
      const handler = await loadHandler('station-mismatch');
      globalThis.fetch = async (url) => upstreamResponse({
        body: String(url).includes('/metar?')
          ? [{ icaoId:'LFMK', obsTime:Date.now()/1000, rawOb:'METAR LFMK 142300Z 00000KT CAVOK 20/10 Q1015' }]
          : [{ icaoId:'LFMK', issueTime:new Date().toISOString(), rawTAF:'TAF LFMK 142300Z 1423/1523 CAVOK' }],
      });

      const result = await invoke(handler, { icao:'LFBL' });

      assert.equal(result.status, 502);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.metar.error.code, 'station_mismatch');
      assert.equal(result.body.taf.error.code, 'station_mismatch');
      assert.equal(result.body.metar.data, null);
      assert.equal(result.body.taf.data, null);
    });

    await suite.test('distingue l’âge de l’observation de l’âge du fetch', async () => {
      const handler = await loadHandler('old-observation');
      const oldObservation = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
      globalThis.fetch = async (url) => String(url).includes('/metar?')
        ? upstreamResponse({ body:[{ icaoId:'LFBL', obsTime:oldObservation, receiptTime:new Date().toISOString(), temp:20, dewp:10, altim:1015, rawOb:'METAR LFBL 141900Z 00000KT CAVOK 20/10 Q1015' }] })
        : upstreamResponse({ status:204 });

      const result = await invoke(handler,{icao:'LFBL'});

      assert.equal(result.status,200);
      assert.equal(result.body.metar.status,'fresh');
      assert.equal(result.body.metar.data.reportStatus,'old');
      assert.ok(result.body.metar.data.reportAgeSeconds > 2 * 60 * 60);
      assert.equal(result.body.metar.ageSeconds,0,'le fetch reste récent même si le rapport ne l’est pas');
    });

    await suite.test('n’utilise jamais receiptTime comme heure d’observation', async () => {
      const handler = await loadHandler('missing-observation-time');
      globalThis.fetch = async (url) => String(url).includes('/metar?')
        ? upstreamResponse({ body:[{ icaoId:'LFBL', receiptTime:new Date().toISOString(), temp:20, dewp:10, altim:1015, rawOb:'METAR LFBL 142300Z 00000KT CAVOK 20/10 Q1015' }] })
        : upstreamResponse({ status:204 });

      const result = await invoke(handler,{icao:'LFBL'});

      assert.equal(result.status,200);
      assert.equal(result.body.metar.data.observedAt,null);
      assert.equal(result.body.metar.data.reportStatus,'missing_time');
      assert.equal(result.body.metar.data.reportAgeSeconds,null);
    });

    await suite.test('signale un horodatage d’observation futur incohérent', async () => {
      const handler = await loadHandler('future-observation-time');
      const futureObservation=Math.floor((Date.now()+10*60*1000)/1000);
      globalThis.fetch=async (url)=>String(url).includes('/metar?')
        ? upstreamResponse({body:[{icaoId:'LFBL',obsTime:futureObservation,temp:20,dewp:10,altim:1015,rawOb:'METAR LFBL FUTURE 00000KT CAVOK 20/10 Q1015'}]})
        : upstreamResponse({status:204});

      const result=await invoke(handler,{icao:'LFBL'});

      assert.equal(result.status,200);
      assert.equal(result.body.metar.data.reportStatus,'future');
      assert.ok(result.body.metar.data.reportAgeSeconds<0);
    });

    await suite.test('propage la limitation AWC 429 sans donnée exploitable', async () => {
      const handler = await loadHandler('rate-limit');
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return upstreamResponse({ status: 429, headers: { 'retry-after': '45' } });
      };

      const result = await invoke(handler, { icao: 'YYYY' });

      assert.equal(result.status, 429);
      assert.equal(result.headers['retry-after'], '45');
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.body.ok, false);
      assert.equal(result.body.metar.status, 'rate_limited');
      assert.equal(result.body.taf.status, 'rate_limited');
      assert.equal(result.body.metar.error.code, 'rate_limited');
      assert.equal(result.body.taf.error.code, 'rate_limited');
      assert.equal(fetchCalls, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
