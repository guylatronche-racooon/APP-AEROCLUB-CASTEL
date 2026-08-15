import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const manualPath = new URL('../app/documents/manuel-utilisation-outils-de-vol.pdf', import.meta.url);
const appPath = new URL('../app/index.html', import.meta.url);
const serviceWorkerPath = new URL('../app/sw.js', import.meta.url);

test('le manuel PDF est publié et relié depuis l’application', async () => {
  const [manualStat, app, serviceWorker] = await Promise.all([
    stat(manualPath),
    readFile(appPath, 'utf8'),
    readFile(serviceWorkerPath, 'utf8'),
  ]);

  assert.ok(manualStat.size > 100_000, 'le PDF doit être un document complet');
  assert.match(app, /Manuel d’utilisation et méthodes de calcul/);
  assert.match(app, /\/documents\/manuel-utilisation-outils-de-vol\.pdf/);
  assert.match(serviceWorker, /acjd-flight-tools-static-v18-vac-catalogue/);
  assert.match(serviceWorker, /\/documents\/manuel-utilisation-outils-de-vol\.pdf/);
});
