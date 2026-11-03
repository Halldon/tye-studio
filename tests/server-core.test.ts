import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverRoot = resolve(root, "app/lib/server");
const dataModule = (source: string) => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
/** Execute actual source modules under Node, replacing only platform-owned bindings. */
async function sourceModule(name: string, stubs: Record<string, string> = {}) {
  const cache = new Map<string, string>();
  async function build(file: string): Promise<string> {
    if (stubs[file]) return dataModule(stubs[file]);
    if (cache.has(file)) return cache.get(file)!;
    const source = await readFile(file, "utf8");
    let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const match of [...code.matchAll(/from\s+["']([^"']+)["']/g)]) {
      const specifier = match[1];
      const url = stubs[specifier] ? dataModule(stubs[specifier]) : specifier.startsWith(".") ? await build(resolve(dirname(file), specifier + (specifier.endsWith(".ts") ? "" : ".ts"))) : import.meta.resolve(specifier);
      code = code.replace(match[0], "from " + JSON.stringify(url));
    }
    const result = dataModule(code); cache.set(file, result); return result;
  }
  return import(await build(resolve(serverRoot, name + ".ts")));
}
async function memoryDb(migrationCount?: number) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = (await readdir(resolve(root, "drizzle"))).filter(f => f.endsWith(".sql")).sort();
  for (const file of migrationCount === undefined ? migrations : migrations.slice(0,migrationCount)) sqlite.exec(await readFile(resolve(root, "drizzle", file), "utf8"));
  let batchQueue: Promise<unknown> = Promise.resolve();
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const prepared = (values: unknown[] = []) => ({
        bind: (...args: unknown[]) => prepared(args),
        first: async () => statement.get(...values as never[]) || null,
        all: async () => ({ results: statement.all(...values as never[]) }),
        run: async () => { const result = statement.run(...values as never[]); return { meta: { changes: Number(result.changes) } }; },
      });
      return prepared();
    },
    batch(statements: { run(): Promise<unknown> }[]) {
      const work = batchQueue.then(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
        catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      });
      batchQueue = work.then(() => undefined, () => undefined); return work;
    },
  };
  return { db, sqlite };
}
function memoryBucket() {
  const files = new Map<string, Uint8Array>();
  return { files, put: async (key: string, bytes: Uint8Array) => { files.set(key, bytes); }, delete: async (key: string) => { files.delete(key); }, get: async (key: string) => { const bytes = files.get(key); return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), size: bytes.byteLength, body: new Response(bytes as BodyInit).body } : null; } };
}
const contextStub = 'export function requireStorage(b) { if(!b.DB||!b.BUCKET) throw Error("missing storage"); return {db:b.DB,bucket:b.BUCKET}; }';
function png() { const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); bytes.set([73,72,68,82],12); const view=new DataView(bytes.buffer); view.setUint32(16,1024); view.setUint32(20,1024); return bytes; }

test("engine URLs reject private remote hosts, embedded credentials and untrusted output hosts", async () => {
  const s = await sourceModule("security"); const config = s.engineConfig({});
  assert.equal(config.mode, "cloud-v2"); assert.equal(config.apiKey, null);
  for (const url of ["https://user:pass@cloud.comfy.org", "http://example.com", "https://169.254.169.254", "https://10.0.0.1"]) assert.throws(() => s.engineConfig({ COMFY_BASE_URL: url }));
  for (const url of ["https://cloud.comfy.org.evil.test/file", "http://169.254.169.254/latest/meta-data", "https://example.com/media"]) assert.throws(() => s.allowedUpstreamUrl(url, config));
  assert.equal(s.allowedUpstreamUrl("https://storage.googleapis.com/bucket/output.png", config).hostname, "storage.googleapis.com");
  assert.equal(s.localPreviewAllowed("true", "https://studio.example.com"), false);
  assert.equal(s.localPreviewAllowed("true", "http://127.0.0.1:4000"), true);
  assert.equal(s.localPreviewAllowed(undefined, "http://localhost:4000"), false);
});

test("guarded redirects strip credentials and never repeat a mutation", async () => {
  const { guardedFetch } = await sourceModule("comfy");
  const config = { baseUrl: "https://cloud.comfy.org", mode: "cloud-v2", apiKey: "test-only-not-a-real-key", local: false };
  const seen: { url: string; authorization: string | null }[] = [];
  const fetcher = async (url: string, init: RequestInit) => { seen.push({ url, authorization: new Headers(init.headers).get("Authorization") }); return seen.length === 1 ? new Response(null, { status: 302, headers: { Location: "https://storage.googleapis.com/output.png" } }) : new Response("bytes"); };
  await guardedFetch(config, "https://cloud.comfy.org/api/v2/assets/x/content", { headers: { Authorization: "Bearer test-only-not-a-real-key" } }, fetcher);
  assert.equal(seen.length, 2); assert.ok(seen[0].authorization); assert.equal(seen[1].authorization, null);
  let mutations = 0;
  const response = await guardedFetch(config, "https://cloud.comfy.org/api/v2/jobs", { method: "POST", body: "{}" }, async () => { mutations++; return new Response(null, { status: 307, headers: { Location: "/new" } }); });
  assert.equal(response.status, 307); assert.equal(mutations, 1);
});

