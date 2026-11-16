import test from "node:test";
import assert from "node:assert/strict";
import { fetchWorkBuddyCheckin, createCheckinRunner, checkinDay } from "./workbuddy-checkin.js";
const session = (id) => ({ id, auth: { accessToken: "secret-" + id, domain: "https://www.codebuddy.cn" }, account: { userId: id } });
test("签到仅明确业务成功或已签成功，且不转发令牌到第三方", async () => {
  for (const [status, payload, expected] of [[200, { code: 0, data: { reward_credit: 100 } }, true], [200, { code: 10001, message: "今日已签到" }, true], [400, { code: 10001, message: "今天已签到，请明天再来" }, true], [401, { code: 10001, message: "已签到" }, false], [200, { code: 10001, message: "活动已结束" }, false], [200, {}, false], [200, {code:false}, false], [200, {code:[]}, false], [401, { code: 0 }, false], [200, { code: 13, message: "secret-a" }, false]]) {
    const result = await fetchWorkBuddyCheckin(session("a"), { fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, "https://www.codebuddy.cn");assert.equal(init.redirect, "error");
      assert.equal(init.headers.authorization, "Bearer secret-a");
      return new Response(JSON.stringify(payload), { status });
    } });
    assert.equal(result.ok, expected);assert(!JSON.stringify(result).includes("secret-a"));
  }
  await fetchWorkBuddyCheckin({ ...session("a"), auth: { accessToken: "secret-a", domain: "https://evil.example" } }, { fetchImpl: async (url) => {
    assert.equal(new URL(url).origin, "https://www.codebuddy.cn");return new Response('{"code":0}');
  } });
});
test("北京时间跨日，同日成功去重，失败隔离，手动重试，重启恢复", async () => {
  let time = Date.parse("2026-11-16T15:59:00Z"), stored = {}, calls = [], fail = true;
  const options = { now: () => time, readAccounts: async () => [session("a"),session("b")], resolveAccount: async (id) => session(id), readState: async () => stored, writeState: async (v) => { stored = structuredClone(v); }, checkin: async (s) => { calls.push(s.id);return { ok: s.id !== "b" || !fail, already: false, reward: 100, message: "结果" }; }, credits: async () => ({ credits: 123, segments: [] }) };
  const runner = createCheckinRunner(options);
  await Promise.all([runner.run({ automatic: true }), runner.run({ automatic: true })]);assert.deepEqual(calls,["a","b"]);
  await runner.run({ automatic: true });assert.equal(calls.length,2);
  fail=false;await runner.run({ accountId: "b" });assert.deepEqual(calls,["a","b","b"]);
  await createCheckinRunner(options).run({ automatic: true });assert.equal(calls.length,3);
  time+=120000;assert.equal(checkinDay(time),"2026-11-17");await runner.run({ automatic: true });assert.equal(calls.length,5);
  const snap=await runner.snapshot();assert.equal(snap.accounts.length,2);assert(!JSON.stringify(snap).includes("secret"));
  await assert.rejects(runner.run({ accountId: "missing" }),/不存在/);
});
test("刷新余额不签到，单账号失败不影响其他账号，停止后不继续请求", async () => {
  const calls=[];let items=[session("a"),session("b")];
  const runner=createCheckinRunner({ readAccounts:async()=>items,resolveAccount:async(id)=>{if(id==='a')throw Error('secret-a');return session(id)},readState:async()=>({}),writeState:async()=>{},checkin:async(s)=>{calls.push(s.id);return {ok:true}},credits:async()=>({credits:3,segments:[]}) });
  await runner.run({refreshOnly:true});assert.equal(calls.length,0);
  await runner.run();assert.deepEqual(calls,['b']);assert(!JSON.stringify(await runner.snapshot()).includes('secret-a'));
  items=[session('b')];assert.equal((await runner.snapshot()).accounts.length,1);
  runner.stop();await runner.run();assert.equal(calls.length,1);
});


test("企业账号明确不支持，失败响应不冒充签到成功", async () => {
  const result = await fetchWorkBuddyCheckin(session('enterprise'),{fetchImpl:async()=>new Response(JSON.stringify({code:10001,message:'企业账号不支持该操作'}),{status:400})});
  assert.equal(result.ok,false);assert.equal(result.unsupported,true);assert.equal(result.message,'企业账号不支持签到');
});

