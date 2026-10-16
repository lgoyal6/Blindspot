// Rectified stereo with declared quantization and bounded matching uncertainty.
// These are synthetic assumptions. No camera noise distribution was calibrated.
import type { Pose, SensorConfig, StereoSensor, Vec3 } from '../../shared/contracts';
import { localPoint, worldPoint } from './math';
import { BOUNDED_SAMPLE_SPACING_M,cameraPose, intrinsics, project, type SampleSensor, type SensorFrame } from './sensor';

export const STEREO_MODEL_VERSION='bounded-disparity-3';
export const STEREO_DIAGNOSTIC_STEP_M=0.005;
export interface StereoModel {
  baselineM: number;
  disparityStepPx: number;
  matchingErrorBoundPx: number;
  maxDepthIntervalWidthM: number;
}
export function validateStereoModel(model: StereoModel): void {
  if(![model.baselineM,model.disparityStepPx,model.matchingErrorBoundPx,model.maxDepthIntervalWidthM].every(Number.isFinite)||model.baselineM<0.001||model.baselineM>1||
    model.disparityStepPx<=0||model.disparityStepPx>4||model.matchingErrorBoundPx<0||model.matchingErrorBoundPx>4||
    model.maxDepthIntervalWidthM<=0||model.maxDepthIntervalWidthM>2)throw new Error('Invalid bounded stereo model; baseline is in metres');
}
export function createStereoModel(baselineMm: number): Readonly<StereoModel> {
  const model={baselineM:baselineMm/1000,disparityStepPx:0.25,matchingErrorBoundPx:0.25,maxDepthIntervalWidthM:0.25};
  validateStereoModel(model);
  return Object.freeze(model);
}
export function bindStereoConfig(config: SensorConfig,model: StereoModel): SensorConfig {
  validateStereoModel(model);
  const parameters={baselineM:model.baselineM,disparityStepPx:model.disparityStepPx,matchingErrorBoundPx:model.matchingErrorBoundPx,maxDepthIntervalWidthM:model.maxDepthIntervalWidthM};
  return {...config,id:`${config.id}-${STEREO_MODEL_VERSION}-${Object.values(parameters).join('-')}`,
    modelVersion:STEREO_MODEL_VERSION,label:`${config.label}, bounded disparity`,assumptions:[
      'Synthetic rectified pinhole stereo; no physical camera calibration or fitted noise distribution.',
      'Opaque candidate geometry and projected-width/FOV/occlusion gates precede disparity degradation.',
      'Visibility uses a single central proxy, not binocular rendering or stereo image matching. Matching error is an uncertainty allowance, not sampled noise.',
      `Cable candidate spacing is at most ${BOUNDED_SAMPLE_SPACING_M}m; diagnostic route spacing is ${STEREO_DIAGNOSTIC_STEP_M}m. Cable subdivision is capped at 4096.`,
      `Stereo parameters: ${JSON.stringify(parameters)}. Disparity d=fx*baseline/depth is rounded to the nearest step.`,
      'Depth interval includes half a disparity step plus the declared matching-error bound; unsupported intervals return no point.',
      'Perceived support includes finite candidate sampling and depth uncertainty. Truth collision geometry is unchanged.',
    ]};
}
export interface DepthInterval { measuredM: number; nearM: number; farM: number; disparityPx: number }
function depthIntervalReader(sensor: StereoSensor,model: StereoModel): (depthM:number)=>DepthInterval|null {
  validateStereoModel(model);
  const fb=intrinsics(sensor).fx*model.baselineM,step=model.disparityStepPx;
  const error=step/2+model.matchingErrorBoundPx,maximum=model.maxDepthIntervalWidthM;
  return depthM=>{
    if(!Number.isFinite(depthM)||depthM<sensor.nearM||depthM>sensor.farM)return null;
    const disparityPx=Math.round(fb/depthM/step)*step;
    if(disparityPx<=error)return null;
    const nearM=fb/(disparityPx+error),farM=fb/(disparityPx-error),measuredM=fb/disparityPx;
    if(![nearM,farM,measuredM].every(Number.isFinite)||nearM<sensor.nearM||farM>sensor.farM||farM-nearM>maximum)return null;
    return {measuredM,nearM,farM,disparityPx};
  };
}
export function stereoDepthInterval(depthM: number,sensor: StereoSensor,model: StereoModel): DepthInterval|null {
  return depthIntervalReader(sensor,model)(depthM);
}
export function degradeStereoFrame(frame: SensorFrame,pose: Pose,sensor: StereoSensor,model: StereoModel): SensorFrame {
  const readDepth=depthIntervalReader(sensor,model),camera=cameraPose(pose,sensor),points:SensorFrame['points']=[];
  for(const point of frame.points){
    if(!Number.isFinite(point.supportRadiusM??0)||(point.supportRadiusM??0)<0||!point.positionM.every(Number.isFinite))throw new Error('Invalid perceived point support');
    const local=localPoint(point.positionM,camera),projection=project(local,sensor);
    if(!projection)continue;
    const interval=readDepth(projection.depth);
    if(!interval)continue;
    const scale=interval.measuredM/projection.depth;
    const measured:Vec3=[local[0]*scale,local[1]*scale,-interval.measuredM];
    const rayLength=Math.hypot(local[0]/projection.depth,local[1]/projection.depth,1);
    const depthError=rayLength*Math.max(interval.measuredM-interval.nearM,interval.farM-interval.measuredM);
    points.push({...point,positionM:worldPoint(measured,camera),supportRadiusM:(point.supportRadiusM??0)+depthError});
  }
  return {...frame,points,stereo:{accepted:points.length,rejected:frame.points.length-points.length}};
}
export function boundedStereoSampler(base: SampleSensor,sensor: StereoSensor,model: StereoModel): SampleSensor {
  validateStereoModel(model);
  const bound=Object.freeze({...model});
  return pose=>degradeStereoFrame(base(pose),pose,sensor,bound);
}
