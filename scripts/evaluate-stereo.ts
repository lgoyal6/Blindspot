// Lock exact synthetic inputs, run every declared arm, then reconstruct from raw cells.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompletedRun,Pose } from '../shared/contracts';
import { evaluate } from '../src/engine/evaluate';
import { DEFAULT_MANIFEST,SCENE_FAMILIES,buildScenario,buildSensorConfig,canonicalJson,generateScene,mulberry32,scenesFor,type SceneFamily,type SceneSpec } from '../src/engine/experiment-manifest';
import { BOUNDED_SAMPLE_SPACING_M,analyticSampler,type SampleSensor } from '../src/engine/sensor';
import { STEREO_DIAGNOSTIC_STEP_M,STEREO_MODEL_VERSION,bindStereoConfig,boundedStereoSampler,createStereoModel } from '../src/engine/stereo-model';
import { stereoOracleForScenario } from '../src/engine/stereo-oracle';
import { compareWithEvaluator,oracleForScenario,type CableOracleResult } from '../src/engine/visibility-oracle';

interface Protocol {
  schema:string;
  versions:Record<string,string>;
  prior_exposed_geometry_cases:SceneSpec[];
  geometries:Record<'tuning'|'held_out',{families:SceneFamily[];seeds:number[]}>;
  factors:{diameters_mm:number[];resolutions_px:number[];width_thresholds_px:number[];baselines_mm:number[]};
  parameters:{disparity_step_px:number;matching_error_bound_px:number;total_disparity_bound_px:number;maximum_depth_interval_width_m:number;sensor_period_s:number;integrator_step_s:number;sensing_horizon_bound_s:number;candidate_spacing_m:number;diagnostic_step_m:number};
  planned_counts:{total_cells:number;total_geometry_clusters?:number};
  analysis:{bootstrap_replicates:number;bootstrap_seed:number};
}
interface Cell {sceneId:string;diameterMm:number;resolutionPx:number;widthPx:number;baselineMm:number|null;arm:'legacy'|'stereo_legacy_control'|'stereo_conservative_control'}
interface RecordRow extends Cell {
  split:SceneSpec['split'];family:SceneFamily;seed:number;geometryId:string;config:CompletedRun['config'];engineVersion:string;
  coverage:CompletedRun['coverage'];outcome:CompletedRun['outcome'];finding:CompletedRun['findings'][number]|null;
  oracle:CableOracleResult|null;agreement:string;reactiveMiss:boolean;
  pointObservations:Record<'diagnostic'|'reactive',{accepted:number;rejected:number}>;
  deterministicDigest:string;runtimeMs:number;
}
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const args=process.argv.slice(2);
const arg=(name:string)=>{const at=args.indexOf(name);if(at<0||!args[at+1]||args[at+1]!.startsWith('--'))throw new Error(`Missing ${name}`);return args[at+1]!;};
const out=resolve(arg('--out')),protocolBytes=readFileSync(arg('--protocol'));
const protocol=JSON.parse(protocolBytes.toString()) as Protocol;
if(protocol.schema!=='blindspot-stereo-prospective-protocol-3'||protocol.versions.new_model!==STEREO_MODEL_VERSION)throw new Error('Unsupported protocol/model version');
const expectedParameters={disparity_step_px:0.25,matching_error_bound_px:0.25,total_disparity_bound_px:0.375,maximum_depth_interval_width_m:0.25,sensor_period_s:0.05,integrator_step_s:0.02,sensing_horizon_bound_s:0.07,candidate_spacing_m:BOUNDED_SAMPLE_SPACING_M,diagnostic_step_m:STEREO_DIAGNOSTIC_STEP_M};
if(canonicalJson(protocol.parameters)!==canonicalJson(expectedParameters))throw new Error('Protocol parameters do not match this model/controller implementation');
if(protocol.analysis.bootstrap_replicates!==10000||!Number.isInteger(protocol.analysis.bootstrap_seed))throw new Error('Invalid analysis contract');
const geometryKey=(s:SceneSpec)=>canonicalJson({cable:s.cable,boxes:s.boxes});
if(!Array.isArray(protocol.prior_exposed_geometry_cases)||!protocol.prior_exposed_geometry_cases.length)throw new Error('Missing exposed-geometry exclusion list');
for(const scene of protocol.prior_exposed_geometry_cases)if(canonicalJson(scene)!==canonicalJson(generateScene(scene.family,scene.seed,scene.split)))throw new Error('Exposed scene is not generator-bound');
const scenes:SceneSpec[]=[],seen=new Set<string>(),historical=new Set([...scenesFor(DEFAULT_MANIFEST),...protocol.prior_exposed_geometry_cases].filter(s=>s.cable!==null).map(geometryKey));
const tuningSeeds=new Set(protocol.geometries.tuning.seeds);
for(const split of ['tuning','held_out'] as const){
  const spec=protocol.geometries[split];
  if(!spec.families.length||!spec.seeds.length||new Set(spec.families).size!==spec.families.length||new Set(spec.seeds).size!==spec.seeds.length)throw new Error('Empty or duplicate scene dimensions');
  for(const family of spec.families)for(const seed of spec.seeds){
    if(!SCENE_FAMILIES.includes(family)||!Number.isInteger(seed)||seed<0||seed>0xffffffff||(split==='held_out'&&tuningSeeds.has(seed)))throw new Error('Invalid or overlapping scene split');
    const scene=generateScene(family,seed,split),key=geometryKey(scene);
    if(scene.cable!==null&&(historical.has(key)||seen.has(key)))throw new Error('Prospective positive geometry aliases another input');
    seen.add(key);scenes.push(scene);
  }
}
if(protocol.planned_counts.total_geometry_clusters!==undefined&&new Set(scenes.map(geometryKey)).size!==protocol.planned_counts.total_geometry_clusters)throw new Error('Geometry cluster denominator mismatch');
for(const values of Object.values(protocol.factors))if(!values.length||new Set(values).size!==values.length||values.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Invalid factor grid');
for(const baseline of protocol.factors.baselines_mm)createStereoModel(baseline);
const cells:Cell[]=[];
for(const scene of scenes)for(const diameterMm of protocol.factors.diameters_mm)for(const resolutionPx of protocol.factors.resolutions_px)for(const widthPx of protocol.factors.width_thresholds_px){
  if(diameterMm<0.5||diameterMm>100||!Number.isInteger(resolutionPx)||resolutionPx<16||resolutionPx>640)throw new Error('Factor outside model bounds');
  const shared={sceneId:scene.sceneId,diameterMm,resolutionPx,widthPx};
  cells.push({...shared,baselineMm:null,arm:'legacy'});
  for(const baselineMm of protocol.factors.baselines_mm)for(const arm of ['stereo_legacy_control','stereo_conservative_control'] as const)cells.push({...shared,baselineMm,arm});
}
if(cells.length!==protocol.planned_counts.total_cells||new Set(cells.map(c=>canonicalJson(c))).size!==cells.length)throw new Error('Denominator mismatch');
const input={protocolSha256:hash(protocolBytes),protocol,scenes,cells},inputText=canonicalJson(input)+'\n';
mkdirSync(out,{recursive:true});
const lock=resolve(out,'inputs.json'),raw=resolve(out,'raw.jsonl');
if(args.includes('--lock-only')){
  if(existsSync(lock)||existsSync(raw))throw new Error('Refusing to overwrite a prior lock or result');
  writeFileSync(lock,inputText,{flag:'wx'});
  console.log(JSON.stringify({locked:true,inputSha256:hash(inputText),scenes:scenes.length,cells:cells.length}));
}else{
  if(!existsSync(lock)||readFileSync(lock,'utf8')!==inputText)throw new Error('Inputs differ from the prospective lock');
  const sources=()=>Object.fromEntries(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean).map(name=>[name,hash(readFileSync(name))]));
  const before=sources(),recordedSources=args.includes('--reconstruct')?JSON.parse(readFileSync(resolve(out,'source-manifest.json'),'utf8')) as Record<string,string>:before;
  for(const [name,digest] of Object.entries(recordedSources))if((name.startsWith('src/engine/')||name==='scripts/evaluate-stereo.ts'||name.startsWith('shared/')||name.startsWith('package')||name.startsWith('tsconfig'))&&before[name]!==digest)throw new Error(`Study implementation changed: ${name}`);
  const runCell=async(inputCell:Cell):Promise<RecordRow>=>{
    const cell:Cell={sceneId:inputCell.sceneId,diameterMm:inputCell.diameterMm,resolutionPx:inputCell.resolutionPx,widthPx:inputCell.widthPx,baselineMm:inputCell.baselineMm,arm:inputCell.arm};
    const start=performance.now(),scene=scenes.find(s=>s.sceneId===cell.sceneId)!;
    const scenario=buildScenario(scene,cell.diameterMm/1000),base=buildSensorConfig(DEFAULT_MANIFEST,cell.resolutionPx,cell.widthPx),sensor=base.sensors[0]!;
    const model=cell.baselineMm===null?null:createStereoModel(cell.baselineMm);
    const config=model?bindStereoConfig(base,model):base;
    const source=analyticSampler(scenario,sensor,undefined,false,model!==null);
    const sample=model?boundedStereoSampler(source,sensor,model):source;
    const observations={diagnostic:{accepted:0,rejected:0},reactive:{accepted:0,rejected:0}};
    let previous=-Infinity,phase:'diagnostic'|'reactive'='diagnostic';
    const measured:SampleSensor=(pose:Pose)=>{
      const along=-pose.positionM[2];if(along<previous-1e-6)phase='reactive';previous=along;
      const frame=sample(pose);observations[phase].accepted+=frame.stereo?.accepted??frame.points.length;observations[phase].rejected+=frame.stereo?.rejected??0;return frame;
    };
    const result=await evaluate(scenario,config,{sample:measured,controller:cell.arm==='stereo_conservative_control'?'conservative-v2':'legacy',runId:hash(canonicalJson(cell)).slice(0,20),completedAt:'2026-10-15T00:00:00.000Z'});
    const oracle=model?stereoOracleForScenario(scenario,sensor,model,DEFAULT_MANIFEST.boundaryToleranceM):oracleForScenario(scenario,sensor,DEFAULT_MANIFEST.boundaryToleranceM);
    const finding=result.run.findings.find(f=>f.hazardId==='cable')??null;
    const deterministic={...cell,split:scene.split,family:scene.family,seed:scene.seed,geometryId:hash(geometryKey(scene)),config:result.run.config,engineVersion:result.run.engineVersion,
      coverage:result.run.coverage,outcome:result.run.outcome,finding,oracle,
      agreement:oracle&&finding?compareWithEvaluator(oracle,finding.status):'no_cable',
      reactiveMiss:oracle?.verdict==='in_time'&&result.run.outcome.collisions!>0,pointObservations:observations};
    return {...deterministic,deterministicDigest:hash(canonicalJson(deterministic)),runtimeMs:performance.now()-start};
  };
  if(!args.includes('--reconstruct')){
    if(existsSync(raw))throw new Error('Refusing to overwrite raw results');
    writeFileSync(raw,'',{flag:'wx'});
    for(const [index,cell] of cells.entries()){
      appendFileSync(raw,JSON.stringify(await runCell(cell))+'\n');
      if((index+1)%100===0)console.log(JSON.stringify({completed:index+1,total:cells.length}));
    }
  }
  const rows=readFileSync(raw,'utf8').trim().split('\n').map(line=>JSON.parse(line) as RecordRow);
  if(rows.length!==cells.length)throw new Error('Incomplete raw denominator');
  for(const [index,row] of rows.entries()){
    const {runtimeMs,deterministicDigest,...deterministic}=row;
    const expected=cells[index]!;
    if(Object.entries(expected).some(([k,v])=>row[k as keyof Cell]!==v)||hash(canonicalJson(deterministic))!==deterministicDigest||!Number.isFinite(runtimeMs))throw new Error('Raw cell identity or digest mismatch');
  }
  const counts=(values:RecordRow[])=>({cells:values.length,collisions:values.reduce((n,r)=>n+(r.outcome.collisions??0),0),stops:values.reduce((n,r)=>n+(r.outcome.stopEvents??0),0),falseStops:values.reduce((n,r)=>n+(r.outcome.falseStopEvents??0),0),reactiveMisses:values.filter(r=>r.reactiveMiss).length,
    agreement:Object.fromEntries([...new Set(values.map(r=>r.agreement))].sort().map(k=>[k,values.filter(r=>r.agreement===k).length])),
    diagnosticPointObservations:values.reduce((n,r)=>({accepted:n.accepted+r.pointObservations.diagnostic.accepted,rejected:n.rejected+r.pointObservations.diagnostic.rejected}),{accepted:0,rejected:0})});
  const held=rows.filter(r=>r.split==='held_out'),arms=['legacy','stereo_legacy_control','stereo_conservative_control'] as const;
  const pairKey=(r:RecordRow)=>canonicalJson([r.sceneId,r.diameterMm,r.resolutionPx,r.widthPx,r.baselineMm]);
  const ordinary=new Map(held.filter(r=>r.arm==='stereo_legacy_control').map(r=>[pairKey(r),r]));
  const controlled=held.filter(r=>r.arm==='stereo_conservative_control');
  for(const r of controlled){const prior=ordinary.get(pairKey(r))!;if(!prior||canonicalJson(r.coverage)!==canonicalJson(prior.coverage)||canonicalJson(r.finding)!==canonicalJson(prior.finding)||canonicalJson(r.pointObservations.diagnostic)!==canonicalJson(prior.pointObservations.diagnostic))throw new Error('Controller arms changed diagnostic sensor inputs');}
  const geometryIds=[...new Set(controlled.map(r=>r.geometryId))];
  const geometryDiffs=geometryIds.map(id=>{const paired=controlled.filter(r=>r.geometryId===id);return {geometryId:id,sceneIds:[...new Set(paired.map(r=>r.sceneId))],collisionDelta:paired.reduce((n,r)=>n+(r.outcome.collisions??0)-(ordinary.get(pairKey(r))!.outcome.collisions??0),0)/paired.length,falseStopDelta:paired.reduce((n,r)=>n+(r.outcome.falseStopEvents??0)-(ordinary.get(pairKey(r))!.outcome.falseStopEvents??0),0)/paired.length};});
  const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
  const rng=mulberry32(protocol.analysis.bootstrap_seed),boot:{collisionDelta:number[];falseStopDelta:number[]}={collisionDelta:[],falseStopDelta:[]};
  for(let i=0;i<protocol.analysis.bootstrap_replicates;i++){const draw=geometryDiffs.map(()=>geometryDiffs[Math.floor(rng()*geometryDiffs.length)]!);for(const key of ['collisionDelta','falseStopDelta'] as const)boot[key].push(mean(draw.map(d=>d[key])));}
  const interval=(v:number[])=>{v.sort((a,b)=>a-b);return [v[Math.floor(0.025*(v.length-1))],v[Math.ceil(0.975*(v.length-1))]];};
  const visibilityErrors=rows.filter(r=>r.arm!=='legacy'&&['algorithmic_miss','false_alert','encounter_mismatch'].includes(r.agreement));
  const summary={protocolSha256:hash(protocolBytes),inputSha256:hash(inputText),rawSha256:hash(readFileSync(raw)),sourceSha256:hash(canonicalJson(recordedSources)),
    visibilityCorrectness:{status:visibilityErrors.length?'FAIL':'PASS',newModelErrors:visibilityErrors.length,scope:'Finite declared-model implementation check. Controller collisions and false stops remain separate measured outcomes, not hidden or relabeled.',errors:visibilityErrors.map(r=>({sceneId:r.sceneId,diameterMm:r.diameterMm,resolutionPx:r.resolutionPx,widthPx:r.widthPx,baselineMm:r.baselineMm,arm:r.arm,agreement:r.agreement}))},
    countsBySplitAndArm:Object.fromEntries(['tuning','held_out'].map(split=>[split,Object.fromEntries(arms.map(arm=>[arm,counts(rows.filter(r=>r.split===split&&r.arm===arm))]))])),
    heldOutByFamily:Object.fromEntries(protocol.geometries.held_out.families.map(family=>[family,Object.fromEntries(arms.map(arm=>[arm,counts(held.filter(r=>r.family===family&&r.arm===arm))]))])),
    heldOutByBaseline:Object.fromEntries(protocol.factors.baselines_mm.map(b=>[b,Object.fromEntries(arms.filter(a=>a!=='legacy').map(arm=>[arm,counts(held.filter(r=>r.baselineMm===b&&r.arm===arm))]))])),
    pairedController:{unit:'canonical held-out cable/box geometry; identical null replicas share one cluster; factor cells averaged within geometry',falseStopDeltaUnit:'false-stop events per matched cell, not conditional false-stop percentage',geometries:geometryDiffs.length,geometryDiffs,collisionRateDelta:{point:mean(geometryDiffs.map(d=>d.collisionDelta)),ci95:interval(boot.collisionDelta)},falseStopRateDelta:{point:mean(geometryDiffs.map(d=>d.falseStopDelta)),ci95:interval(boot.falseStopDelta)}},
    limits:['Declared synthetic quantization/matching bound, not fitted or physically calibrated depth noise.','Four held-out seeds per family; uncertainty is over this finite generator, not real sites.','False stops, oracle disagreements, sensor-limited cases and all adverse axes retained.','Ideal-depth historical results remain a separate model and source-bound study.']};
  const text=JSON.stringify(summary,null,2)+'\n';
  if(args.includes('--reconstruct')){
    if(readFileSync(resolve(out,'summary.json'),'utf8')!==text)throw new Error('Summary reconstruction differs');
    const repeat=held.slice(0,24);for(const row of repeat)if((await runCell(row)).deterministicDigest!==row.deterministicDigest)throw new Error('Deterministic replay mismatch');
    const receipt=JSON.stringify({summaryExact:true,replayedCells:repeat.length,deterministicReplayExact:true,rawSha256:hash(readFileSync(raw))},null,2)+'\n',path=resolve(out,'reconstruction.json');
    if(existsSync(path)){if(readFileSync(path,'utf8')!==receipt)throw new Error('Existing reconstruction receipt differs');}else writeFileSync(path,receipt,{flag:'wx'});
  }else{
    writeFileSync(resolve(out,'summary.json'),text,{flag:'wx'});
    writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
  }
  if(canonicalJson(before)!==canonicalJson(sources()))throw new Error('Source changed during study');
  console.log(JSON.stringify({completed:rows.length,reconstructed:args.includes('--reconstruct'),summary:resolve(out,'summary.json')}));
  if(visibilityErrors.length)process.exitCode=2;
}