test("余额到期摘要合并同一时刻积分，未知时间不显示1970，日期固定北京时间", async () => {
  const {readFileSync}=await import('node:fs'),vm=await import('node:vm');let helpers;
  const source=readFileSync(new URL('./client.js',import.meta.url),'utf8').replace('return { name: "dsh-llm-workbuddy-client", inject:', 'return { expiryText, expiryDate, creditDistribution, creditRingBackground, name: "dsh-llm-workbuddy-client", inject:');
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:m=>{helpers=m.factory(()=>({}))}}}});
  const now=Date.parse('2026-11-16T00:00:00Z');
  assert.match(helpers.expiryText([{remaining:20,expiresAt:now+86400000},{remaining:30,expiresAt:now+86400000}],now),/^50 积分将于 1 天后到期$/);
  assert.equal(helpers.expiryText([{remaining:20,expiresAt:null}],now),'到期时间未知');
  assert.match(helpers.expiryText([{remaining:20,expiresAt:now-1000}],now),/已到期/);
  assert.match(helpers.expiryText([{remaining:20,expiresAt:now+1000}],now),/不足 1 小时/);
  assert.match(helpers.expiryDate(now),/8:00:00/);assert.equal(helpers.expiryDate(null),'到期时间未知');
  const groups=helpers.creditDistribution([{remaining:5,expiresAt:now+1000},{remaining:8,expiresAt:now+5*86400000},{remaining:10,expiresAt:now+10*86400000},{remaining:3,expiresAt:null}],now);
  assert.deepEqual(Array.from(groups,g=>g.value),[5,8,10,3]);
  assert.match(helpers.creditRingBackground([]),/100%/);
  assert.match(helpers.creditRingBackground([{remaining:10,expiresAt:null}]),/#94a3b8 0% 100%/);
});

test("插件启动签到使用全部保存账号并保持选择不变，接口拒绝外部来源，卸载停止计时器", async () => {
  const {installWorkBuddyWeb}=await import('./workbuddy-web.js');const {createWorkBuddySessionStore,serializeWorkBuddySessions}=await import('./workbuddy-auth.js');
  const sessions=['a','b'].map(id=>({...session(id),auth:{...session(id).auth,refreshToken:'refresh-'+id,expiresAt:Date.now()+86400000},account:{userId:id}}));
  const store=createWorkBuddySessionStore(sessions);const refs=new Map([['WORKBUDDY_LOGIN_SESSIONS',serializeWorkBuddySessions(store)]]);
  const refKey=r=>typeof r==='string'?r:r.name??r.key;let disposers=[],requests=0;const routes=new Map(),previous=globalThis.fetch;
  globalThis.fetch=async(url)=>{if(url.includes('daily-checkin')){requests++;return new Response('{"code":0,"data":{"reward_credit":100}}')}if(url.includes('get-user-resource'))return new Response('{"code":0,"data":{"Response":{"Data":{"Accounts":[]}}}}');return new Response('{"code":0,"data":{"total":0,"data":[]}}')};
  try {
    installWorkBuddyWeb({inject:(_names,cb)=>cb({settings:{get:()=>({providers:{'workbuddy-cn':{apiKeyEnv:'KEY'}}})},credentials:{resolve:async(r)=>refs.has(refKey(r))?{value:refs.get(refKey(r))}:undefined,set:async(r,v)=>refs.set(refKey(r),v)},webServer:{register:({path,handler})=>{routes.set(path,handler);return()=>{routes.delete(path)}}},effect:cb=>{disposers.push(cb())}})});
    // Let the startup batch and its balance queries finish before observing persisted state.
    for(let i=0;i<30&&!refs.has('WORKBUDDY_CHECKIN_STATE');i++)await new Promise(r=>setTimeout(r,10));
    for(let i=0;i<30&&requests<2;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(requests,2);assert.equal(refs.get('WORKBUDDY_LOGIN_SESSIONS'),serializeWorkBuddySessions(store));
    let status;await routes.get('/dsh-llm-workbuddy/auth/checkin')({method:'POST',socket:{remoteAddress:'192.0.2.1'},headers:{}},{writeHead:s=>{status=s},end:()=>{}});assert.equal(status,403);
  }finally{disposers.forEach(fn=>fn());globalThis.fetch=previous;}
  assert.equal(routes.size,0);
});

test("余额失败不撤销签到成功，保存失败不伪报已持久化", async () => {
  let stored={},calls=0;
  const options={readAccounts:async()=>[session('a')],resolveAccount:async()=>session('a'),readState:async()=>stored,writeState:async s=>{stored=structuredClone(s)},checkin:async()=>{calls++;return {ok:true}},credits:async()=>{throw Error('network')}};
  const runner=createCheckinRunner(options);await runner.run();assert.equal((await runner.snapshot()).accounts[0].checkin.ok,true);await runner.run();assert.equal(calls,1);
  await assert.rejects(createCheckinRunner({...options,readState:async()=>({}),writeState:async()=>{throw Error('storage')}}).run(),/storage/);
});
test("无时区积分到期按北京时间解析，0时间戳视为未知", async()=>{
 const {__testing:t}=await import('./workbuddy-credits.js');
 assert.equal(t.extractCreditSegments([{CapacityRemain:3,ExpiredTime:0}])[0].expiresAt,null);
 assert.equal(t.extractCreditSegments([{CapacityRemain:3,ExpiredTime:'2026-11-17 00:00:00'}])[0].expiresAt,Date.parse('2026-11-16T16:00:00Z'));
});