#!/usr/bin/env node

import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";
import {
  WORKBUDDY_SESSION_REF,
  WORKBUDDY_SESSIONS_REF,
  LEGACY_SESSION_REF,
  LEGACY_SESSIONS_REF,
  createWorkBuddySessionStore,
  loginWorkBuddy,
  parseWorkBuddySession,
  parseWorkBuddySessions,
  serializeWorkBuddySession,
  serializeWorkBuddySessions,
  upsertWorkBuddySession,
} from "./workbuddy-auth.js";

const PACKAGE = "@axiaohungry/dsh-llm-workbuddy";
const LEGACY_PACKAGES = ["dsh-llm-workbuddy", "dsh-llm-codebuddy"];
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const PACKAGE_SPEC = `${PACKAGE}@${PACKAGE_VERSION}`;
const PROVIDER_PATH = ["llm-pi-ai", "providers", "workbuddy-cn"];
const LEGACY_PROVIDER_PATH = ["llm-pi-ai", "providers", "codebuddy-cn"];
const IGNORED_BUILDS = ["@google/genai", "protobufjs"];
const require = createRequire(import.meta.url);

function dshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
}

function profileHasPackage(home, profile, packageName) {
  const file = join(home, "profiles", profile, "package.json");
  if (!existsSync(file)) return false;
  const json = JSON.parse(readFileSync(file, "utf8"));
  return Boolean(json.dependencies?.[packageName] || json.devDependencies?.[packageName]);
}

function profileHasPlugin(home, profile) {
  return profileHasPackage(home, profile, PACKAGE);
}

function dshEnv() {
  const pnpmPackageDir = dirname(require.resolve("pnpm"));
  const pnpmBinDir = join(dirname(pnpmPackageDir), ".bin");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
  return {
    ...process.env,
    [pathKey]: `${pnpmBinDir}${delimiter}${process.env[pathKey] || ""}`,
    npm_config_ignore_workspace_root_check: "true",
  };
}

function runDsh(args) {
  const result = spawnSync(process.platform === "win32" ? "dsh.cmd" : "dsh", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: dshEnv(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dsh ${args.join(" ")} 执行失败（退出码 ${result.status}）`);
}

function usesEntrySettings() {
  const result = spawnSync(process.platform === "win32" ? "dsh.cmd" : "dsh", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: dshEnv(),
  });
  if (result.error || result.status !== 0) throw new Error("无法检测 DSH 版本，请确认 dsh 命令可用");
  const version = String(result.stdout).match(/\b0\.1\.(\d+)(?:[-.]|\b)/);
  if (!version) throw new Error("无法识别 DSH 版本，令牌已保存；请在模型设置中手动选择令牌登录");
  return Number(version[1]) >= 7;
}

function writeYamlDocument(file, document) {
  const temporary = join(dirname(file), `.workbuddy-${process.pid}.tmp`);
  writeFileSync(temporary, String(document), "utf8");
  renameSync(temporary, file);
}

function withPnpmBuildPolicy(file, action) {
  const document = parseDocument(readFileSync(file, "utf8"));
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const changes = [];
  for (const packageName of IGNORED_BUILDS) {
    const path = ["allowBuilds", packageName];
    if (typeof document.getIn(path) !== "boolean") {
      changes.push({ packageName, existed: document.hasIn(path), value: document.getIn(path) });
      document.setIn(path, false);
    }
  }
  if (changes.length) writeYamlDocument(file, document);
  try {
    return action();
  } finally {
    if (changes.length) {
      const current = parseDocument(readFileSync(file, "utf8"));
      for (const change of changes) {
        const path = ["allowBuilds", change.packageName];
        if (change.existed) current.setIn(path, change.value);
        else current.deleteIn(path);
      }
      if (current.getIn(["allowBuilds"])?.items?.length === 0) current.deleteIn(["allowBuilds"]);
      writeYamlDocument(file, current);
    }
  }
}

function cleanPnpmWorkspace(file) {
  if (!existsSync(file)) return;
  const document = parseDocument(readFileSync(file, "utf8"));
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const entries = document.getIn(["minimumReleaseAgeExclude"])?.items;
  if (!entries) return;
  const packageNames = [PACKAGE, ...LEGACY_PACKAGES];
  const remaining = entries.map((entry) => entry.value).filter((entry) => !packageNames.some((packageName) => String(entry).startsWith(`${packageName}@`)));
  if (remaining.length === entries.length) return;
  if (remaining.length) document.setIn(["minimumReleaseAgeExclude"], remaining);
  else document.deleteIn(["minimumReleaseAgeExclude"]);
  writeYamlDocument(file, document);
}

function cleanSettings(file) {
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, "utf8");
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const paths = [PROVIDER_PATH, LEGACY_PROVIDER_PATH].filter((path) => document.hasIn(path));
  if (paths.length === 0) return undefined;

  for (const path of paths) document.deleteIn(path);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.workbuddy-backup-${stamp}`;
  const temporary = join(dirname(file), `.settings-workbuddy-${process.pid}.tmp`);
  copyFileSync(file, backup);
  writeFileSync(temporary, String(document), "utf8");
  renameSync(temporary, file);
  return backup;
}

function enableTokenLogin(home = dshHome()) {
  const file = join(home, "settings.yaml");
  const source = existsSync(file) ? readFileSync(file, "utf8") : "{}\n";
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  if (document.hasIn(PROVIDER_PATH)) document.deleteIn([...PROVIDER_PATH, "apiKeyEnv"]);
  else if (document.hasIn(LEGACY_PROVIDER_PATH)) {
    const legacy = document.getIn(LEGACY_PROVIDER_PATH);
    const value = legacy && typeof legacy.toJSON === "function" ? legacy.toJSON() : legacy;
    document.setIn(PROVIDER_PATH, document.createNode(value && typeof value === "object" ? value : {}));
    document.deleteIn([...PROVIDER_PATH, "apiKeyEnv"]);
    document.deleteIn(LEGACY_PROVIDER_PATH);
  }
  else document.setIn(PROVIDER_PATH, {});
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, `${file}.workbuddy-backup-${stamp}`);
  }
  writeYamlDocument(file, document);
}

