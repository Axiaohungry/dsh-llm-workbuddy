// Zstd frame parsing and stream timing adapted from dsh-dashboard (MIT).
// Copyright (c) 2026 weibaohui. See THIRD_PARTY_NOTICES.md.
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import * as zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

const VERSION = 1;
const DAY = 86400_000;
const FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "calls", "missingUsage", "speedOutputTokens", "speedMs", "speedSamples"];
const numeric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const text = (v) => typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : "";
const empty = () => Object.fromEntries(FIELDS.map((key) => [key, 0]));
const add = (target, row) => { for (const key of FIELDS) target[key] += numeric(row[key]); };
const finish = (row) => ({ ...row, speed: row.speedMs > 0 ? Number((row.speedOutputTokens * 1000 / row.speedMs).toFixed(1)) : null });
export const usageRoot = () => join(process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"), "sessions");
export const usageDate = (now) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
function monday(date) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
export function periodStarts(now = Date.now()) { const today = usageDate(now); return { today, week: monday(today), month: today.slice(0, 7) + "-01", all: "" }; }
const validDate = (date) => typeof date === "string" && /^\d{4}-\d\d-\d\d$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
const bucket = (date, granularity) => granularity === "week" ? monday(date) : granularity === "month" ? date.slice(0, 7) : date;

function streamWindow(stream) {
  let min = Infinity, max = -Infinity;
  for (const record of Array.isArray(stream) ? stream : []) {
    if (numeric(record?.time) > 0) { min = Math.min(min, record.time); max = Math.max(max, record.time); }
    if (numeric(record?.time0) > 0 && Array.isArray(record.dt)) {
      min = Math.min(min, record.time0);
      max = Math.max(max, record.time0 + record.dt.reduce((sum, step) => sum + numeric(step), 0));
    }
  }
  return Number.isFinite(min) && max > min ? max - min : 0;
}

export function createUsageFold() {
  const cells = new Map(), seen = new Set();
  let provider = "", model = "";
  return {
    push(event) {
      if (!event || typeof event !== "object") return;
      const data = event.data ?? {};
      if (event.type === "request/context") { provider = text(data.provider); model = text(data.model); return; }
      if (event.type === "request/header") {
        const config = data.header?.config ?? data.header?.modelSelection ?? data.header?.model;
        if (config && typeof config === "object") { provider = text(config.provider); model = text(config.model); }
        return;
      }
      if (event.type !== "assistant/message" || !Number.isFinite(event.time) || event.time <= 0 || event.time > 8.63e15) return;
      if (Number.isSafeInteger(event.seq)) { if (seen.has(event.seq)) return; seen.add(event.seq); }
      const source = data.message?.source ?? {};
      const date = usageDate(event.time), p = text(source.provider) || text(source.replayState?.response?.provider) || text(source.replayState?.provider) || provider || "unknown";
      const m = text(source.model) || text(source.replayState?.response?.model) || model || "unknown";
      const key = JSON.stringify([date, p, m]);
      let cell = cells.get(key);
      if (!cell) { cell = { date, provider: p, model: m, ...empty() }; cells.set(key, cell); }
      cell.calls++;
      const usage = data.usage;
      if (!usage || typeof usage !== "object" || !["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].some((k) => typeof usage[k] === "number" && Number.isFinite(usage[k]) && usage[k] >= 0)) { cell.missingUsage++; return; }
      for (const field of FIELDS.slice(0, 4)) cell[field] += numeric(usage[field]);
      const total = typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0 ? usage.totalTokens : FIELDS.slice(0, 4).reduce((sum, k) => sum + numeric(usage[k]), 0);
      cell.totalTokens += total;
      const window = streamWindow(data.stream), output = numeric(usage.outputTokens);
      if (window >= 200 && output >= 16) { cell.speedOutputTokens += output; cell.speedMs += window; cell.speedSamples++; }
    },
    finish: () => ({ version: VERSION, rows: [...cells.values()] }),
  };
}

export function aggregateUsage(facts, query = {}) {
  const now = query.now ?? Date.now(), starts = periodStarts(now), end = starts.today;
  const period = ["today", "week", "month", "all"].includes(query.period) ? query.period : "all";
  const granularity = ["day", "week", "month"].includes(query.granularity) ? query.granularity : "day";
  const rows = facts.flatMap((f) => Array.isArray(f?.rows) ? f.rows : []).filter((r) => r && validDate(r.date) && r.date <= end);
  const filtered = rows.filter((r) => (!query.provider || r.provider === query.provider) && (!query.model || r.model === query.model));
  const summary = Object.fromEntries(Object.entries(starts).map(([key, start]) => { const totals = empty(); for (const row of filtered) if (!start || row.date >= start) add(totals, row); return [key, finish(totals)]; }));
  const models = new Map(), providers = new Map(), trend = new Map();
  for (const row of filtered) {
    if (starts[period] && row.date < starts[period]) continue;
    const id = JSON.stringify([row.provider, row.model]);
    if (!models.has(id)) models.set(id, { provider: row.provider, model: row.model, ...empty() });
    if (!providers.has(row.provider)) providers.set(row.provider, { provider: row.provider, ...empty() });
    const date = bucket(row.date, granularity);
    if (!trend.has(date)) trend.set(date, { bucket: date, ...empty() });
    add(models.get(id), row); add(providers.get(row.provider), row); add(trend.get(date), row);
  }
  const points = [], cursor = new Date(end + "T00:00:00Z");
  const firstDate = starts[period] || filtered.reduce((date, row) => !date || row.date < date ? row.date : date, "");
  if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  if (granularity === "month") cursor.setUTCDate(1);
  for (let i = 0; i < 30; i++) {
    const date = cursor.toISOString().slice(0, 10), key = bucket(date, granularity);
    if (!firstDate || key < bucket(firstDate, granularity)) break;
    points.unshift(finish(trend.get(key) ?? { bucket: key, ...empty() }));
    if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() - 1); else cursor.setUTCDate(cursor.getUTCDate() - (granularity === "week" ? 7 : 1));
  }
  return { timezone: "Asia/Shanghai", period, granularity, summary, trend: points,
    models: [...models.values()].map(finish).sort((a, b) => b.totalTokens - a.totalTokens),
    providers: [...providers.values()].map(finish).sort((a, b) => b.totalTokens - a.totalTokens),
    filters: { providers: [...new Set(rows.map((r) => r.provider))].sort(), models: [...new Set(rows.filter((r) => !query.provider || r.provider === query.provider).map((r) => r.model))].sort() },
  };
}

function zstdFrames(buffer) {
  const frames = []; let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, incomplete: true };
    const magic = buffer.readUInt32LE(offset);
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      if (buffer.length - offset < 8) return { frames, incomplete: true };
      offset += 8 + buffer.readUInt32LE(offset + 4);
      if (offset > buffer.length) return { frames, incomplete: true };
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error("INVALID_ZSTD");
    offset += 4;
    if (offset === buffer.length) return { frames, incomplete: true };
    const descriptor = buffer[offset++];
    if (descriptor & 24) throw new Error("INVALID_ZSTD");
    const contentFlag = descriptor >>> 6, single = (descriptor & 32) !== 0, checksum = (descriptor & 4) !== 0, dictionary = descriptor & 3;
    const rest = (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (contentFlag === 0 ? single ? 1 : 0 : 1 << contentFlag);
    if (buffer.length - offset < rest) return { frames, incomplete: true };
    offset += rest;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, incomplete: true };
      const header = buffer.readUIntLE(offset, 3), type = header >>> 1 & 3, size = header >>> 3;
      offset += 3;
      if (type === 3) throw new Error("INVALID_ZSTD");
      const length = type === 1 ? 1 : size;
      if (buffer.length - offset < length) return { frames, incomplete: true };
      offset += length;
      if (header & 1) break;
    }
    if (checksum) { if (buffer.length - offset < 4) return { frames, incomplete: true }; offset += 4; }
    frames.push({ start, end: offset });
  }
  return { frames, incomplete: false };
}

