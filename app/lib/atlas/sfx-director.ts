import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type SfxEvent = {
  id: string; shot_id: string; at: number; duration: number; prompt: string;
  volume: number; fade_in: number; fade_out: number; mix_db: number; reason: string; source_path?: string;
};
type SfxPlan = { events: SfxEvent[] };

const schema = {
  type: "object", additionalProperties: false,
  properties: { events: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, shot_id:{type:"string"}, at:{type:"number"}, duration:{type:"number"}, prompt:{type:"string"}, volume:{type:"number"}, fade_in:{type:"number"}, fade_out:{type:"number"}, mix_db:{type:"number"}, reason:{type:"string"} },
    required:["id","shot_id","at","duration","prompt","volume","fade_in","fade_out","mix_db","reason"] } } },
  required:["events"]
} as const;

const openaiKey = process.env.OPENAI_API_KEY;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

async function findFfmpeg(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd,"node_modules","ffmpeg-static","ffmpeg.exe"),
    path.join(cwd,"atlas-scene","node_modules","ffmpeg-static","ffmpeg.exe"),
    "C:\\Users\\EPIVATIKOS\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe",
  ];
  for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch {} }
  try {
    const {stdout}=await execFileAsync("where.exe",["ffmpeg"],{windowsHide:true,maxBuffer:1024*1024});
    const found=stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean); if(found) return found;
  } catch {}
  throw new Error("ATLAS SFX DIRECTOR: FFmpeg executable was not found.");
}
function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n));}
function safeDuration(n:unknown){return clamp(Number(n)||0.65,0.25,1.8);}
function cleanEvent(event:any,shots:any[]):SfxEvent|null{
  const shot=shots.find(x=>String(x.id)===String(event?.shot_id)); if(!shot)return null;
  const shotDuration=Math.max(0.25,Number(shot.end||0)-Number(shot.start||0));
  const at=clamp(Number(event?.at)||0,0,Math.max(0,shotDuration-0.05));
  const duration=Math.min(safeDuration(event?.duration),Math.max(0.25,shotDuration-at+0.15));
  const prompt=String(event?.prompt||"").trim(); if(!prompt)return null;
  return {id:String(event.id||crypto.randomUUID()),shot_id:String(shot.id),at:Number(at.toFixed(3)),duration:Number(duration.toFixed(3)),prompt:prompt.slice(0,440),volume:clamp(Number(event?.volume)||0.14,0.06,0.26),fade_in:clamp(Number(event?.fade_in)||0.025,0,0.12),fade_out:clamp(Number(event?.fade_out)||0.08,0.02,0.22),mix_db:clamp(Number(event?.mix_db)||-18,-30,-10),reason:String(event?.reason||"Motivated by visible action").slice(0,300)};
}

async function extractFrames(files:File[],shots:any[]):Promise<{content:any[];tempDir:string}>{
  const ffmpeg=await findFfmpeg(); const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),"atlas-sfx-director-"));
  const clipsDir=path.join(tempDir,"clips"),framesDir=path.join(tempDir,"frames"); await fs.mkdir(clipsDir); await fs.mkdir(framesDir);
  const written=new Map<string,string>();
  for(const file of files){const ext=(file.name.split(".").pop()||"mp4").toLowerCase();const safe=["mp4","mov","m4v","webm","mkv","avi"].includes(ext)?ext:"mp4";const filePath=path.join(clipsDir,`${crypto.createHash("sha1").update(file.name).digest("hex").slice(0,12)}.${safe}`);await fs.writeFile(filePath,Buffer.from(await file.arrayBuffer()));written.set(file.name,filePath);}
  const content:any[]=[];
  for(const shot of shots.slice(0,12)){
    const clipPath=written.get(String(shot.source_filename)); if(!clipPath){console.warn(`[ATLAS SFX DIRECTOR] missing source | shot=${shot.id} | file=${shot.source_filename}`);continue;}
    const start=Math.max(0,Number(shot.start)||0),end=Math.max(start+0.25,Number(shot.end)||start+1),duration=Math.max(0.25,end-start),mid=start+duration*0.5;
    const sampleTimes=[["start",start+Math.min(0.08,duration*0.08)],["early",start+duration*0.25],["mid",mid],["late",start+duration*0.75],["pre_end",Math.max(start,end-Math.min(0.12,duration*0.12))],["end",Math.max(start,end-0.03)]] as const;
    for(const [label,time] of sampleTimes){const framePath=path.join(framesDir,`${String(shot.id).replace(/[^a-z0-9_-]/gi,"_")}-${label}.jpg`);try{await execFileAsync(ffmpeg,["-y","-ss",time.toFixed(3),"-i",clipPath,"-frames:v","1","-vf","scale=480:-2:flags=lanczos","-q:v","5",framePath],{windowsHide:true,maxBuffer:4*1024*1024});const bytes=await fs.readFile(framePath);content.push({type:"input_image",image_url:`data:image/jpeg;base64,${bytes.toString("base64")}`});content.push({type:"input_text",text:`VISUAL SAMPLE | shot=${shot.id} | ${label} | source_time=${time.toFixed(2)}s`});}catch(error){console.warn("[ATLAS SFX DIRECTOR] frame extraction failed",shot.id,label,error);}}
  }
  return {content,tempDir};
}

