import { LlmError } from "@deepseek-ai/dsh-llm";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const OPENAI_APIS = new Set(["openai-completions", "openai-responses"]);

function listingUrl(baseURL, api) {
  const base = baseURL.replace(/\/+$/, "");
  return api === "anthropic-messages"
    ? `${base.endsWith("/v1") ? base : `${base}/v1`}/models?limit=1000`
    : `${base}/models`;
}

function positive(...values) {
  return values.find((value) => Number.isSafeInteger(value) && value > 0);
}

function nonempty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new LlmError("模型目录响应超过 4 MiB", "DISCOVERY_FAILED");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new LlmError("模型目录响应超过 4 MiB", "DISCOVERY_FAILED");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function modelEntries(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (body?.models && typeof body.models === "object" && !Array.isArray(body.models)) {
    return Object.entries(body.models).flatMap(([id, value]) =>
      typeof value === "object" && value !== null && !Array.isArray(value) ? [{ ...value, id }] : []);
  }
  throw new LlmError("端点未返回可识别的模型列表，请手工填写模型", "DISCOVERY_FAILED");
}

export async function probeEndpoint(request, { profiles, resolveCredential }) {
  const profile = request.provider ? profiles().get(request.provider) : undefined;
  const baseURL = nonempty(request.baseURL, profile?.baseURL);
  if (!baseURL) throw new LlmError(`Provider "${request.provider ?? ""}" 缺少 baseURL，请填写 API 地址或手工填写模型`, "DISCOVERY_FAILED");
  const api = request.api ?? "openai-completions";
  if (!OPENAI_APIS.has(api) && api !== "anthropic-messages") {
    throw new LlmError(`协议 "${api}" 不支持自动获取模型，请手工填写`, "DISCOVERY_UNSUPPORTED");
  }
  const key = request.apiKey || (profile ? (await resolveCredential(request.provider, profile)).value : undefined);
  const headers = new Headers(profile?.headers === undefined ? undefined : Object.entries(profile.headers));
  headers.set("accept", "application/json");
  if (key) {
    const value = String(key).trim();
    if (!value || /[\r\n]/.test(value)) throw new LlmError("API Key 包含无效字符", "INVALID_CREDENTIAL");
    if (api === "anthropic-messages") {
      headers.delete("authorization");
      headers.set("x-api-key", value);
    } else {
      headers.delete("x-api-key");
      headers.set("authorization", `Bearer ${value}`);
    }
  }
  if (api === "anthropic-messages") headers.set("anthropic-version", "2023-06-01");
  const url = listingUrl(baseURL, api);
  let response;
  try {
    response = await fetch(url, { headers, signal: request.signal });
  } catch (error) {
    if (request.signal?.aborted) throw new LlmError("模型列表获取已取消", "ABORTED", { cause: error });
    throw new LlmError("无法连接模型目录端点", "DISCOVERY_FAILED", { cause: error });
  }
  if (!response.ok) throw new LlmError(`模型目录端点返回 HTTP ${response.status}`, "DISCOVERY_FAILED");
  let body;
  try {
    body = JSON.parse(await readBounded(response));
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (request.signal?.aborted) throw new LlmError("模型列表获取已取消", "ABORTED", { cause: error });
    throw new LlmError("模型目录端点未返回有效 JSON", "DISCOVERY_FAILED", { cause: error });
  }
  return modelEntries(body).flatMap((raw) => {
    const id = nonempty(raw?.id);
    if (!id) return [];
    const name = nonempty(raw.name, raw.display_name, raw.displayName);
    const contextWindow = positive(raw.contextWindow, raw.context_window, raw.context_length, raw.max_input_tokens, raw.limit?.context);
    const maxTokens = positive(raw.maxTokens, raw.max_output_tokens, raw.max_tokens, raw.top_provider?.max_completion_tokens);
    return [{
      id,
      ...(name ? { name } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    }];
  });
}
