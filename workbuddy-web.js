import { randomBytes } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  WORKBUDDY_API_KEYS_REF,
  WORKBUDDY_SESSION_REF,
  WORKBUDDY_SESSIONS_REF,
  WORKBUDDY_SESSION_ROUTING_REF,
  LEGACY_API_KEYS_REF,
  LEGACY_SESSION_REF,
  LEGACY_SESSIONS_REF,
  activeWorkBuddySession,
  workBuddyApiKeyEntries,
  workBuddySessionAccounts,
  createWorkBuddyApiKeyStore,
  createWorkBuddySessionStore,
  createWorkBuddySessionRoutingState,
  parseWorkBuddyApiKeys,
  loginWorkBuddy,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  refreshWorkBuddySession,
  serializeWorkBuddyApiKeys,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  serializeWorkBuddySessionRouting,
  parseWorkBuddySessionRouting,
  sessionNeedsRefresh,
  upsertWorkBuddyApiKey,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { fetchWorkBuddyCredits } from "./workbuddy-credits.js";

const PROVIDER = "workbuddy-cn";
const LEGACY_PROVIDER = "codebuddy-cn";
const API_KEY_ENV = "WORKBUDDY_API_KEY";
const LEGACY_API_KEY_ENV = "CODEBUDDY_API_KEY";
const ROUTE = "/dsh-llm-workbuddy/auth";
const ENV_SOURCES = new Set(["env", "user-env", "project-env"]);

export function authenticationMode(config) {
  const profile = config?.providers?.[PROVIDER] ?? config?.providers?.[LEGACY_PROVIDER];
  return profile && profile.apiKeyEnv === undefined ? "token" : "api-key";
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function localPost(req) {
  const address = req.socket.remoteAddress;
  const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!loopback) return false;
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] === "same-origin";
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function requestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 64 * 1024) throw new Error("请求体过大");
  }
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    throw new Error("请求参数格式无效");
  }
}

async function setMode(settings, mode, apiKeyRef = API_KEY_ENV) {
  const config = settings.get("llm-pi-ai");
  const providers = config?.providers ?? {};
  const exists = Object.hasOwn(providers, PROVIDER);
  const legacy = !exists && Object.hasOwn(providers, LEGACY_PROVIDER) ? providers[LEGACY_PROVIDER] : undefined;
  const path = ["providers", PROVIDER];
  if (!exists) {
    const value = { ...(legacy ?? {}), ...(mode === "token" ? {} : { apiKeyEnv: apiKeyRef }) };
    await settings.mutate("llm-pi-ai", [
      { op: "set", path, value },
      ...(legacy ? [{ op: "unset", path: ["providers", LEGACY_PROVIDER] }] : []),
    ]);
    return;
  }
  await settings.mutate("llm-pi-ai", [
    {
      op: mode === "token" ? "unset" : "set",
      path: [...path, "apiKeyEnv"],
      ...(mode === "api-key" ? { value: apiKeyRef } : {}),
    },
    ...(Object.hasOwn(providers, LEGACY_PROVIDER) ? [{ op: "unset", path: ["providers", LEGACY_PROVIDER] }] : []),
  ]);
}

function configuredApiKeyRef(settings) {
  const providers = settings.get("llm-pi-ai")?.providers ?? {};
  return providers[PROVIDER]?.apiKeyEnv ?? providers[LEGACY_PROVIDER]?.apiKeyEnv ?? API_KEY_ENV;
}

function maskApiKey(value) {
  const text = typeof value === "string" ? value : "";
  return text.length > 4 ? `••••${text.slice(-4)}` : text ? "••••" : "";
}

