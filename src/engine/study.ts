/**
 * Factorial sensor-simulation study: runs the production evaluator over every manifest cell and
 * scores each cable finding against the independent continuous oracle, so misses can be split
 * into geometric visibility limits (field of view, occlusion), sensor limits (projected width)
 * and algorithmic misses (the evaluator failing to see what its own model says is visible).
 * Simulation only. Nothing here is a physical sensor or safety measurement.
 */
import type { SensorConfig, World } from '../../shared/contracts';
import { evaluate, type EvaluationOptions } from './evaluate';
import { confirmWorldCalibration } from './calibration';
import { analyticSampler, backProject, obstacleClearance, project } from './sensor';
import {
  buildScenario, buildSensorConfig, canonicalJson, diameterMmToM, scenesFor, validateManifest,
  type ExperimentManifest, type SceneSpec,
} from './experiment-manifest';
import {
  closedFormMinDiameterM, compareWithEvaluator, oracleForScenario, requiredStoppingM,
  type Agreement, type CableOracleResult,
} from './visibility-oracle';

export interface CellRecord {
  sceneId: string; split: SceneSpec['split']; family: SceneSpec['family']; seed: number;
  diameterMm: number; resolutionPx: number; minResolvableWidthPx: number;
  evaluator: { status: string | null; firstDetectionRangeM: number | null; termination: string; collisionHazardId: string | null; stopEvents: number; falseStopEvents: number };
  oracle: CableOracleResult | null;
  agreement: Agreement | 'no_cable';
  /** Positive when the evaluator first detects later than the continuous oracle. */
  rangeLagM: number | null;
  reactiveMiss: boolean;
  runtimeMs: number;
}

export interface StudyOptions {
  splits?: readonly SceneSpec['split'][];
  sample?: (scene: SceneSpec, config: SensorConfig) => EvaluationOptions['sample'] | undefined;
  oracle?: { tSamples?: number; sStepM?: number };
  now?: () => number;
}

const FIXED_TIME = '2026-10-15T00:00:00.000Z';

export async function runCell(m: ExperimentManifest, scene: SceneSpec, diameterMm: number, resolutionPx: number, minResolvableWidthPx: number, o: StudyOptions = {}): Promise<CellRecord> {
  const now = o.now ?? (() => performance.now());
  const scenario = buildScenario(scene, diameterMmToM(diameterMm));
  const config = buildSensorConfig(m, resolutionPx, minResolvableWidthPx);
  const sensor = config.sensors[0]!;
  const started = now();
  const sample = o.sample?.(scene, config);
  const result = await evaluate(scenario, config, { runId: `${scenario.id}-${config.id}`, completedAt: FIXED_TIME, ...(sample ? { sample } : {}) });
  const runtimeMs = now() - started;
  const finding = result.run.findings.find(f => f.hazardId === 'cable') ?? null;
  const oracle = oracleForScenario(scenario, sensor, m.boundaryToleranceM, o.oracle);
  const collision = result.run.events.find(e => e.kind === 'collision');
  const collisionHazardId = collision?.hazardId ?? null;
  const agreement = oracle && finding ? compareWithEvaluator(oracle, finding.status) : 'no_cable';
  // A reactive miss: the oracle says the cable was visible in time, nothing else is encountered
  // first on the route, and the reactive controller still drove into the cable.
  const boxFirst = result.run.findings.some(f => f.hazardId !== 'cable' && f.status !== 'excluded');
  const reactiveMiss = !!oracle && oracle.verdict === 'in_time' && !boxFirst && collisionHazardId === 'cable';
  return {
    sceneId: scene.sceneId, split: scene.split, family: scene.family, seed: scene.seed, diameterMm, resolutionPx, minResolvableWidthPx,
    evaluator: { status: finding?.status ?? null, firstDetectionRangeM: finding?.firstDetectionRangeM ?? null, termination: result.run.outcome.termination, collisionHazardId,
      stopEvents: result.run.outcome.stopEvents ?? 0, falseStopEvents: result.run.outcome.falseStopEvents ?? 0 },
    oracle, agreement,
    rangeLagM: oracle?.rangeFullM != null && finding?.firstDetectionRangeM != null ? oracle.rangeFullM - finding.firstDetectionRangeM : null,
    reactiveMiss, runtimeMs,
  };
}