test("native recipe graphs wire references and transparent-selected mask without claiming native inpainting", async () => {
  const r = await sourceModule("recipes");
  const p = r.validateGeneration({ recipeId: "qwen-image-edit", prompt: "Change selected area to blue", inputAssetIds: ["owned-image"], maskAssetId: "owned-mask", seed: 42 });
  const g = r.buildWorkflow(p, ["input.png"], {}, "mask.png");
  assert.equal(g["40"].class_type, "LoadImage");
  assert.deepEqual(g["46"].inputs.mask, ["44",1]);
  assert.equal(g["46"].class_type, "ImageCompositeMasked");
  assert.deepEqual(g["46"].inputs.destination, ["40",0]);
  assert.ok(r.RECIPES.find((x: { id: string }) => x.id === p.recipeId).capabilities.includes("masked-composite"));
  assert.throws(() => r.validateGeneration({ recipeId: "flux-klein-4b", prompt: "x", maskAssetId: "mask" }));
  assert.throws(() => r.validateGeneration({ recipeId: "z-image-turbo", prompt: "x", inputAssetIds: ["unexpected"] }));
  assert.throws(() => r.validateGeneration({ recipeId: "wan-2.2-5b", prompt: "x", duration: 8 }));
  const video = r.buildWorkflow(r.validateGeneration({ recipeId: "wan-2.2-5b", prompt: "Camera moves", duration: 2, fps: 24 }));
  assert.equal(video["7"].inputs.length, 49); assert.equal(video["99"].class_type, "SaveVideo");
  assert.equal(video["99"].inputs.format, "mp4");
  assert.equal(video["99"].inputs["format.codec"], "h264");
});

test("engine state never treats node output or unknown status as successful completion", async () => {
  const c = await sourceModule("comfy");
  const running = c.normalizeRawJob("job", { status: { completed: false }, outputs: { "99": { images: [{ filename:"out.png", type:"output" }] } } }, "http://127.0.0.1:8188");
  assert.equal(running.status, "running");
  const canceled = c.normalizeRawJob("job", { status: { completed:true, messages:[["execution_interrupted",{}]] } }, "http://127.0.0.1:8188");
  assert.equal(canceled.status, "canceled");
  assert.equal(c.normalizeV2Job({ id:"j", status:"new-unrecognized-state", outputs:[] }).status, "submission_unknown");
  assert.equal(c.normalizeV2Job({ id:"j", status:"running", progress:{value:0.42, nodes_done:2,nodes_total:5}, outputs:[] }).progress,42);
  assert.equal(c.normalizeV2Job({ id:"j", status:"running", progress:{value:NaN}, outputs:[] }).progress,null);
  assert.throws(() => c.normalizeV2Job({ status:"succeeded" }));
});

test("D1 reads, changes and request replay remain isolated by stable owner", async () => {
  const { db, sqlite } = await memoryDb(); const { Store } = await sourceModule("store");
  const alice = new Store(db,"alice"); const bob = new Store(db,"bob");
  const a = await alice.createProject("A"); await bob.createProject("B");
  assert.equal((await alice.projects()).length,1); assert.equal((await bob.projects())[0].name,"B");
  await assert.rejects(bob.project(a.id), { code:"project_not_found" });
  await assert.rejects(bob.updateProject(a.id,{ name:"stolen" }), { code:"project_not_found" });
  const row = { id:"asset-a", owner_id:"alice", project_id:a.id, job_id:null, name:"a.png", type:"image", mime_type:"image/png", size:24, r2_key:"private-a", width:1024,height:1024,duration:null,starred:0,source:"upload",source_output_id:null,created_at:new Date().toISOString() };
  await alice.insertAsset(row);
  await assert.rejects(bob.asset(row.id), { code:"asset_not_found" });
  await assert.rejects(bob.deleteAsset(row.id), { code:"asset_not_found" });
  const b = (await bob.projects())[0];
  await assert.rejects(alice.updateAsset(row.id,{projectId:b.id}), { code:"project_not_found" });
  const p={recipeId:"z-image-turbo",prompt:"fox",requestId:"same-request",projectId:a.id};
  const first=await alice.createJob(p,"proxy-v2","http://127.0.0.1:8189"); const duplicate=await alice.createJob(p,"proxy-v2","http://127.0.0.1:8189");
  assert.equal(first.created,true);assert.equal(duplicate.created,false);assert.equal(first.row.id,duplicate.row.id);
  await alice.updateJob(first.row.id,{status:"canceling",stage:"Cancel requested"});
  const late=await alice.updateJob(first.row.id,{status:"running",stage:"Generating"});assert.equal(late.status,"canceling");assert.equal(late.stage,"Cancel requested");
  await alice.updateJob(first.row.id,{status:"canceled"});const stale=await alice.updateJob(first.row.id,{status:"running"});assert.equal(stale.status,"canceled");
  await assert.rejects(bob.job(first.row.id),{code:"job_not_found"}); sqlite.close();
});