function textLabel(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function storedApiKeyRef() {
  return `WORKBUDDY_API_KEY_DSH_${Date.now().toString(36).toUpperCase()}_${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function readApiKeyStore(credentials) {
  for (const ref of [WORKBUDDY_API_KEYS_REF, LEGACY_API_KEYS_REF]) {
    const stored = await credentials.resolve(credentialRef(ref));
    if (stored?.value) return parseWorkBuddyApiKeys(stored.value);
  }
  return createWorkBuddyApiKeyStore();
}

async function writeApiKeyStore(credentials, store) {
  const normalized = createWorkBuddyApiKeyStore(store?.entries ?? [], store?.activeId);
  if (normalized.entries.length === 0) {
    await credentials.unset(credentialRef(WORKBUDDY_API_KEYS_REF));
    await credentials.unset(credentialRef(LEGACY_API_KEYS_REF));
    return;
  }
  await credentials.set(credentialRef(WORKBUDDY_API_KEYS_REF), serializeWorkBuddyApiKeys(normalized));
  await credentials.unset(credentialRef(LEGACY_API_KEYS_REF));
}

async function currentApiKeyState(webCtx) {
  const store = await readApiKeyStore(webCtx.credentials);
  const apiMode = authenticationMode(webCtx.settings.get("llm-pi-ai")) === "api-key";
  const ref = apiMode ? configuredApiKeyRef(webCtx.settings) : undefined;
  const items = [];
  const seenRefs = new Set();
  for (const envRef of [API_KEY_ENV, LEGACY_API_KEY_ENV]) {
    const environment = await webCtx.credentials.resolve(credentialRef(envRef));
    if (environment?.value) {
      items.push({
        id: `env:${envRef}`,
        kind: "environment",
        label: `环境变量 ${envRef}`,
        ref: envRef,
        configured: true,
        masked: maskApiKey(environment.value),
        source: environment.source,
      });
      seenRefs.add(envRef);
    }
  }
  for (const entry of workBuddyApiKeyEntries(store)) {
    if (seenRefs.has(entry.ref)) continue;
    const resolved = await webCtx.credentials.resolve(credentialRef(entry.ref));
    items.push({
      ...entry,
      kind: "dsh",
      configured: Boolean(resolved?.value),
      ...(resolved?.value ? { masked: maskApiKey(resolved.value), source: resolved.source } : {}),
    });
    seenRefs.add(entry.ref);
  }
  if (ref && !seenRefs.has(ref)) {
    const resolved = await webCtx.credentials.resolve(credentialRef(ref));
    if (resolved?.value) {
      items.push({
        id: `dsh:${ref}`,
        kind: ENV_SOURCES.has(resolved.source) ? "environment" : "dsh",
        label: ENV_SOURCES.has(resolved.source) ? `环境变量 ${ref}` : "DSH 默认 API Key",
        ref,
        configured: true,
        masked: maskApiKey(resolved.value),
        source: resolved.source,
      });
    }
  }
  const configured = apiMode
    ? items.find((item) => item.ref === ref)
      ?? (ref === API_KEY_ENV ? items.find((item) => item.ref === LEGACY_API_KEY_ENV) : undefined)
    : undefined;
  const active = configured ?? items.find((item) => item.id === store.activeId) ?? items[0];
  return {
    apiKeys: items,
    activeApiKeyId: active?.id ?? null,
    apiKeyConfigured: Boolean(configured?.configured),
  };
}

async function readSessionStore(credentials) {
  for (const ref of [WORKBUDDY_SESSIONS_REF, LEGACY_SESSIONS_REF]) {
    const stored = await credentials.resolve(credentialRef(ref));
    if (stored?.value) return parseWorkBuddySessions(stored.value);
  }
  for (const ref of [WORKBUDDY_SESSION_REF, LEGACY_SESSION_REF]) {
    const legacy = await credentials.resolve(credentialRef(ref));
    if (legacy?.value) return createWorkBuddySessionStore([parseWorkBuddySession(legacy.value)]);
  }
  return createWorkBuddySessionStore();
}

async function writeSessionStore(credentials, store) {
  const active = activeWorkBuddySession(store);
  if (!active) {
    await credentials.unset(credentialRef(WORKBUDDY_SESSIONS_REF));
    await credentials.unset(credentialRef(WORKBUDDY_SESSION_REF));
    await credentials.unset(credentialRef(LEGACY_SESSIONS_REF));
    await credentials.unset(credentialRef(LEGACY_SESSION_REF));
    return;
  }
  await credentials.set(credentialRef(WORKBUDDY_SESSIONS_REF), serializeWorkBuddySessions(store));
  // Keep the old single-session reference as a compatibility pointer for older plugin versions.
  await credentials.set(credentialRef(WORKBUDDY_SESSION_REF), serializeWorkBuddySession(active));
  await credentials.unset(credentialRef(LEGACY_SESSIONS_REF));
  await credentials.unset(credentialRef(LEGACY_SESSION_REF));
}

async function readSessionRouting(credentials) {
  const stored = await credentials.resolve(credentialRef(WORKBUDDY_SESSION_ROUTING_REF));
  return stored?.value ? parseWorkBuddySessionRouting(stored.value) : createWorkBuddySessionRoutingState();
}

async function writeSessionRouting(credentials, state) {
  await credentials.set(credentialRef(WORKBUDDY_SESSION_ROUTING_REF), serializeWorkBuddySessionRouting(state));
}

function sessionIdOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function clearSessionBindings(credentials, predicate) {
  const state = await readSessionRouting(credentials);
  const bindings = Object.fromEntries(Object.entries(state.bindings).filter(([, binding]) => !predicate(binding)));
  const clearRecent = state.lastUsed && predicate(state.lastUsed);
  if (clearRecent || Object.keys(bindings).length !== Object.keys(state.bindings).length) {
    await writeSessionRouting(credentials, {
      ...state,
      bindings,
      ...(clearRecent ? { lastUsed: undefined } : {}),
    });
  }
}

async function resolveSession(webCtx, accountId, sessionId) {
  const store = await readSessionStore(webCtx.credentials);
  const routing = await readSessionRouting(webCtx.credentials);
  const binding = routing.enabled && sessionIdOf(sessionId) ? routing.bindings[sessionIdOf(sessionId)] : undefined;
  const boundAccountId = binding?.mode === "token" ? binding.accountId : undefined;
  const requestedId = typeof accountId === "string" && accountId
    ? accountId
    : boundAccountId ?? store.activeId;
  let session = store.sessions.find((entry) => entry.id === requestedId) ?? activeWorkBuddySession(store);
  if (!session) throw new Error("没有找到该 WorkBuddy 登录账号");
  if (boundAccountId && session.id !== boundAccountId) throw new Error("当前会话绑定的 WorkBuddy 登录账号不存在");
  if (sessionNeedsRefresh(session)) {
    session = { ...session, ...(await refreshWorkBuddySession(session)), updatedAt: Date.now() };
    const nextStore = {
      ...store,
      sessions: store.sessions.map((entry) => entry.id === session.id ? session : entry),
    };
    await writeSessionStore(webCtx.credentials, nextStore);
  }
  return session;
}

export function installWorkBuddyWeb(ctx) {
  ctx.inject(["webServer", "settings", "credentials"], (webCtx) => {
    let loginPromise;
    const currentState = async (requestedSessionId) => {
      const sessionId = sessionIdOf(requestedSessionId);
      const store = await readSessionStore(webCtx.credentials);
      const active = activeWorkBuddySession(store);
      const routing = await readSessionRouting(webCtx.credentials);
      const apiKeys = await currentApiKeyState(webCtx);
      const globalMode = authenticationMode(webCtx.settings.get("llm-pi-ai"));
      const sessionBinding = routing.enabled && sessionId ? routing.bindings[sessionId] : undefined;
      const recentBinding = routing.enabled ? routing.lastUsed : undefined;
      const exactAccount = sessionBinding?.mode === "token" ? store.sessions.find((entry) => entry.id === sessionBinding.accountId) : undefined;
      const exactApiKey = sessionBinding?.mode === "api-key" ? apiKeys.apiKeys.find((entry) => entry.ref === sessionBinding.apiKeyRef) : undefined;
      const recentAccount = recentBinding?.mode === "token" ? store.sessions.find((entry) => entry.id === recentBinding.accountId) : undefined;
      const recentApiKey = recentBinding?.mode === "api-key" ? apiKeys.apiKeys.find((entry) => entry.ref === recentBinding.apiKeyRef) : undefined;
      const sessionBindingValid = !sessionBinding || (sessionBinding.mode === "token" ? Boolean(exactAccount) : Boolean(exactApiKey?.configured));
      const recentBindingValid = !recentBinding || (recentBinding.mode === "token" ? Boolean(recentAccount) : Boolean(recentApiKey?.configured));
      const effectiveBinding = sessionBinding ?? (recentBindingValid ? recentBinding : undefined);
      const boundAccount = effectiveBinding?.mode === "token" ? (sessionBinding ? exactAccount : recentAccount) : undefined;
      const boundApiKey = effectiveBinding?.mode === "api-key" ? (sessionBinding ? exactApiKey : recentApiKey) : undefined;
      const mode = effectiveBinding?.mode ?? globalMode;
      return {
        ok: true,
        mode,
        globalMode,
        routingEnabled: routing.enabled,
        sessionId: sessionId ?? null,
        sessionBinding: sessionBinding ?? null,
        sessionBindingValid,
        lastUsedBinding: recentBinding ?? null,
        lastUsedBindingValid: recentBindingValid,
        effectiveBinding: effectiveBinding ?? null,
        authenticated: effectiveBinding
          ? effectiveBinding.mode === "token" ? Boolean(boundAccount) : Boolean(boundApiKey?.configured)
          : active !== undefined,
        activeAccountId: effectiveBinding?.mode === "token" ? boundAccount?.id ?? null : active?.id ?? null,
        globalActiveAccountId: active?.id ?? null,
        accounts: workBuddySessionAccounts(store),
        ...apiKeys,
        activeApiKeyId: effectiveBinding?.mode === "api-key" ? boundApiKey?.id ?? null : apiKeys.activeApiKeyId,
        globalActiveApiKeyId: apiKeys.activeApiKeyId,
        apiKeyConfigured: mode === "api-key" && (effectiveBinding?.mode === "api-key" ? Boolean(boundApiKey?.configured) : apiKeys.apiKeyConfigured),
      };
    };
    const status = async (req, res) => {
      try {
        const sessionId = new URL(req.url, "http://127.0.0.1").searchParams.get("sessionId");
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "读取 WorkBuddy 认证状态失败" });
      }
    };
    const routing = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换会话认证" });
      try {
        const body = await requestBody(req);
        if (typeof body.enabled !== "boolean") return json(res, 400, { ok: false, message: "会话级认证开关参数无效" });
        const state = await readSessionRouting(webCtx.credentials);
        await writeSessionRouting(webCtx.credentials, { ...state, enabled: body.enabled });
        json(res, 200, await currentState(body.sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换会话级认证失败" });
      }
    };
    const apiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        const routingState = await readSessionRouting(webCtx.credentials);
        const sessionRouting = routingState.enabled && sessionId;
        let ref = API_KEY_ENV;
        if (typeof body.keyId === "string" && body.keyId) {
          const state = await currentApiKeyState(webCtx);
          const selected = state.apiKeys.find((entry) => entry.id === body.keyId);
          if (!selected) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy API Key" });
          if (!selected.configured) return json(res, 409, { ok: false, message: "该 API Key 已不可用，请删除后重新添加" });
          ref = selected.ref;
          if (!sessionRouting && !routingState.enabled) {
            const store = await readApiKeyStore(webCtx.credentials);
            await writeApiKeyStore(webCtx.credentials, { ...store, activeId: selected.kind === "dsh" ? selected.id : null });
          }
        }
        credentialRef(ref);
        if (routingState.enabled && !body.keyId) {
          const state = await currentApiKeyState(webCtx);
          const selected = state.apiKeys.find((entry) => entry.ref === ref) ?? state.apiKeys.find((entry) => entry.configured);
          if (!selected?.configured) return json(res, 409, { ok: false, message: "未检测到可用 WorkBuddy API Key" });
          ref = selected.ref;
        }
        if (sessionRouting) {
          await writeSessionRouting(webCtx.credentials, {
            ...routingState,
            bindings: { ...routingState.bindings, [sessionId]: { mode: "api-key", apiKeyRef: ref } },
            lastUsed: { mode: "api-key", apiKeyRef: ref },
          });
        } else if (routingState.enabled) {
          await writeSessionRouting(webCtx.credentials, {
            ...routingState,
            lastUsed: { mode: "api-key", apiKeyRef: ref },
          });
        } else {
          await setMode(webCtx.settings, "api-key", ref);
        }
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换 API Key 失败" });
      }
    };
    const addApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面保存 API Key" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        const value = typeof body.key === "string" ? body.key.trim() : "";
        if (!value) return json(res, 400, { ok: false, message: "请输入 API Key" });
        if (value.length > 16 * 1024) return json(res, 413, { ok: false, message: "API Key 长度超出限制" });
        const store = await readApiKeyStore(webCtx.credentials);
        const ref = storedApiKeyRef();
        const entry = {
          id: `dsh:${ref}`,
          ref,
          label: textLabel(body.label) ?? `DSH API Key ${store.entries.length + 1}`,
        };
        await webCtx.credentials.set(credentialRef(ref), value);
        try {
          const next = upsertWorkBuddyApiKey(store, entry);
          await writeApiKeyStore(webCtx.credentials, next);
          const routingState = await readSessionRouting(webCtx.credentials);
          if (routingState.enabled && sessionId) {
            await writeSessionRouting(webCtx.credentials, {
              ...routingState,
              bindings: { ...routingState.bindings, [sessionId]: { mode: "api-key", apiKeyRef: ref } },
              lastUsed: { mode: "api-key", apiKeyRef: ref },
            });
          } else if (routingState.enabled) {
            await writeSessionRouting(webCtx.credentials, {
              ...routingState,
              lastUsed: { mode: "api-key", apiKeyRef: ref },
            });
          } else {
            await setMode(webCtx.settings, "api-key", ref);
          }
        } catch (error) {
          await webCtx.credentials.unset(credentialRef(ref));
          throw error;
        }
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "保存 API Key 失败" });
      }
    };
    const removeApiKey = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面删除 API Key" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        const store = await readApiKeyStore(webCtx.credentials);
        const entry = store.entries.find((item) => item.id === body.keyId);
        if (!entry) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy API Key" });
        const activeRef = configuredApiKeyRef(webCtx.settings);
        await webCtx.credentials.unset(credentialRef(entry.ref));
        const remaining = store.entries.filter((item) => item.id !== entry.id);
        await writeApiKeyStore(webCtx.credentials, { version: 1, activeId: remaining[0]?.id, entries: remaining });
        await clearSessionBindings(webCtx.credentials, (binding) => binding.mode === "api-key" && binding.apiKeyRef === entry.ref);
        if (authenticationMode(webCtx.settings.get("llm-pi-ai")) === "api-key" && activeRef === entry.ref) {
          const environment = await webCtx.credentials.resolve(credentialRef(API_KEY_ENV));
          let fallback = API_KEY_ENV;
          if (!environment?.value) {
            for (const candidate of remaining) {
              if ((await webCtx.credentials.resolve(credentialRef(candidate.ref)))?.value) {
                fallback = candidate.ref;
                break;
              }
            }
          }
          await setMode(webCtx.settings, "api-key", fallback);
        }
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除 API Key 失败" });
      }
    };
    const token = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面切换认证方式" });
      try {
        const body = await requestBody(req);
        const store = await readSessionStore(webCtx.credentials);
        const sessionId = sessionIdOf(body.sessionId);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const active = store.sessions.find((entry) => entry.id === accountId);
        if (!active) return json(res, 409, { ok: false, message: "没有找到该 WorkBuddy 登录账号" });
        const routingState = await readSessionRouting(webCtx.credentials);
        if (routingState.enabled && sessionId) {
          await writeSessionRouting(webCtx.credentials, {
            ...routingState,
            bindings: { ...routingState.bindings, [sessionId]: { mode: "token", accountId: active.id } },
            lastUsed: { mode: "token", accountId: active.id },
          });
        } else if (routingState.enabled) {
          await writeSessionRouting(webCtx.credentials, {
            ...routingState,
            lastUsed: { mode: "token", accountId: active.id },
          });
        } else {
          await writeSessionStore(webCtx.credentials, { ...store, activeId: active.id });
          await setMode(webCtx.settings, "token");
        }
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "切换令牌账号失败" });
      }
    };
    const credits = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面查询 WorkBuddy 积分" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        const selection = await currentState(sessionId);
        if (selection.mode !== "token") {
          return json(res, 200, {
            ok: true,
            accountId: null,
            credits: null,
            totalDosage: null,
            segments: [],
            unlimited: false,
            cycleResetTime: null,
            creditError: "积分查询仅支持 WorkBuddy 令牌登录",
            todayUsage: null,
            todayUsageError: "今日请求量查询仅支持 WorkBuddy 令牌登录",
          });
        }
        const session = await resolveSession(webCtx, selection.activeAccountId ?? body.accountId, sessionId);
        const result = await fetchWorkBuddyCredits(session);
        json(res, 200, {
          ok: true,
          accountId: session.id,
          credits: result.credits,
          totalDosage: result.totalDosage,
          segments: result.segments,
          unlimited: !!result.unlimited,
          cycleResetTime: result.cycleResetTime ?? null,
          creditError: result.creditError ?? null,
          todayUsage: result.todayUsage ?? null,
          todayUsageError: result.todayUsageError ?? null,
        });
      } catch (error) {
        json(res, 200, {
          ok: true,
          accountId: null,
          credits: null,
          totalDosage: null,
          segments: [],
          unlimited: false,
          cycleResetTime: null,
          creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败",
          todayUsage: null,
          todayUsageError: error instanceof Error ? error.message : "查询 WorkBuddy 今日请求量失败",
        });
      }
    };
    const login = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面登录" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        loginPromise ??= (async () => {
          const session = await loginWorkBuddy();
          const store = await readSessionStore(webCtx.credentials);
          const nextStore = upsertWorkBuddySession(store, session);
          await writeSessionStore(webCtx.credentials, nextStore);
          const routingState = await readSessionRouting(webCtx.credentials);
          if (routingState.enabled && sessionId) {
            await writeSessionRouting(webCtx.credentials, {
              ...routingState,
              bindings: { ...routingState.bindings, [sessionId]: { mode: "token", accountId: nextStore.activeId } },
              lastUsed: { mode: "token", accountId: nextStore.activeId },
            });
          } else if (routingState.enabled) {
            await writeSessionRouting(webCtx.credentials, {
              ...routingState,
              lastUsed: { mode: "token", accountId: nextStore.activeId },
            });
          } else {
            await setMode(webCtx.settings, "token");
          }
        })().finally(() => {
          loginPromise = undefined;
        });
        await loginPromise;
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "WorkBuddy 登录失败" });
      }
    };
    const remove = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许从本机 DSH 页面管理登录账号" });
      try {
        const body = await requestBody(req);
        const sessionId = sessionIdOf(body.sessionId);
        const store = await readSessionStore(webCtx.credentials);
        const accountId = typeof body.accountId === "string" ? body.accountId : store.activeId;
        const sessions = store.sessions.filter((entry) => entry.id !== accountId);
        if (sessions.length === store.sessions.length) return json(res, 404, { ok: false, message: "没有找到该 WorkBuddy 登录账号" });
        const activeId = accountId === store.activeId ? sessions[0]?.id : store.activeId;
        await writeSessionStore(webCtx.credentials, { version: 1, activeId, sessions });
        await clearSessionBindings(webCtx.credentials, (binding) => binding.mode === "token" && binding.accountId === accountId);
        json(res, 200, await currentState(sessionId));
      } catch (error) {
        json(res, 500, { ok: false, message: error instanceof Error ? error.message : "删除令牌账号失败" });
      }
    };
    webCtx.effect(() => {
      const dispose = [
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/status`, handler: status }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/routing`, handler: routing }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key`, handler: apiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/add`, handler: addApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/api-key/remove`, handler: removeApiKey }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/token`, handler: token }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/credits`, handler: credits }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/login`, handler: login }),
        webCtx.webServer.register({ kind: "exact", path: `${ROUTE}/remove`, handler: remove }),
      ];
      return () => dispose.forEach((fn) => fn());
    }, "llm-workbuddy: web login routes");
  });
}
