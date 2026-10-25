// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { DEFAULT_MANIFEST,buildScenario,buildSensorConfig,generateScene } from './experiment-manifest';
import { analyticSampler,type SensorFrame } from './sensor';
import { bindStereoConfig,boundedStereoSampler,createStereoModel,degradeStereoFrame,stereoDepthInterval,validateStereoModel } from './stereo-model';
import { stereoRangeOracle } from './stereo-oracle';
import { evaluate } from './evaluate';
import { cameraPose } from './sensor';
import { localPoint } from './math';

const config=buildSensorConfig(DEFAULT_MANIFEST,160,1),sensor=config.sensors[0]!;
const pose={positionM:[0,0,0] as const,orientation:[0,0,0,1] as const};
const plane=(depth:number):SensorFrame=>({points:[{positionM:[0,0.35,-depth]}],candidates:[],unknown:[],method:'raster'});

describe('bounded disparity model',()=>{
  it('rejects zero, wrong-unit, nonfinite and incomplete model parameters before scoring',()=>{
    for(const baseline of [0,-60,0.06,Infinity,NaN])expect(()=>createStereoModel(baseline)).toThrow(/Invalid bounded stereo/);
    expect(()=>validateStereoModel({baselineM:0.06} as ReturnType<typeof createStereoModel>)).toThrow();
    expect(()=>validateStereoModel({...createStereoModel(60),matchingErrorBoundPx:-1})).toThrow();
  });
  it('baseline changes accepted returns on an identical 1.5m plane',()=>{
    expect(stereoDepthInterval(1.5,sensor,createStereoModel(60))).toBeNull();
    const wider=stereoDepthInterval(1.5,sensor,createStereoModel(120))!;
    expect(wider.nearM).toBeLessThanOrEqual(1.5);
    expect(wider.farM).toBeGreaterThanOrEqual(1.5);
    expect(wider.farM-wider.nearM).toBeLessThanOrEqual(0.25);
    expect(degradeStereoFrame(plane(1.5),pose,sensor,createStereoModel(60)).points).toHaveLength(0);
    expect(degradeStereoFrame(plane(1.5),pose,sensor,createStereoModel(120)).points).toHaveLength(1);
  });
  it('accepted planar depths lie inside independently reconstructed world-space ray segments',()=>{
    let accepted=0,rejected=0;
    for(const baseline of [60,120])for(let z=0.101;z<12;z+=0.037){
      const interval=stereoDepthInterval(z,sensor,createStereoModel(baseline));
      if(!interval){rejected++;continue;}
      accepted++;
      const fb=80*baseline/1000;
      expect(interval.nearM).toBeCloseTo(fb/(interval.disparityPx+0.375),12);
      expect(interval.farM).toBeCloseTo(fb/(interval.disparityPx-0.375),12);
      expect(interval.nearM).toBeLessThanOrEqual(z+1e-12);
      expect(interval.farM).toBeGreaterThanOrEqual(z-1e-12);
      const point=degradeStereoFrame(plane(z),pose,sensor,createStereoModel(baseline)).points[0]!;
      expect(point.depthSegmentM).toBeDefined();
      expect(-point.depthSegmentM![0][2]).toBeLessThanOrEqual(z+1e-12);
      expect(-point.depthSegmentM![1][2]).toBeGreaterThanOrEqual(z-1e-12);
    }
    expect(accepted).toBeGreaterThan(40);expect(rejected).toBeGreaterThan(300);
  });
  it('keeps off-axis stereo interval endpoints on the camera ray',()=>{
    const model=createStereoModel(120),frame={...plane(1.5),points:[{positionM:[0.375,0.35,-1.5] as const}]};
    const point=degradeStereoFrame(frame,pose,sensor,model).points[0]!,camera=cameraPose(pose,sensor);
    const near=localPoint(point.depthSegmentM![0],camera),far=localPoint(point.depthSegmentM![1],camera);
    expect(near[0]/-near[2]).toBeCloseTo(0.25,12);expect(far[0]/-far[2]).toBeCloseTo(0.25,12);
    expect(near[1]).toBeCloseTo(0,12);expect(far[1]).toBeCloseTo(0,12);
  });
  it('the independent disparity-bin range oracle matches acceptance away from bin boundaries',()=>{
    for(const baseline of [60,120]){
      const model=createStereoModel(baseline),range=stereoRangeOracle(sensor,model);
      for(let z=0.071;z<12;z+=0.013){
        if(Math.min(Math.abs(z-range.nearM),Math.abs(z-range.farM))<1e-8)continue;
        expect(stereoDepthInterval(z,sensor,model)!==null,`baseline${baseline},depth${z}`).toBe(z>range.nearM&&z<range.farM);
      }
    }
  });
  it('keeps invalid/unresolved returns absent, preserves ideal candidates and rejects invalid support',()=>{
    const model=createStereoModel(60);
    for(const z of [0,0.01,6,12])expect(degradeStereoFrame(plane(z),pose,sensor,model).points).toHaveLength(0);
    for(const z of [Infinity,NaN])expect(()=>degradeStereoFrame(plane(z),pose,sensor,model)).toThrow(/Invalid perceived point/);
    const raw={...plane(6),candidates:['cable']};
    expect(degradeStereoFrame(raw,pose,sensor,model).candidates).toEqual(['cable']);
    expect(()=>degradeStereoFrame({...plane(1),points:[{positionM:[0,0.35,-1],supportRadiusM:-1}]},pose,sensor,model)).toThrow(/support/);
  });
  it('retains width and occlusion rejection with meaningful valid cable controls',()=>{
    const model=createStereoModel(120);
    const scene={sceneId:'stereo-plane-control',split:'tuning' as const,family:'perpendicular' as const,seed:1,
      cable:{startM:[-1.2,0.35,-1.2] as const,endM:[1.2,0.35,-1.2] as const},boxes:[]};
    const small=buildScenario(scene,0.004),large=buildScenario(scene,0.048);
    expect(boundedStereoSampler(analyticSampler(small,sensor),sensor,model)(pose).points).toHaveLength(0);
    expect(boundedStereoSampler(analyticSampler(large,sensor,undefined,false,true),sensor,model)(pose).points.length).toBeGreaterThan(0);
    const hidden=buildScenario({...scene,family:'full_occlusion',boxes:[{centerM:[0,0.35,-0.6],sizeM:[3,0.7,0.1]}]},0.048);
    const hiddenSensor=boundedStereoSampler(analyticSampler(hidden,sensor),sensor,model)(pose);
    expect(hiddenSensor.points.filter(p=>p.hazardId===hidden.hazards[0]?.id)).toHaveLength(0);
  });
  it('binds numeric assumptions into the shared config and refuses a silent legacy fallback',async()=>{
    const a=bindStereoConfig(config,createStereoModel(60)),b=bindStereoConfig(config,createStereoModel(120));
    expect(a.id).not.toBe(b.id);expect(a.assumptions.join(' ')).toContain('"baselineM":0.06');
    expect(a.assumptions.join(' ')).not.toContain('no synthetic noise');
    await expect(evaluate(buildScenario(generateScene('null',15001,'tuning'),0.048),a)).rejects.toThrow(/explicit sensor adapter/);
  });
});