async function askSfxDirector(content:any[],shots:any[]):Promise<SfxEvent[]>{
  if(!openai)throw new Error("ATLAS SFX DIRECTOR: OPENAI_API_KEY is missing.");
  const timelineSummary=shots.map((shot:any,index:number)=>({index:index+1,id:String(shot.id),role:String(shot.role||"STORY"),source_filename:String(shot.source_filename),source_start:Number(shot.start),source_end:Number(shot.end),duration:Math.max(0.25,Number(shot.end)-Number(shot.start)),purpose:String(shot.purpose||""),visual_action:String(shot.visual_action||shot.motion||""),motion:String(shot.motion||""),transition_in:String(shot.transition_in||"CUT"),transition_out:String(shot.transition_out||"CUT"),music_intensity:Number(shot.music_intensity||shot.music_volume||0),text:String(shot.on_screen_text||"")}));
  const prompt=`You are the ATLAS SFX DIRECTOR. You are the professional sound designer for the ENTIRE executable Reel. You are NOT a soundboard. Do NOT fill silence with random effects.

Analyze the complete timeline together with ALL supplied temporal visual samples.

PRIMARY GOAL: Make the Reel feel like a professionally sound-designed premium commercial. Sound must feel intentional, physical, subtle and synchronized to what the viewer actually sees.

HARD RULES:
1. Silence is valid and often better than unnecessary SFX.
2. Every SFX MUST have a concrete visual or editorial reason.
3. Never invent an action that is not visible or strongly implied.
4. Prefer authentic physical Foley over cinematic effects.
5. Whooshes/impacts only when movement, reveal, typography or transition motivates them.
6. Never use generic notification sounds or random filler pops.
7. Do not place an SFX on every shot.
8. Maximum 8 total SFX; maximum 1 primary physical SFX per shot.
9. Never place two SFX within 0.35 seconds on the global timeline.
10. Voice has highest priority; SFX stay clearly below voice.
11. SFX should be short, clean, realistic and premium.
12. Do not create long ambience.
13. Generate one individual sound for one individual event.
14. Do not ask the generator for music, dialogue or multiple events.
15. The generation prompt describes ONLY the desired sound.
16. If a beat is visually weak for sound, use no SFX.
17. CTA may have one restrained premium accent.
18. Do not use an SFX merely because there is a cut.

TIMING: 'at' is LOCAL time inside the shot. Use the six temporal samples to locate the actual action; never default to shot center. For a transient action, place 'at' within roughly 0.10s of the visible action when the samples support it.

STABLE AUDIO PROMPT: Write a highly specific Stable Audio 3 Small SFX sound-generation prompt, maximum 440 characters. Describe ONE sound only. Include physical source, action, material, environment, close-mic/recording perspective, transient and texture when useful. No music, voiceover, dialogue, editing instructions or unrelated sounds. Prefer concrete acoustic language: dry close-mic foley, crisp transient, short decay, realistic physical texture.

If two shots have similar actions, choose the strongest moment instead of duplicating them.

EXECUTABLE TIMELINE:
${JSON.stringify(timelineSummary)}

Return JSON only.`;
  const result=await openai.responses.create({model:"gpt-5.4-mini",store:false,input:[{role:"user",content:[{type:"input_text",text:prompt},...content]}],text:{format:{type:"json_schema",name:"atlas_sfx_director_v2",strict:true,schema}}});
  if(!result.output_text)throw new Error("ATLAS SFX DIRECTOR returned no result.");
  const parsed=JSON.parse(result.output_text) as SfxPlan;
  const cleaned=(Array.isArray(parsed.events)?parsed.events:[]).map(e=>cleanEvent(e,shots)).filter(Boolean) as SfxEvent[];
  cleaned.sort((a,b)=>{const ai=shots.findIndex((s:any)=>String(s.id)===a.shot_id),bi=shots.findIndex((s:any)=>String(s.id)===b.shot_id);return ai-bi||a.at-b.at;});
  const limited:SfxEvent[]=[];
  for(const event of cleaned){const previous=limited[limited.length-1];if(limited.filter(x=>x.shot_id===event.shot_id).length>=1)continue;if(previous&&Math.abs(event.at-previous.at)<0.35)continue;limited.push(event);if(limited.length>=8)break;}
  return limited;
}