export async function runStudy(manifest: ExperimentManifest, o: StudyOptions = {}): Promise<CellRecord[]> {
  const m = validateManifest(manifest);
  const splits = o.splits ?? ['tuning', 'held_out'];
  const records: CellRecord[] = [];
  for (const scene of scenesFor(m).filter(s => splits.includes(s.split)))
    for (const d of m.factors.cableDiametersMm) for (const r of m.factors.resolutionsPx) for (const w of m.factors.minResolvableWidthsPx)
      records.push(await runCell(m, scene, d, r, w, o));
  return records;
}

/** Records without timing, canonicalised: identical inputs must give an identical string. */
export const deterministicRecords = (records: readonly CellRecord[]) => canonicalJson(records.map(({ runtimeMs: _runtime, ...rest }) => rest));

/** Wilson score interval (95%) for k successes out of n. */
export function wilson(k: number, n: number, z = 1.959964): { rate: number | null; lo: number | null; hi: number | null } {
  if (!n) return { rate: null, lo: null, hi: null };
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), e = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { rate: p, lo: (c - e) / d, hi: (c + e) / d };
}

const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]!; };

export interface SplitSummary {
  cells: number;
  agreement: Record<string, number>;
  oracleInTime: number; oracleLimited: number; boundary: number;
  algorithmicMiss: ReturnType<typeof wilson> & { k: number; n: number };
  falseAlert: ReturnType<typeof wilson> & { k: number; n: number };
  limitFactors: Record<string, number>;
  rangeLagM: { n: number; min: number | null; median: number | null; p95: number | null; max: number | null };
  reactive: { reactiveMisses: number; nullSceneCells: number; nullSceneStops: number; collisionsWithCable: number };
  byFamily: Record<string, Record<string, number>>;
  sceneLevel: {
    distinctScenes: number;
    anyMiss: ReturnType<typeof wilson> & { k: number; n: number };
    anyFalseAlert: ReturnType<typeof wilson> & { k: number; n: number };
    interpretation: string;
  };
  cellIntervalBoundary: string;
}

export function summarize(records: readonly CellRecord[]): SplitSummary {
  const count = (pred: (r: CellRecord) => boolean) => records.filter(pred).length;
  const agreement: Record<string, number> = {};
  const limitFactors: Record<string, number> = {};
  const byFamily: Record<string, Record<string, number>> = {};
  for (const r of records) {
    agreement[r.agreement] = (agreement[r.agreement] ?? 0) + 1;
    (byFamily[r.family] ??= {})[r.agreement] = (byFamily[r.family]![r.agreement] ?? 0) + 1;
    if (r.oracle && r.oracle.verdict !== 'in_time' && r.oracle.verdict !== 'not_encountered') limitFactors[r.oracle.limit] = (limitFactors[r.oracle.limit] ?? 0) + 1;
  }
  const inTime = count(r => r.oracle?.verdict === 'in_time'), limited = count(r => r.oracle?.verdict === 'limited');
  const misses = count(r => r.agreement === 'algorithmic_miss'), falseAlerts = count(r => r.agreement === 'false_alert');
  const lags = records.flatMap(r => r.rangeLagM === null ? [] : [r.rangeLagM]);
  const nullCells = records.filter(r => r.family === 'null');
  const groups = [...new Set(records.map(r => r.sceneId))].map(id => records.filter(r => r.sceneId === id));
  const missEligible = groups.filter(rs => rs.some(r => r.oracle?.verdict === 'in_time'));
  const alertEligible = groups.filter(rs => rs.some(r => r.oracle?.verdict === 'limited'));
  const missedScenes = missEligible.filter(rs => rs.some(r => r.agreement === 'algorithmic_miss')).length;
  const alertScenes = alertEligible.filter(rs => rs.some(r => r.agreement === 'false_alert')).length;
  return {
    cells: records.length, agreement, oracleInTime: inTime, oracleLimited: limited, boundary: count(r => r.oracle?.verdict === 'boundary'),
    algorithmicMiss: { k: misses, n: inTime, ...wilson(misses, inTime) },
    falseAlert: { k: falseAlerts, n: limited, ...wilson(falseAlerts, limited) },
    limitFactors,
    rangeLagM: { n: lags.length, min: lags.length ? Math.min(...lags) : null, median: quantile(lags, 0.5), p95: quantile(lags, 0.95), max: lags.length ? Math.max(...lags) : null },
    reactive: { reactiveMisses: count(r => r.reactiveMiss), nullSceneCells: nullCells.length, nullSceneStops: nullCells.filter(r => r.evaluator.stopEvents > 0).length, collisionsWithCable: count(r => r.evaluator.collisionHazardId === 'cable') },
    byFamily,
    cellIntervalBoundary: 'Cell Wilson intervals are descriptive IID reference only; repeated factor cells on the same scene are correlated. Use scene-level counts and retain the finite synthetic-scene scope.',
    sceneLevel: {
      distinctScenes: groups.length,
      anyMiss: { k: missedScenes, n: missEligible.length, ...wilson(missedScenes, missEligible.length) },
      anyFalseAlert: { k: alertScenes, n: alertEligible.length, ...wilson(alertScenes, alertEligible.length) },
      interpretation: 'One family/seed geometry is one unit. Scene-level intervals are conditional on this synthetic generator and selected families; four held-out seeds per family do not establish real-world risk.',
    },
  };
}

