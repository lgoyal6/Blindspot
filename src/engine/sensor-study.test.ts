// @vitest-environment node
/**
 * Sensor-simulation study: manifest contracts, independent oracle, failure matrix and the
 * SampleSensor conformance suite. Simulation only; nothing here is a hardware result.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SensorConfig } from '../../shared/contracts';
import type { SampleSensor } from './sensor';
import { analyticSampler } from './sensor';
import { evaluate } from './evaluate';
import {
  DEFAULT_MANIFEST, buildScenario, buildSensorConfig, canonicalJson, diameterMmToM, exportScene, generateScene,
  importScene, scenesFor, validateManifest, type ExperimentManifest, type SceneSpec,
} from './experiment-manifest';
import {
  closedFormMinDiameterM, closedFormPerpendicularRangeM, compareWithEvaluator, oracleForScenario, requiredStoppingM,
} from './visibility-oracle';
import { calibrationResiduals, deterministicRecords, diagnoseReactive, runCell, summarize, wilson } from './study';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const m = DEFAULT_MANIFEST;
const tol = m.boundaryToleranceM;
const perpendicular = (y = 0.35, z = -6): SceneSpec => ({ sceneId: 'fixture-perp', split: 'tuning', family: 'perpendicular', seed: 1, cable: { startM: [-1.2, y, z], endM: [1.2, y, z] }, boxes: [] });
const sensorOf = (r: number, w: number) => buildSensorConfig(m, r, w).sensors[0]!;
const withManifest = (patch: (x: ExperimentManifest) => ExperimentManifest) => patch(structuredClone(m) as ExperimentManifest);

describe('M1 manifest contract', () => {
  it('the locked default manifest validates and its hash is stable', () => {
    expect(() => validateManifest(m)).not.toThrow();
    expect(sha256(canonicalJson(m))).toBe(sha256(canonicalJson(structuredClone(m))));
  });

  it('F zero baseline: a stereo baseline of 0 is rejected, never scored', () => {
    expect(() => validateManifest(withManifest(x => ({ ...x, factors: { ...x.factors, stereoBaselinesMm: [0, 60] } })))).toThrow(/stereoBaselinesMm must be finite and positive/);
  });

  it('F unit conversion: millimetres convert once; a metre value passed as mm is refused', () => {
    expect(diameterMmToM(8)).toBeCloseTo(0.008, 15);
    expect(() => diameterMmToM(0.008)).toThrow(/outside the plausible range.*check the unit/);
    expect(() => validateManifest(withManifest(x => ({ ...x, factors: { ...x.factors, cableDiametersMm: [0.008, 0.016] } })))).toThrow(/check the unit/);
    expect(() => validateManifest(withManifest(x => ({ ...x, factors: { ...x.factors, stereoBaselinesMm: [0.06] } })))).toThrow(/check the unit/);
  });

  it('rejects held-out seeds that overlap tuning, a mismatched engine version and duplicate factors', () => {
    expect(() => validateManifest(withManifest(x => ({ ...x, heldOut: { ...x.heldOut, seeds: [101, 9002] } })))).toThrow(/overlap/);
    expect(() => validateManifest(withManifest(x => ({ ...x, versions: { ...x.versions, engine: 'ground-stereo-0.9.0' } })))).toThrow(/does not match running engine/);
    expect(() => validateManifest(withManifest(x => ({ ...x, factors: { ...x.factors, resolutionsPx: [160, 160] } })))).toThrow(/duplicates/);
  });

  it('scene generation is a pure function of (family, seed) and splits are disjoint', () => {
    expect(canonicalJson(generateScene('oblique', 9001, 'held_out'))).toBe(canonicalJson(generateScene('oblique', 9001, 'held_out')));
    expect(canonicalJson(generateScene('oblique', 9001, 'held_out'))).not.toBe(canonicalJson(generateScene('oblique', 9002, 'held_out')));
    const scenes = scenesFor(m);
    expect(new Set(scenes.map(s => s.sceneId)).size).toBe(scenes.length);
    expect(scenes.filter(s => s.split === 'tuning').length).toBe(12);
    expect(scenes.filter(s => s.split === 'held_out').length).toBe(28);
  });

  it('F scene export mismatch: tampered content or digest is rejected; a faithful export round-trips', () => {
    const scene = scenesFor(m)[0]!;
    const good = exportScene(scene, sha256);
    expect(canonicalJson(importScene(good, m, sha256))).toBe(canonicalJson(scene));
    const moved = { ...good, json: good.json.replace(/"seed":\d+/, '"seed":999') };
    expect(() => importScene(moved, m, sha256)).toThrow(/geometry digest does not match/);
    // Re-digested but no longer what the manifest generates: still rejected.
    const forged = JSON.parse(good.json) as SceneSpec; forged.cable = forged.cable && { ...forged.cable, startM: [forged.cable.startM[0], 0.9, forged.cable.startM[2]] };
    const forgedJson = canonicalJson(forged);
    expect(() => importScene({ sceneId: good.sceneId, json: forgedJson, geometryDigest: sha256(forgedJson) }, m, sha256)).toThrow(/differs from the manifest-generated scene/);
  });
});

describe('M3 independent oracle and failure matrix', () => {
  it('closed-form control: the dense oracle reproduces fx*D/w - r - D/2 for a level perpendicular cable', () => {
    for (const r of [160, 320, 640]) for (const w of [0.5, 1, 2]) for (const dmm of [4, 8, 16]) {
      const scenario = buildScenario(perpendicular(), dmm / 1000), sensor = sensorOf(r, w);
      const o = oracleForScenario(scenario, sensor, tol)!;
      const closed = closedFormPerpendicularRangeM(dmm / 1000, sensor, scenario.platform);
      // Clipped by the route start when the threshold range exceeds the cable depth.
      const expected = Math.min(closed, o.contactS!);
      if (expected < 0) {
        // The object remains unresolved until after capsule contact.
        expect(o.rangeFullM).toBeNull();
      } else {
        expect(o.rangeFullM!).toBeCloseTo(expected, 3);
      }
    }
  });

  it('F no obstacle: a null scene has no cable, no encounter and no stop', async () => {
    const rec = await runCell(m, generateScene('null', 101, 'tuning'), 8, 160, 1);
    expect(rec.oracle).toBeNull();
    expect(rec.agreement).toBe('no_cable');
    expect(rec.evaluator.stopEvents).toBe(0);
    expect(rec.evaluator.termination).toBe('completed');
  });

  it('off-route cable is never encountered by either side', async () => {
    const rec = await runCell(m, generateScene('off_route', 9001, 'held_out'), 16, 320, 1);
    expect(rec.oracle!.verdict).toBe('not_encountered');
    expect(rec.agreement).toBe('not_encountered_agree');
  });

  it('F fully occluded obstacle: attributed to occlusion, not to the sensor or the algorithm', async () => {
    const rec = await runCell(m, generateScene('full_occlusion', 101, 'tuning'), 32, 640, 0.5);
    expect(rec.oracle!.rangeNoOcclusionM!).toBeGreaterThan(rec.oracle!.requiredM + tol);
    expect(rec.oracle!.verdict).toBe('limited');
    expect(rec.oracle!.limit).toBe('occlusion');
    expect(rec.evaluator.status).not.toBe('detected_in_time');
    expect(rec.agreement).toBe('agree_limited');
  });

  it('thin cable at low resolution is a sensor-resolution limit, thick cable is in time', async () => {
    const thin = await runCell(m, perpendicular(), 4, 160, 1);
    expect(thin.oracle!.limit).toBe('sensor_resolution');
    expect(thin.agreement).toBe('agree_limited');
    const thick = await runCell(m, perpendicular(), 32, 160, 1);
    expect(thick.agreement).toBe('agree_in_time');
  });

  it('F threshold boundary: a diameter placed exactly on the stopping boundary is classed boundary and excluded from both rates', () => {
    const sensor = sensorOf(160, 1), platform = buildScenario(perpendicular(), 0.01).platform;
    const dBoundary = closedFormMinDiameterM(sensor, platform);
    const o = oracleForScenario(buildScenario(perpendicular(), dBoundary), sensor, tol)!;
    expect(Math.abs(o.rangeFullM! - requiredStoppingM(platform))).toBeLessThan(1e-3);
    expect(o.verdict).toBe('boundary');
    expect(compareWithEvaluator(o, 'detected_in_time')).toBe('boundary_excluded');
    expect(compareWithEvaluator(o, 'late')).toBe('boundary_excluded');
    // Just outside the band on each side the verdict is decided.
    const fx = sensor.widthPx / 2, step = (2 * tol) / (fx - 0.5);
    expect(oracleForScenario(buildScenario(perpendicular(), dBoundary + step), sensor, tol)!.verdict).toBe('in_time');
    expect(oracleForScenario(buildScenario(perpendicular(), dBoundary - step), sensor, tol)!.verdict).toBe('limited');
  });

  it('numerical convergence: oracle range changes < 1 mm from 501 to 8001 cable points on an oblique scene', () => {
    const scenario = buildScenario(generateScene('oblique', 9003, 'held_out'), 0.008), sensor = sensorOf(320, 1);
    const ranges = [501, 2001, 8001].map(t => oracleForScenario(scenario, sensor, tol, { tSamples: t })!.rangeFullM!);
    expect(Math.abs(ranges[0]! - ranges[2]!)).toBeLessThan(1e-3);
    expect(Math.abs(ranges[1]! - ranges[2]!)).toBeLessThan(Math.abs(ranges[0]! - ranges[2]!) + 1e-6);
  });

  it('Wilson interval is bounded and degenerates honestly', () => {
    expect(wilson(0, 0).rate).toBeNull();
    const w = wilson(0, 104);
    expect(w.rate).toBe(0); expect(w.lo).toBeCloseTo(0, 12); expect(w.hi!).toBeGreaterThan(0.03); expect(w.hi!).toBeLessThan(0.04);
  });

  it('calibration residuals: intrinsic round trip is sub-micropixel and corrections compose to the final factor', () => {
    const c = calibrationResiduals(m);
    for (const row of c.intrinsics) { expect(row.points).toBeGreaterThan(500); expect(row.maxReprojectionResidualPx).toBeLessThan(1e-6); }
    expect(c.worldScale.residualM).toBeLessThan(1e-12);
  });
});

/**
 * SampleSensor conformance. `EvaluationOptions.sample` is the engine's existing swappable sensor
 * seam (analytic sampler in Node, GPU DepthSensor in the browser). Every adapter must satisfy the
 * same oracle guarantees; the two broken adapters are negative controls proving the suite can fail.
 */
