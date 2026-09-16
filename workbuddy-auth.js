import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const WORKBUDDY_SESSION_REF = "WORKBUDDY_LOGIN_SESSION";
export const WORKBUDDY_SESSIONS_REF = "WORKBUDDY_LOGIN_SESSIONS";
export const WORKBUDDY_SESSION_ROUTING_REF = "WORKBUDDY_SESSION_ROUTING";
export const WORKBUDDY_API_KEYS_REF = "WORKBUDDY_API_KEYS";
export const LEGACY_SESSION_REF = "CODEBUDDY_LOGIN_SESSION";
export const LEGACY_SESSIONS_REF = "CODEBUDDY_LOGIN_SESSIONS";
export const LEGACY_API_KEYS_REF = "CODEBUDDY_API_KEYS";

function normalizeWorkBuddySessionBinding(binding) {
  if (!binding || typeof binding !== "object") return undefined;
  if (binding.mode === "token" && typeof binding.accountId === "string" && binding.accountId.trim()) {
    return { mode: "token", accountId: binding.accountId.trim() };
  }
  if (binding.mode === "api-key" && typeof binding.apiKeyRef === "string" && binding.apiKeyRef.trim()) {
    return { mode: "api-key", apiKeyRef: binding.apiKeyRef.trim() };
  }
  return undefined;
}

export function createWorkBuddySessionRoutingState(enabled = false, bindings = {}, lastUsed) {
  const normalized = {};
  if (bindings && typeof bindings === "object" && !Array.isArray(bindings)) {
    for (const [sessionId, binding] of Object.entries(bindings)) {
      if (typeof sessionId !== "string" || !sessionId.trim() || !binding || typeof binding !== "object") continue;
      const value = normalizeWorkBuddySessionBinding(binding);
      if (value) normalized[sessionId] = value;
    }
  }
  const recent = normalizeWorkBuddySessionBinding(lastUsed);
  return {
    version: 1,
    enabled: enabled === true,
    bindings: normalized,
    ...(recent ? { lastUsed: recent } : {}),
  };
}

export function serializeWorkBuddySessionRouting(state) {
  return JSON.stringify(createWorkBuddySessionRoutingState(state?.enabled, state?.bindings, state?.lastUsed));
}

export function parseWorkBuddySessionRouting(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("WorkBuddy 会话级认证配置已损坏，请重新设置", { cause: error });
  }
  return createWorkBuddySessionRoutingState(parsed?.enabled, parsed?.bindings, parsed?.lastUsed);
}

const BASE_URL = "https://copilot.tencent.com/v2/plugin";
const USER_AGENT = "CLI/unknown CodeBuddy/2.137.1";
const REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": USER_AGENT,
  "x-product": "SaaS",
};
const NO_ACCOUNT_HEADERS = {
  "X-No-Authorization": "true",
  "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true",
  "X-No-Department-Info": "true",
};
const NO_ID_HEADERS = {
  "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true",
  "X-No-Department-Info": "true",
};

function calculateExpiresAt(auth, now = Date.now()) {
  const result = { ...auth };
  if (!result.expiresAt && Number.isFinite(result.expiresIn)) result.expiresAt = now + result.expiresIn * 1000;
  if (!result.refreshExpiresAt && Number.isFinite(result.refreshExpiresIn)) result.refreshExpiresAt = now + result.refreshExpiresIn * 1000;
  return result;
}

