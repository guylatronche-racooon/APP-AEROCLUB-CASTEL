const AWC_BASE_URL = 'https://aviationweather.gov/api/data';

const PRODUCTS = Object.freeze({
  metar: Object.freeze({ path: 'metar', ttlMs: 60_000 }),
  taf: Object.freeze({ path: 'taf', ttlMs: 600_000 }),
});

const ICAO_PATTERN = /^[A-Z]{4}$/;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_UPSTREAM_REQUESTS_PER_MINUTE = 90;
const MAX_METAR_OBSERVATION_AGE_MS = 2 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

// Vercel may reuse a warm function instance. This cache is deliberately only an
// optimisation: correctness never relies on it surviving a cold start.
const cache = new Map();
const inFlight = new Map();
const upstreamRequestTimes = [];

class UpstreamError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

function env(name) {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function timeoutMs() {
  const configured = Number(env('AWC_TIMEOUT_MS'));
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(20_000, Math.max(1_000, Math.round(configured)));
}

function userAgent() {
  return (
    env('AWC_USER_AGENT')?.trim() ||
    'Outils-de-vol-ACJD/1.0 (serverless Aviation Weather Center relay)'
  );
}

function firstDefined(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return null;

  let milliseconds;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
  } else {
    milliseconds = Date.parse(String(value));
  }

  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rawText(report, product) {
  const keys =
    product === 'metar'
      ? ['rawOb', 'rawMETAR', 'rawMetar', 'raw_text', 'rawText']
      : ['rawTAF', 'rawTaf', 'raw_text', 'rawText'];
  const value = firstDefined(report, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tacTemperature(token) {
  if (!/^M?\d{2}$/.test(token || '')) return null;
  const negative = token.startsWith('M');
  const value = Number(token.replace('M', ''));
  return negative ? -value : value;
}

function temperatures(report, raw) {
  let temperatureC = finiteNumber(
    firstDefined(report, ['temp', 'tempC', 'temperature', 'temperatureC']),
  );
  let dewpointC = finiteNumber(
    firstDefined(report, ['dewp', 'dewpC', 'dewpoint', 'dewpointC']),
  );

  if ((temperatureC === null || dewpointC === null) && raw) {
    const match = raw.match(/(?:^|\s)(M?\d{2})\/(M?\d{2})(?=\s|$)/);
    if (match) {
      temperatureC ??= tacTemperature(match[1]);
      dewpointC ??= tacTemperature(match[2]);
    }
  }

  return { temperatureC, dewpointC };
}

function qnhHpa(report, raw) {
  const value = finiteNumber(
    firstDefined(report, ['qnhHpa', 'qnh', 'altim', 'altimeter']),
  );

  // AWC currently returns hPa. The second branch also tolerates providers that
  // expose an altimeter setting in inches of mercury.
  if (value !== null && value >= 800 && value <= 1_100) return round(value, 1);
  if (value !== null && value >= 20 && value <= 40) {
    return round(value * 33.8638866667, 1);
  }

  const qCode = raw?.match(/(?:^|\s)Q(\d{4})(?=\s|$)/);
  if (qCode) return Number(qCode[1]);

  const aCode = raw?.match(/(?:^|\s)A(\d{4})(?=\s|$)/);
  if (aCode) return round((Number(aCode[1]) / 100) * 33.8638866667, 1);

  return null;
}

function relativeHumidity(temperatureC, dewpointC) {
  if (!Number.isFinite(temperatureC) || !Number.isFinite(dewpointC)) return null;
  const saturation = (temperature) =>
    (17.625 * temperature) / (243.04 + temperature);
  const result = 100 * Math.exp(saturation(dewpointC) - saturation(temperatureC));
  return round(Math.min(100, Math.max(0, result)), 1);
}

function stationId(report, fallback) {
  const candidate = firstDefined(report, ['icaoId', 'stationId', 'station_id']);
  return typeof candidate === 'string' && ICAO_PATTERN.test(candidate.toUpperCase())
    ? candidate.toUpperCase()
    : fallback;
}

function reportStationId(report, product) {
  const explicit = firstDefined(report, ['icaoId', 'stationId', 'station_id']);
  if (typeof explicit === 'string' && ICAO_PATTERN.test(explicit.toUpperCase())) {
    return explicit.toUpperCase();
  }

  const raw = rawText(report, product);
  if (!raw) return null;
  const expression =
    product === 'metar'
      ? /^(?:METAR|SPECI)?\s*([A-Z]{4})(?=\s)/
      : /^TAF(?:\s+(?:AMD|COR))?\s+([A-Z]{4})(?=\s)/;
  return raw.match(expression)?.[1] ?? null;
}

function reportTimeQuality(timestamp, now = Date.now()) {
  if (!timestamp) {
    return { reportStatus: 'missing_time', reportAgeSeconds: null };
  }
  const reportTime = Date.parse(timestamp);
  if (!Number.isFinite(reportTime)) {
    return { reportStatus: 'invalid_time', reportAgeSeconds: null };
  }
  const ageMs = now - reportTime;
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      reportStatus: 'future',
      reportAgeSeconds: Math.round(ageMs / 1_000),
    };
  }
  if (ageMs > MAX_METAR_OBSERVATION_AGE_MS) {
    return {
      reportStatus: 'old',
      reportAgeSeconds: Math.floor(ageMs / 1_000),
    };
  }
  return {
    reportStatus: 'current',
    reportAgeSeconds: Math.max(0, Math.floor(ageMs / 1_000)),
  };
}

function normalizeMetar(report, icao) {
  const raw = rawText(report, 'metar');
  const { temperatureC, dewpointC } = temperatures(report, raw);
  const observedAt = toIso(
    firstDefined(report, [
      'obsTime',
      'observationTime',
      'observation_time',
      'reportTime',
    ]),
  );

  return {
    station: stationId(report, icao),
    raw,
    timestamp: observedAt,
    observedAt,
    receivedAt: toIso(firstDefined(report, ['receiptTime', 'dbPopTime'])),
    temperatureC,
    dewpointC,
    relativeHumidityPercent: relativeHumidity(temperatureC, dewpointC),
    qnhHpa: qnhHpa(report, raw),
    windDirectionDeg: finiteNumber(firstDefined(report, ['wdir', 'windDirection'])),
    windSpeedKt: finiteNumber(firstDefined(report, ['wspd', 'windSpeed'])),
    windGustKt: finiteNumber(firstDefined(report, ['wgst', 'windGust'])),
    visibilitySm: finiteNumber(firstDefined(report, ['visib', 'visibility'])),
    flightCategory: firstDefined(report, ['fltCat', 'flightCategory']),
    ...reportTimeQuality(observedAt),
  };
}

function normalizeForecastGroup(group) {
  return {
    from: toIso(firstDefined(group, ['timeFrom', 'validTimeFrom'])),
    to: toIso(firstDefined(group, ['timeTo', 'validTimeTo'])),
    becomingAt: toIso(firstDefined(group, ['timeBec', 'becomingAt'])),
    change: firstDefined(group, ['fcstChange', 'change']),
    probabilityPercent: finiteNumber(firstDefined(group, ['probability', 'probabilityPercent'])),
    windDirectionDeg: finiteNumber(firstDefined(group, ['wdir', 'windDirection'])),
    windSpeedKt: finiteNumber(firstDefined(group, ['wspd', 'windSpeed'])),
    windGustKt: finiteNumber(firstDefined(group, ['wgst', 'windGust'])),
    visibilitySm: finiteNumber(firstDefined(group, ['visib', 'visibility'])),
    weather: firstDefined(group, ['wxString', 'weather']),
  };
}

function normalizeTaf(report, icao) {
  const raw = rawText(report, 'taf');
  const issuedAt = toIso(
    firstDefined(report, ['issueTime', 'bulletinTime', 'dbPopTime', 'receiptTime']),
  );
  const groups = Array.isArray(report?.fcsts)
    ? report.fcsts.map(normalizeForecastGroup)
    : [];

  return {
    station: stationId(report, icao),
    raw,
    timestamp: issuedAt,
    issuedAt,
    validFrom: toIso(firstDefined(report, ['validTimeFrom', 'validFrom'])),
    validTo: toIso(firstDefined(report, ['validTimeTo', 'validTo'])),
    amended: /(?:^|\s)AMD(?:\s|$)/.test(raw || ''),
    cancelled: /(?:^|\s)CNL(?:\s|$)/.test(raw || ''),
    nil: /(?:^|\s)NIL(?:\s|$)/.test(raw || ''),
    forecastGroups: groups,
  };
}

function normalizeReport(product, report, icao) {
  return product === 'metar'
    ? normalizeMetar(report, icao)
    : normalizeTaf(report, icao);
}

function responseArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.features)) {
    return payload.features.map((feature) => feature?.properties ?? feature);
  }
  throw new UpstreamError(
    'invalid_response',
    "La réponse du service météo n'a pas le format attendu.",
  );
}