type Adapter = (scene: SceneSpec, config: SensorConfig) => SampleSensor;
/** The production analytic sampler, passed explicitly through the swappable `sample` seam. */
const productionAnalytic = (dmm: number): Adapter => (scene, config) => analyticSampler(buildScenario(scene, dmm / 1000), config.sensors[0]!);
const conformanceCells: [SceneSpec, number, number, number][] = [
  [perpendicular(), 4, 160, 1], [perpendicular(), 16, 160, 1], [perpendicular(0.6), 8, 640, 0.5],
  [generateScene('full_occlusion', 101, 'tuning'), 32, 640, 0.5], [generateScene('oblique', 9001, 'held_out'), 16, 320, 1],
  [generateScene('partial_occlusion', 9002, 'held_out'), 16, 640, 1],
];
async function conformance(adapterFor: (diameterMm: number) => Adapter | undefined) {
  const out = [];
  for (const [scene, dmm, r, w] of conformanceCells) {
    const adapter = adapterFor(dmm);
    out.push(await runCell(m, scene, dmm, r, w, adapter ? { sample: (sc, cfg) => { const a = adapter(sc, cfg); return a; } } : {}));
  }
  return summarize(out);
}

describe('SampleSensor conformance suite', () => {
  it('production analytic sampler through the sample seam: no algorithmic misses, no false alerts, identical to the built-in default', async () => {
    const s = await conformance(productionAnalytic);
    expect(s.algorithmicMiss.k).toBe(0); expect(s.falseAlert.k).toBe(0);
    expect(s.oracleInTime).toBeGreaterThan(0); expect(s.oracleLimited).toBeGreaterThan(0);
    expect(s).toEqual(await conformance(() => undefined));
  });

  it('negative control: a sampler that ignores the width threshold is caught as false alerts', async () => {
    const s = await conformance(dmm => (scene, config) => {
      const scenario = buildScenario(scene, dmm / 1000);
      return analyticSampler(scenario, { ...config.sensors[0]!, minResolvableWidthPx: 1e-9 });
    });
    expect(s.falseAlert.k).toBeGreaterThan(0);
  });

  it('negative control: a sampler that returns no points is caught as algorithmic misses', async () => {
    const s = await conformance(() => () => () => ({ points: [], candidates: [], unknown: [], method: 'analytic_with_occlusion' }));
    expect(s.algorithmicMiss.k).toBeGreaterThan(0);
  });

  it('F identical seed/version, different result: injected nondeterminism is detected by the repeatability check', async () => {
    const scene = perpendicular();
    const run = (o = {}) => runCell(m, scene, 16, 160, 1, o).then(r => deterministicRecords([r]));
    expect(await run()).toBe(await run());
    let dropAll = false;
    const flaky = { sample: (sc: SceneSpec, cfg: SensorConfig) => {
      const base = analyticSampler(buildScenario(sc, 0.016), cfg.sensors[0]!);
      return (pose: Parameters<SampleSensor>[0]) => dropAll
        ? { points: [], candidates: [], unknown: [], method: 'analytic_with_occlusion' as const }
        : base(pose);
    } };
    const a = await run(flaky); dropAll = true; const b = await run(flaky);
    expect(a).not.toBe(b);
  });

});