async function generateOne(event:SfxEvent,outputDir:string):Promise<SfxEvent>{
  const hash=crypto.createHash("sha1").update(`${event.prompt}|${event.duration.toFixed(2)}`).digest("hex").slice(0,16);const outputPath=path.join(outputDir,`${hash}.wav`);
  try{await fs.access(outputPath);console.log(`[ATLAS AI SFX] CACHE HIT | ${event.id}`);return {...event,source_path:outputPath};}catch{}
  const pythonExe=path.join(process.cwd(),".stable-audio-3",".venv","Scripts","python.exe"),generator=path.join(process.cwd(),"scripts","sfx","generate.py");
  try{await fs.access(pythonExe);await fs.access(generator);}catch{throw new Error("ATLAS LOCAL SFX: Stable Audio runtime not found at .stable-audio-3/.venv.");}
  const seed=Number.parseInt(hash.slice(0,8),16);console.log(`[ATLAS AI SFX] GENERATING LOCAL | ${event.id} | duration=${event.duration.toFixed(2)} | seed=${seed}`);await fs.mkdir(outputDir,{recursive:true});
  const {stdout,stderr}=await execFileAsync(pythonExe,[generator,"--prompt",event.prompt,"--duration",event.duration.toFixed(3),"--seed",String(seed),"--output",outputPath],{windowsHide:true,maxBuffer:8*1024*1024,cwd:process.cwd(),env:{...process.env}});
  if(stderr?.trim())console.log(`[ATLAS LOCAL SFX] stderr | ${stderr.trim().slice(-1200)}`);if(stdout?.trim())console.log(`[ATLAS LOCAL SFX] ${stdout.trim().slice(-1200)}`);await fs.access(outputPath);console.log(`[ATLAS AI SFX] GENERATED LOCAL | ${event.id} | ${outputPath}`);return {...event,source_path:outputPath};
}

export async function designAndGenerateSfx(files:File[],shots:any[]):Promise<{shots:any[];events:SfxEvent[]}>{
  const enabled=String(process.env.ATLAS_AI_SFX_ENABLED||"").toLowerCase()==="true";console.log(`[ATLAS SFX DIRECTOR] STATUS | enabled=${enabled}`);if(!enabled){console.log("[ATLAS SFX DIRECTOR] disabled by ATLAS_AI_SFX_ENABLED=false");return{shots,events:[]};}if(!openai)throw new Error("ATLAS SFX DIRECTOR: OPENAI_API_KEY is missing.");
  console.log(`[ATLAS SFX DIRECTOR] START | beats=${shots.length} | files=${files.length}`);const {content,tempDir}=await extractFrames(files,shots);const generatedDir=path.join(process.cwd(),"public",".atlas-sfx-cache");await fs.mkdir(generatedDir,{recursive:true});
  try{console.log(`[ATLAS SFX DIRECTOR] ANALYZING TIMELINE | beats=${shots.length} | visualSamples=${content.filter((x)=>x.type==="input_image").length}`);const events=await askSfxDirector(content,shots);console.log(`[ATLAS SFX DIRECTOR] PLAN | events=${events.length}`);for(const event of events){console.log(`[ATLAS AI SFX PLAN] ${event.id} | shot=${event.shot_id} | at=${event.at.toFixed(2)} | duration=${event.duration.toFixed(2)} | vol=${event.volume.toFixed(2)} | reason=${event.reason}`);console.log(`[ATLAS AI SFX PROMPT] ${event.id} | ${event.prompt}`);}const generated:SfxEvent[]=[];let generationFailed=0;for(const event of events){try{generated.push(await generateOne(event,generatedDir));}catch(error){generationFailed++;console.warn(`[ATLAS AI SFX] FAILED | ${event.id}`,error);}}console.log(`[ATLAS SFX DIRECTOR] COMPLETE | planned=${events.length} | generated=${generated.length} | failed=${generationFailed}`);const byShot=new Map<string,SfxEvent[]>();for(const event of generated){const list=byShot.get(event.shot_id)||[];list.push(event);byShot.set(event.shot_id,list);}const nextShots=shots.map((shot:any)=>{const shotEvents=byShot.get(String(shot.id))||[];return{...shot,sfx_events:shotEvents.map(event=>({type:"AI_GENERATED",at:event.at,duration:event.duration,volume:event.volume,fadeIn:event.fade_in,fadeOut:event.fade_out,mix_db:event.mix_db,reason:event.reason,prompt:event.prompt,source_path:event.source_path}))};});return{shots:nextShots,events:generated};}finally{await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{});}
}
