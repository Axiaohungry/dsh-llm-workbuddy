import { AsyncLocalStorage } from "node:async_hooks";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { LlmError, assertUsableApiKey, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { Config, PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import * as dshSettings from "@deepseek-ai/dsh-settings";
import { createProvider } from "@earendil-works/pi-ai";
import * as openAICompletionsApi from "@earendil-works/pi-ai/api/openai-completions";
import * as openAIResponsesApi from "@earendil-works/pi-ai/api/openai-responses";
import * as anthropicMessagesApi from "@earendil-works/pi-ai/api/anthropic-messages";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  WORKBUDDY_SESSION_REF,
  WORKBUDDY_SESSIONS_REF,
  WORKBUDDY_SESSION_ROUTING_REF,
  LEGACY_SESSION_REF,
  LEGACY_SESSIONS_REF,
  activeWorkBuddySession,
  createWorkBuddySessionStore,
  createWorkBuddySessionRoutingState,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  parseWorkBuddySessionRouting,
  refreshWorkBuddySession,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  sessionCacheDeadline,
  sessionNeedsRefresh,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { installWorkBuddyWeb } from "./workbuddy-web.js";

export { Config };

export const name = "llm-workbuddy";
export const inject = ["llm"];

const NS = typeof dshSettings.settingsNamespace === "function" ? dshSettings.settingsNamespace("llm-pi-ai") : "llm-pi-ai";
const PROVIDER = "workbuddy-cn";
const LEGACY_PROVIDER = "codebuddy-cn";
const WORKBUDDY_PROVIDERS = new Set([PROVIDER, LEGACY_PROVIDER]);
const DISPLAY_NAME = "WorkBuddy 中国区";
const API_KEY_ENV = "WORKBUDDY_API_KEY";
const LEGACY_API_KEY_ENV = "CODEBUDDY_API_KEY";
const BASE_URL = "https://copilot.tencent.com/v2";
const CONFIG_URL = "https://copilot.tencent.com/v3/config";
const USER_AGENT = "CLI/unknown CodeBuddy/2.137.1";
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_LEVELS = ["off", ...EFFORTS];
const COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  thinkingFormat: "openai",
};

function workBuddyRequestOptions(options) {
  return {
    ...options,
    timeoutMs: options?.timeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
    headers: { ...(options?.headers ?? {}), "user-agent": USER_AGENT },
  };
}

const workBuddyApi = {
  ...openAICompletionsApi,
  stream: (model, context, options) => openAICompletionsApi.stream(model, context, workBuddyRequestOptions(options)),
  streamSimple: (model, context, options) => openAICompletionsApi.streamSimple(model, context, workBuddyRequestOptions(options)),
};

const FALLBACK_MODELS = [
  ["hy3", "Hy3", 192000, 64000, true],
  ["glm-5.2", "GLM-5.2", 1000000, 48000, false],
  ["glm-5.1", "GLM-5.1", 200000, 48000, false],
  ["glm-5v-turbo", "GLM-5v-Turbo", 200000, 64000, true],
  ["minimax-m3-pay", "MiniMax-M3", 512000, 128000, true],
  ["minimax-m2.7", "MiniMax-M2.7", 200000, 48000, true],
  ["kimi-k3-2", "Kimi-K3", 1000000, 32000, true],
  ["kimi-k2.7", "Kimi-K2.7-Code", 256000, 32000, true],
  ["kimi-k2.6", "Kimi-K2.6", 256000, 32000, true],
  ["deepseek-v4-pro", "DeepSeek V4 Pro", 1000000, 50000, true],
  ["deepseek-v4-flash", "DeepSeek V4 Flash", 1000000, 50000, true],
].map(([id, modelName, contextWindow, maxTokens, images]) =>
  workBuddyModel({ id, name: modelName, contextWindow, maxTokens, images }),
);

function workBuddyModel({ provider = PROVIDER, id, name: modelName, contextWindow, maxTokens, images, reasoning = true, thinkingLevelMap = { off: null }, defaultReasoningEffort, thinkingFormat }) {
  return {
    id,
    name: modelName,
    api: "openai-completions",
    provider,
    baseUrl: BASE_URL,
    reasoning,
    ...(reasoning ? { thinkingLevelMap: { ...thinkingLevelMap } } : {}),
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    input: images ? ["text", "image"] : ["text"],
    cost: { ...NO_COST },
    contextWindow,
    maxTokens,
    compat: { ...COMPAT, ...(thinkingFormat ? { thinkingFormat } : {}) },
  };
}

function remoteReasoning(raw, fallback) {
  const reasoning = raw.supportsReasoning ?? fallback?.reasoning ?? raw.onlyReasoning === true;
  if (!reasoning) return { reasoning: false };
  const declared = raw.thinkingLevelMap && typeof raw.thinkingLevelMap === "object" ? raw.thinkingLevelMap : undefined;
  const thinkingLevelMap = declared
    ? Object.fromEntries(THINKING_LEVELS.map((level) => [level,
        Object.hasOwn(declared, level) && (typeof declared[level] === "string" || declared[level] === null) ? declared[level] : null]))
    : { ...(fallback?.thinkingLevelMap ?? {}), ...(raw.onlyReasoning === true ? { off: null } : {}) };
  const effort = raw.reasoning?.effort;
  const defaultReasoningEffort = EFFORTS.includes(effort) && thinkingLevelMap[effort] !== null ? effort : undefined;
  return {
    reasoning: true,
    thinkingLevelMap,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(typeof raw.thinkingFormat === "string" ? { thinkingFormat: raw.thinkingFormat } : {}),
  };
}

function configuredReasoning(entry, base) {
  if (entry.reasoningEfforts === false) return { reasoning: false };
  if (!entry.reasoningEfforts || typeof entry.reasoningEfforts !== "object") {
    return base ? {
      reasoning: base.reasoning,
      thinkingLevelMap: base.thinkingLevelMap,
      defaultReasoningEffort: base.defaultReasoningEffort,
      thinkingFormat: base.compat?.thinkingFormat,
    } : { reasoning: false };
  }
  const map = {};
  for (const level of THINKING_LEVELS) {
    if (!Object.hasOwn(entry.reasoningEfforts, level)) map[level] = null;
    else if (!(level === "off" && entry.reasoningEfforts[level] === null)) map[level] = entry.reasoningEfforts[level];
  }
  return { reasoning: true, thinkingLevelMap: map, thinkingFormat: entry.compat?.thinkingFormat };
}

function positiveInteger(...values) {
  return values.find((value) => Number.isSafeInteger(value) && value > 0);
}

function text(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function modelsFromConfig(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : data?.agent?.agents;
  const cli = Array.isArray(agents) ? agents.find((agent) => agent?.name === "cli") : undefined;
  const allowed = Array.isArray(cli?.models) ? cli.models : [];
  const source = Array.isArray(data?.models) ? data.models : [];
  const byId = new Map(source.map((model) => [model?.id, model]));
  return allowed.flatMap((id) => {
    const raw = byId.get(id);
    if (!raw) return [];
    const fallback = FALLBACK_MODELS.find((model) => model.id === id);
    const contextWindow = positiveInteger(raw.maxInputTokens, raw.maxAllowedSize, fallback?.contextWindow);
    const maxTokens = positiveInteger(raw.maxOutputTokens, fallback?.maxTokens);
    if (!contextWindow || !maxTokens) return [];
    return [workBuddyModel({
      id,
      name: text(raw.name, fallback?.name, id),
      contextWindow,
      maxTokens,
      images: raw.supportsImages === true || fallback?.input.includes("image") === true,
      ...remoteReasoning(raw, fallback),
    })];
  });
}

function authenticationHeaders(credential) {
  const value = assertUsableApiKey(credential.value, name, credential.ref ?? API_KEY_ENV);
  return credential.kind === "bearer" ? { authorization: `Bearer ${value}` } : { "x-api-key": value };
}

async function fetchWorkBuddyModels(credential, signal) {
  let response;
  try {
    response = await fetch(CONFIG_URL, {
      headers: {
        accept: "application/json",
        ...authenticationHeaders(credential),
        "user-agent": USER_AGENT,
        "x-product": "SaaS",
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new LlmError("WorkBuddy 模型列表获取已取消", "ABORTED", { cause: error });
    throw new LlmError("无法连接 WorkBuddy 模型配置接口", "DISCOVERY_FAILED", { cause: error });
  }
  if (!response.ok) throw new LlmError(`WorkBuddy 模型配置接口返回 ${response.status}`, "DISCOVERY_FAILED");
  const body = await response.json();
  if (body?.code !== 0) throw new LlmError(`WorkBuddy 模型配置接口错误：${body?.msg ?? body?.code}`, "DISCOVERY_FAILED");
  const models = modelsFromConfig(body.data);
  if (models.length === 0) throw new LlmError("WorkBuddy 没有返回 CLI 可用模型", "DISCOVERY_FAILED");
  return models;
}

/**
 * WorkBuddy's credential is already resolved by the DSH adapter.  Do not
 * reuse pi-ai's DeepSeek envApiKeyAuth here: newer pi-ai releases require a
 * signal argument while older DSH adapters call auth resolvers without one.
 * This small adapter accepts both contracts and keeps bearer/API-key values
 * opaque to the provider implementation.
 */
function workBuddyApiKeyAuth() {
  return {
    name: `${DISPLAY_NAME} API Key`,
    login: async (interaction) => {
      const signal = interaction?.signal;
      signal?.throwIfAborted?.();
      const key = await interaction.prompt({ type: "secret", message: `Enter ${DISPLAY_NAME} API Key` });
      signal?.throwIfAborted?.();
      return { type: "api_key", key };
    },
    resolve: async ({ credential, signal } = {}) => {
      signal?.throwIfAborted?.();
      if (!credential?.key) return undefined;
      return {
        auth: { apiKey: credential.key },
        ...(credential.env ? { env: credential.env } : {}),
        source: "DSH credential",
      };
    },
  };
}

function workBuddyProvider(models, provider = PROVIDER) {
  return createProvider({
    id: provider,
    name: DISPLAY_NAME,
    baseUrl: BASE_URL,
    auth: { apiKey: workBuddyApiKeyAuth() },
    models: models.map((model) => ({ ...model, provider })),
    api: workBuddyApi,
  });
}

const GENERIC_APIS = Object.freeze({
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
});
const GENERIC_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function genericApiKeyAuth(provider) {
  return {
    name: `${provider} API Key`,
    resolve: async ({ credential, signal } = {}) => {
      signal?.throwIfAborted?.();
      if (!credential?.key) return undefined;
      return { auth: { apiKey: credential.key }, source: "DSH credential" };
    },
  };
}

function genericModel(provider, source, entry) {
  const reasoningEfforts = entry.reasoningEfforts;
  const reasoning = reasoningEfforts !== false && reasoningEfforts && typeof reasoningEfforts === "object";
  const thinkingLevelMap = reasoning
    ? Object.fromEntries(GENERIC_LEVELS.filter((level) => Object.hasOwn(reasoningEfforts, level)).map((level) => [level, reasoningEfforts[level]]))
    : undefined;
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    api: source.api,
    provider,
    baseUrl: source.baseURL,
    input: Array.isArray(entry.input) && entry.input.length > 0 ? [...entry.input] : [...source.defaultInput ?? ["text"]],
    cost: { ...NO_COST },
    contextWindow: entry.contextWindow ?? source.defaultContextWindow ?? 262144,
    maxTokens: entry.maxTokens ?? source.defaultMaxTokens ?? 32768,
    ...(reasoning ? { reasoning: true, thinkingLevelMap } : {}),
    ...(entry.compat ?? source.compat ? { compat: { ...(source.compat ?? {}), ...(entry.compat ?? {}) } } : {}),
  };
}

function genericProvider(provider, source = {}) {
  const api = GENERIC_APIS[source.api];
  if (!api || !source.baseURL || !Array.isArray(source.models) || source.models.length === 0) return undefined;
  return createProvider({
    id: provider,
    name: source.displayName ?? provider,
    baseUrl: source.baseURL,
    headers: source.headers,
    auth: { apiKey: genericApiKeyAuth(provider) },
    models: source.models.map((entry) => genericModel(provider, source, entry)),
    api,
  });
}

function resolvedProfile(provider, source, piProvider, configuredMaxTokens = new Map(), requestContext) {
  const apiKeyEnv = source.apiKeyEnv === undefined ? undefined : credentialRef(source.apiKeyEnv);
  return {
    ...source,
    headers: runtimeHeaders(source.headers, requestContext),
    provider,
    displayName: source.displayName ?? piProvider.name ?? provider,
    // dsh-llm-pi-ai reads this map for every exact model during catalog
    // resolution. WorkBuddy profiles have no per-model validation failures
    // here, but must still provide the empty map for the shared adapter API.
    modelErrors: new Map(),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(source.retryPolicy, `${name}: provider "${provider}" retryPolicy`),
    configuredMaxTokens,
    piProvider,
  };
}

function selectBuiltinModels(base, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return base;
  const byId = new Map(base.getModels().map((model) => [model.id, model]));
  const selected = entries.flatMap((entry) => {
    const model = byId.get(entry.id);
    if (!model) return [];
    return [{
      ...model,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
      ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
      ...(Array.isArray(entry.input) && entry.input.length ? { input: [...entry.input] } : {}),
    }];
  });
  return { ...base, getModels: () => selected };
}

function selectWorkBuddyModels(base, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return base;
  const byId = new Map(base.map((model) => [model.id, model]));
  return entries.map((entry) => {
    const model = byId.get(entry.id);
    const reasoning = configuredReasoning(entry, model);
    return workBuddyModel({
      id: entry.id,
      name: entry.name ?? model?.name ?? entry.id,
      contextWindow: entry.contextWindow ?? model?.contextWindow ?? 262144,
      maxTokens: entry.maxTokens ?? model?.maxTokens ?? 32768,
      images: entry.input?.includes("image") ?? model?.input.includes("image") ?? false,
      ...reasoning,
    });
  });
}

function ownsProvider(provider, builtins, source) {
  return WORKBUDDY_PROVIDERS.has(provider) || builtins.has(provider) || genericProvider(provider, source) !== undefined;
}

function runtimeHeaders(headers, requestContext) {
  const base = { ...(headers ?? {}) };
  if (!requestContext) return base;
  return new Proxy(base, {
    ownKeys(target) {
      const extra = requestContext.getStore()?.headers ?? {};
      return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(extra)])];
    },
    getOwnPropertyDescriptor(target, property) {
      const extra = requestContext.getStore()?.headers ?? {};
      if (!Reflect.has(target, property) && !Reflect.has(extra, property)) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: this.get(target, property) };
    },
    get(target, property, receiver) {
      const extra = requestContext.getStore()?.headers ?? {};
      return Reflect.has(extra, property) ? extra[property] : Reflect.get(target, property, receiver);
    },
  });
}

