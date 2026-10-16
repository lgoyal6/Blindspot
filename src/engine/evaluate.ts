// Evaluate diagnostic coverage and reactive motion for one simulated scenario.
// Uses sensor.ts and geometry.ts, then returns the shared CompletedRun shape.
// Reject invalid routes before dividing by route length to compute progress.
import type { CompletedRun, CoverageMetrics, HazardFinding, Pose, Scenario, SensorConfig } from '../../shared/contracts';
import { clearance, sweptContact } from './geometry';
import { clamp, localPoint, routeLength, routePose } from './math';
import { analyticSampler, cameraPose, conservativeObstacleClearance, obstacleClearance, thresholdRange, type SampleSensor, type SensorFrame } from './sensor';
import { ENGINE_VERSION } from './presets';
import { STEREO_DIAGNOSTIC_STEP_M,STEREO_MODEL_VERSION } from './stereo-model';

export interface PlaybackFrame { timeMs: number; pose: Pose; speedMps: number; points: SensorFrame['points']; pass: 'diagnostic'|'reactive' }
export interface BrakingDecision { timeMs: number; pose: Pose; speedMps: number; corridorM: number; truthHazardIds: string[]; environmentInCorridor: boolean }
export interface Evaluation { run: CompletedRun; frames: PlaybackFrame[]; diagnosticFrames: PlaybackFrame[]; brakingDecision: BrakingDecision|null; idealCandidates: Record<string,number> }
export interface EvaluationOptions {
  runId?: string; completedAt?: string; sample?: SampleSensor;
  controller?: 'legacy'|'conservative-v2';
  environmentClearance?: (pose: Pose)=>number;
  onProgress?: (value: {pass:'diagnostic'|'reactive';progress:number;frame:PlaybackFrame})=>void;
  yieldControl?: ()=>Promise<void>;
}
export const stoppingDistance=(speed:number,latency:number,deceleration:number,margin=0)=>speed*latency+speed*speed/(2*deceleration)+margin;
export function coverageMetrics(findings: readonly HazardFinding[]): CoverageMetrics {
  const eligible=findings.filter(f=>f.status!=='excluded'),unknown=eligible.filter(f=>f.status==='unknown').length;
  const detected=eligible.filter(f=>f.status==='detected_in_time').length;
  return {pass:'diagnostic_full_route',eligibleEncounters:eligible.length,detectedBeforeBoundary:detected,
    missedOrLate:eligible.filter(f=>f.status==='missed'||f.status==='late').length,unknown,excluded:findings.length-eligible.length,
    percent:!eligible.length||unknown?null:detected/eligible.length*100};
}
function validate(s:Scenario,c:SensorConfig) {
  if(s.world.calibration.status!=='verified')throw new Error('Confirm metric scale and collider registration before running.');
  const p=s.platform,sensor=c.sensors[0];
  if(p.mode!=='ground'||s.route.length<2||s.route.length>32||s.hazards.length>16||c.sensors.length!==1)throw new Error('Unsupported ground scenario.');
  if(![p.radiusM,p.heightM,p.speedMps,p.brakingDecelerationMps2,p.controlLatencyS,p.clearanceMarginM].every(Number.isFinite)||p.radiusM<=0||p.heightM<2*p.radiusM||p.speedMps<=0||p.speedMps>3||p.brakingDecelerationMps2<=0||p.controlLatencyS<0||p.clearanceMarginM<0)throw new Error('Invalid platform dimensions or motion.');
  if(!sensor||![sensor.widthPx,sensor.heightPx,sensor.horizontalFovRad,sensor.minResolvableWidthPx,sensor.nearM,sensor.farM].every(Number.isFinite)||sensor.widthPx<16||sensor.widthPx>640||sensor.heightPx<16||sensor.heightPx>480||sensor.horizontalFovRad<=0||sensor.horizontalFovRad>=Math.PI||sensor.nearM<=0||sensor.farM<=sensor.nearM||sensor.minResolvableWidthPx<=0)throw new Error('Invalid sensor configuration.');
  const length=routeLength(s.route);
  if(s.route.some(pose=>!pose.positionM.every(Number.isFinite)||Math.abs(pose.positionM[1]-s.route[0]!.positionM[1])>1e-6)||length<=0||length>50)throw new Error('Use a nonzero level route no longer than 50 meters.');
}
export async function evaluate(scenario:Scenario,config:SensorConfig,options:EvaluationOptions={}):Promise<Evaluation> {
  validate(scenario,config);
  const boundedModel=config.modelVersion===STEREO_MODEL_VERSION;
  if(config.modelVersion.startsWith('bounded-disparity-')&&!boundedModel)throw new Error('Unsupported bounded stereo model version');
  if(boundedModel&&!options.sample)throw new Error('Bounded stereo requires its explicit sensor adapter');
  if(options.controller!==undefined&&!['legacy','conservative-v2'].includes(options.controller))throw new Error('Unsupported controller');
  const conservative=options.controller==='conservative-v2';
  const p=scenario.platform,sensor=config.sensors[0]!,total=routeLength(scenario.route),sample=options.sample||analyticSampler(scenario,sensor,undefined,false,conservative,0);
  const diagnosticStep=boundedModel?STEREO_DIAGNOSTIC_STEP_M:0.025;
  const required=stoppingDistance(p.speedMps,p.controlLatencyS,p.brakingDecelerationMps2,p.clearanceMarginM);
  const encounter=new Map<string,number>();const nearMisses=new Set<string>(),unknown=new Set<string>();
  const idealCandidates:Record<string,number>={};
  // First physical contact along the nominal full route is the front-envelope boundary.
  for(const h of scenario.hazards){let previous=routePose(scenario.route,0);
    for(let s=0;s<=total+0.02;s+=0.02){const pose=routePose(scenario.route,Math.min(s,total));
      const hit=sweptContact(previous,pose,p,[h]);if(hit){encounter.set(h.id,Math.max(0,s-0.02)+0.02*hit.fraction);break;}previous=pose;}
  }
  const findings=new Map<string,HazardFinding>(scenario.hazards.map(h=>[h.id,{hazardId:h.id,status:encounter.has(h.id)?'missed':'excluded',firstDetectionRangeM:null,firstDetectionAxialDepthM:null,
    theoreticalThresholdRangeM:h.geometry.kind==='cable'?thresholdRange(h.geometry.diameterM,sensor):null,requiredStoppingDistanceM:encounter.has(h.id)?required:null,
    reason:encounter.has(h.id)?'No visible return before the tested route encounter.':'Outside the nominal swept robot envelope.',sampleMethod:'not_evaluated'}]));
  const diagnosticFrames:PlaybackFrame[]=[];let index=0;
  for(let s=0;s<=total+diagnosticStep;s+=diagnosticStep){const pose=routePose(scenario.route,Math.min(s,total)),cloud=sample(pose);
    cloud.unknown.forEach(id=>unknown.add(id));cloud.candidates.forEach(id=>{idealCandidates[id]=(idealCandidates[id]||0)+1;});
    for(const h of scenario.hazards){const f=findings.get(h.id)!;f.sampleMethod=cloud.method;
      if(!encounter.has(h.id)||f.firstDetectionRangeM!==null||s>encounter.get(h.id)!)continue;
      const point=cloud.points.find(point=>point.hazardId===h.id);if(!point)continue;
      f.firstDetectionRangeM=encounter.get(h.id)!-s;f.firstDetectionAxialDepthM=-localPoint(point.positionM,cameraPose(pose,sensor))[2];
      f.status=f.firstDetectionRangeM+1e-9>=required?'detected_in_time':'late';
      f.reason=f.status==='late'?'First valid return is inside the latency, braking and margin boundary.':'First valid return precedes the stopping boundary.';
    }
    if(index++%4===0){const frame={timeMs:Math.round(s/p.speedMps*1000),pose,speedMps:p.speedMps,points:cloud.points,pass:'diagnostic' as const};diagnosticFrames.push(frame);options.onProgress?.({pass:'diagnostic',progress:s/total,frame});await options.yieldControl?.();}
  }
  for(const id of unknown){const f=findings.get(id);if(f&&f.status!=='excluded'){f.status='unknown';f.reason='Sensor or geometry could not be evaluated. Coverage is suppressed.';}}
  let s=0,time=0,speed=p.speedMps,brakeAt=Infinity,nextSensor=0,cloud:SensorFrame={points:[],candidates:[],unknown:[],method:'analytic_with_occlusion'};
  let termination:CompletedRun['outcome']['termination']='timeout',stopEvents=0,falseStopEvents=0,collisions=0;
  let brakingDecision:BrakingDecision|null=null;const frames:PlaybackFrame[]=[],events:CompletedRun['events'][number][]=[],detected=new Set<string>();
  const dt=0.02,deadline=Math.min(120,total/p.speedMps+30);index=0;
  while(time<deadline&&s<total){const pose=routePose(scenario.route,s);
    if(time+1e-9>=nextSensor){cloud=sample(pose);nextSensor=time+0.05;
      for(const point of cloud.points)if(point.hazardId&&!detected.has(point.hazardId)){detected.add(point.hazardId);events.push({timeMs:Math.round(time*1000),kind:'first_detection',hazardId:point.hazardId,positionM:pose.positionM});}
      // A 50ms sensing period can be observed up to one 20ms integration tick late.
      const corridor=stoppingDistance(speed,p.controlLatencyS,p.brakingDecelerationMps2,p.clearanceMarginM)+(conservative?speed*(0.05+dt):0);
      const obstacle=(conservative?conservativeObstacleClearance:obstacleClearance)(cloud.points,pose,p.radiusM,p.heightM);
      if(!brakingDecision&&obstacle!==null&&obstacle<=corridor){
        const truthHazardIds:string[]=[];let environmentInCorridor=false;
        for(let ahead=0;ahead<=corridor+0.005;ahead+=0.005){const future=routePose(scenario.route,Math.min(total,s+ahead));
          for(const h of scenario.hazards)if(clearance(future,p,h)<=0&&!truthHazardIds.includes(h.id))truthHazardIds.push(h.id);
          if(options.environmentClearance&&options.environmentClearance(future)<=0)environmentInCorridor=true;
        }
        brakingDecision={timeMs:Math.round(time*1000),pose,speedMps:speed,corridorM:corridor,truthHazardIds,environmentInCorridor};brakeAt=time+p.controlLatencyS;
        events.push({timeMs:Math.round(time*1000),kind:'braking',positionM:pose.positionM});
      }
    }
    const delay=clamp(brakeAt-time,0,dt),brakingDuration=Math.min(dt-delay,speed/p.brakingDecelerationMps2);
    const travel=speed*delay+speed*brakingDuration-0.5*p.brakingDecelerationMps2*brakingDuration*brakingDuration;
    const nextSpeed=Math.max(0,speed-p.brakingDecelerationMps2*brakingDuration),nextS=Math.min(total,s+travel),nextPose=routePose(scenario.route,nextS);
    const hit=sweptContact(pose,nextPose,p,scenario.hazards);
    let envFraction:number|null=null;
    if(options.environmentClearance){const steps=Math.max(1,Math.ceil((nextS-s)/0.004));for(let i=0;i<=steps;i++)if(options.environmentClearance(routePose(scenario.route,s+(nextS-s)*i/steps))<=0){envFraction=i/steps;break;}}
    if(hit||envFraction!==null){const f=Math.min(hit?.fraction??1,envFraction??1);s+=(nextS-s)*f;time+=dt*f;collisions=1;termination='collision';
      events.push({timeMs:Math.round(time*1000),kind:'collision',...(hit&&hit.fraction<=(envFraction??1)?{hazardId:hit.hazardId}:{}),positionM:routePose(scenario.route,s).positionM});
      frames.push({timeMs:Math.round(time*1000),pose:routePose(scenario.route,s),speedMps:Math.max(0,speed-p.brakingDecelerationMps2*Math.max(0,dt*f-delay)),points:cloud.points,pass:'reactive'});break;}
    for(const h of scenario.hazards){const gap=clearance(nextPose,p,h);if(gap>0&&gap<p.clearanceMarginM&&!nearMisses.has(h.id)){nearMisses.add(h.id);events.push({timeMs:Math.round((time+dt)*1000),kind:'near_miss',hazardId:h.id,positionM:nextPose.positionM});}}
    s=nextS;time+=dt;speed=nextSpeed;
    if(index++%5===0){const frame={timeMs:Math.round(time*1000),pose:nextPose,speedMps:speed,points:cloud.points,pass:'reactive' as const};frames.push(frame);options.onProgress?.({pass:'reactive',progress:s/total,frame});await options.yieldControl?.();}
    if(speed<=1e-8){stopEvents=1;falseStopEvents=brakingDecision&&!brakingDecision.truthHazardIds.length&&!brakingDecision.environmentInCorridor?1:0;
      events.push({timeMs:Math.round(time*1000),kind:'stop',positionM:nextPose.positionM});termination='stopped';frames.push({timeMs:Math.round(time*1000),pose:nextPose,speedMps:0,points:cloud.points,pass:'reactive'});break;}
  }
  if(s>=total)termination='completed';
  // A contact is not simultaneously counted as a near miss for that encounter.
  for(const event of events)if(event.kind==='collision'&&event.hazardId)nearMisses.delete(event.hazardId);
  const filteredEvents=events.filter(e=>e.kind!=='near_miss'||(e.hazardId&&nearMisses.has(e.hazardId)));
  const engineVersion=boundedModel?`ground-stereo-3.0.0+${conservative?'conservative-control-2':'legacy-control'}`:conservative?'ground-stereo-2.0.0':ENGINE_VERSION;
  const run:CompletedRun={id:options.runId||`run-${scenario.id}-${config.version}`,scenarioId:scenario.id,scenarioVersion:scenario.version,config,seed:scenario.seed,
    coverage:coverageMetrics([...findings.values()]),outcome:{pass:'reactive',collisions,nearMisses:nearMisses.size,stopEvents,falseStopEvents,falseStopPercent:stopEvents?falseStopEvents/stopEvents*100:null,routeCompletionPercent:s/total*100,completionTimeMs:termination==='completed'?Math.round(time*1000):null,termination},
    findings:[...findings.values()],events:filteredEvents,completedAt:options.completedAt||new Date().toISOString(),engineVersion,execution:'client_computed'};
  return {run,frames,diagnosticFrames,brakingDecision,idealCandidates};
}
