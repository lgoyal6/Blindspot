/**
 * Deterministic sensor-model ablation for the simulator's stated passive-stereo
 * approximation. Results are analytical model outputs, not hardware measurements.
 */

export interface SensorAblationInput {
  cableDiametersM: readonly number[];
  stereoBaselinesM: readonly number[];
  resolutionsPx: readonly number[];
  minResolvableWidthPx: readonly number[];
  /** Axial depth at which the comparison is reported. */
  depthM: number;
  horizontalFovRad: number;
}

export interface SensorAblationResult {
  cableDiameterM: number;
  stereoBaselineM: number;
  resolutionPx: number;
  minResolvableWidthPx: number;
  focalLengthPx: number;
  projectedCableWidthPx: number;
  disparityPx: number;
  thresholdRangeM: number;
  resolvableAtDepth: boolean;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive`);
  return value;
}

function uniqueSorted(values: readonly number[], label: string): number[] {
  if (!values.length) throw new Error(`${label} must not be empty`);
  return [...new Set(values.map(value => finitePositive(value, label)))].sort((a, b) => a - b);
}

/**
 * Enumerate every parameter combination in stable numeric order. The baseline
 * affects disparity only; cable resolvability is deliberately governed by the
 * declared projected-width threshold, matching the production approximation.
 */
export function sensorModelAblation(input: SensorAblationInput): SensorAblationResult[] {
  const depthM = finitePositive(input.depthM, 'depthM');
  if (!Number.isFinite(input.horizontalFovRad) || input.horizontalFovRad <= 0 || input.horizontalFovRad >= Math.PI) {
    throw new Error('horizontalFovRad must be between 0 and pi');
  }
  const diameters = uniqueSorted(input.cableDiametersM, 'cableDiametersM');
  const baselines = uniqueSorted(input.stereoBaselinesM, 'stereoBaselinesM');
  const resolutions = uniqueSorted(input.resolutionsPx, 'resolutionsPx');
  const thresholds = uniqueSorted(input.minResolvableWidthPx, 'minResolvableWidthPx');
  const results: SensorAblationResult[] = [];
  for (const resolutionPx of resolutions) {
    const focalLengthPx = resolutionPx / (2 * Math.tan(input.horizontalFovRad / 2));
    for (const cableDiameterM of diameters) {
      for (const stereoBaselineM of baselines) {
        for (const minResolvableWidthPx of thresholds) {
          const projectedCableWidthPx = focalLengthPx * cableDiameterM / depthM;
          results.push({
            cableDiameterM,
            stereoBaselineM,
            resolutionPx,
            minResolvableWidthPx,
            focalLengthPx,
            projectedCableWidthPx,
            disparityPx: focalLengthPx * stereoBaselineM / depthM,
            thresholdRangeM: focalLengthPx * cableDiameterM / minResolvableWidthPx,
            resolvableAtDepth: projectedCableWidthPx >= minResolvableWidthPx,
          });
        }
      }
    }
  }
  return results;
}