test("credential encryption uses random nonces, authenticates owner and never stores plaintext", async () => {
  const c = await sourceModule("credentials"); const secret=Buffer.alloc(32,7).toString("base64url"); const apiKey="test-only-comfy-key-never-valid";
  const a=await c.encryptCredential(apiKey,"alice",secret); const b=await c.encryptCredential(apiKey,"alice",secret);
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);assert.ok(!a.ciphertext.includes(apiKey));
  assert.equal(await c.decryptCredential(a,"alice",secret),apiKey);
  await assert.rejects(c.decryptCredential(a,"bob",secret),{code:"saved_connection_unavailable"});
  await assert.rejects(c.decryptCredential({...a,ciphertext:a.ciphertext.slice(0,-2)+"AA"},"alice",secret));
  assert.equal(c.credentialStorageReady("short"),false);
  const {db,sqlite}=await memoryDb();await c.saveCredential(db,"alice",apiKey,secret);
  const stored=sqlite.prepare("SELECT * FROM studio_credentials").get()!;assert.ok(!JSON.stringify(stored).includes(apiKey));assert.equal(await c.savedCredential(db,"bob"),null);
  await c.forgetCredential(db,"alice");assert.equal(await c.savedCredential(db,"alice"),null);sqlite.close();
});

test("local identity requires explicit flag plus loopback and session keys do not mutate runtime env", async () => {
  const c=await sourceModule("context",{"cloudflare:workers":'export const env={TYE_LOCAL_PREVIEW:"true"};',[resolve(root,"app/chatgpt-auth.ts")]:"export async function getChatGPTUser(){return null;}"});
  await assert.rejects(c.requestContext(new Request("https://studio.example.com/api/bootstrap")),{code:"sign_in_required"});
  const local=await c.requestContext(new Request("http://localhost:4000/api/engine",{headers:{"X-Comfy-Api-Key":"test-only-comfy-session-key"}}));
  assert.equal(local.user.localPreview,true);assert.equal(local.bindings.COMFY_API_KEY,"test-only-comfy-session-key");
  const next=await c.requestContext(new Request("http://localhost:4000/api/engine"));assert.equal(next.bindings.COMFY_API_KEY,undefined);
});

test("ambiguous submit is recorded once; duplicate app request never retries GPU work", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();
  const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});
  const original=globalThis.fetch;let submits=0;
  globalThis.fetch=(async (input: RequestInfo | URL,init?:RequestInit)=>{
    if((init?.method||"GET")==="POST"){submits++;throw new TypeError("Connection dropped after accept");}
    return Response.json({});
  }) as typeof fetch;
  try{
    const bindings={DB:db,BUCKET:bucket,COMFY_BASE_URL:"http://127.0.0.1:8189"};const p={recipeId:"z-image-turbo",prompt:"fox",requestId:"stable-client-request"};
    const job=await service.submitGeneration(bindings,"alice",p);assert.equal(job.status,"submission_unknown");assert.equal(submits,1);
    const again=await service.submitGeneration(bindings,"alice",p);assert.equal(again.id,job.id);assert.equal(submits,1);
  }finally{globalThis.fetch=original;sqlite.close();}
});

test("completed output becomes success only after real bytes are persisted and content stays owner-only", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();
  const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});
  const original=globalThis.fetch;globalThis.fetch=(async (input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if((init?.method||"GET")==="POST")return Response.json({id:"engine-job",status:"queued",outputs:[]},{status:201});
    if(url.endsWith("/health"))return Response.json({});
    if(url.endsWith("/api/v2/jobs/engine-job"))return Response.json({id:"engine-job",status:"succeeded",outputs:[{id:"out-a",name:"fox.png",type:"image",url:"http://127.0.0.1:8189/api/v2/assets/out-a/content"}]});
    if(url.includes("/assets/out-a/content"))return new Response(png() as BodyInit,{headers:{"Content-Type":"image/png"}});
    throw Error("Unexpected fetch");
  }) as typeof fetch;
  try{
    const bindings={DB:db,BUCKET:bucket,COMFY_BASE_URL:"http://127.0.0.1:8189"};
    const submitted=await service.submitGeneration(bindings,"alice",{recipeId:"z-image-turbo",prompt:"fox"});assert.equal(submitted.status,"queued");
    const completed=await service.reconcileJob(bindings,"alice",submitted.id);assert.equal(completed.status,"succeeded");assert.equal(completed.outputAssetIds.length,1);assert.equal(bucket.files.size,1);
    await service.reconcileJob(bindings,"alice",submitted.id);assert.equal(bucket.files.size,1);
    await assert.rejects(service.assetContent(bindings,"bob",completed.outputAssetIds[0],new Request("http://localhost/x")),{code:"asset_not_found"});
    const content=await service.assetContent(bindings,"alice",completed.outputAssetIds[0],new Request("http://localhost/x"));assert.equal(content.headers.get("Content-Type"),"image/png");assert.equal((await content.arrayBuffer()).byteLength,24);
  }finally{globalThis.fetch=original;sqlite.close();}
});