async function discover(root) {
  const chosen = new Map();
  let errors = 0;
  // Only session/project directories are walked; directory symlinks are not followed.
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { errors++; continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
      const sessionDir = join(dir, entry.name);
      let names; try { names = await readdir(sessionDir); } catch { errors++; continue; }
      const candidates = names.map((name) => ({ name, match: /^session\.v(\d+)\.jsonl(\.zstd)?$/.exec(name) })).filter((f) => f.match).sort((a, b) => Number(b.match[1]) - Number(a.match[1]) || Number(Boolean(b.match[2])) - Number(Boolean(a.match[2])));
      if (!candidates.length) continue;
      const best = candidates[0], path = join(sessionDir, best.name);
      try {
        const info = await stat(path);
        const file = { id: entry.name, path, size: info.size, mtime: info.mtimeMs };
        const previous = chosen.get(file.id);
        if (!previous || previous.mtime < file.mtime || previous.mtime === file.mtime && previous.size < file.size) chosen.set(file.id, file);
      } catch { errors++; }
    }
  }
  return { files: [...chosen.values()], errors };
}

async function readFact(file, signal) {
  const fold = createUsageFold(), decoder = new StringDecoder("utf8");
  const bytes = await readFile(file.path, { signal });
  const compressed = file.path.endsWith(".zstd");
  const parsed = compressed ? zstdFrames(bytes) : { frames: [{ start: 0, end: bytes.length }], incomplete: false };
  let tail = "", badLines = 0;
  const pushLine = (line) => { if (!line.trim()) return; try { fold.push(JSON.parse(line)); } catch { badLines++; } };
  for (const frame of parsed.frames) {
    signal.throwIfAborted();
    const block = bytes.subarray(frame.start, frame.end);
    // shortcut: 单帧解压上限 64 MiB；遇到更大单帧日志时改用帧内流式解析。
    tail += decoder.write(compressed ? zlib.zstdDecompressSync(block, { maxOutputLength: 64 * 1024 * 1024 }) : block);
    let start = 0, end;
    while ((end = tail.indexOf("\n", start)) !== -1) { pushLine(tail.slice(start, end)); start = end + 1; }
    tail = tail.slice(start);
    await yieldEventLoop();
  }
  tail += decoder.end();
  let incomplete = parsed.incomplete;
  if (tail.trim()) { try { fold.push(JSON.parse(tail)); } catch { incomplete = true; } }
  return { ...fold.finish(), badLines, complete: !incomplete };
}

