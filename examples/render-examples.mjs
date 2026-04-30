/**
 * Render the six example videos via the renderer service (Docker on :5000),
 * stitch them with TTS narration, and copy the final mp4s into
 * client/public/examples/ where the landing page picks them up.
 *
 * Pipeline per video:
 *   1. POST script to /render-code  → silent video at storage/output/<id>.mp4
 *   2. POST narration to /tts       → audio at storage/audio/<id>.mp3
 *   3. docker exec ffmpeg to stitch → storage/output/<id>_with_audio.mp4
 *   4. Move stitched mp4 to client/public/examples/<id>.mp4
 *
 * Usage (from repo root):
 *   node examples/render-examples.mjs
 *
 * Prereqs:
 *   - Node.js 18+ (built-in fetch)
 *   - docker compose up renderer  (container name: cognito-renderer)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(__dirname, 'scripts');
const outputDir = path.join(repoRoot, 'client', 'public', 'examples');
const rendererUrl = 'http://localhost:5000';
const containerName = 'cognito-renderer';

// Narration text per example. Roughly word-count-matched to each video's
// duration assuming ~150 wpm Piper TTS pacing.
const narrations = {
    'pythagorean-theorem':
        "The Pythagorean theorem describes a fundamental relationship between the three sides of a right triangle. The square of the hypotenuse — the side opposite the right angle — equals the sum of the squares of the other two sides. We can prove this visually by drawing a square on each side. The areas of the two smaller squares, combined, exactly fill the largest square built on the hypotenuse. This elegant geometric truth has been known for over two and a half thousand years.",

    'bubble-sort':
        "Bubble sort is one of the simplest sorting algorithms. It works by repeatedly stepping through an array and comparing each pair of adjacent elements. When they're out of order, the algorithm swaps them. After each complete pass, the largest unsorted value bubbles up to its correct position at the end. The process repeats with one fewer element to consider, until the entire array is sorted. While simple to understand, bubble sort is inefficient for large datasets, with a worst-case time complexity of O of n squared.",

    'pendulum-motion':
        "A simple pendulum is a mass swinging from a fixed point under gravity. As the bob is released from an angle, it accelerates toward the lowest point, swings past it, and rises on the other side, oscillating back and forth. Remarkably, the period of oscillation depends only on the length of the string and the acceleration due to gravity. The mass of the bob has no effect. This relationship is captured in the formula: T equals two pi times the square root of L over g.",

    'binary-search':
        "Binary search efficiently finds a target value in a sorted array by repeatedly halving the search range. At each step, we compare the middle element with our target. If the target is larger, we discard the entire left half and continue searching the right side. If smaller, we eliminate the right half. Each comparison cuts the remaining problem in half, so we reach any element in roughly log base two of n steps. For an array of one million items, that's just twenty comparisons.",

    'fourier-series':
        "A Fourier series represents any periodic function as a sum of sine and cosine waves. Take the square wave: a function that switches abruptly between two values. We can build it by summing odd harmonics. Start with a sine wave, then add one third of a sine wave at three times the frequency. Add one fifth at five times the frequency, and continue. As more terms are added, the approximation becomes increasingly accurate, capturing the sharp transitions of the square wave with smooth sine curves.",

    'wave-interference':
        "When two waves travel through the same medium, they combine through interference. If both waves arrive in phase, their amplitudes add together to create a wave with double the intensity. This is constructive interference. If they arrive exactly out of phase, the peak of one cancels the trough of the other, producing zero amplitude. This is destructive interference. In real situations, waves typically overlap with intermediate phase relationships, producing the complex patterns we see in everyday wave behavior.",
};

const ALL_VIDEOS = [
    { id: 'pythagorean-theorem', file: 'pythagorean_theorem.py' },
    { id: 'bubble-sort', file: 'bubble_sort.py' },
    { id: 'pendulum-motion', file: 'pendulum_motion.py' },
    { id: 'binary-search', file: 'binary_search.py' },
    { id: 'fourier-series', file: 'fourier_series.py' },
    { id: 'wave-interference', file: 'wave_interference.py' },
];

// CLI:
//   node render-examples.mjs                       → render all that don't exist yet
//   node render-examples.mjs --force               → re-render all (overwrite)
//   node render-examples.mjs bubble-sort           → render just bubble-sort (overwrites)
//   node render-examples.mjs --force bubble-sort   → same; --force is implicit when ids passed
const args = process.argv.slice(2);
const force = args.includes('--force');
const requestedIds = args.filter((a) => !a.startsWith('--'));

let videos;
if (requestedIds.length > 0) {
    videos = ALL_VIDEOS.filter((v) => requestedIds.includes(v.id));
    const unknown = requestedIds.filter((id) => !ALL_VIDEOS.some((v) => v.id === id));
    if (unknown.length > 0) {
        console.error(`Unknown id(s): ${unknown.join(', ')}`);
        console.error(`Valid ids: ${ALL_VIDEOS.map((v) => v.id).join(', ')}`);
        process.exit(1);
    }
} else {
    videos = ALL_VIDEOS;
}

console.log(`==> Renderer: ${rendererUrl}`);
console.log(`==> Output:   ${outputDir}`);
console.log(
    `==> Mode:     ${requestedIds.length > 0 ? `targeted (${requestedIds.length})` : force ? 'all (forced)' : 'all (skip existing)'}\n`
);

// Sanity check: renderer reachable?
try {
    const r = await fetch(`${rendererUrl}/health`);
    if (!r.ok) throw new Error(`status ${r.status}`);
} catch (err) {
    console.error(
        `Renderer not reachable at ${rendererUrl}. Start it with 'docker compose up renderer'.`
    );
    console.error(`Underlying: ${err.message}`);
    process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

/**
 * Move a file with Windows-friendly retry. fs.renameSync fails with EPERM if
 * the destination is held open (browser playing the video, Vite watcher,
 * antivirus scan). copyFileSync uses CopyFile under the hood, which is more
 * lenient about a destination open for read. We also retry a few times in
 * case the lock is transient.
 */
