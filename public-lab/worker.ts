// Execute the existing sensor model and controller on one bounded scene.
import { DEFAULT_MANIFEST, SCENE_FAMILIES, generateScene, buildScenario, buildSensorConfig, type SceneFamily } from '../src/engine/experiment-manifest';
import { evaluate } from '../src/engine/evaluate';
import { analyticSampler } from '../src/engine/sensor';
import { bindStereoConfig, boundedStereoSampler, createStereoModel } from '../src/engine/stereo-model';
self.onmessage = async ({ data }) => {
  try {
    if (!SCENE_FAMILIES.includes(data.family) || !Number.isInteger(data.seed) || data.seed < 0 || data.seed > 99999 || ![160,320,640].includes(data.resolution) || ![4,8,16,32,48].includes(data.diameter) || !['legacy','conservative-v2'].includes(data.controller)) throw new Error('Invalid bounded scenario inputs');
    const scene = generateScene(data.family as SceneFamily, data.seed, 'tuning');
    const scenario = buildScenario(scene, data.diameter / 1000);
    const base = buildSensorConfig(DEFAULT_MANIFEST, data.resolution, 1);
    const sensor = base.sensors[0]!, model = createStereoModel(120);
    const config = bindStereoConfig(base, model);
    const sample = boundedStereoSampler(analyticSampler(scenario, sensor, undefined, false, true), sensor, model);
    const { run } = await evaluate(scenario, config, { sample, controller: data.controller });
    self.postMessage({ input: data, outcome: run.outcome, coverage: run.coverage, findings: run.findings, engineVersion: run.engineVersion, assumptions: config.assumptions });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
