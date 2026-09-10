import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { __testing } from "./index.js";
import {
  workBuddyApiKeyEntries,
  activeWorkBuddySession,
  workBuddySessionAccounts,
  createWorkBuddyApiKeyStore,
  createWorkBuddySessionStore,
  parseWorkBuddyApiKeys,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  refreshWorkBuddySession,
  serializeWorkBuddyApiKeys,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  sessionNeedsRefresh,
  upsertWorkBuddyApiKey,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";
import { authenticationMode } from "./workbuddy-web.js";
import { __testing as creditsTesting, fetchWorkBuddyCredits } from "./workbuddy-credits.js";

test("客户端兼容包装 Provider 并将 WorkBuddy 用量并入统计行", () => {
  const client = readFileSync(new URL("./client.js", import.meta.url), "utf8");
  assert.match(client, /WORKBUDDY_PROVIDER_PATTERN/);
  assert.match(client, /isWorkBuddyProvider\(provider\)/);
  assert.match(client, /data-composer-stats/);
  assert.match(client, /display: grid !important/);
});

test("忽略由其他插件负责的 Provider", () => {
  const builtins = new Map([["deepseek", {}]]);

  assert.equal(__testing.ownsProvider("workbuddy-cn", builtins), true);
  assert.equal(__testing.ownsProvider("codebuddy-cn", builtins), true);
  assert.equal(__testing.ownsProvider("deepseek", builtins), true);
  assert.equal(__testing.ownsProvider("opencode-go-live", builtins), false);
});

test("完整的自定义 Provider 配置由插件注册为通用路由", () => {
  const provider = __testing.genericProvider("txcodingplan", {
    displayName: "Deepseek-v4-flash",
    api: "openai-completions",
    baseURL: "https://chatapi.weixin.qq.com/openai/v1",
    models: [{ id: "Deepseek-v4-flash", name: "Deepseek-v4-flash", maxTokens: 48000 }],
  });

  assert.equal(provider.id, "txcodingplan");
  assert.equal(provider.getModels()[0].provider, "txcodingplan");
  assert.equal(provider.getModels()[0].api, "openai-completions");
  assert.equal(__testing.ownsProvider("txcodingplan", new Map(), { api: "openai-completions", baseURL: "https://example.com", models: [{ id: "model" }] }), true);
});

test("API Key 和登录令牌使用各自的认证头", () => {
  assert.deepEqual(__testing.authenticationHeaders({ value: "api-key", kind: "api-key" }), { "x-api-key": "api-key" });
  assert.deepEqual(__testing.authenticationHeaders({ value: "login-token", kind: "bearer" }), { authorization: "Bearer login-token" });
});

test("WorkBuddy 自有认证助手兼容新旧 DSH 的 signal 调用约定", async () => {
  const auth = __testing.workBuddyApiKeyAuth();
  const credential = { type: "api_key", key: "login-token" };

  // Older DSH calls resolve without a signal. This must not dereference it.
  assert.deepEqual(await auth.resolve({ credential }), {
    auth: { apiKey: "login-token" },
    source: "DSH credential",
  });

  // Newer DSH supplies an AbortSignal. The same resolver must remain valid.
  const controller = new AbortController();
  assert.deepEqual(await auth.resolve({ credential, signal: controller.signal }), {
    auth: { apiKey: "login-token" },
    source: "DSH credential",
  });
});

test("登录请求头不修改 DSH 冻结的配置对象", () => {
  const headers = __testing.runtimeHeaders(Object.freeze({ existing: "value" }));
  headers["X-User-Id"] = "user";
  assert.deepEqual(headers, { existing: "value", "X-User-Id": "user" });
});

test("模型请求恢复 WorkBuddy 官方 User-Agent", () => {
  const options = Object.freeze({ headers: Object.freeze({ "user-agent": "deepseek-harness", existing: "value" }) });
  const resolved = __testing.workBuddyRequestOptions(options);

  assert.equal(resolved.headers["user-agent"], "CLI/unknown CodeBuddy/2.137.1");
  assert.equal(resolved.headers.existing, "value");
  assert.equal(options.headers["user-agent"], "deepseek-harness");
});

test("显式空配置启用令牌模式，未配置时仍使用 API Key", () => {
  assert.equal(__testing.workBuddySource({}, {}).apiKeyEnv, "WORKBUDDY_API_KEY");
  assert.equal(__testing.workBuddySource({ providers: { "workbuddy-cn": {} } }, {}).apiKeyEnv, undefined);
  assert.equal(__testing.workBuddySource({ providers: { "codebuddy-cn": {} } }, {}).apiKeyEnv, undefined);
});

test("WebUI 可以区分 API Key 与令牌认证模式", () => {
  assert.equal(authenticationMode({ providers: {} }), "api-key");
  assert.equal(authenticationMode({ providers: { "workbuddy-cn": { apiKeyEnv: "WORKBUDDY_API_KEY" } } }), "api-key");
  assert.equal(authenticationMode({ providers: { "workbuddy-cn": {} } }), "token");
  assert.equal(authenticationMode({ providers: { "codebuddy-cn": {} } }), "token");
});

test("登录会话可以安全序列化并按过期时间刷新", () => {
  const session = {
    auth: { accessToken: "access", refreshToken: "refresh", expiresAt: 2_000_000 },
    account: { userId: "user", enterpriseId: "enterprise", ignored: "not-stored" },
  };
  const restored = parseWorkBuddySession(serializeWorkBuddySession(session));
  assert.deepEqual(restored.account, { userId: "user", enterpriseId: "enterprise" });
  assert.equal(sessionNeedsRefresh(restored, 1_000_000), false);
  assert.equal(sessionNeedsRefresh(restored, 1_900_000), true);
});

test("多个登录账号可以持久化、去重并切换", () => {
  const first = { auth: { accessToken: "access-1", refreshToken: "refresh-1" }, account: { userId: "user-1" } };
  const second = { auth: { accessToken: "access-2", refreshToken: "refresh-2" }, account: { userId: "user-2" } };
  const store = upsertWorkBuddySession(upsertWorkBuddySession(createWorkBuddySessionStore(), first), second);
  const restored = parseWorkBuddySessions(serializeWorkBuddySessions({ ...store, activeId: store.sessions[0].id }));
  assert.equal(restored.sessions.length, 2);
  assert.equal(activeWorkBuddySession(restored).account.userId, "user-1");
  assert.deepEqual(workBuddySessionAccounts(restored).map((entry) => entry.label), ["user-1", "user-2"]);
  assert.equal(JSON.stringify(workBuddySessionAccounts(restored)).includes("refresh-1"), false);
  const replaced = upsertWorkBuddySession(restored, { ...first, auth: { accessToken: "access-1-new", refreshToken: "refresh-1-new" } });
  assert.equal(replaced.sessions.length, 2);
  assert.equal(replaced.sessions.find((entry) => entry.id === "user:user-1").auth.accessToken, "access-1-new");
});

test("新增登录账号统一生成账号名称和 UID 展示字段", () => {
  const session = {
    auth: { accessToken: "access-new", refreshToken: "refresh-new" },
    account: { account: { uid: "new-user-id", nickname: "新账号" } },
  };
  const store = upsertWorkBuddySession(createWorkBuddySessionStore(), session);
  const [account] = workBuddySessionAccounts(store);

  assert.equal(account.label, "新账号");
  assert.equal(account.accountName, "新账号");
  assert.equal(account.userId, "new-user-id");
  assert.equal(account.account.displayName, "新账号");
  assert.equal(account.account.userId, "new-user-id");
});

test("账号接口缺少名称时从 UIN 或登录令牌补齐展示信息", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "jwt-user-id", preferred_username: "jwt-account" })).toString("base64url");
  const session = {
    auth: { accessToken: `header.${payload}.signature`, refreshToken: "refresh-jwt" },
    account: { uin: "uin-account" },
  };
  const store = upsertWorkBuddySession(createWorkBuddySessionStore(), session);
  const [account] = workBuddySessionAccounts(store);

  assert.equal(account.label, "uin-account");
  assert.equal(account.userId, "jwt-user-id");
  assert.equal(account.account.displayName, "uin-account");
  assert.equal(account.account.uin, "uin-account");
});

