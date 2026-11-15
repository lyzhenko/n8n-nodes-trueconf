/**
 * Copies non-TypeScript assets (icons) into dist/ so that `icon: 'file:trueconf.svg'`
 * resolves both in the repository and inside the packed npm tarball.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');
const assetExtensions = new Set(['.svg', '.png', '.webp', '.jpg', '.jpeg', '.ico']);

function walk(dir) {
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			walk(full);
			continue;
		}
		const dot = entry.lastIndexOf('.');
		const extension = dot === -1 ? '' : entry.slice(dot).toLowerCase();
		if (!assetExtensions.has(extension)) {
			continue;
		}
		const target = join(distDir, relative(srcDir, full));
		mkdirSync(dirname(target), { recursive: true });
		cpSync(full, target);
		console.log(`[assets] ${relative(root, target)}`);
	}
}

if (!existsSync(distDir)) {
	console.error('[assets] dist/ is missing — run tsc first');
	process.exit(1);
}

walk(srcDir);
