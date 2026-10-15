/**
 * Independent continuous visibility oracle for study scenes.
 *
 * It deliberately imports nothing from sensor.ts, geometry.ts or math.ts: projection bounds,
 * the width threshold, box occlusion and robot contact are re-derived here in closed form per
 * cable point, over a dense parameterisation of the cable (default 2001 points) instead of the
 * evaluator's 25 samples and 25 mm route steps. It applies the SAME declared passive-stereo
 * approximation (pinhole projection, projected-width threshold, opaque boxes), so agreement
 * means the evaluator implements that model faithfully; it says nothing about real sensors.
 *
 * Scope: straight route from the origin along -z, identity mount orientation, axis-aligned
 * boxes. The study generator only produces such scenes; anything else is rejected.
 */
import type { Platform, Scenario, StereoSensor, Vec3 } from '../../shared/contracts';

export interface OracleOptions { tSamples?: number; sStepM?: number; useWidth?: boolean; useOcclusion?: boolean; useFov?: boolean }
interface Box { center: Vec3; half: Vec3 }
interface Cable { start: Vec3; end: Vec3; diameterM: number }

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Closed-form stopping corridor: reaction travel + braking travel + margin. */
export const requiredStoppingM = (p: Platform) => p.speedMps * p.controlLatencyS + (p.speedMps * p.speedMps) / (2 * p.brakingDecelerationMps2) + p.clearanceMarginM;

function checkScope(scenario: Scenario, sensor: StereoSensor) {
  const r = scenario.route;
  if (r.length !== 2 || r[0]!.positionM.some(v => v !== 0) || r[1]!.positionM[0] !== 0 || r[1]!.positionM[1] !== 0 || !(r[1]!.positionM[2] < 0)) throw new Error('Oracle scope: straight route from the origin along -z only');
  const q = sensor.mount.orientation;
  if (q[0] !== 0 || q[1] !== 0 || q[2] !== 0 || q[3] !== 1 || sensor.mount.positionM[0] !== 0 || sensor.mount.positionM[2] !== 0) throw new Error('Oracle scope: centred identity mount only');
  for (const h of scenario.hazards) if (h.geometry.kind === 'box') {
    const o = h.geometry.pose.orientation;
    if (o[0] !== 0 || o[1] !== 0 || o[2] !== 0 || o[3] !== 1) throw new Error('Oracle scope: axis-aligned boxes only');
  }
}

/** Segment from camera to point blocked by an axis-aligned box (slab method; inside counts as blocked). */
function segmentBlocked(from: Vec3, to: Vec3, box: Box): boolean {
  let enter = -Infinity, exit = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = to[i]! - from[i]!, lo = box.center[i]! - box.half[i]!, hi = box.center[i]! + box.half[i]!;
    if (Math.abs(d) < 1e-12) { if (from[i]! < lo || from[i]! > hi) return false; continue; }
    const a = (lo - from[i]!) / d, b = (hi - from[i]!) / d;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (enter > exit || exit < 0) return false;
  return Math.max(enter, 0) < 1 - 1e-5;
}