test("Cloud connection verifies authenticated v2 read access before using public node metadata", async () => {
  const {ComfyAdapter}=await sourceModule("comfy");const original=globalThis.fetch;let metadataReads=0;let allow=false;
  globalThis.fetch=(async (input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.includes("/api/v2/assets/00000000"))return Response.json({error:{code:allow?"not_found":"unauthorized",message:"test"}},{status:allow?404:401});
    if(url.endsWith("/api/object_info")){metadataReads++;return Response.json({});}
    throw Error("Unexpected probe");
  }) as typeof fetch;
  try{
    const adapter=new ComfyAdapter({baseUrl:"https://cloud.comfy.org",mode:"cloud-v2",apiKey:"test-only-key-not-valid",local:false});
    const denied=await adapter.discover(true);assert.equal(denied.status.connected,false);assert.equal(metadataReads,0);assert.match(denied.status.message,/rejected.*API key/i);
    allow=true;const verified=await adapter.discover(true);assert.equal(verified.status.connected,true);assert.equal(metadataReads,1);assert.match(verified.status.message,/eligibility.*submit/i);
  }finally{globalThis.fetch=original;}
});

test("generated video duration stays unknown instead of copying the request; measured upload duration is preserved", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();
  const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});
  const {Store}=await sourceModule("store");const {validateGeneration}=await sourceModule("recipes");
  const store=new Store(db,"alice");const bindings={DB:db,BUCKET:bucket,COMFY_BASE_URL:"http://127.0.0.1:8189"};
  const p=validateGeneration({recipeId:"wan-2.2-5b",prompt:"Camera moves",width:256,height:256,duration:1,fps:16,steps:4,seed:42});
  const saved=await store.createJob(p,"proxy-v2",bindings.COMFY_BASE_URL);
  await store.updateJob(saved.row.id,{engineJobId:"engine-video",status:"running"});
  // Signature fixture only: inspectMedia does not parse a container duration.
  const bytes=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]);
  const original=globalThis.fetch;globalThis.fetch=(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith("/api/v2/jobs/engine-video"))return Response.json({id:"engine-video",status:"succeeded",outputs:[{id:"video-out",name:"clip.mp4",type:"image",content_type:"video/mp4",url:"http://127.0.0.1:8189/api/v2/assets/video-out/content"}]});
    if(url.endsWith("/assets/video-out/content"))return new Response(bytes,{headers:{"Content-Type":"video/mp4"}});
    throw Error("Unexpected metadata test request");
  }) as typeof fetch;
  try{
    const completed=await service.reconcileJob(bindings,"alice",saved.row.id);assert.equal(completed.status,"succeeded");
    const generated=await store.asset(completed.outputAssetIds[0]);
    assert.equal(generated.type,"video");assert.equal(generated.mime_type,"video/mp4");
    assert.equal(generated.duration,null);assert.equal(completed.parameters.duration,1);
    assert.equal(generated.width,256);assert.equal(generated.height,256);
    const form=new FormData();form.append("file",new Blob([bytes],{type:"video/mp4"}),"measured.mp4");form.append("duration","1.062012");
    const measured=await service.uploadAsset(bindings,"alice",new Request("http://localhost/api/assets",{method:"POST",body:form}));
    assert.equal(measured.duration,1.062012);
  }finally{globalThis.fetch=original;sqlite.close();}
});

test("media body limits cover missing or dishonest length and reject active content", async () => {
  const {boundedBytes,inspectMedia}=await sourceModule("media");
  await assert.rejects(boundedBytes(new Response(new Uint8Array(9),{headers:{"Content-Length":"9"}}),8),{code:"media_too_large"});
  await assert.rejects(boundedBytes(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));c.close();}})),8),{code:"media_too_large"});
  await assert.rejects(boundedBytes(new Response(new Uint8Array(9),{headers:{"Content-Length":"1"}}),8),{code:"media_too_large"});
  assert.throws(()=>inspectMedia(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')),{code:"unsupported_media"});
  assert.equal(inspectMedia(png()).width,1024);
});

