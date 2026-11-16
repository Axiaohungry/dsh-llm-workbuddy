const DEFAULT_BILLING_HOST = "https://www.codebuddy.cn";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const ENTERPRISE_EDITIONS = new Set(["ultimate", "exclusive"]);
const REMAINING_FIELDS = [
  "SlicePeriodCapacityRemainPrecise",
  "SlicePeriodCapacityRemain",
  "CycleCapacityRemainPrecise",
  "CycleCapacityRemain",
  "CapacityRemainPrecise",
  "CapacityRemain",
  "RemainPrecise",
  "Remain",
  "Remaining",
  "Balance",
];
const TOTAL_FIELDS = [
  "SlicePeriodCapacitySizePrecise",
  "SlicePeriodCapacitySize",
  "CycleCapacitySizePrecise",
  "CycleCapacitySize",
  "CycleCapacityPrecise",
  "CycleCapacity",
  "CapacityPrecise",
  "Capacity",
  "TotalCapacityPrecise",
  "TotalCapacity",
  "PackageCapacity",
  "Quota",
  "Amount",
];
const EXPIRY_FIELDS = [
  "DeductionEndTime",
  "ExpiredTime",
  "SlicePeriodEndTime",
  "PackageEndTime",
  "EndTime",
  "CycleEndTime",
  "ExpireTime",
  "ExpirationTime",
  "ValidEndTime",
  "ValidPeriodEndTime",
  "EndAt",
  "ExpireAt",
];
const LABEL_FIELDS = ["PackageName", "PackageTypeName", "AccountName", "ProductName", "Name", "RuleName", "Description"];
const MAX_USAGE_PAGES = 100;
const PAGE_SIZE = 100;

function normalizeHost(value) {
  const fallback = new URL(DEFAULT_BILLING_HOST);
  if (typeof value !== "string" || !value.trim()) return fallback.origin;
  try {
    const candidate = new URL(value.includes("://") ? value : `https://${value}`);
    if (candidate.protocol !== "https:") return fallback.origin;
    const host = candidate.hostname.toLowerCase();
    if (!["codebuddy.cn", "www.codebuddy.cn", "workbuddy.cn", "www.workbuddy.cn"].includes(host)) return fallback.origin;
    return candidate.origin;
  } catch {
    return fallback.origin;
  }
}

export function billingHost(session) {
  return normalizeHost(session?.auth?.domain);
}

function authToken(session) {
  const token = typeof session?.auth?.accessToken === "string" ? session.auth.accessToken.trim() : "";
  if (!token) throw new Error("WorkBuddy 登录令牌为空");
  return token;
}

export function billingHeaders(session, host, enterpriseId) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-client-platform": "web",
    origin: host,
    referer: `${host}/profile/plans-usage`,
    authorization: `Bearer ${authToken(session)}`,
    "user-agent": BROWSER_USER_AGENT,
  };
  const domain = typeof session?.auth?.domain === "string" ? session.auth.domain.trim() : "";
  if (domain) headers["x-domain"] = domain;
  const userId = typeof session?.account?.userId === "string" ? session.account.userId.trim() : "";
  if (userId) headers["x-user-id"] = userId;
  if (enterpriseId) {
    headers["x-enterprise-id"] = String(enterpriseId);
    headers["x-tenant-id"] = String(enterpriseId);
  }
  return headers;
}