function sessionBindingFor(routing, sessionId, runtimeScoped = false) {
  if (!routing?.enabled) return undefined;
  const id = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
  if (id && Object.hasOwn(routing.bindings, id)) return routing.bindings[id];
  // ponytail: a new session can have an unbound id on its first request, so
  // keep the recent default for that path. Only a truly missing runtime id
  // must fail over to the global provider auth instead of another session.
  return runtimeScoped && !id ? undefined : routing.lastUsed;
}

// The rc.6 pi-ai adapter rejects replay metadata it does not understand. A
// newer DSH may persist a v2 envelope, so let old adapters use the durable
// message content as provider-neutral history instead of failing the request.
function stripUnsupportedReplay(options) {
  if (!Array.isArray(options?.messages)) return options;
  let changed = false;
  const messages = options.messages.map((message) => {
    const source = message?.source;
    const state = source?.replayState;
    if (state === undefined || (state?.kind === "pi-ai" && state?.version === 1)) return message;
    changed = true;
    const { replayState: _ignored, ...sourceWithoutReplay } = source;
    return { ...message, source: sourceWithoutReplay };
  });
  return changed ? { ...options, messages } : options;
}

function workBuddySource(config, source) {
  const providers = config?.providers ?? {};
  return Object.hasOwn(providers, PROVIDER) || Object.hasOwn(providers, LEGACY_PROVIDER)
    ? source
    : { ...source, apiKeyEnv: source.apiKeyEnv ?? API_KEY_ENV };
}