/** Earliest route position s (m) at which the robot capsule touches the cable; null if never on this route. */
export function contactS(cable: Cable, p: Platform, routeLengthM: number, tSamples = 2001): number | null {
  if (!Number.isInteger(tSamples) || tSamples < 2) throw new Error('Oracle samples must be an integer >= 2');
  const reach = p.radiusM + cable.diameterM / 2, lo = p.radiusM, hi = Math.max(p.radiusM, p.heightM - p.radiusM);
  let best = Infinity;
  for (let i = 0; i < tSamples; i++) {
    const [x, y, z] = lerp3(cable.start, cable.end, i / (tSamples - 1));
    const dy = Math.max(0, lo - y, y - hi), q = reach * reach - x * x - dy * dy;
    if (q < 0) continue;
    const sFirst = -z - Math.sqrt(q), sLast = -z + Math.sqrt(q);
    if (sLast < 0 || sFirst > routeLengthM) continue;
    best = Math.min(best, Math.max(0, sFirst));
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Earliest s in [0, sLimit] at which ANY cable point is visible under the declared model.
 * Each constraint can be switched off to attribute a miss to field of view, resolution or occlusion.
 */
export function earliestVisibleS(cable: Cable, sensor: StereoSensor, boxes: readonly Box[], sLimit: number, o: OracleOptions = {}): number | null {
  const tSamples = o.tSamples ?? 2001, sStep = o.sStepM ?? 0.001, useWidth = o.useWidth ?? true, useOcc = o.useOcclusion ?? true, useFov = o.useFov ?? true;
  if (!Number.isInteger(tSamples) || tSamples < 2) throw new Error('Oracle samples must be an integer >= 2');
  if (!Number.isFinite(sStep) || sStep <= 0) throw new Error('Oracle step must be finite and positive');
  const fx = sensor.widthPx / (2 * Math.tan(sensor.horizontalFovRad / 2));
  const tanH = Math.tan(sensor.horizontalFovRad / 2), tanV = sensor.heightPx / (2 * fx), mh = sensor.mount.positionM[1];
  const widthRange = fx * cable.diameterM / sensor.minResolvableWidthPx;
  const eps = 1e-9;
  let best = Infinity;
  for (let i = 0; i < tSamples; i++) {
    const point = lerp3(cable.start, cable.end, i / (tSamples - 1)), [x, y, z] = point, yp = y - mh;
    // u in [0, W) and v in [0, H) translate to these inclusive/exclusive depth bounds.
    let dMin = sensor.nearM, dMax = sensor.farM;
    if (useFov) {
      dMin = Math.max(dMin, x > 0 ? x / tanH + eps : -x / tanH, yp < 0 ? -yp / tanV + eps : yp / tanV);
    }
    if (useWidth) dMax = Math.min(dMax, widthRange);
    if (dMin > dMax) continue;
    const sLo = Math.max(0, -z - dMax), sHi = Math.min(sLimit, -z - dMin);
    if (sLo > sHi || sLo >= best) continue;
    if (!useOcc || !boxes.length) { best = Math.min(best, sLo); continue; }
    for (let s = sLo; s <= Math.min(sHi, best); s += sStep) {
      const cam: Vec3 = [0, mh, -s];
      if (!boxes.some(b => segmentBlocked(cam, point, b))) { best = Math.min(best, s); break; }
    }
  }
  return Number.isFinite(best) ? best : null;
}

export type OracleVerdict = 'not_encountered' | 'in_time' | 'boundary' | 'limited';
export type LimitFactor = 'none' | 'field_of_view' | 'sensor_resolution' | 'occlusion' | 'resolution_and_occlusion';

export interface CableOracleResult {
  contactS: number | null;
  requiredM: number;
  rangeFullM: number | null;
  rangeNoWidthM: number | null;
  rangeNoOcclusionM: number | null;
  rangeFovOnlyM: number | null;
  verdict: OracleVerdict;
  limit: LimitFactor;
}

/** Score the cable hazard of a study scenario. Returns null when the scenario has no cable. */
export function oracleForScenario(scenario: Scenario, sensor: StereoSensor, toleranceM: number, o: OracleOptions = {}): CableOracleResult | null {
  checkScope(scenario, sensor);
  const h = scenario.hazards.find(x => x.geometry.kind === 'cable');
  if (!h || h.geometry.kind !== 'cable') return null;
  const cable: Cable = { start: h.geometry.startM, end: h.geometry.endM, diameterM: h.geometry.diameterM };
  const boxes: Box[] = scenario.hazards.flatMap(x => x.geometry.kind === 'box' ? [{ center: x.geometry.pose.positionM, half: [x.geometry.dimensionsM[0] / 2, x.geometry.dimensionsM[1] / 2, x.geometry.dimensionsM[2] / 2] as Vec3 }] : []);
  const total = -scenario.route[1]!.positionM[2];
  const requiredM = requiredStoppingM(scenario.platform);
  const c = contactS(cable, scenario.platform, total, o.tSamples);
  if (c === null) return { contactS: null, requiredM, rangeFullM: null, rangeNoWidthM: null, rangeNoOcclusionM: null, rangeFovOnlyM: null, verdict: 'not_encountered', limit: 'none' };
  const range = (opts: OracleOptions) => { const s = earliestVisibleS(cable, sensor, boxes, c, { ...o, ...opts }); return s === null ? null : c - s; };
  const rangeFullM = range({}), rangeNoWidthM = range({ useWidth: false }), rangeNoOcclusionM = range({ useOcclusion: false }), rangeFovOnlyM = range({ useWidth: false, useOcclusion: false });
  const ok = (r: number | null) => r !== null && r >= requiredM - toleranceM;
  let verdict: OracleVerdict;
  if (rangeFullM !== null && rangeFullM >= requiredM + toleranceM) verdict = 'in_time';
  else if (rangeFullM !== null && Math.abs(rangeFullM - requiredM) < toleranceM) verdict = 'boundary';
  else verdict = 'limited';
  let limit: LimitFactor = 'none';
  if (verdict !== 'in_time') {
    if (!ok(rangeFovOnlyM)) limit = 'field_of_view';
    else if (!ok(rangeNoOcclusionM) && ok(rangeNoWidthM)) limit = 'sensor_resolution';
    else if (ok(rangeNoOcclusionM) && !ok(rangeNoWidthM)) limit = 'occlusion';
    else limit = 'resolution_and_occlusion';
  }
  return { contactS: c, requiredM, rangeFullM, rangeNoWidthM, rangeNoOcclusionM, rangeFovOnlyM, verdict, limit };
}

/** Closed-form control: level cable square across the route, at a height inside the capsule's straight section, spanning x=0. */
export function closedFormPerpendicularRangeM(diameterM: number, sensor: StereoSensor, p: Platform): number {
  const fx = sensor.widthPx / (2 * Math.tan(sensor.horizontalFovRad / 2));
  return Math.min(sensor.farM, fx * diameterM / sensor.minResolvableWidthPx) - p.radiusM - diameterM / 2;
}

/** Smallest cable diameter detectable in time on that closed-form control: solves fx*D/w - r - D/2 = required. */
export function closedFormMinDiameterM(sensor: StereoSensor, p: Platform): number {
  const fx = sensor.widthPx / (2 * Math.tan(sensor.horizontalFovRad / 2));
  return (requiredStoppingM(p) + p.radiusM) / (fx / sensor.minResolvableWidthPx - 0.5);
}

export type Agreement = 'agree_in_time' | 'agree_limited' | 'algorithmic_miss' | 'false_alert' | 'boundary_excluded' | 'not_encountered_agree' | 'encounter_mismatch';

/** Compare one evaluator finding with the oracle. Boundary cases are excluded from both error rates. */
export function compareWithEvaluator(oracle: CableOracleResult, evaluatorStatus: string): Agreement {
  const evaluatorInTime = evaluatorStatus === 'detected_in_time';
  if (oracle.verdict === 'not_encountered') return evaluatorStatus === 'excluded' ? 'not_encountered_agree' : 'encounter_mismatch';
  if (evaluatorStatus === 'excluded') return 'encounter_mismatch';
  if (oracle.verdict === 'boundary') return 'boundary_excluded';
  if (oracle.verdict === 'in_time') return evaluatorInTime ? 'agree_in_time' : 'algorithmic_miss';
  return evaluatorInTime ? 'false_alert' : 'agree_limited';
}