/** Detection-in-time surface over (diameter, resolution, threshold), oracle versus evaluator, encountered cables only. */
export function robustnessSurface(records: readonly CellRecord[]) {
  const cells = new Map<string, { diameterMm: number; resolutionPx: number; minResolvableWidthPx: number; n: number; oracleInTime: number; evaluatorInTime: number }>();
  for (const r of records) {
    if (!r.oracle || r.oracle.verdict === 'not_encountered') continue;
    const key = `${r.diameterMm}|${r.resolutionPx}|${r.minResolvableWidthPx}`;
    const c = cells.get(key) ?? { diameterMm: r.diameterMm, resolutionPx: r.resolutionPx, minResolvableWidthPx: r.minResolvableWidthPx, n: 0, oracleInTime: 0, evaluatorInTime: 0 };
    c.n++; if (r.oracle.verdict === 'in_time') c.oracleInTime++; if (r.evaluator.status === 'detected_in_time') c.evaluatorInTime++;
    cells.set(key, c);
  }
  return [...cells.values()];
}

/** Disparity (px) of a target at depth z: f*B/z. Reported per baseline; baseline is not part of the detection model. */
export function disparityTable(m: ExperimentManifest) {
  const rows = [];
  for (const r of m.factors.resolutionsPx) for (const w of m.factors.minResolvableWidthsPx) for (const dmm of m.factors.cableDiametersMm) {
    const sensor = buildSensorConfig(m, r, w).sensors[0]!;
    const fx = sensor.widthPx / (2 * Math.tan(sensor.horizontalFovRad / 2));
    const thresholdRangeM = fx * diameterMmToM(dmm) / w;
    for (const bmm of m.factors.stereoBaselinesMm)
      rows.push({ resolutionPx: r, minResolvableWidthPx: w, diameterMm: dmm, baselineMm: bmm, thresholdRangeM, disparityAtThresholdPx: fx * (bmm / 1000) / Math.min(thresholdRangeM, sensor.farM) });
  }
  return rows;
}

/**
 * Minimum in-time diameter on the canonical perpendicular control scene: closed form versus the
 * evaluator itself (bisection over diameter, 14 halvings between 0.5 mm and 100 mm).
 */
export async function minimumResolvableDiameters(m: ExperimentManifest) {
  const scene: SceneSpec = { sceneId: 'control-perpendicular', split: 'tuning', family: 'perpendicular', seed: 0, cable: { startM: [-1.2, 0.35, -6], endM: [1.2, 0.35, -6] }, boxes: [] };
  const rows = [];
  for (const r of m.factors.resolutionsPx) for (const w of m.factors.minResolvableWidthsPx) {
    const config = buildSensorConfig(m, r, w);
    const inTime = async (mm: number) => {
      const res = await evaluate(buildScenario(scene, mm / 1000), config, { completedAt: FIXED_TIME });
      return res.run.findings.find(f => f.hazardId === 'cable')!.status === 'detected_in_time';
    };
    let lo = 0.5, hi = 100;
    if (await inTime(lo)) { rows.push({ resolutionPx: r, minResolvableWidthPx: w, closedFormMm: closedFormMinDiameterM(config.sensors[0]!, buildScenario(scene, 0.01).platform) * 1000, evaluatorMm: lo, bracketMm: [lo, lo] }); continue; }
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (await inTime(mid)) hi = mid; else lo = mid; }
    rows.push({ resolutionPx: r, minResolvableWidthPx: w, closedFormMm: closedFormMinDiameterM(config.sensors[0]!, buildScenario(scene, 0.01).platform) * 1000, evaluatorMm: hi, bracketMm: [lo, hi] });
  }
  return { requiredStoppingM: requiredStoppingM(buildScenario(scene, 0.01).platform), rows };
}

