// Independent accepted-depth range, derived from the quantized-disparity inequalities.
// Reuses the separately implemented continuous visibility/contact oracle, not the sampler.
import type { Scenario, StereoSensor } from '../../shared/contracts';
import type { StereoModel } from './stereo-model';
import { oracleForScenario } from './visibility-oracle';

export function stereoRangeOracle(sensor: StereoSensor,model: StereoModel): {nearM:number;farM:number} {
  const {baselineM,disparityStepPx:step,matchingErrorBoundPx:matching,maxDepthIntervalWidthM:span}=model;
  if(![baselineM,step,matching,span].every(Number.isFinite)||baselineM<=0||step<=0||matching<0||span<=0)throw new Error('Invalid oracle stereo parameters');
  const fb=sensor.widthPx/(2*Math.tan(sensor.horizontalFovRad/2))*baselineM,error=step/2+matching;
  // span = 2*fb*error/(q*q-error*error), with q a multiple of step.
  const minimum=Math.max(Math.sqrt(error*error+2*fb*error/span),fb/sensor.farM+error);
  const qMin=Math.ceil(minimum/step)*step,qMax=Math.floor((fb/sensor.nearM-error)/step)*step;
  if(qMin>qMax||qMin<=error)return {nearM:sensor.farM+1,farM:sensor.nearM};
  return {nearM:Math.max(sensor.nearM,fb/(qMax+step/2)),farM:Math.min(sensor.farM,fb/(qMin-step/2))};
}
export function stereoOracleForScenario(scenario: Scenario,sensor: StereoSensor,model: StereoModel,toleranceM:number) {
  return oracleForScenario(scenario,{...sensor,...stereoRangeOracle(sensor,model)},toleranceM);
}