async function responseBody(response, action) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${action}返回了无法解析的数据`, { cause: error });
  }
}

async function request(path, options, action) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, options);
  } catch (error) {
    if (options.signal?.aborted) throw new Error(`${action}已取消`, { cause: error });
    throw new Error(`${action}无法连接 WorkBuddy 中国站`, { cause: error });
  }
  const body = await responseBody(response, action);
  if (!response.ok || body?.code !== 0) throw new Error(`${action}失败（${body?.message ?? body?.msg ?? response.status}）`);
  return body.data;
}

function enterpriseHeaders(session) {
  const enterpriseId = session.account?.enterpriseId;
  return {
    ...(enterpriseId ? { "X-Enterprise-Id": enterpriseId, "X-Tenant-Id": enterpriseId } : {}),
    ...(session.auth?.domain ? { "X-Domain": session.auth.domain } : {}),
  };
}

async function poll(path, headers, action, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(1000, undefined, { signal });
    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, { headers: { ...REQUEST_HEADERS, ...headers }, signal });
    } catch (error) {
      if (signal?.aborted) throw new Error(`${action}已取消`, { cause: error });
      continue;
    }
    const body = await responseBody(response, action);
    if (response.ok && body?.code === 0 && body.data) return body.data;
    if (response.status === 401 || response.status === 403) throw new Error(`${action}失败（${body?.message ?? body?.msg ?? response.status}）`);
  }
  throw new Error(`${action}超时`);
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function tokenClaims(token) {
  if (typeof token !== "string") return {};
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeApiKeyEntry(entry, now = Date.now()) {
  const ref = textValue(entry?.ref);
  if (!ref || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error("WorkBuddy API Key 引用无效");
  const id = textValue(entry?.id) ?? `dsh:${ref}`;
  return {
    id,
    ref,
    label: textValue(entry?.label) ?? "DSH 保存的 API Key",
    createdAt: Number.isFinite(entry?.createdAt) ? entry.createdAt : now,
    updatedAt: Number.isFinite(entry?.updatedAt) ? entry.updatedAt : now,
  };
}

export function createWorkBuddyApiKeyStore(entries = [], activeId) {
  const keys = [];
  for (const entry of entries) {
    const normalized = normalizeApiKeyEntry(entry);
    if (!keys.some((item) => item.id === normalized.id || item.ref === normalized.ref)) keys.push(normalized);
  }
  const selected = activeId === null
    ? null
    : typeof activeId === "string" && keys.some((entry) => entry.id === activeId) ? activeId : keys[0]?.id;
  return { version: 1, activeId: selected, entries: keys };
}

export function upsertWorkBuddyApiKey(store, entry, now = Date.now()) {
  const current = createWorkBuddyApiKeyStore(store?.entries ?? [], store?.activeId);
  const incoming = normalizeApiKeyEntry({ ...entry, updatedAt: now }, now);
  const index = current.entries.findIndex((item) => item.id === incoming.id || item.ref === incoming.ref);
  if (index >= 0) incoming.createdAt = current.entries[index].createdAt;
  const entries = index >= 0
    ? current.entries.map((item, position) => position === index ? incoming : item)
    : [...current.entries, incoming];
  return { version: 1, activeId: incoming.id, entries };
}

export function serializeWorkBuddyApiKeys(store) {
  const normalized = createWorkBuddyApiKeyStore(store?.entries ?? [], store?.activeId);
  return JSON.stringify(normalized);
}

export function parseWorkBuddyApiKeys(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("WorkBuddy API Key 列表已损坏，请重新配置", { cause: error });
  }
  if (!Array.isArray(parsed?.entries)) throw new Error("WorkBuddy API Key 列表格式无效，请重新配置");
  return createWorkBuddyApiKeyStore(parsed.entries, parsed.activeId);
}

export function workBuddyApiKeyEntries(store) {
  return (store?.entries ?? []).map(({ id, ref, label, createdAt, updatedAt }) => ({ id, ref, label, createdAt, updatedAt }));
}

function normalizeAccount(account, auth) {
  // The account endpoint has returned both a flat object and wrapped objects
  // across WorkBuddy versions. Keep all known wrappers in the lookup so a newly
  // added account gets the same display metadata as an imported account.
  const sources = [
    account,
    account?.account,
    account?.user,
    account?.userInfo,
    account?.profile,
    account?.data,
  ].filter((source) => source && typeof source === "object");
  const read = (...keys) => textValue(...sources.flatMap((source) => keys.map((key) => source[key])));
  const claims = tokenClaims(auth?.accessToken);
  const userId = read("userId", "uid", "user_id", "id") ?? textValue(claims.userId, claims.uid, claims.user_id, claims.sub);
  const enterpriseId = read("enterpriseId", "tenantId", "enterprise_id", "tenant_id")
    ?? textValue(claims.enterpriseId, claims.tenantId, claims.enterprise_id, claims.tenant_id);
  const email = read("email", "mail", "emailAddress") ?? textValue(claims.email, claims.mail);
  const uin = read("uin", "phoneNumber", "phone", "mobile", "mobilePhone")
    ?? textValue(claims.uin, claims.phoneNumber, claims.phone_number, claims.mobile);
  const type = read("type", "accountType", "account_type");
  const displayName = read("displayName", "name", "nickname", "username", "accountName")
    ?? uin
    ?? textValue(claims.displayName, claims.name, claims.nickname, claims.username, claims.preferred_username)
    ?? email;
  return {
    ...(userId ? { userId } : {}),
    ...(enterpriseId ? { enterpriseId } : {}),
    ...(email ? { email } : {}),
    ...(uin ? { uin } : {}),
    ...(type ? { type } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

export function workBuddySessionId(session) {
  const account = normalizeAccount(session?.account, session?.auth);
  if (account.userId) return `user:${account.userId}`;
  if (account.email) return `email:${account.email}`;
  if (account.enterpriseId) return `enterprise:${account.enterpriseId}`;
  const refreshToken = session?.auth?.refreshToken ?? session?.auth?.accessToken;
  if (!refreshToken) throw new Error("WorkBuddy 登录会话缺少账号标识和令牌");
  return `token:${createHash("sha256").update(refreshToken).digest("hex")}`;
}

export function workBuddySessionLabel(session) {
  const account = normalizeAccount(session?.account, session?.auth);
  return account.displayName ?? account.email ?? account.userId ?? account.enterpriseId ?? `账号 ${workBuddySessionId(session).slice(-8)}`;
}

export function normalizeWorkBuddySessionEntry(session, now = Date.now()) {
  const normalized = {
    auth: calculateExpiresAt(session?.auth),
    account: normalizeAccount(session?.account, session?.auth),
  };
  if (!normalized.auth.accessToken || !normalized.auth.refreshToken) throw new Error("WorkBuddy 登录会话无效");
  const id = typeof session?.id === "string" && session.id.trim() ? session.id : workBuddySessionId(normalized);
  const createdAt = Number.isFinite(session?.createdAt) ? session.createdAt : now;
  return {
    id,
    label: typeof session?.label === "string" && session.label.trim() ? session.label : workBuddySessionLabel(normalized),
    createdAt,
    updatedAt: Number.isFinite(session?.updatedAt) ? session.updatedAt : now,
    ...normalized,
  };
}

export function createWorkBuddySessionStore(entries = [], activeId) {
  const sessions = [];
  for (const entry of entries) {
    const normalized = normalizeWorkBuddySessionEntry(entry);
    if (!sessions.some((item) => item.id === normalized.id)) sessions.push(normalized);
  }
  const selected = typeof activeId === "string" && sessions.some((entry) => entry.id === activeId) ? activeId : sessions[0]?.id;
  return { version: 1, activeId: selected, sessions };
}

export function upsertWorkBuddySession(store, session, now = Date.now()) {
  const current = createWorkBuddySessionStore(store?.sessions ?? [], store?.activeId);
  const incoming = normalizeWorkBuddySessionEntry({ ...session, updatedAt: now }, now);
  const index = current.sessions.findIndex((entry) => entry.id === incoming.id);
  if (index >= 0) incoming.createdAt = current.sessions[index].createdAt;
  const sessions = index >= 0
    ? current.sessions.map((entry, position) => position === index ? incoming : entry)
    : [...current.sessions, incoming];
  return { version: 1, activeId: incoming.id, sessions };
}

export function activeWorkBuddySession(store) {
  return store?.sessions?.find((entry) => entry.id === store.activeId) ?? store?.sessions?.[0];
}

export function workBuddySessionAccounts(store) {
  return (store?.sessions ?? []).map(({ id, label, account, createdAt, updatedAt }) => ({
    id,
    label,
    accountName: label,
    userId: account?.userId ?? null,
    account,
    createdAt,
    updatedAt,
  }));
}

export async function loginWorkBuddy(onAuthUrl, signal) {
  const state = await request("/auth/state?platform=CLI", {
    method: "POST",
    headers: { ...REQUEST_HEADERS, ...NO_ACCOUNT_HEADERS },
    body: "{}",
    signal,
  }, "创建 WorkBuddy 登录会话");
  if (!state?.state || !state?.authUrl) throw new Error("WorkBuddy 登录接口没有返回登录地址");
  try {
    await openBrowser(state.authUrl);
    onAuthUrl?.(state.authUrl, true);
  } catch {
    onAuthUrl?.(state.authUrl, false);
  }
  const auth = calculateExpiresAt(await poll(
    `/auth/token?state=${encodeURIComponent(state.state)}`,
    NO_ACCOUNT_HEADERS,
    "等待 WorkBuddy 登录",
    10 * 60_000,
    signal,
  ));
  if (!auth.accessToken || !auth.refreshToken) throw new Error("WorkBuddy 登录接口没有返回完整令牌");
  const account = await poll(
    `/login/account?state=${encodeURIComponent(state.state)}`,
    { ...enterpriseHeaders({ auth }), authorization: `Bearer ${auth.accessToken}`, ...NO_ID_HEADERS },
    "获取 WorkBuddy 账号",
    60_000,
    signal,
  );
  return { auth, account: normalizeAccount(account, auth) };
}

export async function refreshWorkBuddySession(session, signal) {
  if (!session?.auth?.refreshToken) throw new Error("WorkBuddy 登录会话缺少刷新令牌，请重新登录");
  const auth = await request("/auth/token/refresh", {
    method: "POST",
    headers: {
      ...REQUEST_HEADERS,
      ...enterpriseHeaders(session),
      "X-Refresh-Token": session.auth.refreshToken,
      "X-Auth-Refresh-Source": "plugin",
    },
    body: "{}",
    signal,
  }, "刷新 WorkBuddy 登录令牌");
  const fresh = calculateExpiresAt(auth);
  const merged = { ...session.auth, ...fresh, refreshToken: fresh?.refreshToken ?? session.auth.refreshToken };
  if (!merged.accessToken) throw new Error("WorkBuddy 刷新接口没有返回访问令牌");
  return { auth: merged, account: normalizeAccount(session.account, merged) };
}

export function serializeWorkBuddySession(session) {
  if (!session?.auth?.accessToken || !session?.auth?.refreshToken) throw new Error("WorkBuddy 登录会话无效");
  return JSON.stringify({ auth: calculateExpiresAt(session.auth), account: normalizeAccount(session.account, session.auth) });
}

export function serializeWorkBuddySessions(store) {
  const normalized = createWorkBuddySessionStore(store?.sessions ?? [], store?.activeId);
  if (normalized.sessions.length === 0) throw new Error("WorkBuddy 登录账号列表为空");
  return JSON.stringify(normalized);
}

export function parseWorkBuddySession(value) {
  let session;
  try {
    session = JSON.parse(value);
  } catch (error) {
    throw new Error("WorkBuddy 登录凭据已损坏，请重新登录", { cause: error });
  }
  if (!session?.auth?.accessToken || !session?.auth?.refreshToken) throw new Error("WorkBuddy 登录凭据不完整，请重新登录");
  return { auth: calculateExpiresAt(session.auth), account: normalizeAccount(session.account, session.auth) };
}

export function parseWorkBuddySessions(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("WorkBuddy 登录账号列表已损坏，请重新登录", { cause: error });
  }
  if (Array.isArray(parsed?.sessions)) return createWorkBuddySessionStore(parsed.sessions, parsed.activeId);
  if (parsed?.auth) {
    const session = parseWorkBuddySession(value);
    return createWorkBuddySessionStore([session], workBuddySessionId(session));
  }
  throw new Error("WorkBuddy 登录账号列表格式无效，请重新登录");
}

export function sessionNeedsRefresh(session, now = Date.now()) {
  const expiresAt = Number(session?.auth?.expiresAt);
  if (Number.isFinite(expiresAt)) return expiresAt <= now + 2 * 60_000;
  try {
    const payload = JSON.parse(Buffer.from(session.auth.accessToken.split(".")[1], "base64url").toString("utf8"));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 <= now + 2 * 60_000 : true;
  } catch {
    return true;
  }
}

export function sessionCacheDeadline(session, now = Date.now()) {
  const expiresAt = Number(session?.auth?.expiresAt);
  return Number.isFinite(expiresAt)
    ? Math.max(now, Math.min(expiresAt - 2 * 60_000, now + 30 * 60_000))
    : now + 5 * 60_000;
}