/**
 * Calibration residuals of the simulated pipeline (not of any physical camera):
 * - intrinsics: pixel -> backProject -> project round trip over a grid of pixels and depths;
 * - world scale: two successive operator corrections must compose to the final factor, measured
 *   on a 1 m ruler transformed by the resulting splat matrix.
 */
export function calibrationResiduals(m: ExperimentManifest) {
  const intrinsics = m.factors.resolutionsPx.map(r => {
    const s = buildSensorConfig(m, r, 1).sensors[0]!;
    let maxPx = 0, points = 0;
    for (let u = 0.5; u < s.widthPx; u += s.widthPx / 16) for (let v = 0.5; v < s.heightPx; v += s.heightPx / 12) for (const d of [0.1, 1, 5, 11.9]) {
      const p = backProject(u, v, d, s); if (!p) continue;
      const q = project(p, s); if (!q) throw new Error('Round trip left the image');
      maxPx = Math.max(maxPx, Math.abs(q.u - u), Math.abs(q.v - v)); points++;
    }
    return { resolutionPx: r, points, maxReprojectionResidualPx: maxPx };
  });
  const base = buildScenario({ sceneId: 'cal', split: 'tuning', family: 'null', seed: 0, cable: null, boxes: [] }, 0.01).world;
  const world: World = { ...base, calibration: { ...base.calibration, status: 'unverified' } };
  const steps = [1.07, 0.93];
  let w = world;
  for (const f of steps) w = confirmWorldCalibration(w, { worldId: w.id, referenceLabel: '1 m ruler', referenceLengthM: 1, evidence: 'assumed', correctionFactor: f }, true);
  const m4 = w.calibration.splatToWorld;
  const rulerM = Math.hypot(m4[0]!, m4[1]!, m4[2]!);
  return { intrinsics, worldScale: { corrections: steps, finalFactor: w.calibration.correctionFactor, rulerAfterM: rulerM, residualM: Math.abs(rulerM - steps[steps.length - 1]!) } };
}

/**
 * Decompose one reactive miss: at the controller's braking decision, compare the corridor, the
 * controller's own obstacle-gap estimate (recomputed from the same sensed cloud) and the true
 * distance to first contact from the independent oracle.
 *   overestimateM = estimate - truth (sparse cable samples / occupancy grid misjudge contact)
 *   triggerLagM   = corridor - estimate (sensing period and estimate discontinuities)
 *   shortfallM    = corridor - truth (room missing when braking starts; > margin means contact)
 */
export async function diagnoseReactive(m: ExperimentManifest, scene: SceneSpec, diameterMm: number, resolutionPx: number, minResolvableWidthPx: number) {
  const scenario = buildScenario(scene, diameterMmToM(diameterMm)), config = buildSensorConfig(m, resolutionPx, minResolvableWidthPx), sensor = config.sensors[0]!;
  const res = await evaluate(scenario, config, { completedAt: FIXED_TIME });
  const oracle = oracleForScenario(scenario, sensor, m.boundaryToleranceM);
  const b = res.brakingDecision;
  if (!b || !oracle || oracle.contactS === null) return { sceneId: scene.sceneId, diameterMm, resolutionPx, minResolvableWidthPx, braked: !!b, termination: res.run.outcome.termination, brakeS: null, trueGapM: null, estimatedGapM: null, corridorM: b?.corridorM ?? null, overestimateM: null, triggerLagM: null, shortfallM: null, marginM: scenario.platform.clearanceMarginM };
  const brakeS = -b.pose.positionM[2];
  const cloud = analyticSampler(scenario, sensor)(b.pose);
  const estimatedGapM = obstacleClearance(cloud.points, b.pose, scenario.platform.radiusM, scenario.platform.heightM);
  const trueGapM = oracle.contactS - brakeS;
  return {
    sceneId: scene.sceneId, diameterMm, resolutionPx, minResolvableWidthPx, braked: true, termination: res.run.outcome.termination, brakeS, trueGapM, estimatedGapM, corridorM: b.corridorM,
    overestimateM: estimatedGapM === null ? null : estimatedGapM - trueGapM, triggerLagM: estimatedGapM === null ? null : b.corridorM - estimatedGapM, shortfallM: b.corridorM - trueGapM, marginM: scenario.platform.clearanceMarginM,
  };
}
