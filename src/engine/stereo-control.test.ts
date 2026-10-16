// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { DEFAULT_MANIFEST,buildScenario,buildSensorConfig,generateScene,type SceneSpec } from './experiment-manifest';
import { evaluate } from './evaluate';
import { conservativeObstacleClearance,type SampleSensor } from './sensor';
import { contactS,requiredStoppingM } from './visibility-oracle';

const config=buildSensorConfig(DEFAULT_MANIFEST,320,1);
const pose={positionM:[0,0,0] as const,orientation:[0,0,0,1] as const};
const across=(z:number):SceneSpec=>({sceneId:'control-cable',split:'tuning',family:'perpendicular',seed:2,
  cable:{startM:[-1.2,0.35,z],endM:[1.2,0.35,z]},boxes:[]});

describe('conservative point-cloud control',()=>{
  it('handles capsule height and a grazing support ball without counting the robot radius twice',()=>{
    expect(conservativeObstacleClearance([{positionM:[0,0.35,-1]}],pose,0.25,0.7)).toBeCloseTo(0.75,12);
    expect(conservativeObstacleClearance([{positionM:[0.27,0.35,-1],supportRadiusM:0.03}],pose,0.25,0.7)).not.toBeNull();
    expect(conservativeObstacleClearance([{positionM:[0,1.2,-1]}],pose,0.25,0.7)).toBeNull();
    expect(()=>conservativeObstacleClearance([{positionM:[0,0.35,-1],supportRadiusM:NaN}],pose,0.25,0.7)).toThrow(/support/);
  });
  it('preserves the historical oblique collision while the opt-in controller stops before independent contact',async()=>{
    const scene=generateScene('oblique',9004,'held_out'),scenario=buildScenario(scene,0.032);
    const old=await evaluate(scenario,config),fixed=await evaluate(scenario,config,{controller:'conservative-v2'});
    expect(old.run.outcome.termination).toBe('collision');
    expect(fixed.run.outcome.termination).toBe('stopped');
    expect(fixed.run.outcome.collisions).toBe(0);
    const hit=contactS({start:scene.cable!.startM,end:scene.cable!.endM,diameterM:0.032},scenario.platform,11)!;
    const stop=fixed.run.events.find(e=>e.kind==='stop')!;
    expect(-stop.positionM[2]).toBeLessThan(hit);
    expect(fixed.run.engineVersion).toBe('ground-stereo-2.0.0');
    expect(old.run.engineVersion).toBe('ground-stereo-1.0.0');
  });
  it('passes null and off-route controls, and stops on a resolvable encountered cable',async()=>{
    for(const family of ['null','off_route'] as const){
      const result=await evaluate(buildScenario(generateScene(family,15001,'tuning'),0.048),config,{controller:'conservative-v2'});
      expect(result.run.outcome.termination).toBe('completed');expect(result.run.outcome.stopEvents).toBe(0);
    }
    const scenario=buildScenario(across(-3),0.048),result=await evaluate(scenario,config,{controller:'conservative-v2'});
    expect(result.run.outcome.termination).toBe('stopped');expect(result.run.outcome.collisions).toBe(0);
    expect(result.brakingDecision!.corridorM).toBeGreaterThan(requiredStoppingM(scenario.platform));
  });
  it('cannot avoid an unseen or first-seen-too-late obstacle by consulting truth geometry',async()=>{
    const scenario=buildScenario(across(-1.5),0.008);
    const empty:SampleSensor=()=>({points:[],candidates:[],unknown:[],method:'analytic_with_occlusion'});
    const missing=await evaluate(scenario,config,{controller:'conservative-v2',sample:empty});
    expect(missing.run.outcome.termination).toBe('collision');expect(missing.brakingDecision).toBeNull();
    const late:SampleSensor=robot=>-robot.positionM[2]<1.2?empty(robot):({points:[{positionM:[0,0.35,-1.5]}],candidates:['cable'],unknown:[],method:'analytic_with_occlusion'});
    const delayed=await evaluate(scenario,config,{controller:'conservative-v2',sample:late});
    expect(delayed.run.outcome.termination).toBe('collision');
  });
  it('retains a real false stop when the sensor reports an obstacle in an empty truth scene',async()=>{
    const scenario=buildScenario(generateScene('null',15001,'tuning'),0.048);
    const falsePoint:SampleSensor=()=>({points:[{positionM:[0,0.35,-1]}],candidates:[],unknown:[],method:'raster'});
    const result=await evaluate(scenario,config,{controller:'conservative-v2',sample:falsePoint});
    expect(result.run.outcome.stopEvents).toBe(1);expect(result.run.outcome.falseStopEvents).toBe(1);expect(result.run.outcome.falseStopPercent).toBe(100);
  });
});
