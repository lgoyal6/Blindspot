// @vitest-environment node
/** Check route validation before evaluate.ts computes progress percentages.
 * Builds a normal procedural scene and replaces only the route with zero travel.
 * Invalid geometry must fail before it can produce NaN metrics.
 */
import { expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { DEFAULT_MANIFEST, buildScenario, buildSensorConfig, generateScene } from './experiment-manifest';
it('rejects a zero-length route before computing metrics', async () => {
  const scenario = buildScenario(generateScene('null', 101, 'tuning'), 0.01);
  scenario.route = [scenario.route[0]!, scenario.route[0]!];
  await expect(evaluate(scenario, buildSensorConfig(DEFAULT_MANIFEST, 160, 1))).rejects.toThrow(/route/i);
});
