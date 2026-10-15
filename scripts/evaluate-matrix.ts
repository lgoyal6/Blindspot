/**
 * Run the locked sensor-simulation study and write raw records plus reconstructable summaries.
 *
 *   node_modules/.bin/esbuild scripts/evaluate-matrix.ts --bundle --platform=node --format=esm --outfile=<tmp>/evaluate-matrix.mjs
 *   node <tmp>/evaluate-matrix.mjs --out <dir> [--split tuning|held_out|all] [--lock-only]
 *   node <tmp>/evaluate-matrix.mjs --out <dir> --split all --diagnose-reactive
 *
 * --lock-only writes the manifest and its hash without running anything (protocol freeze).
 * Outputs stay outside the repository. Simulation only; no network, no provider calls.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MANIFEST, canonicalJson, exportScene, scenesFor, validateManifest, type SceneSpec } from '../src/engine/experiment-manifest';
import type { CellRecord } from '../src/engine/study';
import { diagnoseReactive, deterministicRecords, disparityTable, minimumResolvableDiameters, robustnessSurface, runStudy, summarize, calibrationResiduals } from '../src/engine/study';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const out = arg('--out');
  if (!out) throw new Error('--out <dir> is required');
  const split = (arg('--split') ?? 'all') as 'tuning' | 'held_out' | 'all';
  if (!['tuning', 'held_out', 'all'].includes(split)) throw new Error('--split must be tuning, held_out or all');
  mkdirSync(out, { recursive: true });
  const manifest = validateManifest(DEFAULT_MANIFEST);
  const manifestJson = canonicalJson(manifest), manifestHash = sha256(manifestJson);
  const lockPath = join(out, 'manifest.lock.json');
  // A locked protocol may not be silently replaced: the running manifest must hash to the lock.
  if (existsSync(lockPath)) {
    const locked = JSON.parse(readFileSync(lockPath, 'utf8')) as { manifestSha256: string };
    if (locked.manifestSha256 !== manifestHash) throw new Error(`Manifest ${manifestHash} does not match locked ${locked.manifestSha256}`);
  } else {
    const scenes = scenesFor(manifest).map(s => exportScene(s, sha256));
    writeFileSync(lockPath, JSON.stringify({ manifestSha256: manifestHash, lockedAt: new Date().toISOString(), manifest, sceneDigests: scenes.map(s => ({ sceneId: s.sceneId, geometryDigest: s.geometryDigest })) }, null, 1));
  }
  if (process.argv.includes('--lock-only')) { console.log(JSON.stringify({ manifestSha256: manifestHash, lock: lockPath })); return; }

  if (process.argv.includes('--diagnose-reactive')) {
    // Reads retained raw records (never reruns the study) and decomposes every reactive miss.
    const raw = readFileSync(join(out, `records-${split}.jsonl`), 'utf8');
    const misses = raw.trim().split('\n').map(line => JSON.parse(line) as CellRecord).filter(r => r.reactiveMiss);
    const scenes = scenesFor(manifest);
    const rows: Awaited<ReturnType<typeof diagnoseReactive>>[] = [];
    for (const r of misses) rows.push(await diagnoseReactive(manifest, scenes.find(s => s.sceneId === r.sceneId)!, r.diameterMm, r.resolutionPx, r.minResolvableWidthPx));
    const stat = (k: 'overestimateM' | 'triggerLagM' | 'shortfallM') => { const xs = rows.flatMap(x => x[k] === null ? [] : [x[k] as number]).sort((a, b) => a - b); return { n: xs.length, min: xs[0] ?? null, median: xs[Math.floor(xs.length / 2)] ?? null, max: xs[xs.length - 1] ?? null }; };
    const result = { manifestSha256: manifestHash, recordsSha256: sha256(raw), misses: rows.length, scenes: new Set(rows.map(x => x.sceneId)).size,
      allShortfallsExceedMargin: rows.every(x => x.shortfallM !== null && x.shortfallM > x.marginM),
      overestimateM: stat('overestimateM'), triggerLagM: stat('triggerLagM'), shortfallM: stat('shortfallM'), sensingStepTravelM: 1.1 * 0.05, rows };
    writeFileSync(join(out, 'reactive-diagnosis.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify({ ...result, rows: undefined }, null, 1));
    return;
  }
  const splits: SceneSpec['split'][] = split === 'all' ? ['tuning', 'held_out'] : [split];
  const runId = `${manifest.studyId}-${split}-${manifestHash.slice(0, 12)}`;
  const t0 = performance.now();
  const reconstruct = process.argv.includes('--reconstruct');
  if (!reconstruct && existsSync(join(out, `records-${split}.jsonl`))) throw new Error('Retained raw samples already exist; use --reconstruct or a new output directory');
  const prior = reconstruct ? JSON.parse(readFileSync(join(out, `summary-${split}.json`), 'utf8')) : null;
  const records: CellRecord[] = reconstruct
    ? readFileSync(join(out, `records-${split}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    : await runStudy(manifest, { splits });
  const first = deterministicRecords(records);
  // Repeatability: rerun the identical inputs and require byte-identical deterministic output.
  const again = reconstruct ? first : deterministicRecords(await runStudy(manifest, { splits }));
  if (reconstruct && (sha256(first) !== prior.recordsSha256 || prior.manifestSha256 !== manifestHash)) throw new Error('Retained raw/manifest hashes do not match the original repeatability receipt');
  const elapsedMs = reconstruct ? prior.wallClockMsBothPasses : performance.now() - t0;
  const repeatable = reconstruct ? prior.repeatable : first === again;

  const bySplit = Object.fromEntries(splits.map(s => [s, summarize(records.filter(r => r.split === s))]));
  const runtimes = records.map(r => r.runtimeMs).sort((a, b) => a - b);
  const runtimeByResolution = Object.fromEntries(manifest.factors.resolutionsPx.map(res => {
    const xs = records.filter(r => r.resolutionPx === res).map(r => r.runtimeMs).sort((a, b) => a - b);
    return [res, { n: xs.length, medianMs: xs[Math.floor(xs.length / 2)], p95Ms: xs[Math.floor(0.95 * (xs.length - 1))], maxMs: xs[xs.length - 1] }];
  }));
  const summary = {
    runId, manifestSha256: manifestHash, recordsSha256: sha256(first), repeatable, splits,
    reconstruction: reconstruct, cells: records.length, wallClockMsBothPasses: Math.round(elapsedMs),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    runtime: { medianMs: runtimes[Math.floor(runtimes.length / 2)], p95Ms: runtimes[Math.floor(0.95 * (runtimes.length - 1))], byResolution: runtimeByResolution },
    bySplit,
    minimumResolvableDiameter: split === 'tuning' ? null : await minimumResolvableDiameters(manifest),
    calibration: calibrationResiduals(manifest),
    claimBoundary: 'Simulation of the declared passive-stereo approximation only. Not a hardware measurement or safety certification.',
  };
  if (!reconstruct) writeFileSync(join(out, `records-${split}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(out, `summary-${split}.json`), JSON.stringify(summary, null, 1));
  const surface = robustnessSurface(records.filter(r => r.split === (split === 'tuning' ? 'tuning' : 'held_out')));
  writeFileSync(join(out, `surface-${split}.csv`), ['diameter_mm,resolution_px,min_width_px,n,oracle_in_time,evaluator_in_time', ...surface.map(c => `${c.diameterMm},${c.resolutionPx},${c.minResolvableWidthPx},${c.n},${c.oracleInTime},${c.evaluatorInTime}`)].join('\n') + '\n');
  writeFileSync(join(out, 'disparity.csv'), ['resolution_px,min_width_px,diameter_mm,baseline_mm,threshold_range_m,disparity_at_threshold_px', ...disparityTable(manifest).map(r => `${r.resolutionPx},${r.minResolvableWidthPx},${r.diameterMm},${r.baselineMm},${r.thresholdRangeM},${r.disparityAtThresholdPx}`)].join('\n') + '\n');
  console.log(JSON.stringify({ runId, cells: records.length, repeatable, recordsSha256: summary.recordsSha256, bySplit: Object.fromEntries(Object.entries(bySplit).map(([k, v]) => [k, { agreement: v.agreement, algorithmicMiss: v.algorithmicMiss, falseAlert: v.falseAlert, limitFactors: v.limitFactors, rangeLagM: v.rangeLagM, reactive: v.reactive }])) }, null, 1));
  if (!repeatable) process.exitCode = 2;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
