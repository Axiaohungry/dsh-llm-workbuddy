import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { createUsageFold, aggregateUsage, createUsageScanner, usageDate, periodStarts } from "./workbuddy-usage.js";
const at = Date.parse("2026-11-16T02:00:00Z");
const event = (seq, provider="one", model="same", usage={inputTokens:10,outputTokens:20,cacheReadTokens:5,totalTokens:35}, time=at, duration=1000) => ({seq,time,type:"assistant/message",data:{message:{source:{kind:"model",provider,model},content:[{type:"text",text:"PRIVATE-CONTENT"}]},usage,stream:[{type:"text-chunks",time0:time-duration,texts:["a","b"],dt:[duration]}]}});
function fold(events) { const f=createUsageFold();events.forEach(e=>f.push(e));return f.finish(); }
test("同名模型按服务商拆分，缓存计入总量，缺失usage不假装为零用量",()=>{
 const result=aggregateUsage([fold([event(1),event(2,"two"),event(3,"one","missing",null)])],{now:at});
 assert.equal(result.summary.all.totalTokens,70);assert.equal(result.summary.all.missingUsage,1);
 assert.equal(result.models.length,3);assert.deepEqual(result.providers.map(p=>p.provider).sort(),["one","two"]);
 assert(!JSON.stringify(result).includes("PRIVATE-CONTENT"));assert.equal(result.models.find(m=>m.model==='missing').speed,null);
});
test("北京时间、周一始和跨年周正确，筛选同步到四个周期",()=>{
 assert.equal(usageDate(Date.parse('2026-11-15T16:00:00Z')),'2026-11-16');
 assert.equal(periodStarts(Date.parse('2027-01-01T01:00:00Z')).week,'2026-12-28');
 const result=aggregateUsage([fold([event(1),event(2,'two'),event(3,'one','same',undefined,at-86400000)])],{now:at,provider:'one',model:'same',granularity:'week'});
 assert.equal(result.summary.today.totalTokens,35);assert.equal(result.summary.week.totalTokens,35);assert.equal(result.summary.month.totalTokens,70);assert.equal(result.summary.all.totalTokens,70);assert.equal(result.models.length,1);
});
test("速度按有效样本输出总量/总时间加权，短样本与缺失时间排除",()=>{
 const rows=[event(1,'one','same',{outputTokens:100,totalTokens:100},at,1000),event(2,'one','same',{outputTokens:100,totalTokens:100},at,9000),event(3,'one','same',{outputTokens:3,totalTokens:3},at,10)];
 const result=aggregateUsage([fold(rows)],{now:at});assert.equal(result.models[0].speed,20);assert.equal(result.models[0].speedSamples,2);assert.equal(result.summary.all.totalTokens,203);
});
test("优先使用报告total，缺省回退分项，重复seq去重，服务商仅按明确字段解析",()=>{
 const e=event(1,'','', {inputTokens:2,outputTokens:3,cacheReadTokens:4,cacheWriteTokens:5});
 const f=fold([{type:'request/context',data:{provider:'provider-context',model:'model-context'}},e,e,event(2,'two','same',{inputTokens:10,outputTokens:20,totalTokens:7})]);
 const r=aggregateUsage([f],{now:at});assert.equal(r.summary.all.totalTokens,21);assert(r.models.some(m=>m.provider==='provider-context'&&m.model==='model-context'));
});
test("多帧zstd、断尾、坏行增量重算不累加，最高版本/重复目录只统计一次",async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbuddy-usage-'));const dir=join(root,'project','session-test');await mkdir(dir,{recursive:true});
 const frame1=zstdCompressSync(Buffer.from(JSON.stringify(event(1))+'\nBROKEN\n'));
 const frame2=zstdCompressSync(Buffer.from(JSON.stringify(event(2))+'\n'));
 const file=join(dir,'session.v4.jsonl.zstd');await writeFile(file,Buffer.concat([frame1,frame2.subarray(0,Math.floor(frame2.length/2))]));
 await writeFile(join(dir,'session.v3.jsonl'),JSON.stringify(event(90))+'\n');
 let writes=0;const scanner=createUsageScanner({root,now:()=>at,saveCache:async()=>{writes++}});
 try {
  await scanner.scan();let r=await scanner.query({now:at});assert.equal(r.summary.all.totalTokens,35);assert.equal(r.scan.incompleteFiles,1);assert.equal(r.scan.badLines,1);
  await appendFile(file,frame2.subarray(Math.floor(frame2.length/2)));await scanner.scan();r=await scanner.query({now:at});assert.equal(r.summary.all.totalTokens,70);assert.equal(r.scan.incompleteFiles,0);
  const count=writes;await scanner.scan();assert.equal(writes,count);assert.equal((await scanner.query({now:at})).summary.all.totalTokens,70);
  const duplicate=join(root,'moved','session-test');await mkdir(duplicate,{recursive:true});await writeFile(join(duplicate,'session.v4.jsonl'),JSON.stringify(event(4))+'\n');await utimes(join(duplicate,'session.v4.jsonl'),new Date(at+1000),new Date(Date.now()+10000));
  await scanner.scan();assert.equal((await scanner.query({now:at})).summary.all.totalTokens,35);
  await rm(join(root,'project'),{recursive:true});await rm(join(root,'moved'),{recursive:true});await scanner.scan();assert.equal((await scanner.query({now:at})).summary.all.totalTokens,0);
 }finally{scanner.stop();await rm(root,{recursive:true,force:true})}
});
test("并发扫描共用任务，持久缓存可恢复，停止后不读取日志",async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbuddy-usage-cache-'));const dir=join(root,'p','session-cached');await mkdir(dir,{recursive:true});await writeFile(join(dir,'session.v4.jsonl'),JSON.stringify(event(1))+'\n');
 let cache=[],writes=0;const opts={root,now:()=>at,loadCache:async()=>cache,saveCache:async rows=>{cache=structuredClone(rows);writes++}};
 const first=createUsageScanner(opts);
 try{await Promise.all([first.scan(),first.scan()]);assert.equal(writes,1);const second=createUsageScanner(opts);await second.scan();assert.equal(writes,1);assert.equal((await second.query({now:at})).summary.all.totalTokens,35);second.stop();first.stop();await first.scan();assert.equal(writes,1)}finally{await rm(root,{recursive:true,force:true})}
});