test("multipart metadata is bounded, supports fractional durations and never overrides parsed image dimensions", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});
  const bindings={DB:db,BUCKET:bucket};
  const form=new FormData();form.append("file",new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3])],{type:"video/webm"}),"clip.webm");form.append("width","1280");form.append("height","720");form.append("duration","2.375");
  const video=await service.uploadAsset(bindings,"alice",new Request("http://localhost/api/assets",{method:"POST",body:form}));
  assert.equal(video.width,1280);assert.equal(video.duration,2.375);
  const imageForm=new FormData();imageForm.append("file",new Blob([png() as BlobPart],{type:"image/png"}),"image.png");imageForm.append("width","2048");imageForm.append("height","2048");
  const image=await service.uploadAsset(bindings,"alice",new Request("http://localhost/api/assets",{method:"POST",body:imageForm}));assert.equal(image.width,1024);
  const bad=new FormData();bad.append("file",new Blob([png() as BlobPart]),"x.png");bad.append("duration","Infinity");
  await assert.rejects(service.uploadAsset(bindings,"alice",new Request("http://localhost/api/assets",{method:"POST",body:bad})),{code:"invalid_media_metadata"});sqlite.close();
});

test("raw cancellation always uses prompt-scoped atomic endpoint", async () => {
  const {ComfyAdapter}=await sourceModule("comfy");const original=globalThis.fetch;const seen:string[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL)=>{seen.push(String(input));return Response.json({});}) as typeof fetch;
  try{const adapter=new ComfyAdapter({baseUrl:"http://127.0.0.1:8188",mode:"local-raw",apiKey:null,local:true});const result=await adapter.cancel("prompt-123");assert.equal(result.status,"canceling");assert.deepEqual(seen,["http://127.0.0.1:8188/api/jobs/prompt-123/cancel"]);}finally{globalThis.fetch=original;}
});

test("R2 content normalizes suffix/open byte ranges and emits matching seek headers", async () => {
  const {db,sqlite}=await memoryDb(); const {Store}=await sourceModule("store");
  const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub}); const {errorResponse}=await sourceModule("errors");
  const bytes=Uint8Array.from({length:10},(_,i)=>i);
  const bucket={get:async(_key:string,options?:{range?:{offset:number;length:number}})=>({size:bytes.length,body:new Response((options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes) as BodyInit).body})};
  const row={id:"seek-video",owner_id:"alice",project_id:null,job_id:null,name:"clip.mp4",type:"video",mime_type:"video/mp4",size:10,r2_key:"video-key",width:640,height:480,duration:1,starred:0,source:"upload",source_output_id:null,created_at:new Date().toISOString()};
  await new Store(db,"alice").insertAsset(row); const bindings={DB:db,BUCKET:bucket};
  for(const [range,start,end] of [["bytes=-3",7,9],["bytes=2-4",2,4],["bytes=8-",8,9],["bytes=-99",0,9]] as const){
    const response=await service.assetContent(bindings,"alice",row.id,new Request("http://localhost/media",{headers:{Range:range}}));
    assert.equal(response.status,206);assert.equal(response.headers.get("Content-Range"),`bytes ${start}-${end}/10`);assert.equal(Number(response.headers.get("Content-Length")),end-start+1);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(start,end+1));
  }
  for(const range of ["bytes=10-","bytes=5-2","bytes=-0","bytes=-","bytes=0-1,3-4"]){
    try{await service.assetContent(bindings,"alice",row.id,new Request("http://localhost/media",{headers:{Range:range}}));assert.fail("Expected invalid range");}catch(error){const response=errorResponse(error);assert.equal(response.status,416);assert.equal(response.headers.get("Content-Range"),"bytes */10");}
  }
  const full=await service.assetContent(bindings,"alice",row.id,new Request("http://localhost/media"));assert.equal(full.status,200);assert.equal((await full.arrayBuffer()).byteLength,10);sqlite.close();
});

test("JSON reads enforce byte bounds while streaming and preserve split UTF-8", async () => {
  const {readJson}=await sourceModule("errors");
  const oversized=new ReadableStream({start(c){c.enqueue(new Uint8Array(1_000_001));c.close();}});
  await assert.rejects(readJson(new Request("http://localhost/api/projects",{method:"POST",body:oversized,headers:{"Content-Length":"1"},duplex:"half"} as RequestInit)),{code:"request_too_large"});
  const bytes=new TextEncoder().encode('{"prompt":"é"}');const split=bytes.indexOf(0xc3)+1;
  const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,split));c.enqueue(bytes.slice(split));c.close();}});
  assert.deepEqual(await readJson(new Request("http://localhost/api/projects",{method:"POST",body:stream,duplex:"half"} as RequestInit)),{prompt:"é"});
});

function lineageAsset(id:string,ownerId:string,parent:string|null=null,type="image") {
  return {id,owner_id:ownerId,project_id:null,job_id:null,parent_asset_id:parent,name:id+(type==="video"?".mp4":".png"),type,mime_type:type==="video"?"video/mp4":"image/png",size:24,r2_key:"source/"+id,width:720,height:540,duration:type==="video"?2:null,starred:0,source:"upload",source_output_id:null,created_at:new Date().toISOString()};
}