describe('evaluator sanity on the canonical scene', () => {
  it('evaluate on a study scenario completes and reports the frozen engine version', async () => {
    const res = await evaluate(buildScenario(perpendicular(), 0.016), buildSensorConfig(m, 160, 1), { completedAt: '2026-10-15T00:00:00.000Z' });
    expect(res.run.engineVersion).toBe(m.versions.engine);
  });
});

describe('reactive controller miss decomposition (finding retained, not fixed)', () => {
  // Held-out oblique scene where the diagnostic pass and the oracle both say "visible in time"
  // yet the reactive controller still contacts the cable. Pinned so a controller change shows up.
  it('braking starts with less room than the corridor; the shortfall exceeds the clearance margin', async () => {
    const d = await diagnoseReactive(m, generateScene('oblique', 9004, 'held_out'), 32, 320, 1);
    expect(d.braked).toBe(true);
    expect(d.termination).toBe('collision');
    expect(d.estimatedGapM!).toBeGreaterThan(d.trueGapM!); // controller overestimates room left
    expect(d.estimatedGapM!).toBeLessThanOrEqual(d.corridorM!); // trigger fired below the corridor
    expect(d.shortfallM!).toBeGreaterThan(d.marginM); // so the margin cannot absorb it
    const cell = await runCell(m, generateScene('oblique', 9004, 'held_out'), 32, 320, 1);
    expect(cell.agreement).toBe('agree_in_time');
    expect(cell.reactiveMiss).toBe(true);
  });
});
