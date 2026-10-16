// @vitest-environment node
// These are diagnosis-exposed v2 cases, not unseen validation for the repaired model.
import { describe,expect,it } from 'vitest';
import { DEFAULT_MANIFEST,buildScenario,buildSensorConfig,generateScene } from './experiment-manifest';
import { evaluate } from './evaluate';
import { analyticSampler,type SampleSensor } from './sensor';
import { bindStereoConfig,boundedStereoSampler,createStereoModel } from './stereo-model';
import { stereoOracleForScenario } from './stereo-oracle';

describe('v2-exposed visibility and version regressions',()=>{
  for(const family of ['oblique','partial_occlusion'] as const){
    it(`detects the 8mm ${family} target before the independent stopping boundary`,async()=>{
      const scenario=buildScenario(generateScene(family,16004,'held_out'),0.008);
      const base=buildSensorConfig(DEFAULT_MANIFEST,160,1),sensor=base.sensors[0]!,model=createStereoModel(60);
      const oracle=stereoOracleForScenario(scenario,sensor,model,0.025)!;
      expect(oracle.verdict).toBe('in_time');
      const sample=boundedStereoSampler(analyticSampler(scenario,sensor,undefined,false,true),sensor,model);
      const result=await evaluate(scenario,bindStereoConfig(base,model),{sample,controller:'conservative-v2'});
      expect(result.run.findings.find(f=>f.hazardId==='cable')!.status).toBe('detected_in_time');
    });
  }
  it('retains distinct controller identities even when both use the same disparity model',async()=>{
    const scenario=buildScenario(generateScene('null',15001,'tuning'),0.048);
    const config=bindStereoConfig(buildSensorConfig(DEFAULT_MANIFEST,160,1),createStereoModel(60));
    const empty:SampleSensor=()=>({points:[],candidates:[],unknown:[],method:'analytic_with_occlusion'});
    const legacy=await evaluate(scenario,config,{sample:empty,controller:'legacy'});
    const conservative=await evaluate(scenario,config,{sample:empty,controller:'conservative-v2'});
    expect(legacy.run.engineVersion).not.toBe(conservative.run.engineVersion);
  });
});
