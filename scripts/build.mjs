import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceApp = path.join(root, 'app');
const encodedAssets = path.join(root, 'encoded-assets');
const output = path.join(root, 'dist');

async function decodeTree(directory, relative = '') {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await decodeTree(absolute, nextRelative);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.b64')) continue;

    const targetRelative = nextRelative.slice(0, -4);
    const target = path.join(output, targetRelative);
    await mkdir(path.dirname(target), { recursive: true });
    const base64 = (await readFile(absolute, 'utf8')).trim();
    await writeFile(target, Buffer.from(base64, 'base64'));
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(sourceApp, path.join(output, 'app'), { recursive: true });
await decodeTree(encodedAssets);

console.log('Build statique prêt dans dist/.');