function installSettingsCompat(ctx, ns, schema, entry, hooks) {
  if (typeof dshSettings.installSettingsSection === "function") {
    return dshSettings.installSettingsSection(ctx, ns, schema, entry, hooks);
  }
  return ctx.inject(["settings"], (settingsCtx) => {
    if (!settingsCtx.settings || typeof settingsCtx.settings.installSection !== "function") {
      throw new Error(`${name}: DSH settings service does not provide installSection`);
    }
    return settingsCtx.settings.installSection(ctx, ns, schema, entry, hooks);
  });
}

export const __testing = Object.freeze({ authenticationHeaders, workBuddyApiKeyAuth, workBuddyRequestOptions, workBuddySource, genericProvider, modelsFromConfig, ownsProvider, runtimeHeaders, stripUnsupportedReplay, selectWorkBuddyModels, sessionBindingFor });

export function apply(ctx, config) {
  installWorkBuddyWeb(ctx);
  let current = () => config;
  const requestContext = new AsyncLocalStorage();
  let remoteModels;
  let generation = 0;
  let memoRaw;
  let memoGeneration = -1;
  let memoized;
  const loginSessionPromises = new Map();
  let remoteModelsKey;
  const builtins = new Map(builtinProviders().map((provider) => [provider.id, provider]));

  const effectiveConfig = () => {
    const raw = current() ?? {};
    const providers = raw.providers ?? {};
    const configured = providers[PROVIDER] ?? providers[LEGACY_PROVIDER];
    return {
      ...raw,
      providers: {
        ...providers,
        [PROVIDER]: configured ?? { apiKeyEnv: API_KEY_ENV },
      },
    };
  };

  const profiles = () => {
    const raw = effectiveConfig();
    if (memoRaw === current() && memoGeneration === generation && memoized) return memoized;
    const result = new Map();
    for (const [provider, source] of Object.entries(raw.providers)) {
      if (!ownsProvider(provider, builtins, source)) continue;
      if (WORKBUDDY_PROVIDERS.has(provider)) {
        const sourceWithAuth = workBuddySource(current(), source);
        const models = selectWorkBuddyModels(remoteModels ?? FALLBACK_MODELS, source.models);
        const configured = new Map((source.models ?? []).flatMap((model) =>
          Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
        ));
        result.set(provider, resolvedProfile(provider, {
          ...sourceWithAuth,
          headers: runtimeHeaders(sourceWithAuth.headers, requestContext),
          displayName: DISPLAY_NAME,
        }, workBuddyProvider(models, provider), configured, requestContext));
        continue;
      }
      const base = builtins.get(provider);
      if (!base) {
        const generic = genericProvider(provider, source);
        if (!generic) continue;
        const configured = new Map((source.models ?? []).flatMap((model) =>
          Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
        ));
        result.set(provider, resolvedProfile(provider, source, generic, configured));
        continue;
      }
      const selected = selectBuiltinModels(base, source.models);
      const configured = new Map((source.models ?? []).flatMap((model) =>
        Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? [[model.id, model.maxTokens]] : [],
      ));
      result.set(provider, resolvedProfile(provider, source, selected, configured));
    }
    memoRaw = current();
    memoGeneration = generation;
    memoized = result;
    return result;
  };

  const readSessionRouting = async () => {
    const credentials = ctx.get("credentials");
    const env = launchEnvironmentOf(ctx);
    const ref = credentialRef(WORKBUDDY_SESSION_ROUTING_REF);
    const stored = await credentials?.resolve(ref);
    const value = stored?.value ?? env.get(ref)?.value;
    return value ? parseWorkBuddySessionRouting(value) : createWorkBuddySessionRoutingState();
  };

  const resolveLoginSession = async (requestedId) => {
    const key = typeof requestedId === "string" && requestedId ? requestedId : "active";
    let promise = loginSessionPromises.get(key);
    if (!promise) {
      promise = (async () => {
        const credentials = ctx.get("credentials");
        const env = launchEnvironmentOf(ctx);
        const sessionsRef = credentialRef(WORKBUDDY_SESSIONS_REF);
        const sessionRefs = [sessionsRef, credentialRef(LEGACY_SESSIONS_REF)];
        let sessionsValue;
        for (const ref of sessionRefs) {
          const storedSessions = await credentials?.resolve(ref);
          sessionsValue = storedSessions?.value ?? env.get(ref)?.value;
          if (sessionsValue) break;
        }
        let store;
        if (sessionsValue) {
          store = parseWorkBuddySessions(sessionsValue);
        } else {
          const legacyRefs = [credentialRef(WORKBUDDY_SESSION_REF), credentialRef(LEGACY_SESSION_REF)];
          let legacyValue;
          for (const ref of legacyRefs) {
            const storedLegacy = await credentials?.resolve(ref);
            legacyValue = storedLegacy?.value ?? env.get(ref)?.value;
            if (legacyValue) break;
          }
          if (!legacyValue) throw new Error("未找到 WorkBuddy 登录凭据");
          store = createWorkBuddySessionStore([parseWorkBuddySession(legacyValue)]);
        }
        const active = typeof requestedId === "string" && requestedId
          ? store.sessions.find((entry) => entry.id === requestedId)
          : activeWorkBuddySession(store);
        if (!active) throw new Error("未找到 WorkBuddy 登录账号");
        let session = active;
        if (sessionNeedsRefresh(session)) {
          session = { ...session, ...(await refreshWorkBuddySession(session)), updatedAt: Date.now() };
          const nextStore = {
            ...store,
            sessions: store.sessions.map((entry) => entry.id === session.id ? session : entry),
          };
          await credentials?.set(sessionsRef, serializeWorkBuddySessions(nextStore));
          if (nextStore.activeId === session.id) await credentials?.set(credentialRef(WORKBUDDY_SESSION_REF), serializeWorkBuddySession(session));
        }
        return { ...session, sessionId: active.id, expiresAt: sessionCacheDeadline(session) };
      })().finally(() => {
        loginSessionPromises.delete(key);
      });
      loginSessionPromises.set(key, promise);
    }
    return promise;
  };

  const resolveCredential = async (provider, profile, context = requestContext.getStore()) => {
    const runtimeContext = context;
    context ??= {};
    const ref = profile.apiKeyEnv;
    const routing = WORKBUDDY_PROVIDERS.has(provider) ? await readSessionRouting() : createWorkBuddySessionRoutingState();
    const sessionId = context?.sessionId ? String(context.sessionId) : undefined;
    const binding = sessionBindingFor(routing, sessionId, runtimeContext !== undefined);
    if (WORKBUDDY_PROVIDERS.has(provider) && binding?.mode === "token") {
      let session;
      try {
        session = await resolveLoginSession(binding.accountId);
      } catch (error) {
        throw new LlmError(`${name}: 当前会话绑定的 WorkBuddy 登录账号不可用`, "MISSING_CREDENTIAL", { cause: error });
      }
      context.headers = {
        ...(session.account.userId ? { "X-User-Id": session.account.userId } : {}),
        ...(session.account.enterpriseId ? { "X-Enterprise-Id": session.account.enterpriseId, "X-Tenant-Id": session.account.enterpriseId } : {}),
        ...(session.auth.domain ? { "X-Domain": session.auth.domain } : {}),
      };
      return { value: assertUsableApiKey(session.auth.accessToken, name, "WorkBuddy login session"), kind: "bearer", sessionId: session.sessionId };
    }
    if (WORKBUDDY_PROVIDERS.has(provider) && binding?.mode === "api-key") {
      const bindingRef = binding.apiKeyRef;
      if (!bindingRef) throw new LlmError(`${name}: 当前会话绑定的 API Key 引用无效`, "MISSING_CREDENTIAL");
      const stored = await ctx.get("credentials")?.resolve(credentialRef(bindingRef));
      const value = stored?.value ?? launchEnvironmentOf(ctx).get(credentialRef(bindingRef))?.value;
      if (value) return { value: assertUsableApiKey(value, name, bindingRef), kind: "api-key", ref: bindingRef };
      throw new LlmError(`${name}: 当前会话绑定的 API Key 不可用`, "MISSING_CREDENTIAL");
    }
    if (!ref && WORKBUDDY_PROVIDERS.has(provider)) {
      let session;
      try {
        session = await resolveLoginSession();
      } catch (error) {
        throw new LlmError(`${name}: 未找到可用的 WorkBuddy 登录令牌，请运行 dsh-llm-workbuddy login`, "MISSING_CREDENTIAL", { cause: error });
      }
      context.headers = {
        ...(session.account.userId ? { "X-User-Id": session.account.userId } : {}),
        ...(session.account.enterpriseId ? { "X-Enterprise-Id": session.account.enterpriseId, "X-Tenant-Id": session.account.enterpriseId } : {}),
        ...(session.auth.domain ? { "X-Domain": session.auth.domain } : {}),
      };
      return { value: assertUsableApiKey(session.auth.accessToken, name, "WorkBuddy login session"), kind: "bearer", sessionId: session.sessionId };
    }
    if (!ref) return { value: undefined, kind: "none" };
    const stored = await ctx.get("credentials")?.resolve(ref);
    let value = stored?.value ?? launchEnvironmentOf(ctx).get(ref)?.value;
    if (!value && ref === API_KEY_ENV) {
      const legacyRef = credentialRef(LEGACY_API_KEY_ENV);
      const legacyStored = await ctx.get("credentials")?.resolve(legacyRef);
      value = legacyStored?.value ?? launchEnvironmentOf(ctx).get(legacyRef)?.value;
    }
    if (value) return { value: assertUsableApiKey(value, name, ref), kind: "api-key", ref };
    throw new LlmError(`${name}: Provider "${provider}" 缺少 API Key，请在 WebUI 的模型设置中填写`, "MISSING_CREDENTIAL");
  };

  const resolveApiKey = async (provider, profile) => (await resolveCredential(provider, profile)).value;

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    resolveAttachments: () => ctx.get("attachments"),
  });
  const sessionScopedStream = (stream, options) => {
    const context = { sessionId: options?.sessionId === undefined ? undefined : String(options.sessionId), headers: {} };
    const source = requestContext.run(context, () => stream(options));
    const iterator = source[Symbol.asyncIterator]();
    return {
      [Symbol.asyncIterator]() { return this; },
      next(value) { return requestContext.run(context, () => iterator.next(value)); },
      return(value) { return requestContext.run(context, () => iterator.return?.(value) ?? Promise.resolve({ done: true, value })); },
      throw(error) { return requestContext.run(context, () => iterator.throw?.(error) ?? Promise.reject(error)); },
    };
  };
  const adapterStream = adapter.stream.bind(adapter);
  const legacyAdapter = typeof adapter.prepareCall !== "function";
  const invokeAdapterStream = (options) => adapterStream(legacyAdapter ? stripUnsupportedReplay(options) : options);
  adapter.stream = (options) => sessionScopedStream(invokeAdapterStream, options);
  // `prepareCall` was added after the DSH rc.6 adapter. Keep the direct
  // `stream` path working on older hosts while wrapping prepared calls on
  // newer hosts, whose runtime dispatches through the returned stream handle.
  if (!legacyAdapter) {
    const adapterPrepareCall = adapter.prepareCall.bind(adapter);
    adapter.prepareCall = async (...args) => {
      const prepared = await adapterPrepareCall(...args);
      return {
        ...prepared,
        stream: (options) => sessionScopedStream(prepared.stream, options),
      };
    };
  } else {
    // DSH 0.1.5 calls prepareCall unconditionally, while the rc.6 pi-ai
    // adapter shipped without it. Keep that older adapter usable by exposing
    // the same prepared-call shape from its existing methods.
    adapter.prepareCall = async (provider, model, signal) => ({
      model: await adapter.resolveModel(provider, model, signal),
      stream: (options) => sessionScopedStream(invokeAdapterStream, options),
    });
  }
  const resolveModel = adapter.resolveModel.bind(adapter);
  adapter.resolveModel = async (provider, model, signal) => {
    const resolved = await resolveModel(provider, model, signal);
    if (!WORKBUDDY_PROVIDERS.has(provider) || !resolved.reasoning) return resolved;
    const configured = profiles().get(provider)?.piProvider.getModels().find((entry) => entry.id === model);
    const effort = configured?.defaultReasoningEffort;
    if (!effort || !resolved.reasoning.efforts.some((entry) => entry.id === effort)) return resolved;
    return { ...resolved, reasoning: { ...resolved.reasoning, defaultEffort: effort } };
  };
  const listModels = adapter.listModels.bind(adapter);
  let refreshPromise;
  adapter.listModels = async (provider) => {
    if (WORKBUDDY_PROVIDERS.has(provider)) {
      refreshPromise ??= (async () => {
        try {
          const profile = profiles().get(provider);
          const credential = await resolveCredential(provider, profile);
          const cacheKey = credential.kind === "bearer" ? `token:${credential.sessionId ?? "active"}` : `api:${credential.ref ?? API_KEY_ENV}`;
          if (remoteModels && remoteModelsKey === cacheKey) return;
          remoteModels = await fetchWorkBuddyModels(credential);
          remoteModelsKey = cacheKey;
          generation += 1;
        } catch {
          // Keep the built-in catalog available while the key or network is absent.
        }
      })().finally(() => {
        refreshPromise = undefined;
      });
      await refreshPromise;
    }
    return listModels(provider);
  };

  const directoryEntries = () => [{
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    settingsNs: NS,
    settingsPath: ["providers", PROVIDER],
    declared: false,
  }, ...[...builtins.values()].flatMap((provider) => provider.auth?.apiKey ? [{
    provider: provider.id,
    displayName: provider.name,
    settingsNs: NS,
    settingsPath: ["providers", provider.id],
    declared: false,
  }] : []), ...Object.entries(effectiveConfig().providers ?? {}).flatMap(([provider, source]) => {
    if (WORKBUDDY_PROVIDERS.has(provider) || builtins.has(provider) || !genericProvider(provider, source)) return [];
    return [{
      provider,
      displayName: source.displayName ?? provider,
      settingsNs: NS,
      settingsPath: ["providers", provider],
      declared: true,
    }];
  })];

  let directory = ctx.llm.registerConfigurableProviders(directoryEntries());
  let registration = ctx.llm.registerAdapter([...profiles().keys()], adapter);

  ctx.llm.registerModelDiscovery(NS, async (request) => {
    if (WORKBUDDY_PROVIDERS.has(request.provider)) {
      const profile = profiles().get(request.provider);
      const credential = request.apiKey
        ? { value: request.apiKey, kind: "api-key", ref: API_KEY_ENV }
        : await resolveCredential(request.provider, profile);
      remoteModels = await fetchWorkBuddyModels(credential, request.signal);
      remoteModelsKey = credential.kind === "bearer" ? `token:${credential.sessionId ?? "active"}` : `api:${credential.ref ?? API_KEY_ENV}`;
      generation += 1;
      return remoteModels.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }));
    }
    const provider = builtins.get(request.provider);
    if (!provider) throw new LlmError(`没有 Provider "${request.provider ?? ""}" 的模型目录`, "DISCOVERY_FAILED");
    return provider.getModels().map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  });

  // Keep WorkBuddy out of the settings base layer so it appears in WebUI's
  // "Add provider" dropdown. The runtime profile above still exists as the
  // built-in implementation; selecting it only persists the credential ref.
  installSettingsCompat(ctx, NS, Config, config ?? { providers: {} }, {
    setSource(source) {
      current = source;
    },
    onChange() {
      memoRaw = undefined;
      const providers = profiles();
      registration.replace([...providers.keys()]);
      directory.replace(directoryEntries());
    },
  });
}
