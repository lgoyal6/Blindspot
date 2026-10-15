/**
 * Versioned scene inputs shared by study.ts and scripts/evaluate-matrix.ts.
 *
 * A manifest freezes the engine, sensor model, oracle and scene-generator versions, the
 * width-based detection grid (diameter, resolution, threshold), a separately reported stereo-baseline disparity diagnostic, the
 * seeds and the tuning / held-out scene split before anything is run. Every scene is generated
 * deterministically from (family, seed), so a manifest plus its hash is enough to rebuild the
 * exact inputs. Everything here is SIMULATION input; nothing is a hardware measurement.
 */
import type { HazardInstance, HazardLibraryItem, Scenario, SensorConfig, Vec3, World } from '../../shared/contracts';
import { ENGINE_VERSION, createSensorConfig } from './presets';
import { MINT_PLATFORM_ASSET } from './scenario';

export const MANIFEST_SCHEMA_VERSION = 'blindspot-study-manifest-1';
export const SCENE_GENERATOR_VERSION = 'scene-gen-1';
export const ORACLE_VERSION = 'continuous-visibility-oracle-1';

export type SceneFamily =
  | 'perpendicular' // level cable square across the route
  | 'oblique' // level cable crossing the route at a yaw angle
  | 'elevated' // perpendicular cable near the top or bottom of the robot envelope
  | 'full_occlusion' // opaque box on the route directly in front of the cable
  | 'partial_occlusion' // opaque box beside the route shadowing part of an oblique cable
  | 'null' // no hazards at all: negative control
  | 'off_route'; // cable parallel to and beside the route: never encountered

export const SCENE_FAMILIES: readonly SceneFamily[] = ['perpendicular', 'oblique', 'elevated', 'full_occlusion', 'partial_occlusion', 'null', 'off_route'];

export interface SplitSpec { families: readonly SceneFamily[]; seeds: readonly number[] }

export interface ExperimentManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  studyId: string;
  versions: { engine: string; sensorModel: string; oracle: string; sceneGenerator: string };
  /** Explicit units. Diameters and baselines in millimetres, converted once with range guards. */
  factors: {
    cableDiametersMm: readonly number[];
    stereoBaselinesMm: readonly number[];
    resolutionsPx: readonly number[];
    minResolvableWidthsPx: readonly number[];
  };
  /** Fixed for every arm. Only the factors above vary. */
  fixed: { horizontalFovRad: number; aspect: number; nearM: number; farM: number; mountHeightM: number };
  /** Boundary band (m) frozen before results: the evaluator's diagnostic route step. */
  boundaryToleranceM: number;
  tuning: SplitSpec;
  heldOut: SplitSpec;
}

/** The locked study used for the M4 run. Changing any value changes the manifest hash. */
export const DEFAULT_MANIFEST: ExperimentManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  studyId: 'h9-thin-cable-visibility-v1',
  versions: { engine: ENGINE_VERSION, sensorModel: 'passive-stereo-1', oracle: ORACLE_VERSION, sceneGenerator: SCENE_GENERATOR_VERSION },
  factors: {
    cableDiametersMm: [4, 8, 16, 32],
    stereoBaselinesMm: [60, 120],
    resolutionsPx: [160, 320, 640],
    minResolvableWidthsPx: [0.5, 1, 2],
  },
  fixed: { horizontalFovRad: Math.PI / 2, aspect: 0.75, nearM: 0.05, farM: 12, mountHeightM: 0.35 },
  boundaryToleranceM: 0.025,
  tuning: { families: ['perpendicular', 'full_occlusion', 'null'], seeds: [101, 102, 103, 104] },
  heldOut: { families: ['perpendicular', 'oblique', 'elevated', 'full_occlusion', 'partial_occlusion', 'null', 'off_route'], seeds: [9001, 9002, 9003, 9004] },
};

const MIN_DIAMETER_MM = 0.5, MAX_DIAMETER_MM = 100;
const MIN_BASELINE_MM = 1, MAX_BASELINE_MM = 1000;