function storeLoginSession(session, home = dshHome()) {
  const file = join(home, ".credentials.yaml");
  const document = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "{}\n");
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  const stored = document.get(WORKBUDDY_SESSIONS_REF)
    ?? document.get(LEGACY_SESSIONS_REF)
    ?? document.get(WORKBUDDY_SESSION_REF)
    ?? document.get(LEGACY_SESSION_REF);
  const current = stored ? parseWorkBuddySessions(stored) : createWorkBuddySessionStore();
  const next = upsertWorkBuddySession(current, session);
  document.set(WORKBUDDY_SESSIONS_REF, serializeWorkBuddySessions(next));
  document.set(WORKBUDDY_SESSION_REF, serializeWorkBuddySession(next.sessions.find((entry) => entry.id === next.activeId)));
  document.delete(LEGACY_SESSIONS_REF);
  document.delete(LEGACY_SESSION_REF);
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, `${file}.workbuddy-backup-${stamp}`);
  }
  writeYamlDocument(file, document);
}

async function login() {
  console.log("正在打开 WorkBuddy 中国站网页登录（无需安装 WorkBuddy CLI）……");
  const session = await loginWorkBuddy((url, opened) => {
    if (opened) console.log("浏览器登录页已打开，请在浏览器中完成登录。");
    else console.log(`无法自动打开浏览器，请手动访问：${url}`);
  });
  storeLoginSession(session);
  if (usesEntrySettings()) {
    console.log("WorkBuddy 令牌登录成功。新版 DSH 按插件条目保存配置，请在模型设置的 WorkBuddy 卡片中选择“令牌登录”；无需安装 WorkBuddy CLI。");
  } else {
    enableTokenLogin();
    console.log("WorkBuddy 令牌登录成功，Provider 已切换为令牌模式。请重启 DSH。");
  }
}

function install() {
  for (const profile of ["web", "headless"]) {
    runDsh(["plugin", "--profile", profile, "list", "--depth", "0"]);
    const workspace = join(dshHome(), "profiles", profile, "pnpm-workspace.yaml");
    withPnpmBuildPolicy(workspace, () => {
      for (const legacyPackage of LEGACY_PACKAGES) {
        if (profileHasPackage(dshHome(), profile, legacyPackage)) {
          runDsh(["plugin", "--profile", profile, "remove", legacyPackage]);
        }
      }
      runDsh(["plugin", "--profile", profile, "add", PACKAGE_SPEC]);
    });
  }
  console.log("WorkBuddy Provider 已安装。请重启 DSH 后进行配置。");
}