async function fetchAwc(product, icao) {
  const now = Date.now();
  while (upstreamRequestTimes.length && upstreamRequestTimes[0] <= now - 60_000) {
    upstreamRequestTimes.shift();
  }
  if (upstreamRequestTimes.length >= MAX_UPSTREAM_REQUESTS_PER_MINUTE) {
    throw new UpstreamError(
      'rate_limited',
      'Le relais protège temporairement la limite de requêtes du service météo.',
      { status: 429, retryAfter: '60' },
    );
  }
  upstreamRequestTimes.push(now);
  const config = PRODUCTS[product];
  const url = new URL(`${AWC_BASE_URL}/${config.path}`);
  url.searchParams.set('ids', icao);
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent(),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new UpstreamError('timeout', 'Le service météo a dépassé le délai de réponse.');
    }
    throw new UpstreamError('network_error', 'Le service météo est injoignable.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return { kind: 'no_data', data: null };

  if (response.status === 429) {
    throw new UpstreamError('rate_limited', 'Le service météo limite temporairement les requêtes.', {
      status: 429,
      retryAfter: response.headers.get('retry-after'),
    });
  }

  if (!response.ok) {
    throw new UpstreamError(
      'upstream_error',
      `Le service météo a répondu avec le statut ${response.status}.`,
      { status: response.status },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(
      'invalid_response',
      "La réponse du service météo n'est pas un JSON valide.",
    );
  }

  const reports = responseArray(payload);
  if (reports.length === 0) return { kind: 'no_data', data: null };

  const report = reports.find((candidate) => reportStationId(candidate, product) === icao);
  if (!report) {
    throw new UpstreamError(
      'station_mismatch',
      `Le service météo n'a pas renvoyé de rapport pour la station ${icao}.`,
    );
  }

  return { kind: 'data', data: normalizeReport(product, report, icao) };
}

function cacheKey(product, icao) {
  return `${product}:${icao}`;
}

function setCacheEntry(key, entry) {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

function publicEntry(entry, status, now, extras = {}) {
  return {
    status,
    cached: status === 'cached' || status === 'stale',
    stale: status === 'stale',
    fetchedAt: entry.fetchedAt,
    expiresAt: entry.expiresAt,
    ageSeconds: Math.max(0, Math.floor((now - entry.fetchedAtMs) / 1_000)),
    data: entry.data,
    ...extras,
  };
}

function publicError(error) {
  if (error instanceof UpstreamError) {
    return {
      code: error.code,
      message: error.message,
      upstreamStatus: error.status,
      retryAfter: error.retryAfter,
    };
  }
  return {
    code: 'unexpected_error',
    message: 'Une erreur inattendue est survenue pendant la récupération météo.',
    upstreamStatus: null,
    retryAfter: null,
  };
}

async function refreshProduct(product, icao) {
  const key = cacheKey(product, icao);
  if (inFlight.has(key)) return inFlight.get(key);

  const operation = (async () => {
    const fetched = await fetchAwc(product, icao);
    const fetchedAtMs = Date.now();
    const entry = {
      kind: fetched.kind,
      data: fetched.data,
      fetchedAtMs,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      expiresAtMs: fetchedAtMs + PRODUCTS[product].ttlMs,
      expiresAt: new Date(fetchedAtMs + PRODUCTS[product].ttlMs).toISOString(),
    };
    setCacheEntry(key, entry);
    return entry;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, operation);
  return operation;
}

async function getProduct(product, icao) {
  const now = Date.now();
  const key = cacheKey(product, icao);
  const cachedEntry = cache.get(key);

  if (cachedEntry && cachedEntry.expiresAtMs > now) {
    const status = cachedEntry.kind === 'no_data' ? 'no_data' : 'cached';
    return publicEntry(cachedEntry, status, now);
  }

  try {
    const fresh = await refreshProduct(product, icao);
    return publicEntry(fresh, fresh.kind === 'no_data' ? 'no_data' : 'fresh', Date.now());
  } catch (error) {
    const normalizedError = publicError(error);

    if (cachedEntry?.kind === 'data' && cachedEntry.data) {
      return publicEntry(cachedEntry, 'stale', Date.now(), {
        warning: {
          code: 'stale_fallback',
          message: "Donnée expirée conservée car l'actualisation a échoué.",
          cause: normalizedError,
        },
      });
    }

    return {
      status: normalizedError.code === 'rate_limited' ? 'rate_limited' : 'error',
      cached: false,
      stale: false,
      fetchedAt: null,
      expiresAt: null,
      ageSeconds: null,
      data: null,
      error: normalizedError,
    };
  }
}

function queryValue(req, name) {
  const direct = req?.query?.[name];
  if (Array.isArray(direct)) return direct.length === 1 ? direct[0] : null;
  if (direct !== undefined && direct !== null) return direct;

  try {
    const values = new URL(req?.url || '/', 'http://localhost').searchParams.getAll(name);
    return values.length === 1 ? values[0] : null;
  } catch {
    return null;
  }
}

function validatedIcao(req) {
  const raw = queryValue(req, 'icao');
  if (typeof raw !== 'string') return null;
  const icao = raw.trim().toUpperCase();
  return ICAO_PATTERN.test(icao) ? icao : null;
}

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function usable(product) {
  return Boolean(product?.data) && ['fresh', 'cached', 'stale'].includes(product.status);
}

function overallStatus(metar, taf) {
  if (usable(metar) || usable(taf)) return 200;
  if (metar.status === 'no_data' && taf.status === 'no_data') return 200;
  if (metar.status === 'rate_limited' || taf.status === 'rate_limited') return 429;
  return 502;
}

export default async function handler(req, res) {
  setCommonHeaders(res);

  if ((req.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 405, {
      ok: false,
      error: { code: 'method_not_allowed', message: 'Seule la méthode GET est acceptée.' },
    });
  }

  const icao = validatedIcao(req);
  if (!icao) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 400, {
      ok: false,
      error: {
        code: 'invalid_icao',
        message: 'Le paramètre icao doit contenir exactement quatre lettres (ex. LFBL).',
      },
    });
  }

  const [metar, taf] = await Promise.all([
    getProduct('metar', icao),
    getProduct('taf', icao),
  ]);
  const status = overallStatus(metar, taf);

  if (status === 200) {
    // The shortest source cadence is one minute (METAR). Vercel's shared cache
    // complements, but does not replace, the best-effort in-memory cache above.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }

  if (status === 429) {
    const retryAfter = metar.error?.retryAfter || taf.error?.retryAfter;
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
  }

  return sendJson(res, status, {
    ok: usable(metar) || usable(taf),
    complete: usable(metar) && usable(taf),
    station: icao,
    requestedAt: new Date().toISOString(),
    source: {
      provider: 'NOAA / National Weather Service — Aviation Weather Center',
      documentation: 'https://aviationweather.gov/data/api/',
    },
    metar,
    taf,
  });
}
