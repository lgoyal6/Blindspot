// @vitest-environment node
/** Reject invalid diagnostic sampling options before entering oracle loops.
 * Exercises visibility-oracle.ts on a clear scene so failure cannot hang this test.
 * The normal study defaults and its frozen geometry remain unchanged.
 */
import { expect, it } from 'vitest';
import { DEFAULT_MANIFEST, buildSensorConfig } from './experiment-manifest';
import { earliestVisibleS } from './visibility-oracle';
it.each([0, -0.1, NaN, Infinity])('rejects invalid occlusion step %s', step => {
  const sensor = buildSensorConfig(DEFAULT_MANIFEST, 160, 1).sensors[0]!;
  const cable = { start: [-1, 0.35, -3] as [number, number, number], end: [1, 0.35, -3] as [number, number, number], diameterM: 0.01 };
  expect(() => earliestVisibleS(cable, sensor, [], 3, { sStepM: step })).toThrow(/step/i);
});