function uninstall(home = dshHome()) {
  const backup = cleanSettings(join(home, "settings.yaml"));
  for (const profile of ["web", "headless"]) {
    const workspace = join(home, "profiles", profile, "pnpm-workspace.yaml");
    const installedPackages = [PACKAGE, ...LEGACY_PACKAGES].filter((packageName) => profileHasPackage(home, profile, packageName));
    if (installedPackages.length) {
      withPnpmBuildPolicy(workspace, () => {
        for (const packageName of installedPackages) {
          runDsh(["plugin", "--profile", profile, "remove", packageName]);
        }
      });
    }
    cleanPnpmWorkspace(workspace);
  }
  console.log(backup ? `WorkBuddy 配置已清理，备份：${backup}` : "未发现 WorkBuddy Provider 配置。");
  console.log("插件已卸载，API Key 和登录令牌凭据保持不变。请重启 DSH。");
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "dsh-workbuddy-cli-"));
  try {
    const file = join(root, "settings.yaml");
    writeFileSync(file, "llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: OPENCODE_GO_API_KEY\n    codebuddy-cn:\n      apiKeyEnv: WORKBUDDY_CN_API_KEY\n      models:\n        - id: legacy-model\n", "utf8");
    enableTokenLogin(root);
    const tokenMode = parseDocument(readFileSync(file, "utf8"));
    if (tokenMode.hasIn([...PROVIDER_PATH, "apiKeyEnv"]) || !tokenMode.hasIn(PROVIDER_PATH) || tokenMode.hasIn(LEGACY_PROVIDER_PATH) || !tokenMode.hasIn([...PROVIDER_PATH, "models", 0, "id"])) {
      throw new Error("token login settings self-test failed");
    }
    const backup = cleanSettings(file);
    const result = parseDocument(readFileSync(file, "utf8"));
    if (!backup || !existsSync(backup) || result.hasIn(PROVIDER_PATH) || !result.hasIn(["llm-pi-ai", "providers", "opencode-go"])) {
      throw new Error("uninstall settings cleanup self-test failed");
    }
    enableTokenLogin(root);
    if (!parseDocument(readFileSync(file, "utf8")).hasIn(PROVIDER_PATH)) {
      throw new Error("token login provider creation self-test failed");
    }
    const sampleSession = {
      auth: { accessToken: "test-access-token", refreshToken: "test-refresh-token", expiresAt: Date.now() + 60_000 },
      account: { userId: "test-user" },
    };
    storeLoginSession(sampleSession, root);
    const storedSession = parseDocument(readFileSync(join(root, ".credentials.yaml"), "utf8")).get(WORKBUDDY_SESSION_REF);
    if (parseWorkBuddySession(storedSession).account.userId !== "test-user") {
      throw new Error("token credential storage self-test failed");
    }
    const storedSessions = parseDocument(readFileSync(join(root, ".credentials.yaml"), "utf8")).get(WORKBUDDY_SESSIONS_REF);
    const sessionStore = parseWorkBuddySessions(storedSessions);
    if (sessionStore.sessions.length !== 1 || sessionStore.activeId !== sessionStore.sessions[0].id) {
      throw new Error("token account list self-test failed");
    }
    const workspace = join(root, "pnpm-workspace.yaml");
    writeFileSync(workspace, "packages:\n  - .\nallowBuilds:\n  '@google/genai': true\n  protobufjs: pending\n", "utf8");
    withPnpmBuildPolicy(workspace, () => {
      const active = parseDocument(readFileSync(workspace, "utf8"));
      if (active.getIn(["allowBuilds", "@google/genai"]) !== true || active.getIn(["allowBuilds", "protobufjs"]) !== false) {
        throw new Error("pnpm build policy activation self-test failed");
      }
    });
    const restored = parseDocument(readFileSync(workspace, "utf8"));
    if (restored.getIn(["allowBuilds", "@google/genai"]) !== true || restored.getIn(["allowBuilds", "protobufjs"]) !== "pending") {
      throw new Error("pnpm build policy self-test failed");
    }
    restored.setIn(["minimumReleaseAgeExclude"], ["other@1.0.0", `${PACKAGE}@1.3.1`]);
    writeYamlDocument(workspace, restored);
    cleanPnpmWorkspace(workspace);
    const cleaned = parseDocument(readFileSync(workspace, "utf8")).getIn(["minimumReleaseAgeExclude"])?.items?.map((entry) => entry.value);
    if (cleaned?.join(",") !== "other@1.0.0") throw new Error("pnpm workspace cleanup self-test failed");
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
    if (!dshEnv()[pathKey].split(delimiter)[0].endsWith(join("node_modules", ".bin"))) {
      throw new Error("bundled pnpm PATH self-test failed");
    }
    console.log("CLI-SELF-TEST-OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "login") await login();
else if (command === "--self-test") selfTest();
else {
  console.log("用法：dsh-llm-workbuddy <install|login|uninstall>");
  process.exitCode = 1;
}
