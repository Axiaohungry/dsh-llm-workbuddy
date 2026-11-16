import { billingHost, billingHeaders, fetchWorkBuddyCredits } from "./workbuddy-credits.js";

export const WORKBUDDY_CHECKIN_REF = "WORKBUDDY_CHECKIN_STATE";
export function checkinDay(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

export async function fetchWorkBuddyCheckin(session, options = {}) {
  const host = billingHost(session);
  for (const path of ["/v2/billing/meter/daily-checkin", "/billing/meter/daily-checkin"]) {
    let response;
    try {
      response = await (options.fetchImpl ?? fetch)(host + path, {
        method: "POST", headers: billingHeaders(session, host), body: "{}", redirect: "error",
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      });
      if (response.status === 404) continue;
      const payload = await response.json();
      const rawCode = payload?.code;
      const code = typeof rawCode === "number" && Number.isFinite(rawCode) || typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : null;
      const message = String(payload?.message ?? payload?.msg ?? "");
      const inactive = /未开启|未开始|未开放|已过期|活动.*(?:结束|关闭|暂停)/.test(message);
      const unsupported = /企业账号不支持|不支持.*签到|不具备.*签到/.test(message);
      const already = (response.ok || response.status === 400) && code === 10001 && !inactive && /已签到|已领取|重复签到|already.*(?:checked|claimed)/i.test(message);
      const ok = !inactive && !unsupported && (response.ok && code === 0 || already);
      const data = payload?.data;
      const rewardValue = data?.reward_credit ?? data?.rewardCredits ?? data?.credits ?? data?.credit;
      const reward = rewardValue != null && rewardValue !== "" && Number.isFinite(Number(rewardValue)) && Number(rewardValue) >= 0 ? Number(rewardValue) : null;
      return { ok, already, unsupported, reward: ok && !already ? reward : null, code,
        message: ok ? already ? "今日已签到" : "签到成功" : response.status === 401 || response.status === 403 ? "登录已失效，请重新登录" : unsupported ? "企业账号不支持签到" : inactive ? "签到活动暂不可用" : "签到失败（HTTP " + response.status + "，业务码 " + (code ?? "未知") + "）" };
    } catch {
      return { ok: false, already: false, reward: null, message: "签到请求失败，请检查网络或重新登录后重试" };
    }
  }
  return { ok: false, already: false, reward: null, message: "当前账号签到接口不可用" };
}

export function createCheckinRunner(options) {
  const now = options.now ?? Date.now;
  const attempted = new Map(), balances = new Map();
  const controller = new AbortController();
  let queue = Promise.resolve(), running = false, stopped = false;
  const state = async () => {
    const stored = await options.readState();
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  };
  const safeRecord = (record) => record && /^\d{4}-\d\d-\d\d$/.test(record.date) ? {
    date: record.date, ok: record.ok === true, already: record.already === true, unsupported: record.unsupported === true,
    reward: typeof record.reward === "number" && Number.isFinite(record.reward) ? record.reward : null,
    checkedAt: Number(record.checkedAt) || null,
    message: record.ok ? record.already ? "今日已签到" : "签到成功" : ["账号或网络不可用，请重新登录或重试", "企业账号不支持签到", "登录已失效，请重新登录", "签到活动暂不可用", "当前账号签到接口不可用", "签到请求失败，请检查网络或重新登录后重试"].includes(record.message) ? record.message : Number.isFinite(record.code) ? "签到失败（业务码 " + record.code + "），请重试" : "签到失败，请重试或重新登录",
  } : null;
  async function snapshot() {
    const saved = await state();
    const accounts = await options.readAccounts();
    return { running, date: checkinDay(now()), accounts: accounts.map((session) => ({
      id: session.id, checkin: safeRecord(saved[session.id]), ...(balances.get(session.id) ?? {}),
    })) };
  }
  async function execute({ accountId, refreshOnly = false, automatic = false } = {}) {
    if (stopped) return snapshot();
    const accounts = await options.readAccounts();
    if (accountId && !accounts.some((s) => s.id === accountId)) throw new Error("该 WorkBuddy 账号不存在");
    let saved = await state();
    running = true;
    try {
      for (const item of accounts.filter((s) => !accountId || s.id === accountId)) {
        if (stopped) break;
        const day = checkinDay(now());
        if (automatic && attempted.get(item.id) === day) continue;
        if (automatic) attempted.set(item.id, day);
        const success = saved[item.id]?.ok === true && saved[item.id]?.date === day;
        if (automatic && success) continue;
        let session, result;
        try {
          session = await options.resolveAccount(item.id);
          if (!refreshOnly && !success && !(saved[item.id]?.unsupported && saved[item.id]?.date === day)) {
            result = await (options.checkin ?? fetchWorkBuddyCheckin)(session, { signal: controller.signal });
          }
        } catch {
          if (!refreshOnly && !success) result = { ok: false, message: "账号或网络不可用，请重新登录或重试" };
        }
        if (result) {
          saved = { ...saved, [item.id]: { ...result, date: day, checkedAt: now() } };
          await options.writeState(saved);
        }
        if (stopped) break;
        try {
          if (!session) throw new Error("账号不可用");
          const balance = await (options.credits ?? fetchWorkBuddyCredits)(session, { signal: controller.signal });
          balances.set(item.id, { credits: balance.credits, unlimited: balance.unlimited === true, segments: balance.segments ?? [],
            balanceAt: now(), creditError: balance.creditError ? "积分查询暂不可用" : null });
        } catch {
          balances.set(item.id, { credits: null, segments: [], balanceAt: now(), creditError: "账号或网络不可用，请重新登录或重试" });
        }
      }
    } finally { running = false; }
    return snapshot();
  }
  return {
    snapshot,
    run(input) { const next = queue.then(() => execute(input)); queue = next.catch(() => {}); return next; },
    stop() { stopped = true; controller.abort(); },
  };
}