test("append-only lineage migration upgrades existing rows without rewriting history or credentials", async () => {
  const {db,sqlite}=await memoryDb(2);const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO studio_assets (id,owner_id,name,type,mime_type,size,r2_key,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("legacy","alice","legacy.png","image","image/png",24,"legacy-key","upload",now);
  sqlite.prepare("INSERT INTO studio_jobs (id,owner_id,recipe_id,status,prompt,parameters_json,client_request_id,engine_mode,engine_base_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("old-job","alice","z-image-turbo","failed","original prompt",'{"recipeId":"z-image-turbo","prompt":"original prompt"}',"old-request","cloud-v2","https://cloud.comfy.org",now,now);
  sqlite.prepare("INSERT INTO studio_credentials (user_id,ciphertext,iv,updated_at) VALUES (?,?,?,?)").run("alice","encrypted-existing-value","existing-iv",now);
  assert.throws(()=>db.prepare("SELECT parent_asset_id FROM studio_assets"));
  sqlite.exec(await readFile(resolve(root,"drizzle/0002_brave_wolverine.sql"),"utf8"));
  const {Store,assetView}=await sourceModule("store");const store=new Store(db,"alice");const old=await store.asset("legacy");
  assert.equal(old.parent_asset_id,null);assert.equal(old.version_root_id,null);assert.equal(assetView(old).versionRootId,"legacy");assert.equal(assetView(old).parentAssetId,null);
  assert.equal((await store.job("old-job")).prompt,"original prompt");assert.equal((await store.job("old-job")).credential_fingerprint,null);
  assert.equal(sqlite.prepare("SELECT ciphertext FROM studio_credentials WHERE user_id='alice'").get()!.ciphertext,"encrypted-existing-value");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM studio_engine_checks").get()!.n,0);sqlite.close();
});

test("lineage derives roots across branches, restores out of order, and protects ownership/cycles", async () => {
  const {db,sqlite}=await memoryDb();const {Store,assetView}=await sourceModule("store");const alice=new Store(db,"alice"),bob=new Store(db,"bob");
  await alice.insertAsset(lineageAsset("original","alice"));await bob.insertAsset(lineageAsset("foreign","bob"));
  const branch=await alice.insertAsset({...lineageAsset("branch","alice","original"),version_root_id:"foreign"});
  assert.equal(assetView(branch).parentAssetId,"original");assert.equal(assetView(branch).versionRootId,"original");
  const leaf=await alice.insertAsset(lineageAsset("leaf","alice","branch"));const sibling=await alice.insertAsset(lineageAsset("sibling","alice","original"));
  assert.equal(assetView(leaf).versionRootId,"original");assert.equal(assetView(sibling).versionRootId,"original");
  await assert.rejects(alice.insertAsset(lineageAsset("not-owned","alice","foreign")),{code:"parent_asset_not_found"});
  await assert.rejects(alice.insertAsset(lineageAsset("self","alice","self")),{code:"asset_lineage_cycle"});
  await assert.rejects(alice.updateAsset("original",{parentAssetId:"leaf"}),{code:"asset_lineage_cycle"});
  await assert.rejects(alice.updateAsset("leaf",{parentAssetId:"sibling"}),{code:"asset_parent_immutable"});
  await assert.rejects(alice.updateAsset("leaf",{parentAssetId:null}),{code:"asset_parent_immutable"});
  await assert.rejects(alice.deleteAsset("original"),{code:"asset_has_versions"});
  for(const id of ["restore-root","restore-parent","restore-child"])await alice.insertAsset(lineageAsset(id,"alice"));
  await alice.updateAsset("restore-child",{parentAssetId:"restore-parent"});
  assert.equal(assetView(await alice.asset("restore-child")).versionRootId,"restore-parent");
  await alice.updateAsset("restore-parent",{parentAssetId:"restore-root"});
  assert.equal(assetView(await alice.asset("restore-child")).versionRootId,"restore-root");
  // Defense in depth: even corrupt/legacy cross-owner references are never serialized to another user.
  sqlite.prepare("UPDATE studio_assets SET parent_asset_id='foreign',version_root_id='foreign' WHERE id='restore-child'").run();
  const publicRow=assetView(await alice.asset("restore-child"));assert.equal(publicRow.parentAssetId,null);assert.equal(publicRow.versionRootId,"restore-child");
  assert.ok(!(await alice.assets()).some((a:{id:string})=>a.id==="foreign"));sqlite.close();
});

test("concurrent portable parent restoration cannot create a cycle", async () => {
  const {db,sqlite}=await memoryDb();const {Store,assetView}=await sourceModule("store");const store=new Store(db,"alice");
  await store.insertAsset(lineageAsset("a","alice"));await store.insertAsset(lineageAsset("b","alice"));
  const results=await Promise.allSettled([store.updateAsset("a",{parentAssetId:"b"}),store.updateAsset("b",{parentAssetId:"a"})]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(results.filter(x=>x.status==="rejected").length,1);
  const a=assetView(await store.asset("a")),b=assetView(await store.asset("b"));assert.ok(!(a.parentAssetId==="b"&&b.parentAssetId==="a"));assert.equal(a.versionRootId,b.versionRootId);sqlite.close();
});

test("source edits accept native720x540 dimensions and source graph controls actual latent size", async () => {
  const r=await sourceModule("recipes");
  for(const recipeId of ["qwen-image-edit","flux-klein-edit"]){
    const p=r.validateGeneration({recipeId,prompt:"Change the selected object",inputAssetIds:["source"],width:720,height:540});
    assert.equal(p.width,720);assert.equal(p.height,540);const graph=r.buildWorkflow(p,["source.png"]);
    if(recipeId==="flux-klein-edit"){assert.equal(graph["16"].class_type,"GetImageSize");assert.deepEqual(graph["6"].inputs.width,["16",0]);assert.deepEqual(graph["6"].inputs.height,["16",1]);}
    else{assert.equal(graph["12"].class_type,"FluxKontextImageScale");assert.deepEqual(graph["8"].inputs.pixels,["12",0]);}
  }
  assert.throws(()=>r.validateGeneration({recipeId:"z-image-turbo",prompt:"x",width:720,height:540}),{code:"invalid_dimensions"});
  assert.throws(()=>r.validateGeneration({recipeId:"wan-2.2-5b",prompt:"x",width:720,height:540}),{code:"invalid_dimensions"});
  assert.throws(()=>r.validateGeneration({recipeId:"qwen-image-edit",prompt:"x",inputAssetIds:["source"],width:0,height:540}),{code:"invalid_dimensions"});
  for(const field of ["batchId","parentAssetId","shotId"])assert.throws(()=>r.validateGeneration({recipeId:"z-image-turbo",prompt:"x",[field]:"x".repeat(101)}),{code:"invalid_identifier"});
});

test("uploads and generated branch outputs retain owner-only parent/root and immutable grouping metadata", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();const {Store,assetView}=await sourceModule("store");const store=new Store(db,"alice");
  await store.insertAsset(lineageAsset("source-video","alice",null,"video"));await new Store(db,"bob").insertAsset(lineageAsset("bob-source","bob"));
  const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});const bindings={DB:db,BUCKET:bucket,COMFY_BASE_URL:"http://127.0.0.1:8189"};
  const form=new FormData();form.append("file",new Blob([png() as BlobPart],{type:"image/png"}),"frame.png");form.append("parentAssetId","source-video");
  const frame=await service.uploadAsset(bindings,"alice",new Request("http://localhost/api/assets",{method:"POST",body:form}));assert.equal(frame.type,"image");assert.equal(frame.parentAssetId,"source-video");assert.equal(frame.versionRootId,"source-video");
  const originalFetch=globalThis.fetch;let submits=0;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);if((init?.method||"GET")==="POST"){submits++;return Response.json({id:"engine-"+submits,status:"queued",outputs:[]},{status:201});}
    if(url.endsWith("/health"))return Response.json({});
    if(url.includes("/api/v2/jobs/")){const engineId=url.split("/").at(-1);return Response.json({id:engineId,status:"succeeded",outputs:[{id:"output-"+engineId,name:"version.png",type:"image",url:"http://127.0.0.1:8189/api/v2/assets/"+engineId+"/content"}]});}
    if(url.endsWith("/content"))return new Response(png() as BodyInit,{headers:{"Content-Type":"image/png"}});throw Error("Unexpected fetch");
  }) as typeof fetch;
  try{
    const p={recipeId:"z-image-turbo",prompt:"fox",requestId:"grouped-request",parentAssetId:frame.id,batchId:"batch-1",shotId:"shot-7"};
    const job=await service.submitGeneration(bindings,"alice",p);const replay=await service.submitGeneration(bindings,"alice",{...p,batchId:"different-batch",shotId:"changed-shot"});
    assert.equal(replay.id,job.id);assert.equal(submits,1);assert.equal(replay.parameters.batchId,"batch-1");assert.equal(replay.parameters.shotId,"shot-7");assert.equal(replay.parameters.parentAssetId,frame.id);
    await assert.rejects(store.deleteAsset(frame.id),{code:"asset_used_by_generation"});
    const completed=await service.reconcileJob(bindings,"alice",job.id);const first=assetView(await store.asset(completed.outputAssetIds[0]));assert.equal(first.parentAssetId,frame.id);assert.equal(first.versionRootId,"source-video");
    const next=await service.submitGeneration(bindings,"alice",{...p,requestId:"branch-2",parentAssetId:first.id});const nextDone=await service.reconcileJob(bindings,"alice",next.id);const second=assetView(await store.asset(nextDone.outputAssetIds[0]));assert.equal(second.parentAssetId,first.id);assert.equal(second.versionRootId,"source-video");
    await assert.rejects(service.submitGeneration(bindings,"alice",{...p,requestId:"foreign-parent",parentAssetId:"bob-source"}),{code:"parent_asset_not_found"});assert.equal(submits,2);
    const eligibility=await store.engineEligibility(bindings.COMFY_BASE_URL,"keyless");assert.equal(eligibility.state,"verified");assert.equal(eligibility.jobId,next.id);
  }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test("eligibility uses actual scoped evidence, ignores model policy403 and resets only on explicit successful check", async () => {
  const {db,sqlite}=await memoryDb();const bucket=memoryBucket();const service=await sourceModule("service",{[resolve(serverRoot,"context.ts")]:contextStub});const {Store}=await sourceModule("store");const {credentialFingerprint,eligibilityBlock}=await sourceModule("eligibility");
  const key="test-only-connection-key";const base="http://127.0.0.1:8189";const bindings={DB:db,BUCKET:bucket,COMFY_BASE_URL:base,COMFY_API_KEY:key,ownerId:"alice"};const store=new Store(db,"alice");const fingerprint=await credentialFingerprint(key);let responseCode=403;let reason="Prompt rejected by model policy";const original=globalThis.fetch;let paidSubmits=0;
  globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{if((init?.method||"GET")==="POST"){paidSubmits++;return Response.json({error:{code:responseCode===402?"insufficient_credits":"forbidden",message:reason}},{status:responseCode});}return Response.json({});}) as typeof fetch;
  try{
    const p={recipeId:"z-image-turbo",prompt:"fox"};
    const policy=await service.submitGeneration(bindings,"alice",{...p,requestId:"policy"});assert.equal(policy.status,"failed");assert.equal((await store.engineEligibility(base,fingerprint)).state,"unknown");assert.equal(eligibilityBlock(403,"forbidden","Image violates policy"),null);
    reason="API access denied";const blocked=await service.submitGeneration(bindings,"alice",{...p,requestId:"api-denied"});const proof=await store.engineEligibility(base,fingerprint);assert.equal(proof.state,"blocked");assert.equal(proof.jobId,blocked.id);assert.equal(proof.message,"API access denied");
    assert.equal((await store.engineEligibility(base,await credentialFingerprint("test-only-different-key"))).state,"unknown");assert.equal((await new Store(db,"bob").engineEligibility(base,fingerprint)).state,"unknown");
    const before=paidSubmits;const discovery=await service.discoverEngine(bindings);assert.equal(discovery.status.eligibility.state,"blocked");assert.equal(paidSubmits,before);
    await service.acknowledgeEngineCheck(bindings,"alice",discovery.status);assert.equal(discovery.status.eligibility.state,"unknown");assert.equal((await store.engineEligibility(base,fingerprint)).state,"unknown");assert.equal(paidSubmits,before);
    responseCode=402;reason="Insufficient credits";const credit=await service.submitGeneration(bindings,"alice",{...p,requestId:"intentional-after-account-check"});const next=await store.engineEligibility(base,fingerprint);assert.equal(next.state,"blocked");assert.equal(next.jobId,credit.id);
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM studio_jobs").all()).includes(key));assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM studio_engine_checks").all()).includes(key));
  }finally{globalThis.fetch=original;sqlite.close();}
});