test("统计路由保护本机数据，参数验证和卸载清理有效", async()=>{
 const {installWorkBuddyUsage}=await import('./workbuddy-usage-web.js');const root=await mkdtemp(join(tmpdir(),'workbuddy-usage-route-'));const old=process.env.DSH_HOME;process.env.DSH_HOME=root;
 const routes=new Map(),tables=new Map([['files',new Map()],['meta',new Map()]]);let dispose,closed=false;
 const domain={table:name=>({get:async key=>tables.get(name).get(key),put:async(key,value)=>tables.get(name).set(key,value)}),close:()=>{closed=true}};
 try{
  installWorkBuddyUsage({inject:(names,cb)=>{assert.deepEqual(names,['webServer','storageDomain']);cb({storageDomain:{open:async()=>domain},webServer:{register:({path,handler})=>{routes.set(path,handler);return()=>routes.delete(path)}},effect:cb=>{dispose=cb()}})}});
  const call=async(body,origin='http://localhost:3000')=>{let status,payload;await routes.get('/dsh-llm-workbuddy/usage')({method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{origin},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body))}},{writeHead:s=>{status=s},end:b=>{payload=JSON.parse(b)}});return{status,payload}};
  assert.equal((await call({},'https://evil.example')).status,403);assert.equal((await call({provider:123})).status,400);assert.equal((await call({period:'forever'})).status,400);
  const result=await call({period:'all',granularity:'month'});assert.equal(result.status,200);assert.equal(result.payload.summary.all.totalTokens,0);assert(!JSON.stringify(result.payload).includes(root));
 }finally{dispose?.();await new Promise(r=>setImmediate(r));if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;await rm(root,{recursive:true,force:true})}
 assert(closed);assert.equal(routes.size,0);
});
test("原始chunk和紧凑流速度一致，缓存只含白名单数值字段",()=>{
 const raw=event(1),compact=event(1);raw.data.stream=[{type:'chunk',time:at-1000,chunk:{type:'text-delta',text:'PRIVATE'}},{type:'chunk',time:at,chunk:{type:'text-delta',text:'DATA'}}];
 const a=fold([raw]),b=fold([compact]);assert.equal(aggregateUsage([a],{now:at}).models[0].speed,aggregateUsage([b],{now:at}).models[0].speed);
 const allowed=['date','provider','model','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens','calls','missingUsage','speedOutputTokens','speedMs','speedSamples'];assert(a.rows.every(row=>Object.keys(row).every(key=>allowed.includes(key))));
});
test("坏压缩文件不阻止其他统计，已缓存文件读失败时提示并保留上次数字",async()=>{
 const root=await mkdtemp(join(tmpdir(),'workbuddy-usage-bad-'));const dir=join(root,'p','session-good'),bad=join(root,'p','session-bad');await mkdir(dir,{recursive:true});await mkdir(bad,{recursive:true});const file=join(dir,'session.v4.jsonl.zstd');await writeFile(file,zstdCompressSync(Buffer.from(JSON.stringify(event(1))+'\n')));await writeFile(join(bad,'session.v4.jsonl.zstd'),Buffer.from('INVALID'));
 const scanner=createUsageScanner({root,now:()=>at});try{await scanner.scan();let result=await scanner.query();assert.equal(result.summary.all.totalTokens,35);assert.equal(result.scan.failedFiles,1);await writeFile(file,Buffer.from('ALSO INVALID'));await scanner.scan();result=await scanner.query();assert.equal(result.summary.all.totalTokens,35);assert.equal(result.scan.failedFiles,2)}finally{scanner.stop();await rm(root,{recursive:true,force:true})}
});