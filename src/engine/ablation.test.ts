import { describe, expect, it } from 'vitest';
import { sensorModelAblation } from './ablation';

const input = {
  cableDiametersM: [0.008, 0.016],
  stereoBaselinesM: [0.06, 0.12],
  resolutionsPx: [160, 320],
  minResolvableWidthPx: [1, 2],
  depthM: 1,
  horizontalFovRad: Math.PI / 2,
} as const;

describe('sensor model ablation', () => {
  it('enumerates a stable Cartesian product with simulation-only quantities', () => {
    const first = sensorModelAblation(input);
    const second = sensorModelAblation(input);
    expect(first).toHaveLength(16);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ resolutionPx: 160, cableDiameterM: 0.008, stereoBaselineM: 0.06, minResolvableWidthPx: 1 });
    expect(first.every(result => result.focalLengthPx > 0 && result.disparityPx > 0)).toBe(true);
  });

  it('keeps the declared approximation monotonic', () => {
    const results = sensorModelAblation(input);
    const at = (resolutionPx: number, cableDiameterM: number, minResolvableWidthPx: number) =>
      results.find(result => result.resolutionPx === resolutionPx && result.cableDiameterM === cableDiameterM && result.minResolvableWidthPx === minResolvableWidthPx && result.stereoBaselineM === 0.12)!;
    expect(at(320, 0.008, 1).projectedCableWidthPx).toBeGreaterThan(at(160, 0.008, 1).projectedCableWidthPx);
    expect(at(160, 0.016, 1).thresholdRangeM).toBeGreaterThan(at(160, 0.008, 1).thresholdRangeM);
    expect(at(160, 0.008, 2).thresholdRangeM).toBeLessThan(at(160, 0.008, 1).thresholdRangeM);
    expect(at(160, 0.016, 1).resolvableAtDepth).toBe(true);
    expect(at(160, 0.008, 2).resolvableAtDepth).toBe(false);
  });

  it('rejects empty or invalid parameter sets instead of producing invented data', () => {
    expect(() => sensorModelAblation({ ...input, cableDiametersM: [] })).toThrow(/must not be empty/);
    expect(() => sensorModelAblation({ ...input, depthM: 0 })).toThrow(/depthM/);
    expect(() => sensorModelAblation({ ...input, horizontalFovRad: Math.PI })).toThrow(/horizontalFovRad/);
  });
});
