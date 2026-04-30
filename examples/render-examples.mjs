/**
 * Render the six example videos via the renderer service (Docker on :5000)
 * and copy them into client/public/examples/ where the landing page picks
 * them up.
 *
 * Usage (from repo root):
 *   node examples/render-examples.mjs
 *
 * Prereqs:
 *   - Node.js 18+ (for built-in fetch)
 *   - docker compose up renderer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(__dirname, 'scripts');
const outputDir = path.join(repoRoot, 'client', 'public', 'examples');
const rendererUrl = 'http://localhost:5000';

const videos = [
    { id: 'pythagorean-theorem', file: 'pythagorean_theorem.py' },
    { id: 'bubble-sort', file: 'bubble_sort.py' },
    { id: 'pendulum-motion', file: 'pendulum_motion.py' },
    { id: 'binary-search', file: 'binary_search.py' },
    { id: 'fourier-series', file: 'fourier_series.py' },
    { id: 'wave-interference', file: 'wave_interference.py' },
];

console.log(`==> Renderer: ${rendererUrl}`);
console.log(`==> Output:   ${outputDir}\n`);

// Sanity check: renderer reachable?
try {
    const r = await fetch(`${rendererUrl}/health`);
    if (!r.ok) throw new Error(`status ${r.status}`);
} catch (err) {
    console.error(
        `Renderer not reachable at ${rendererUrl}. Start it with 'docker compose up renderer'.`
    );
    console.error(`Underlying error: ${err.message}`);
    process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

for (const v of videos) {
    const scriptPath = path.join(scriptsDir, v.file);

    if (!fs.existsSync(scriptPath)) {
        console.warn(`Skipping ${v.id}: ${scriptPath} not found`);
        continue;
    }

    console.log(`==> Rendering ${v.id}...`);
    const code = fs.readFileSync(scriptPath, 'utf-8');

    let resp;
    try {
        const httpResp = await fetch(`${rendererUrl}/render-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                sceneId: v.id,
                manimCode: code,
                quality: 'medium',
            }),
        });
        resp = await httpResp.json();
    } catch (err) {
        console.warn(`    HTTP error: ${err.message}`);
        continue;
    }

    if (!resp.success) {
        console.warn(`    Render failed:`);
        console.warn(`    ${JSON.stringify(resp, null, 2).split('\n').join('\n    ')}`);
        continue;
    }

    // Renderer wrote the file to storage/output/<id>.mp4 via the volume mount.
    const rendered = path.join(repoRoot, 'storage', 'output', `${v.id}.mp4`);
    const finalPath = path.join(outputDir, `${v.id}.mp4`);

    if (!fs.existsSync(rendered)) {
        console.warn(`    Rendered file not found at ${rendered}`);
        continue;
    }

    fs.renameSync(rendered, finalPath);
    const sizeKb = Math.round(fs.statSync(finalPath).size / 1024);
    console.log(`    OK -> ${finalPath}  (${sizeKb} KB, ${resp.duration}s)`);
}

console.log('\nAll done. Reload the landing page to see the videos.');