function moveFileSafe(src, dest, attempts = 5) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            fs.copyFileSync(src, dest);
            try { fs.unlinkSync(src); } catch { /* leave the source if delete fails */ }
            return;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) {
                // Synchronous sleep (no busy-wait) before retrying.
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (i + 1));
            }
        }
    }
    throw lastErr;
}

/**
 * Stitch silent video + audio into one mp4 via ffmpeg inside the renderer container.
 *
 * Output duration always matches the AUDIO. If the narration is longer than
 * the animation, the video's last frame is held until the audio ends. If the
 * narration is shorter, the video is cut at audio end. Either way, the user
 * never hears the narration get cut off.
 *
 * Implementation: tpad=stop_mode=clone:stop_duration=N extends the video by
 * cloning the final frame for N seconds; -shortest then trims output to the
 * audio length. Re-encoding is required (we can't `-c:v copy` while filtering).
 */
function stitchVideoWithAudio(id) {
    // /app/output and /app/audio are volume-mounted to host's storage/output and storage/audio.
    const result = spawnSync(
        'docker',
        [
            'exec', containerName,
            'ffmpeg', '-y',
            '-i', `/app/output/${id}.mp4`,
            '-i', `/app/audio/${id}.mp3`,
            '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=999[vpadded]',
            '-map', '[vpadded]',
            '-map', '1:a',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            `/app/output/${id}_with_audio.mp4`,
        ],
        { encoding: 'utf-8' }
    );
    return { ok: result.status === 0, stderr: result.stderr ?? '' };
}