test("API Key 目录只保存引用和展示元数据，不保存密钥值", () => {
  const store = upsertWorkBuddyApiKey(createWorkBuddyApiKeyStore(), {
    id: "dsh:WORKBUDDY_API_KEY_DSH_TEST",
    ref: "WORKBUDDY_API_KEY_DSH_TEST",
    label: "DSH API Key 1",
  });
  const restored = parseWorkBuddyApiKeys(serializeWorkBuddyApiKeys(store));
  assert.deepEqual(workBuddyApiKeyEntries(restored).map((entry) => entry.ref), ["WORKBUDDY_API_KEY_DSH_TEST"]);
  assert.equal(JSON.stringify(workBuddyApiKeyEntries(restored)).includes("secret"), false);
  const noActive = createWorkBuddyApiKeyStore(restored.entries, null);
  assert.equal(noActive.activeId, null);
});

test("插件直接调用官方刷新接口且不复用旧过期时间", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ code: 0, data: { accessToken: "new-access", expiresIn: 3600 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const refreshed = await refreshWorkBuddySession({
      auth: { accessToken: "old-access", refreshToken: "refresh", expiresAt: 1 },
      account: { uid: "user", enterpriseId: "enterprise" },
    });
    assert.equal(request.url, "https://copilot.tencent.com/v2/plugin/auth/token/refresh");
    assert.equal(request.options.headers["X-Refresh-Token"], "refresh");
    assert.equal(request.options.headers["X-Enterprise-Id"], "enterprise");
    assert.equal(refreshed.auth.accessToken, "new-access");
    assert.ok(refreshed.auth.expiresAt > Date.now() + 3_500_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型目录保留逐模型思考能力和默认档位", () => {
  const models = __testing.modelsFromConfig({
    agents: [{ name: "cli", models: ["reasoning", "plain"] }],
    models: [
      { id: "reasoning", name: "Reasoning", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: "high" } },
      { id: "plain", name: "Plain", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: false },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), ["reasoning", "plain"]);
  assert.equal(models[0].reasoning, true);
  assert.equal(models[0].thinkingLevelMap.off, null);
  assert.equal(models[0].thinkingLevelMap.xhigh, undefined);
  assert.equal(models[0].defaultReasoningEffort, "high");
  assert.equal(models[1].reasoning, false);
});

test("自定义模型可覆盖自己的思考档位", () => {
  const [model] = __testing.selectWorkBuddyModels([], [{
    id: "custom",
    contextWindow: 1000,
    maxTokens: 100,
    reasoningEfforts: { off: null, medium: "balanced" },
  }]);

  assert.equal(model.reasoning, true);
  assert.equal(Object.hasOwn(model.thinkingLevelMap, "off"), false);
  assert.equal(model.thinkingLevelMap.medium, "balanced");
  assert.equal(model.thinkingLevelMap.high, null);
});

test("积分查询复用 WorkBuddy billing 接口并汇总有效资源", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (String(url).includes("get-user-resource")) {
      return new Response(JSON.stringify({ code: 0, data: { Response: { Data: { Accounts: [
        { CycleCapacityRemainPrecise: 12.5, CapacityRemainPrecise: 100, PackageName: "月度包" },
        { CapacityRemain: 7 },
      ] } } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0, data: { total: 2, data: [
      { requestId: "r1", requestTime: Date.now(), credit: 1.25 },
      { requestId: "r2", requestTime: Date.now() - 1000, credit: 2.75 },
    ] } }), { status: 200 });
  };
  try {
    const result = await fetchWorkBuddyCredits({ auth: { accessToken: "token" }, account: { userId: "user" } });
    assert.equal(result.credits, 19.5);
    assert.equal(result.todayUsage.count, 2);
    assert.equal(result.todayUsage.used, 4);
    assert.equal(result.creditError, null);
    assert.equal(requests[0].url, "https://www.codebuddy.cn/v2/billing/meter/get-user-resource");
    assert.equal(requests[0].options.headers.authorization, "Bearer token");
    assert.equal(requests[1].url, "https://www.codebuddy.cn/billing/meter/get-user-request-usage");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("企业积分响应支持不限量和周期重置时间", () => {
  const result = creditsTesting.enterpriseUsage({ data: { limitNum: -1, cycleResetTime: "2026-09-01 00:00:00" } });
  assert.equal(result.unlimited, true);
  assert.equal(result.credits, null);
  assert.ok(Number.isFinite(result.cycleResetTime));
});

test("积分查询只接受受信任的 WorkBuddy billing 域名", () => {
  assert.equal(creditsTesting.normalizeHost("https://www.codebuddy.cn"), "https://www.codebuddy.cn");
  assert.equal(creditsTesting.normalizeHost("https://evil.example"), "https://www.codebuddy.cn");
  assert.deepEqual(creditsTesting.buildCreditResourceBody(new Date(2026, 7, 31, 9, 8, 7)), {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: "2026-08-31 09:08:07",
    PackageEndTimeRangeEnd: "2127-08-31 09:08:07",
  });
});
