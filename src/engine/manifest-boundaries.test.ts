// @vitest-environment node
/** Reject repeated study units before they enter the evaluator.
 * Exercises experiment-manifest.ts without running or changing the frozen grid.
 * A seed must fit the generator's 32-bit state and each split unit must be unique.
 */
import { expect, it } from 'vitest';
import { DEFAULT_MANIFEST, validateManifest } from './experiment-manifest';
it.each(['families', 'seeds'] as const)('rejects duplicate %s within a split', key => {
  const m = structuredClone(DEFAULT_MANIFEST);
  if (key === 'families') m.heldOut.families = ['null', 'null'];
  else m.heldOut.seeds = [9001, 9001];
  expect(() => validateManifest(m)).toThrow(/duplicate/i);
});
it('rejects seeds that wrap into an already used PRNG state', () => {
  const m = structuredClone(DEFAULT_MANIFEST);
  m.heldOut.seeds = [101 + 2 ** 32];
  expect(() => validateManifest(m)).toThrow(/32.bit/);
});