for (const v of videos) {
    const scriptPath = path.join(scriptsDir, v.file);
    if (!fs.existsSync(scriptPath)) {
        console.warn(`Skipping ${v.id}: ${scriptPath} not found`);
        continue;
    }

    const narration = narrations[v.id];
    if (!narration) {
        console.warn(`Skipping ${v.id}: no narration defined for this id`);
        continue;
    }

    // Skip videos that already exist unless --force or specifically requested.
    const finalPath = path.join(outputDir, `${v.id}.mp4`);
    const explicitlyRequested = requestedIds.includes(v.id);
    if (!force && !explicitlyRequested && fs.existsSync(finalPath)) {
        const sizeKb = Math.round(fs.statSync(finalPath).size / 1024);
        console.log(`==> ${v.id} (skipped, already exists, ${sizeKb} KB — use --force to re-render)`);
        continue;
    }

    console.log(`==> ${v.id}`);
    const code = fs.readFileSync(scriptPath, 'utf-8');

    // ── Step 1: render the silent video ──
    process.stdout.write('    [1/3] rendering video...');
    let renderResp;
    try {
        const r = await fetch(`${rendererUrl}/render-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ sceneId: v.id, manimCode: code, quality: 'medium' }),
        });
        renderResp = await r.json();
    } catch (err) {
        console.log(` ❌ HTTP ${err.message}`);
        continue;
    }
    if (!renderResp.success) {
        console.log(` ❌\n    ${JSON.stringify(renderResp).slice(0, 500)}`);
        continue;
    }
    console.log(` ${renderResp.duration}s`);

    // ── Step 2: synthesize narration ──
    process.stdout.write('    [2/3] synthesizing narration...');
    let ttsResp;
    try {
        const r = await fetch(`${rendererUrl}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ sceneId: v.id, text: narration }),
        });
        ttsResp = await r.json();
    } catch (err) {
        console.log(` ❌ HTTP ${err.message}`);
        ttsResp = { success: false };
    }

    let stitched = false;
    if (ttsResp.success) {
        console.log(` ${ttsResp.duration}s`);

        // ── Step 3: stitch ──
        process.stdout.write('    [3/3] stitching with ffmpeg...');
        const { ok, stderr } = stitchVideoWithAudio(v.id);
        if (ok) {
            console.log(' ✓');
            stitched = true;
        } else {
            console.log(' ❌');
            console.log(`    ${stderr.slice(0, 500)}`);
        }
    } else {
        console.log(` ❌ skipping stitch`);
    }

    // ── Move final file to client/public/examples (finalPath defined above) ──
    const sourceFilename = stitched ? `${v.id}_with_audio.mp4` : `${v.id}.mp4`;
    const sourcePath = path.join(repoRoot, 'storage', 'output', sourceFilename);

    if (!fs.existsSync(sourcePath)) {
        console.log(`    ⚠ expected output not found at ${sourcePath}`);
        continue;
    }

    try {
        moveFileSafe(sourcePath, finalPath);
    } catch (moveErr) {
        console.log(`    ❌ couldn't write ${path.basename(finalPath)} — ${moveErr.code || moveErr.message}`);
        console.log(`       This usually means the file is open in your browser (modal playing) or watched by Vite.`);
        console.log(`       Close the browser tab/Vite dev server and retry just this one:`);
        console.log(`         node examples/render-examples.mjs ${v.id}`);
        console.log(`       The stitched output is left at: ${sourcePath}`);
        continue;
    }
    const sizeKb = Math.round(fs.statSync(finalPath).size / 1024);
    console.log(`    -> ${finalPath} (${sizeKb} KB${stitched ? ', with narration' : ', SILENT'})`);

    // Clean up the silent intermediate if we kept the stitched copy.
    if (stitched) {
        const silentPath = path.join(repoRoot, 'storage', 'output', `${v.id}.mp4`);
        if (fs.existsSync(silentPath)) {
            try { fs.unlinkSync(silentPath); } catch { /* ignore */ }
        }
    }
}

console.log('\nAll done. Reload the landing page to see the videos with narration.');
