window.__ModuleLoader__.load({
  id: "@axiaohungry/dsh-llm-workbuddy",
  factory: (require) => {
    const ROUTE = "/dsh-llm-workbuddy/auth";
    const MARKER = "data-workbuddy-auth-switch";
    const AUTH_STATE_EVENT = "dsh-llm-workbuddy:auth-state";
    const WORKBUDDY_PROVIDERS = new Set(["workbuddy-cn", "codebuddy-cn"]);
    const React = require("react");
    const { createElement, useEffect, useState } = React;

    function button(text) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      Object.assign(element.style, {
        minHeight: "44px",
        padding: "0 12px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "8px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "500",
        transition: "background-color 120ms ease, border-color 120ms ease, opacity 120ms ease",
      });
      return element;
    }

    function accountPicker() {
      const element = document.createElement("select");
      element.setAttribute("aria-label", "WorkBuddy 令牌账号");
      Object.assign(element.style, {
        minHeight: "44px",
        minWidth: "180px",
        maxWidth: "260px",
        flex: "1 1 220px",
        boxSizing: "border-box",
        padding: "0 10px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "8px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        font: "inherit",
        fontSize: "13px",
      });
      return element;
    }

    function textInput(type, placeholder, ariaLabel) {
      const element = document.createElement("input");
      element.type = type;
      element.placeholder = placeholder;
      element.setAttribute("aria-label", ariaLabel);
      element.autocomplete = type === "password" ? "new-password" : "off";
      Object.assign(element.style, {
        minHeight: "44px",
        minWidth: "0",
        flex: "1 1 200px",
        boxSizing: "border-box",
        padding: "0 12px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "8px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        font: "inherit",
        fontSize: "13px",
      });
      return element;
    }

    function fieldLabel(text) {
      const element = document.createElement("span");
      element.textContent = text;
      Object.assign(element.style, {
        flex: "0 0 auto",
        minWidth: "92px",
        fontSize: "13px",
        lineHeight: "20px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      return element;
    }

    function row() {
      const element = document.createElement("div");
      Object.assign(element.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        width: "100%",
      });
      return element;
    }

    function section() {
      const element = document.createElement("div");
      Object.assign(element.style, {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 12px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "10px",
        background: "var(--dsw-surface-subtle, rgba(0, 0, 0, 0.02))",
      });
      return element;
    }

    function setVisible(element, visible, display = "flex") {
      element.hidden = !visible;
      element.style.setProperty("display", visible ? display : "none", "important");
    }

    function isWorkBuddy(input) {
      const editor = input.parentElement?.parentElement;
      if (!editor) return false;
      if (editor.textContent?.includes("workbuddy-cn") || editor.textContent?.includes("codebuddy-cn")) return true;
      const provider = editor.parentElement?.querySelector('select[aria-label="提供方"]')?.value;
      return provider === "workbuddy-cn" || provider === "codebuddy-cn";
    }

    function accountText(account) {
      const label = account?.accountName || account?.label || account?.account?.displayName || account?.account?.email || account?.account?.userId || "未命名账号";
      const userId = account?.userId || account?.account?.userId;
      return userId && userId !== label ? `${label} · ${String(userId).slice(0, 8)}` : label;
    }

    function accountLabel(account) {
      return account?.accountName || account?.label || account?.account?.displayName || account?.account?.email || account?.account?.userId || "未命名账号";
    }

    function apiKeyText(key) {
      const label = key?.label || (key?.kind === "environment" ? `环境变量 ${key.ref}` : "DSH 保存的 API Key");
      const suffix = key?.masked ? ` · ${key.masked}` : "";
      return key?.configured === false ? `${label}（不可用）` : `${label}${suffix}`;
    }

    function apiKeyLabel(key) {
      return key?.label || (key?.kind === "environment" ? `环境变量 ${key.ref}` : "DSH 保存的 API Key");
    }

    function formatCredits(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
    }

    async function authRequest(path, body) {
      const options = {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
      };
      if (body !== undefined) {
        options.headers = { "content-type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${ROUTE}/${path}`, options);
      const text = await response.text();
      let result = {};
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = {};
      }
      if (!response.ok || result.ok === false) {
        const error = new Error(result.message || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function notifyAuthState() {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_STATE_EVENT));
    }

    function selectedProvider(selection) {
      return selection?.next?.provider ?? selection?.lastUsed?.provider ?? selection?.provider;
    }

    function WorkBuddyCreditsDock({ useProjection }) {
      let selection;
      try {
        selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
      } catch {
        selection = undefined;
      }
      const provider = selectedProvider(selection);
      const selected = WORKBUDDY_PROVIDERS.has(provider);
      const [state, setState] = useState(null);

      useEffect(() => {
        let disposed = false;
        let requestId = 0;
        const load = async () => {
          const currentRequestId = ++requestId;
          if (!selected) {
            setState(null);
            return;
          }
          setState({ mode: "token", creditLoading: true, credits: undefined, todayUsage: null, creditError: null, todayUsageError: null });
          let status;
          try {
            status = await authRequest("status");
          } catch {
            if (!disposed && currentRequestId === requestId) setState(null);
            return;
          }
          if (disposed || currentRequestId !== requestId) return;
          if (status.mode !== "token" || !status.activeAccountId) {
            setState({ ...status, creditLoading: false });
            return;
          }
          try {
            const result = await authRequest("credits", { accountId: status.activeAccountId });
            if (!disposed && currentRequestId === requestId) setState({ ...status, ...result, creditLoading: false });
          } catch (error) {
            if (!disposed && currentRequestId === requestId) {
              const message = error instanceof Error ? error.message : "查询 WorkBuddy 积分失败";
              setState({
                ...status,
                credits: null,
                creditLoading: false,
                creditError: message,
                todayUsage: null,
                todayUsageError: "查询 WorkBuddy 今日请求量失败",
              });
            }
          }
        };
        load();
        const onAuthState = () => load();
        window.addEventListener(AUTH_STATE_EVENT, onAuthState);
        const timer = window.setInterval(load, 60_000);
        return () => {
          disposed = true;
          window.removeEventListener(AUTH_STATE_EVENT, onAuthState);
          window.clearInterval(timer);
        };
      }, [provider, selected]);

      if (!selected || state?.mode !== "token" || !state?.activeAccountId) return null;
      const creditsText = state.creditLoading
        ? "剩余积分：读取中…"
        : state.unlimited
          ? "剩余积分：不限量"
          : typeof state.credits === "number" && Number.isFinite(state.credits)
            ? `剩余积分：${formatCredits(state.credits)}`
            : state.creditError
              ? "剩余积分：暂不可用"
              : "剩余积分：—";
      const today = state.todayUsage;
      const usageText = today?.synced === true
        ? `今日请求：${Number.isFinite(Number(today.count)) ? Number(today.count) : 0} 次 · 用量 ${formatCredits(today.used)} 积分`
        : state.creditLoading
          ? "今日请求：读取中…"
          : state.todayUsageError
            ? "今日请求：暂不可用"
            : "今日请求：—";
      const activeAccount = Array.isArray(state.accounts) ? state.accounts.find((account) => account.id === state.activeAccountId) : undefined;
      return createElement(
        "div",
        {
          className: "dsh-workbuddy-credits",
          "data-workbuddy-credits": true,
          role: "status",
          "aria-live": "polite",
          title: [activeAccount ? `当前账号：${accountText(activeAccount)}` : "", state.creditError, state.todayUsageError].filter(Boolean).join("；") || undefined,
          style: {
            boxSizing: "border-box",
            width: "100%",
            minWidth: 0,
            minHeight: "20px",
            padding: "2px 16px 0",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            color: "var(--dsw-text-tertiary, #98a2b3)",
            fontSize: "12px",
            lineHeight: "18px",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        },
        createElement("span", null, creditsText),
        createElement("span", { "aria-hidden": true, style: { opacity: 0.55, padding: "0 4px" } }, "·"),
        createElement("span", null, usageText),
      );
    }

    function applyCreditStatus(stats, status, activeAccount) {
      const visible = status.mode === "token" && Boolean(activeAccount);
      setVisible(stats, visible);
      if (!visible) return;
      const credit = stats.querySelector('[data-workbuddy-stat="credits"]');
      const usage = stats.querySelector('[data-workbuddy-stat="usage"]');
      credit.title = status.creditError || "";
      usage.title = status.todayUsageError || "";
      if (status.creditLoading) credit.textContent = "剩余积分：读取中…";
      else if (status.unlimited) credit.textContent = "剩余积分：不限量";
      else if (typeof status.credits === "number" && Number.isFinite(status.credits)) credit.textContent = `剩余积分：${formatCredits(status.credits)}`;
      else credit.textContent = status.creditError ? "剩余积分：暂不可用" : "剩余积分：—";
      const today = status.todayUsage;
      if (today && today.synced === true) {
        usage.textContent = `今日请求：${Number.isFinite(Number(today.count)) ? Number(today.count) : 0} 次 · 用量 ${formatCredits(today.used)} 积分`;
      } else {
        usage.textContent = status.creditLoading ? "今日请求：读取中…" : status.todayUsageError ? "今日请求：暂不可用" : "今日请求：—";
      }
    }

    function applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, message, status) {
      const token = status.mode === "token";
      const apiKeys = Array.isArray(status.apiKeys) ? status.apiKeys : [];
      const activeApiKeyId = status.activeApiKeyId ?? apiKeys[0]?.id;
      const activeApiKey = apiKeys.find((key) => key.id === activeApiKeyId);
      const accounts = Array.isArray(status.accounts) ? status.accounts : [];
      const activeAccountId = status.activeAccountId ?? accounts[0]?.id;
      input.disabled = token;
      input.placeholder = token ? "当前使用 WorkBuddy 账号令牌" : "输入新的 API Key（保存到 DSH）";
      newKeyInput.disabled = token;
      newKeyLabelInput.disabled = token;
      keyButton.setAttribute("aria-pressed", String(!token));
      tokenButton.setAttribute("aria-pressed", String(token));
      keyButton.style.background = !token ? "var(--dsw-accent-subtle, #eef4ff)" : "var(--dsw-surface-subtle, transparent)";
      tokenButton.style.background = token ? "var(--dsw-accent-subtle, #eef4ff)" : "var(--dsw-surface-subtle, transparent)";
      setVisible(keySection, !token);
      setVisible(keySourceRow, apiKeys.length > 0);
      keySelect.replaceChildren(...apiKeys.map((key) => {
        const option = document.createElement("option");
        option.value = key.id;
        option.textContent = apiKeyText(key);
        option.title = apiKeyLabel(key);
        return option;
      }));
      if (activeApiKeyId) keySelect.value = activeApiKeyId;
      keyHint.textContent = token
        ? ""
        : activeApiKey ? `${status.apiKeyConfigured ? "当前来源" : "可选来源"}：${apiKeyText(activeApiKey)}` : "未检测到可用 API Key，可输入新 Key 保存";
      keyHint.title = activeApiKey ? apiKeyLabel(activeApiKey) : "";
      saveKeyButton.textContent = "添加并使用";
      removeKeyButton.hidden = !activeApiKey || activeApiKey.kind !== "dsh";
      setVisible(tokenSection, token);
      tokenButton.textContent = token ? "令牌模式" : "令牌登录";
      addButton.textContent = accounts.length ? "添加账号" : "登录 WorkBuddy";
      setVisible(accountRow, token && accounts.length > 0);
      accountSelect.replaceChildren(...accounts.map((account) => {
        const option = document.createElement("option");
        option.value = account.id;
        option.textContent = accountText(account);
        option.title = accountLabel(account);
        return option;
      }));
      if (activeAccountId) accountSelect.value = activeAccountId;
      const activeAccount = accounts.find((account) => account.id === activeAccountId);
      accountName.textContent = activeAccount ? `当前账号：${accountText(activeAccount)}` : "";
      accountName.title = activeAccount ? accountLabel(activeAccount) : "";
      removeButton.hidden = !token || !activeAccount;
      setVisible(accountStats, token && Boolean(activeAccount));
      applyCreditStatus(accountStats, status, activeAccount);
      message.textContent = token
        ? status.authenticated ? `令牌已登录：${activeAccount ? accountText(activeAccount) : "当前账号"}` : "令牌缺失，请重新登录"
        : status.apiKeyConfigured ? `API Key 已就绪：${activeApiKey ? apiKeyText(activeApiKey) : "当前来源"}` : "未配置 API Key，请输入后保存";
      message.style.color = token
        ? status.authenticated ? "var(--dsw-text-success, #2e7d32)" : "var(--dsw-text-danger, #c62828)"
        : status.apiKeyConfigured ? "var(--dsw-text-success, #2e7d32)" : "var(--dsw-text-danger, #c62828)";
    }

    async function request(path, body) {
      const options = { method: "POST" };
      if (body !== undefined) {
        options.headers = { "content-type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${ROUTE}/${path}`, options);
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const error = new Error(result.message || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function mount(input) {
      const field = input.parentElement;
      if (!field || field.querySelector(`[${MARKER}]`)) return;
      field.setAttribute("data-workbuddy-auth-field", "");
      input.dataset.workbuddyPlaceholder = input.placeholder;
      for (const nativeNode of field.children) nativeNode.hidden = true;
      Object.assign(field.style, { display: "block", width: "100%", boxSizing: "border-box" });
      const controls = document.createElement("div");
      controls.setAttribute(MARKER, "");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "WorkBuddy 认证方式");
      Object.assign(controls.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "8px",
        width: "100%",
        maxWidth: "100%",
        paddingTop: "4px",
        boxSizing: "border-box",
        color: "var(--dsw-text-primary, inherit)",
      });
      const modeRow = row();
      const keySection = section();
      const keySourceRow = row();
      const keyAddRow = row();
      const tokenSection = section();
      const accountRow = row();
      const tokenActionRow = row();
      const keyButton = button("API Key");
      const tokenButton = button("令牌登录");
      const keySelect = accountPicker();
      keySelect.setAttribute("aria-label", "WorkBuddy API Key 来源");
      const keySourceLabel = fieldLabel("当前 API Key");
      const newKeyLabel = fieldLabel("新增 API Key");
      const newKeyInput = textInput("password", "粘贴新的 API Key", "新增 WorkBuddy API Key");
      const newKeyLabelInput = textInput("text", "名称（可选）", "API Key 名称");
      const keyHint = document.createElement("span");
      Object.assign(keyHint.style, {
        display: "block",
        width: "100%",
        minWidth: "0",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const saveKeyButton = button("添加并使用");
      const removeKeyButton = button("删除");
      const accountSelect = accountPicker();
      const accountName = document.createElement("span");
      Object.assign(accountName.style, {
        flex: "1 1 220px",
        minWidth: "0",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        fontSize: "13px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const addButton = button("令牌登录");
      const removeButton = button("删除账号");
      const accountLabel = fieldLabel("令牌账号");
      const accountStats = document.createElement("div");
      accountStats.setAttribute("role", "status");
      accountStats.setAttribute("aria-live", "polite");
      Object.assign(accountStats.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        width: "100%",
        minHeight: "24px",
        fontSize: "13px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const tokenHint = document.createElement("span");
      tokenHint.textContent = "令牌登录后可切换账号，并查看积分与今日请求量。";
      Object.assign(tokenHint.style, {
        display: "block",
        width: "100%",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-text-secondary, #667085)",
      });
      const creditStat = document.createElement("span");
      creditStat.dataset.workbuddyStat = "credits";
      const usageStat = document.createElement("span");
      usageStat.dataset.workbuddyStat = "usage";
      accountStats.append(creditStat, usageStat);
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      Object.assign(message.style, { fontSize: "12px", minHeight: "18px", lineHeight: "18px" });
      modeRow.append(keyButton, tokenButton);
      keySourceRow.append(keySourceLabel, keySelect, removeKeyButton);
      keyAddRow.append(newKeyLabel, newKeyInput, newKeyLabelInput, saveKeyButton);
      keySection.append(keySourceRow, keyAddRow, keyHint);
      accountRow.append(accountLabel, accountSelect, accountName, removeButton);
      tokenActionRow.append(addButton);
      tokenSection.append(tokenHint, accountRow, accountStats, tokenActionRow);
      controls.append(modeRow, keySection, tokenSection, message);
      field.append(controls);
      let current = { mode: "api-key", authenticated: false, accounts: [], apiKeys: [], credits: undefined, creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null };
      const render = (status) => {
        const previousMode = current.mode;
        const previousAccountId = current.activeAccountId;
        current = { ...current, ...status };
        applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, message, current);
        if (previousMode !== current.mode || previousAccountId !== current.activeAccountId) notifyAuthState();
      };
      render(current);
      let creditRequestId = 0;
      const loadCredits = async (accountId) => {
        const requestId = ++creditRequestId;
        if (current.mode !== "token" || !accountId) {
          render({ credits: undefined, creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null });
          return;
        }
        render({ credits: undefined, creditLoading: true, creditError: null, todayUsage: null, todayUsageError: null });
        try {
          const result = await request("credits", { accountId });
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ ...result, creditLoading: false });
        } catch (error) {
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ credits: null, creditLoading: false, creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败", todayUsage: null, todayUsageError: "查询 WorkBuddy 今日请求量失败" });
        }
      };

      const setBusy = (busy) => {
        keyButton.disabled = busy;
        tokenButton.disabled = busy;
        keySelect.disabled = busy;
        newKeyInput.disabled = busy || current.mode === "token";
        newKeyLabelInput.disabled = busy || current.mode === "token";
        saveKeyButton.disabled = busy;
        removeKeyButton.disabled = busy;
        accountSelect.disabled = busy;
        addButton.disabled = busy;
        removeButton.disabled = busy;
        keyButton.style.cursor = busy ? "progress" : "pointer";
        tokenButton.style.cursor = busy ? "progress" : "pointer";
        saveKeyButton.style.cursor = busy ? "progress" : "pointer";
        removeKeyButton.style.cursor = busy ? "progress" : "pointer";
        addButton.style.cursor = busy ? "progress" : "pointer";
        removeButton.style.cursor = busy ? "progress" : "pointer";
      };
      keyButton.addEventListener("click", async () => {
        setBusy(true);
        message.textContent = "正在切换…";
        try {
          render(await request("api-key", current.activeApiKeyId ? { keyId: current.activeApiKeyId } : undefined));
          newKeyInput.focus();
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      keySelect.addEventListener("change", async () => {
        setBusy(true);
        message.textContent = "正在切换 API Key…";
        try {
          render(await request("api-key", { keyId: keySelect.value }));
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      saveKeyButton.addEventListener("click", async () => {
        const value = newKeyInput.value.trim();
        if (!value) {
          message.textContent = "请输入新的 API Key";
          message.style.color = "var(--dsw-text-danger, #c62828)";
          newKeyInput.focus();
          return;
        }
        setBusy(true);
        saveKeyButton.textContent = "添加中…";
        message.textContent = "正在保存 API Key…";
        try {
          const label = newKeyLabelInput.value.trim();
          const next = await request("api-key/add", { key: value, ...(label ? { label } : {}) });
          newKeyInput.value = "";
          newKeyLabelInput.value = "";
          render(next);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "保存失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      newKeyInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !saveKeyButton.disabled) {
          event.preventDefault();
          saveKeyButton.click();
        }
      });
      removeKeyButton.addEventListener("click", async () => {
        if (!current.activeApiKeyId || !window.confirm("确定删除当前 DSH 保存的 API Key 吗？")) return;
        setBusy(true);
        message.textContent = "正在删除 API Key…";
        try {
          render(await request("api-key/remove", { keyId: current.activeApiKeyId }));
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "删除失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      tokenButton.addEventListener("click", async () => {
        setBusy(true);
        tokenButton.textContent = "切换中…";
        message.textContent = current.accounts?.length ? "正在切换令牌账号…" : "请在浏览器中完成 WorkBuddy 中国站登录";
        try {
          const next = await request(current.accounts?.length ? "token" : "login");
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "登录失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      addButton.addEventListener("click", async () => {
        setBusy(true);
        addButton.textContent = "等待浏览器登录…";
        message.textContent = "请在浏览器中完成 WorkBuddy 中国站登录";
        try {
          const next = await request("login");
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "登录失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      accountSelect.addEventListener("change", async () => {
        setBusy(true);
        message.textContent = "正在切换令牌账号…";
        try {
          const next = await request("token", { accountId: accountSelect.value });
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "切换失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      removeButton.addEventListener("click", async () => {
        if (!current.activeAccountId || !window.confirm("确定删除这个 WorkBuddy 登录账号吗？令牌将从 DSH 凭据中移除。")) return;
        setBusy(true);
        message.textContent = "正在删除账号…";
        try {
          const next = await request("remove", { accountId: current.activeAccountId });
          render(next);
          await loadCredits(next.activeAccountId);
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "删除失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          setBusy(false);
        }
      });
      fetch(`${ROUTE}/status`, { cache: "no-store" })
        .then((response) => response.json())
        .then((status) => {
          render(status);
          return loadCredits(status.activeAccountId);
        })
        .catch(() => {
          message.textContent = "认证状态读取失败";
          message.style.color = "var(--dsw-text-danger, #c62828)";
        });
    }

    function enhance() {
      for (const input of document.querySelectorAll('input[aria-label="API 密钥"]')) {
        if (isWorkBuddy(input)) mount(input);
      }
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "workbuddy-credits",
        order: 100,
        label: "WorkBuddy 用量",
      }, WorkBuddyCreditsDock));
      ctx.effect(() => {
        const observer = new MutationObserver(enhance);
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("change", enhance, true);
        enhance();
        return () => {
          observer.disconnect();
          document.removeEventListener("change", enhance, true);
        };
      }, "llm-workbuddy: auth switch");
    }

    return { name: "dsh-llm-workbuddy-client", inject: ["slots"], apply };
  },
});