test("provider evidence excludes model-specific403 and redacts credentials before truncation", async () => {
  const {eligibilityBlock}=await sourceModule("eligibility");const {ComfyAdapter,normalizeV2Job}=await sourceModule("comfy");
  assert.equal(eligibilityBlock(403,"model_not_allowed","API access denied for unsupported model"),null);
  assert.equal(eligibilityBlock(403,"invalid_workflow","API access requires a different model"),null);
  assert.equal(eligibilityBlock(403,"api_access_denied","API access denied"),"api-access");
  const key="test-only-private-value-"+"abcdefghij".repeat(8);const original=globalThis.fetch;
  globalThis.fetch=(async()=>Response.json({error:{code:"invalid_input",message:"x".repeat(680)+key+" tail"},node_errors:{detail:"y".repeat(5990)+key}},{status:400})) as typeof fetch;
  try{
    const adapter=new ComfyAdapter({baseUrl:"http://127.0.0.1:8189",mode:"proxy-v2",apiKey:key,local:true});
    await assert.rejects(adapter.submit({},"test-request"),(error:unknown)=>{const serialized=JSON.stringify((error as {publicError():unknown}).publicError());assert.ok(!serialized.includes(key.slice(0,20)));assert.match(serialized,/redacted/);return true;});
    const failed=normalizeV2Job({id:"failed",status:"failed",outputs:[],error:{code:"execution_failed",message:"x".repeat(680)+key}},key);assert.ok(!failed.error.message.includes(key.slice(0,20)));
  }finally{globalThis.fetch=original;}
});