function positiveList(values: readonly number[], label: string, lo: number, hi: number, unit: string): number[] {
  if (!values.length) throw new Error(`${label} must not be empty`);
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be finite and positive (got ${v})`);
    if (v < lo || v > hi) throw new Error(`${label} value ${v} ${unit} is outside the plausible range [${lo}, ${hi}] ${unit}; check the unit`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
  return [...values].sort((a, b) => a - b);
}

/** Millimetres to metres, refusing values that only make sense in another unit. */
export function diameterMmToM(mm: number): number {
  positiveList([mm], 'cable diameter', MIN_DIAMETER_MM, MAX_DIAMETER_MM, 'mm');
  return mm / 1000;
}

/** Throws with a specific message on any invalid or inconsistent manifest. */
export function validateManifest(m: ExperimentManifest): ExperimentManifest {
  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error('Unsupported manifest schema');
  if (m.versions.engine !== ENGINE_VERSION) throw new Error(`Manifest engine ${m.versions.engine} does not match running engine ${ENGINE_VERSION}`);
  if (m.versions.oracle !== ORACLE_VERSION || m.versions.sceneGenerator !== SCENE_GENERATOR_VERSION) throw new Error('Manifest oracle or scene generator version does not match this build');
  if (m.versions.sensorModel !== createSensorConfig('baseline').modelVersion) throw new Error('Manifest sensor model does not match this build');
  positiveList(m.factors.cableDiametersMm, 'cableDiametersMm', MIN_DIAMETER_MM, MAX_DIAMETER_MM, 'mm');
  // A zero baseline has no disparity, so there is no stereo depth at all. Rejected, never scored.
  positiveList(m.factors.stereoBaselinesMm, 'stereoBaselinesMm', MIN_BASELINE_MM, MAX_BASELINE_MM, 'mm');
  positiveList(m.factors.resolutionsPx, 'resolutionsPx', 16, 640, 'px');
  for (const r of m.factors.resolutionsPx) if (!Number.isInteger(r)) throw new Error('resolutionsPx must be integers');
  positiveList(m.factors.minResolvableWidthsPx, 'minResolvableWidthsPx', 0.05, 50, 'px');
  const f = m.fixed;
  if (!(f.horizontalFovRad > 0 && f.horizontalFovRad < Math.PI) || !(f.aspect > 0 && f.aspect <= 1) || !(f.nearM > 0 && f.farM > f.nearM)) throw new Error('Invalid fixed sensor geometry');
  if (!(m.boundaryToleranceM > 0 && m.boundaryToleranceM < 0.5)) throw new Error('boundaryToleranceM must be in (0, 0.5) m');
  for (const split of [m.tuning, m.heldOut]) {
    if (!split.families.length || !split.seeds.length) throw new Error('Each split needs families and seeds');
    for (const fam of split.families) if (!SCENE_FAMILIES.includes(fam)) throw new Error(`Unknown scene family ${fam}`);
    if (new Set(split.families).size !== split.families.length || new Set(split.seeds).size !== split.seeds.length) throw new Error('Duplicate scene families or seeds within a split');
    // The generator truncates to 32 bits, so larger seeds can alias a tuning scene.
    for (const s of split.seeds) if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) throw new Error('Seeds must be unsigned 32-bit integers');
  }
  const overlap = m.tuning.seeds.filter(s => m.heldOut.seeds.includes(s));
  if (overlap.length) throw new Error(`Held-out seeds overlap tuning seeds: ${overlap.join(',')}`);
  return m;
}

/** Canonical JSON: sorted keys, no undefined. Same input always yields the same string. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number in canonical JSON');
  return JSON.stringify(value);
}

/** Deterministic PRNG (mulberry32). Seeded per scene so every scene is independently rebuildable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SceneSpec {
  sceneId: string;
  split: 'tuning' | 'held_out';
  family: SceneFamily;
  seed: number;
  /** Cable geometry in metres, before the diameter factor is applied. Null for scenes with no cable. */
  cable: { startM: Vec3; endM: Vec3 } | null;
  /** Opaque boxes (occluders or bulk controls). */
  boxes: { centerM: Vec3; sizeM: Vec3 }[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const familySalt = (f: SceneFamily) => SCENE_FAMILIES.indexOf(f) * 7919;

/** Pure function of (family, seed). Geometry is rounded to the millimetre so exports are stable. */
export function generateScene(family: SceneFamily, seed: number, split: SceneSpec['split']): SceneSpec {
  const rnd = mulberry32(seed * 31 + familySalt(family));
  const u = (lo: number, hi: number) => r3(lo + (hi - lo) * rnd());
  const zc = -u(3, 9); // cable crossing depth along the route (route runs from z=0 to z=-11)
  const half = 1.2;
  let cable: SceneSpec['cable'] = null;
  const boxes: SceneSpec['boxes'] = [];
  if (family === 'perpendicular') {
    const y = u(0.2, 0.5), xo = u(-0.3, 0.3);
    cable = { startM: [r3(xo - half), y, zc], endM: [r3(xo + half), y, zc] };
  } else if (family === 'oblique') {
    const y = u(0.2, 0.5), yaw = u(15, 60) * Math.PI / 180 * (rnd() < 0.5 ? -1 : 1);
    const dx = half * Math.cos(yaw), dz = half * Math.sin(yaw);
    cable = { startM: [r3(-dx), y, r3(zc - dz)], endM: [r3(dx), y, r3(zc + dz)] };
  } else if (family === 'elevated') {
    const y = rnd() < 0.5 ? u(0.05, 0.12) : u(0.55, 0.65);
    cable = { startM: [-half, y, zc], endM: [half, y, zc] };
  } else if (family === 'full_occlusion') {
    const y = u(0.2, 0.5);
    cable = { startM: [-half, y, zc], endM: [half, y, zc] };
    // Wide, tall box filling the route up to 0.30 m before the cable: every line of sight is
    // blocked until the camera is past the far face, which is after the stopping boundary.
    const depth = u(0.8, 1.5);
    boxes.push({ centerM: [0, 0.6, r3(zc + 0.3 + depth / 2)], sizeM: [3.2, 1.2, depth] });
  } else if (family === 'partial_occlusion') {
    const y = u(0.2, 0.5), yaw = u(20, 45) * Math.PI / 180;
    const dx = half * Math.cos(yaw), dz = half * Math.sin(yaw);
    cable = { startM: [r3(-dx), y, r3(zc - dz)], endM: [r3(dx), y, r3(zc + dz)] };
    // Off-route box (never contacted) shadowing the near end of the cable.
    boxes.push({ centerM: [u(0.75, 0.95), 0.4, r3(zc + u(1.0, 2.0))], sizeM: [0.4, 0.8, 0.4] });
  } else if (family === 'off_route') {
    const x = u(0.8, 1.2) * (rnd() < 0.5 ? -1 : 1), y = u(0.2, 0.5);
    cable = { startM: [x, y, r3(zc + 1)], endM: [x, y, r3(zc - 1)] };
  }
  return { sceneId: `${split}-${family}-${seed}`, split, family, seed, cable, boxes };
}

export function scenesFor(m: ExperimentManifest): SceneSpec[] {
  const out: SceneSpec[] = [];
  for (const [split, spec] of [['tuning', m.tuning], ['held_out', m.heldOut]] as const)
    for (const family of spec.families) for (const seed of spec.seeds) out.push(generateScene(family, seed, split));
  return out;
}

/** Synthetic study world. Calibration is "verified" only in the sense the evaluator requires; scale is exact by construction. */
export const STUDY_WORLD: World = {
  id: 'study-world', version: 1, name: 'Procedural study floor', sourcePhotoUrl: '',
  splat: { id: 'none', source: 'procedural', url: '', sha256: '0'.repeat(64), createdAt: '2026-10-15T00:00:00.000Z' },
  collider: { id: 'none', source: 'procedural', url: '', sha256: '0'.repeat(64), createdAt: '2026-10-15T00:00:00.000Z' },
  calibration: {
    status: 'verified', source: 'estimated_reference',
    splatToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], colliderToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    correctionFactor: 1, uncertaintyNote: 'Procedural study world: geometry is defined in metres by construction, not reconstructed from a photo.',
  },
  preparationMs: null, cached: true,
};

const cableItem = (diameterM: number): HazardLibraryItem => ({
  id: `study-cable-${diameterM}`, version: 1, name: `${r3(diameterM * 1000)} mm study cable`, type: 'cable', dimensionsM: [2.4, diameterM, diameterM],
  dimensionEvidence: 'assumed', materialClass: 'opaque', returnAssumption: 'Study geometry; passive-stereo width threshold only.',
});
const boxItem = (size: Vec3): HazardLibraryItem => ({
  id: 'study-box', version: 1, name: 'Study occluder', type: 'bulk', dimensionsM: size, dimensionEvidence: 'assumed', materialClass: 'opaque', returnAssumption: 'Opaque procedural box.',
});

/** Build the evaluator scenario for one scene and one cable diameter (metres). */
export function buildScenario(scene: SceneSpec, diameterM: number): Scenario {
  const hazards: HazardInstance[] = [];
  if (scene.cable) hazards.push({ id: 'cable', libraryItem: cableItem(diameterM), geometry: { kind: 'cable', startM: scene.cable.startM, endM: scene.cable.endM, diameterM }, placementSource: 'preset', observedInPhoto: false, justification: 'Generated study geometry.' });
  scene.boxes.forEach((b, i) => hazards.push({ id: `box-${i}`, libraryItem: boxItem(b.sizeM), geometry: { kind: 'box', pose: { positionM: b.centerM, orientation: [0, 0, 0, 1] }, dimensionsM: b.sizeM }, placementSource: 'preset', observedInPhoto: false, justification: 'Generated study occluder.' }));
  return {
    id: `${scene.sceneId}-d${r3(diameterM * 1000)}`, version: 1, world: STUDY_WORLD, seed: scene.seed, authoring: 'preset', sentence: `Study scene ${scene.sceneId}`,
    hazards,
    route: [{ positionM: [0, 0, 0], orientation: [0, 0, 0, 1] }, { positionM: [0, 0, -11], orientation: [0, 0, 0, 1] }],
    platform: { mode: 'ground', radiusM: 0.25, heightM: 0.7, speedMps: 1.1, brakingDecelerationMps2: 1.3, controlLatencyS: 0.15, clearanceMarginM: 0.08, visualAsset: MINT_PLATFORM_ASSET },
    assumptions: ['Generated study scene. Simulation only; not a physical safety test.'],
  };
}

/** One sensor arm. Baseline is not part of the frozen passive-stereo-1 contract, so it does not enter the evaluator. */
export function buildSensorConfig(m: ExperimentManifest, resolutionPx: number, minResolvableWidthPx: number): SensorConfig {
  const base = createSensorConfig('baseline');
  const s = base.sensors[0]!;
  return {
    ...base, id: `study-r${resolutionPx}-w${minResolvableWidthPx}`, label: `Study ${resolutionPx}px w${minResolvableWidthPx}`,
    sensors: [{ ...s, mount: { positionM: [0, m.fixed.mountHeightM, 0], orientation: [0, 0, 0, 1] }, widthPx: resolutionPx, heightPx: Math.round(resolutionPx * m.fixed.aspect),
      horizontalFovRad: m.fixed.horizontalFovRad, nearM: m.fixed.nearM, farM: m.fixed.farM, minResolvableWidthPx }],
  };
}

/**
 * Scene export with a digest of its geometry. Importing an export whose geometry no longer
 * matches its recorded digest (or the manifest's regenerated scene) is rejected.
 */
export interface SceneExport { sceneId: string; geometryDigest: string; json: string }
export function exportScene(scene: SceneSpec, hash: (s: string) => string): SceneExport {
  const json = canonicalJson(scene);
  return { sceneId: scene.sceneId, geometryDigest: hash(json), json };
}
export function importScene(exported: SceneExport, m: ExperimentManifest, hash: (s: string) => string): SceneSpec {
  if (hash(exported.json) !== exported.geometryDigest) throw new Error(`Scene export mismatch for ${exported.sceneId}: geometry digest does not match its content`);
  const scene = JSON.parse(exported.json) as SceneSpec;
  const regenerated = scenesFor(m).find(s => s.sceneId === scene.sceneId);
  if (!regenerated) throw new Error(`Scene ${scene.sceneId} is not part of manifest ${m.studyId}`);
  if (canonicalJson(regenerated) !== exported.json) throw new Error(`Scene export mismatch for ${scene.sceneId}: content differs from the manifest-generated scene`);
  return scene;
}