function timeoutSignal(timeoutMs, externalSignal) {
  if (externalSignal) return AbortSignal.any([externalSignal, AbortSignal.timeout(timeoutMs)]);
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

async function readJson(response, action) {
  const raw = await response.text();
  if (!raw.trim()) throw new Error(`${action}返回空响应（HTTP ${response.status}）`);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${action}返回了无法解析的数据`, { cause: error });
  }
  if (!response.ok) throw new Error(`${action} HTTP ${response.status}: ${raw.slice(0, 160)}`);
  if (payload?.code !== undefined && payload.code !== null && payload.code !== 0) {
    throw new Error(`${action}失败（${payload.msg ?? payload.message ?? `code=${payload.code}`}）`);
  }
  return payload;
}

function firstNumber(value, fields) {
  for (const field of fields) {
    const raw = value?.[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const number = Number(raw);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 1e12 ? Math.round(number * 1000) : Math.round(number);
  }
  const text = String(value).trim().replace(/^(\d{4}-\d\d-\d\d)\s+/, "$1T");
  const parsed = Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text) ? text + "+08:00" : /^\d{4}-\d\d-\d\d$/.test(text) ? text + "T00:00:00+08:00" : text);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstTimestamp(value, fields) {
  for (const field of fields) {
    const parsed = parseTimestamp(value?.[field]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstText(value, fields) {
  for (const field of fields) {
    const text = value?.[field];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function extractAccounts(payload) {
  const candidates = [
    payload?.data?.Response?.Data?.Accounts,
    payload?.data?.data?.Response?.Data?.Accounts,
    payload?.data?.accounts,
    payload?.data?.data?.accounts,
    payload?.Response?.Data?.Accounts,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function extractCreditSegments(accounts, source = "积分") {
  return (Array.isArray(accounts) ? accounts : [])
    .flatMap((account) => {
      const details = Array.isArray(account?.SlicePeriodUsageDetails) && account.SlicePeriodUsageDetails.length
        ? account.SlicePeriodUsageDetails.map((detail) => ({ ...account, ...detail }))
        : [account];
      return details.map((item) => {
        const remaining = firstNumber(item, REMAINING_FIELDS);
        if (remaining === null || remaining <= 0) return null;
        const total = firstNumber(item, TOTAL_FIELDS);
        return {
          remaining: Number(remaining.toFixed(2)),
          total: Number((total === null ? remaining : Math.max(total, remaining)).toFixed(2)),
          expiresAt: firstTimestamp(item, EXPIRY_FIELDS),
          source: firstText(item, LABEL_FIELDS) || source,
          packageCode: item?.PackageCode ? String(item.PackageCode) : "",
        };
      });
    })
    .filter(Boolean);
}

function sortSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => segment && Number(segment.remaining) > 0)
    .map((segment) => ({
      remaining: Number(Number(segment.remaining).toFixed(2)),
      total: Number(Number(segment.total || segment.remaining).toFixed(2)),
      expiresAt: segment.expiresAt === null || segment.expiresAt === undefined ? null : Number(segment.expiresAt),
      source: String(segment.source || "积分"),
      packageCode: String(segment.packageCode || ""),
    }))
    .sort((left, right) => {
      if (left.expiresAt === null && right.expiresAt !== null) return 1;
      if (left.expiresAt !== null && right.expiresAt === null) return -1;
      return (left.expiresAt || 0) - (right.expiresAt || 0);
    });
}

function mergeSegments(segments) {
  const merged = new Map();
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment || Number(segment.remaining) <= 0) continue;
    const key = [segment.packageCode || segment.source || "积分", segment.expiresAt ?? "unknown"].join("|");
    const previous = merged.get(key);
    if (previous) {
      previous.remaining += Number(segment.remaining) || 0;
      previous.total += Number(segment.total || segment.remaining) || 0;
    } else {
      merged.set(key, {
        remaining: Number(segment.remaining) || 0,
        total: Number(segment.total || segment.remaining) || 0,
        expiresAt: segment.expiresAt === undefined ? null : segment.expiresAt,
        source: String(segment.source || "积分"),
        packageCode: String(segment.packageCode || ""),
      });
    }
  }
  return sortSegments(Array.from(merged.values()));
}

function buildCreditResourceBody(now = new Date()) {
  const end = new Date(now.getTime());
  end.setFullYear(end.getFullYear() + 101);
  const format = (date) => {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  return {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: format(now),
    PackageEndTimeRangeEnd: format(end),
  };
}

async function postJson(url, session, body, action, options = {}) {
  const response = await (options.fetchImpl || globalThis.fetch)(url, {
    method: "POST",
    redirect: "error",
    headers: billingHeaders(session, options.host, options.enterpriseId),
    body: JSON.stringify(body),
    signal: timeoutSignal(options.timeoutMs ?? 12_000, options.signal),
  });
  return readJson(response, action);
}

function enterpriseUsage(payload) {
  const candidates = [payload?.data, payload?.data?.data, payload?.data?.Response?.Data, payload];
  const data = candidates.find((value) => value && typeof value === "object" && ("limitNum" in value || "LimitNum" in value));
  if (!data) return null;
  const limitNum = Number(data.limitNum ?? data.LimitNum);
  if (!Number.isFinite(limitNum)) return null;
  const reset = firstTimestamp(data, ["cycleResetTime", "CycleResetTime", "CycleResetTimeMs"]);
  if (limitNum === -1) return { unlimited: true, credits: null, total: null, count: 0, segments: [], cycleResetTime: reset };
  const credit = Number(data.credit ?? data.Credit);
  const used = Number.isFinite(credit) ? credit : 0;
  const credits = Math.max(0, limitNum - used);
  return {
    unlimited: false,
    credits: Number(credits.toFixed(2)),
    total: Number(limitNum.toFixed(2)),
    count: 1,
    segments: sortSegments([{ remaining: credits, total: limitNum, expiresAt: reset, source: "企业配额" }]),
    cycleResetTime: reset,
  };
}

async function queryPersonalCredits(session, host, options = {}) {
  const payload = await postJson(`${host}/v2/billing/meter/get-user-resource`, session, buildCreditResourceBody(), "WorkBuddy 积分接口", { ...options, host });
  const accounts = extractAccounts(payload);
  let credits = 0;
  for (const account of accounts) {
    const remaining = firstNumber(account, [
      "CycleCapacityRemainPrecise",
      "CycleCapacityRemain",
      "CapacityRemainPrecise",
      "CapacityRemain",
    ]);
    if (remaining !== null) credits += remaining;
  }
  return {
    credits: Number(credits.toFixed(2)),
    count: accounts.length,
    totalDosage: payload?.data?.Response?.Data?.TotalDosage ?? payload?.data?.data?.Response?.Data?.TotalDosage ?? null,
    segments: mergeSegments(extractCreditSegments(accounts)),
    unlimited: false,
    cycleResetTime: null,
  };
}

async function resolveEnterpriseId(session, host, options = {}) {
  const uid = session?.account?.userId;
  if (!uid) return "";
  const response = await (options.fetchImpl || globalThis.fetch)(`${host}/console/accounts`, {
    method: "GET",
    redirect: "error",
    headers: billingHeaders(session, host),
    signal: timeoutSignal(8_000, options.signal),
  });
  const payload = await readJson(response, "WorkBuddy 企业账号接口");
  const accounts = payload?.data?.accounts;
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  return typeof first?.enterpriseId === "string" ? first.enterpriseId.trim() : "";
}

async function queryEnterpriseCredits(session, host, enterpriseId, options = {}) {
  const payload = await postJson(`${host}/v2/billing/meter/get-enterprise-user-usage`, session, {}, "WorkBuddy 企业积分接口", {
    ...options,
    host,
    enterpriseId,
  });
  const parsed = enterpriseUsage(payload);
  if (!parsed) throw new Error("WorkBuddy 企业积分接口返回数据无法解析");
  return parsed;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function localDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseUsageTime(value) {
  return parseTimestamp(value);
}

function usageRows(payload) {
  const data = payload?.data;
  const rows = data && Array.isArray(data.data) ? data.data : data && Array.isArray(data.rows) ? data.rows : [];
  const total = Number(data?.total);
  return { rows, total: Number.isSafeInteger(total) && total >= 0 ? total : rows.length };
}

async function queryTodayUsage(session, host, options = {}) {
  const now = new Date();
  const start = new Date(now.getTime());
  start.setHours(0, 0, 0, 0);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const records = [];
  let expectedTotal = null;
  let fetched = 0;
  for (let pageNum = 1; pageNum <= MAX_USAGE_PAGES; pageNum += 1) {
    const payload = await postJson(`${host}/billing/meter/get-user-request-usage`, session, {
      startTime: formatLocalDateTime(start),
      endTime: formatLocalDateTime(now),
      pageNum,
      pageSize: PAGE_SIZE,
    }, "WorkBuddy 今日请求量接口", { ...options, host, fetchImpl, timeoutMs: options.usageTimeoutMs ?? 8_000 });
    const page = usageRows(payload);
    if (expectedTotal === null) expectedTotal = page.total;
    if (!page.rows.length) break;
    for (const row of page.rows) {
      const requestTime = parseUsageTime(row?.requestTime ?? row?.RequestTime ?? row?.createdAt);
      const credit = Number(row?.credit ?? row?.Credit ?? 0);
      if (requestTime === null || !Number.isFinite(credit) || credit < 0) continue;
      records.push({ requestTime, credit });
    }
    fetched += page.rows.length;
    if (fetched >= expectedTotal || page.rows.length < PAGE_SIZE) break;
  }
  const used = records.reduce((sum, record) => sum + record.credit, 0);
  return {
    date: localDateString(now),
    used: Number(used.toFixed(2)),
    count: records.length,
    synced: true,
  };
}

async function retry(task, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export async function fetchWorkBuddyCredits(session, options = {}) {
  const host = billingHost(session);
  const account = session?.account && typeof session.account === "object" ? session.account : {};
  let creditResult;
  let creditError = null;
  try {
    const enterpriseId = typeof account.enterpriseId === "string" ? account.enterpriseId.trim() : "";
    const enterpriseEdition = typeof account.type === "string" && ENTERPRISE_EDITIONS.has(account.type.toLowerCase());
    if (enterpriseId || enterpriseEdition) {
      const resolvedId = enterpriseId || await retry(() => resolveEnterpriseId(session, host, options));
      if (!resolvedId) throw new Error("企业账号缺少 enterpriseId");
      creditResult = await retry(() => queryEnterpriseCredits(session, host, resolvedId, options));
    } else {
      creditResult = await retry(() => queryPersonalCredits(session, host, options));
    }
  } catch (error) {
    creditError = error instanceof Error ? error.message : String(error);
    creditResult = { credits: null, count: 0, totalDosage: null, segments: [], unlimited: false, cycleResetTime: null };
  }

  let todayUsage;
  let todayUsageError = null;
  try {
    todayUsage = await retry(() => queryTodayUsage(session, host, options));
  } catch (error) {
    todayUsageError = error instanceof Error ? error.message : String(error);
  }
  return {
    ...creditResult,
    creditError,
    todayUsage: todayUsage ?? null,
    todayUsageError,
  };
}

export const __testing = Object.freeze({
  billingHost,
  buildCreditResourceBody,
  enterpriseUsage,
  extractAccounts,
  extractCreditSegments,
  formatLocalDateTime,
  mergeSegments,
  normalizeHost,
  queryTodayUsage,
  sortSegments,
});
