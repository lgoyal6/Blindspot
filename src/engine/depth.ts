import * as THREE from 'three';
import type { Pose, Scenario, StereoSensor } from '../../shared/contracts';
import { BOUNDED_SAMPLE_SPACING_M,analyticSampler, backProject, cameraPose, intrinsics, projectedCableWidth, type SensorFrame } from './sensor';
import { degradeStereoFrame, validateStereoModel, type StereoModel } from './stereo-model';
import { localPoint, worldPoint } from './math';
import { OcclusionIndex } from './occlusion';

export function depthMaterial(id:number,far:number) {
  return new THREE.ShaderMaterial({uniforms:{objectId:{value:id},farPlane:{value:far}},side:THREE.DoubleSide,blending:THREE.NoBlending,toneMapped:false,
    vertexShader:'varying float axialDepth; varying vec3 worldPosition; void main(){worldPosition=(modelMatrix*vec4(position,1.0)).xyz;vec4 view=modelViewMatrix*vec4(position,1.0);axialDepth=-view.z;gl_Position=projectionMatrix*view;}',
    fragmentShader:'precision highp float; varying float axialDepth; varying vec3 worldPosition; uniform float farPlane; uniform float objectId; void main(){vec3 normal=normalize(cross(dFdx(worldPosition),dFdy(worldPosition)));if(objectId<1.5&&abs(worldPosition.y)<0.08&&abs(normal.y)>0.85)discard;vec3 packed=fract((axialDepth/farPlane)*vec3(1.0,255.0,65025.0));packed.xy-=packed.yz/255.0;gl_FragColor=vec4(packed,objectId/255.0);}',
  });
}
export class DepthSensor {
  readonly diagnostics={rasterPixels:0,nearestDepth:Infinity,farthestDepth:0};
  private target:THREE.WebGLRenderTarget;
  private bytes:Uint8Array;
  private camera:THREE.PerspectiveCamera;
  private occluders:OcclusionIndex;
  private analytic:ReturnType<typeof analyticSampler>;
  constructor(private renderer:THREE.WebGLRenderer,private proxy:THREE.Scene,private scenario:Scenario,private sensor:StereoSensor,private options:{stereo?:StereoModel;boundedSupport?:boolean}={}) {
    if(options.stereo)validateStereoModel(options.stereo);
    this.target=new THREE.WebGLRenderTarget(sensor.widthPx,sensor.heightPx,{type:THREE.UnsignedByteType,format:THREE.RGBAFormat,depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    this.target.texture.colorSpace=THREE.NoColorSpace;this.bytes=new Uint8Array(sensor.widthPx*sensor.heightPx*4);
    const verticalFov=2*Math.atan(Math.tan(sensor.horizontalFovRad/2)*sensor.heightPx/sensor.widthPx);
    this.camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(verticalFov),sensor.widthPx/sensor.heightPx,sensor.nearM,sensor.farM);
    this.proxy.updateMatrixWorld(true);this.occluders=new OcclusionIndex(proxy);
    this.analytic=analyticSampler(scenario,sensor,(a,b,ignoreId)=>this.occluders.occluded(a,b,ignoreId),true,!!options.stereo||!!options.boundedSupport,options.stereo?BOUNDED_SAMPLE_SPACING_M:0);
  }
  capture=(pose:Pose):SensorFrame=>{
    const c=cameraPose(pose,this.sensor);this.camera.position.set(...c.positionM);this.camera.quaternion.set(...c.orientation);this.camera.updateMatrixWorld(true);
    const oldTarget=this.renderer.getRenderTarget(),oldViewport=this.renderer.getViewport(new THREE.Vector4()),oldScissor=this.renderer.getScissor(new THREE.Vector4()),scissorTest=this.renderer.getScissorTest(),clear=this.renderer.getClearColor(new THREE.Color()),alpha=this.renderer.getClearAlpha();
    // RenderTarget owns a physical-pixel viewport. setViewport would apply display DPR again.
    try{this.renderer.setScissorTest(false);this.renderer.setRenderTarget(this.target);this.renderer.setClearColor(0,0);this.renderer.clear();this.renderer.render(this.proxy,this.camera);this.renderer.readRenderTargetPixels(this.target,0,0,this.sensor.widthPx,this.sensor.heightPx,this.bytes);}
    finally{this.renderer.setRenderTarget(oldTarget);this.renderer.setViewport(oldViewport);this.renderer.setScissor(oldScissor);this.renderer.setScissorTest(scissorTest);this.renderer.setClearColor(clear,alpha);}
    const frame:SensorFrame={points:[],candidates:[],unknown:[],method:'analytic_with_occlusion'};
    this.diagnostics.rasterPixels=0;this.diagnostics.nearestDepth=Infinity;this.diagnostics.farthestDepth=0;
    const candidates=new Set<string>();
    for(let y=0;y<this.sensor.heightPx;y++)for(let x=0;x<this.sensor.widthPx;x++){
      const i=(y*this.sensor.widthPx+x)*4,id=this.bytes[i+3]!;if(!id)continue;
      const depth=(this.bytes[i]!/255+this.bytes[i+1]!/65025+this.bytes[i+2]!/16581375)*this.sensor.farM;
      ++this.diagnostics.rasterPixels;this.diagnostics.nearestDepth=Math.min(this.diagnostics.nearestDepth,depth);this.diagnostics.farthestDepth=Math.max(this.diagnostics.farthestDepth,depth);
      const point=backProject(x+0.5,this.sensor.heightPx-y-0.5,depth,this.sensor);if(!point)continue;
      const wp=worldPoint(point,c),local=localPoint(wp,pose);if(local[1]<0.03||local[1]>this.scenario.platform.heightM)continue;
      const h=this.scenario.hazards[id-2];
      if(h){candidates.add(h.id);if(h.geometry.kind==='cable'&&projectedCableWidth(h.geometry.diameterM,depth,this.sensor)<this.sensor.minResolvableWidthPx)continue;}
      frame.points.push({positionM:wp,...(h?{hazardId:h.id}:{}),...((this.options.stereo||this.options.boundedSupport)?{supportRadiusM:Math.SQRT2*depth/(2*intrinsics(this.sensor).fx)}:{})});
    }
    // Exact cable candidates recover subpixel raster aliasing. Their rays still test proxy occlusion.
    const analytic=this.analytic(pose);
    for(const id of analytic.candidates)candidates.add(id);
    for(const point of analytic.points)if(this.scenario.hazards.find(h=>h.id===point.hazardId)?.geometry.kind==='cable')frame.points.push(point);
    frame.candidates=[...candidates];return this.options.stereo?degradeStereoFrame(frame,pose,this.sensor,this.options.stereo):frame;
  };
  dispose(){this.target.dispose();}
}