export function createUsageScanner(options = {}) {
  const root = options.root ?? usageRoot(), now = options.now ?? Date.now;
  const files = new Map(), controller = new AbortController();
  let loadPromise, running = null;
  let status = { scanning: false, totalFiles: 0, done: 0, failedFiles: 0, incompleteFiles: 0, badLines: 0, lastScanAt: null, cacheMode: options.loadCache ? "persistent" : "memory", cacheError: false, readError: false, supportsZstd: typeof zlib.zstdDecompressSync === "function" };
  const valid = (f) => f && f.version === VERSION && typeof f.id === "string" && typeof f.path === "string" && Number.isFinite(f.mtime) && Array.isArray(f.rows) && f.rows.every((r) => r && validDate(r.date) && typeof r.provider === "string" && typeof r.model === "string" && FIELDS.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]) && r[k] >= 0));
  function load() {
    return loadPromise ??= (async () => {
      try { for (const entry of await options.loadCache?.() ?? []) if (valid(entry)) files.set(entry.id, entry); }
      catch { status.cacheMode = "memory"; status.cacheError = true; }
    })();
  }
  async function perform() {
    if (controller.signal.aborted) return;
    await load();
    if (controller.signal.aborted) return;
    status = { ...status, scanning: true, done: 0, failedFiles: 0, readError: false };
    try {
      let found;
      try { const discovered = await discover(root); found = discovered.files; status.readError = discovered.errors > 0; } catch (error) { if (error.code === "ENOENT") found = []; else { status.readError = true; return; } }
      status.totalFiles = found.length;
      const ids = new Set(found.map((f) => f.id));
      let changed = false;
      for (const id of files.keys()) if (!status.readError && !ids.has(id)) { files.delete(id); changed = true; }
      for (const file of found) {
        if (controller.signal.aborted) break;
        const previous = files.get(file.id);
        if (previous?.mtime !== file.mtime || previous?.size !== file.size || previous?.path !== file.path || !previous?.complete) {
          try { files.set(file.id, { ...file, ...(await readFact(file, controller.signal)) }); changed = true; }
          catch { if (controller.signal.aborted) break; status.failedFiles++; }
        }
        status.done++;
      }
      if (changed && !controller.signal.aborted) {
        try { await options.saveCache?.([...files.values()]); } catch { status.cacheMode = "memory"; status.cacheError = true; }
      }
      status.incompleteFiles = [...files.values()].filter((f) => !f.complete).length;
      status.badLines = [...files.values()].reduce((sum, f) => sum + numeric(f.badLines), 0);
      status.lastScanAt = now();
    } finally { status.scanning = false; }
  }
  return {
    scan() { if (!running) running = perform().finally(() => { running = null; }); return running; },
    async query(query = {}) { await load(); return { ...aggregateUsage([...files.values()], { ...query, now: query.now ?? now() }), scan: { ...status } }; },
    stop() { controller.abort(); },
  };
}
