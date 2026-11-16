import { createUsageScanner } from "./workbuddy-usage.js";
import { json, localPost, requestBody } from "./workbuddy-web.js";

export function installWorkBuddyUsage(ctx) {
  ctx.inject(["webServer", "storageDomain"], (usageCtx) => {
    const schema = { parse: (value) => value };
    let fingerprints = new Map();
    const domain = Promise.resolve().then(() => usageCtx.storageDomain.open({
      name: "workbuddy_usage", version: 1, invalidRecords: "backup-and-skip",
      tables: { files: { valueSchema: schema }, meta: { valueSchema: schema } },
    }));
    // Keep a rejection handled before the first scan or page query starts.
    domain.catch(() => {});
    const scanner = createUsageScanner({
      loadCache: async () => {
        const d = await domain;
        const ids = await d.table("meta").get("ids") ?? [];
        if (!Array.isArray(ids)) throw new Error("CACHE_INVALID");
        const rows = [];
        for (const id of ids) {
          if (typeof id !== "string") continue;
          const row = await d.table("files").get(id);
          if (row) { rows.push(row); fingerprints.set(id, JSON.stringify(row)); }
        }
        return rows;
      },
      saveCache: async (rows) => {
        const d = await domain, next = new Map();
        for (const row of rows) {
          const fingerprint = JSON.stringify(row);
          if (fingerprints.get(row.id) !== fingerprint) await d.table("files").put(row.id, row);
          next.set(row.id, fingerprint);
        }
        for (const id of fingerprints.keys()) if (!next.has(id)) await d.table("files").put(id, null);
        await d.table("meta").put("ids", [...next.keys()]);
        fingerprints = next;
      },
    });
    const scan = () => scanner.scan().catch(() => usageCtx.logger?.warn?.("WorkBuddy 用量扫描未完成，请在统计面板重试"));
    const handler = async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
      if (!localPost(req)) return json(res, 403, { ok: false, message: "只允许本机 DSH 页面读取用量统计" });
      try {
        const body = await requestBody(req);
        if (["provider", "model"].some((key) => body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 256))) return json(res, 400, { ok: false, message: "统计筛选参数无效" });
        if (body.period !== undefined && !["today", "week", "month", "all"].includes(body.period) || body.granularity !== undefined && !["day", "week", "month"].includes(body.granularity) || body.action !== undefined && body.action !== "refresh") return json(res, 400, { ok: false, message: "统计周期或操作无效" });
        if (body.action === "refresh") void scan();
        const result = await scanner.query({ provider: body.provider, model: body.model, period: body.period, granularity: body.granularity });
        json(res, 200, { ok: true, ...result });
      } catch { json(res, 500, { ok: false, message: "读取用量统计失败，请刷新重试" }); }
    };
    usageCtx.effect(() => {
      const unregister = usageCtx.webServer.register({ kind: "exact", path: "/dsh-llm-workbuddy/usage", handler });
      void scan();
      const timer = setInterval(() => { void scan(); }, 60_000);
      timer.unref?.();
      return () => { clearInterval(timer); scanner.stop(); unregister(); domain.then((d) => d.close()).catch(() => {}); };
    }, "llm-workbuddy: usage statistics");
  });
}
