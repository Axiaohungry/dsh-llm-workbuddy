window.__ModuleLoader__.load({
  id: "@axiaohungry/dsh-llm-workbuddy",
  factory: (require) => {
    const ROUTE = "/dsh-llm-workbuddy/auth";
    const MARKER = "data-workbuddy-auth-switch";
    const AUTH_STATE_EVENT = "dsh-llm-workbuddy:auth-state";
    const PENDING_MARKER = "data-workbuddy-new-session-selector";
    const WORKBUDDY_PROVIDER_PATTERN = /(?:^|-)(?:work-?buddy|code-?buddy)(?:-|$)/;
    const React = require("react");
    const { createElement, useEffect, useRef, useState } = React;

    function isWorkBuddyProvider(value) {
      const normalized = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return normalized.length > 0 && WORKBUDDY_PROVIDER_PATTERN.test(normalized);
    }

    function isModLensWorkBuddyProvider(value) {
      const normalized = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return /^modlens-(?:work-?buddy|code-?buddy)(?:-|$)/.test(normalized);
    }

    function button(text) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "wb-button";
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
      element.className = "wb-field-control";
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
      element.className = "wb-field-control";
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
      element.className = "wb-section";
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
      if (isWorkBuddyProvider(editor.textContent)) return true;
      const provider = editor.parentElement?.querySelector('select[aria-label="提供方"]')?.value;
      return isWorkBuddyProvider(provider);
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

    function expiryText(segments, now = Date.now()) {
      const known = (Array.isArray(segments) ? segments : []).filter((s) => s.remaining > 0 && typeof s.expiresAt === "number" && Number.isFinite(s.expiresAt)).sort((a, b) => a.expiresAt - b.expiresAt);
      if (!known.length) return "到期时间未知";
      const first = known[0], amount = known.filter((s) => s.expiresAt === first.expiresAt).reduce((n, s) => n + Number(s.remaining), 0);
      const delta = first.expiresAt - now;
      const remaining = delta <= 0 ? "已到期，待服务端更新" : delta < 3600_000 ? "不足 1 小时后到期" : delta < 86400_000 ? Math.ceil(delta / 3600_000) + " 小时后到期" : Math.ceil(delta / 86400_000) + " 天后到期";
      return formatCredits(amount) + " 积分" + (delta <= 0 ? "：" : "将于 ") + remaining;
    }

    function expiryDate(value) {
      return typeof value === "number" && Number.isFinite(value)
        ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）" : "到期时间未知";
    }

    function creditDistribution(segments, now = Date.now()) {
      const groups = [
        { label: "3 天内到期", value: 0, color: "#fb923c" },
        { label: "4–7 天到期", value: 0, color: "#facc15" },
        { label: "7 天后到期", value: 0, color: "#818cf8" },
        { label: "到期未知", value: 0, color: "#94a3b8" },
      ];
      for (const item of Array.isArray(segments) ? segments : []) {
        const amount = Number(item.remaining);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const delta = typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) ? item.expiresAt - now : null;
        groups[delta === null ? 3 : delta <= 3 * 86400_000 ? 0 : delta <= 7 * 86400_000 ? 1 : 2].value += amount;
      }
      return groups;
    }

    function creditChart(segments) {
      const groups = creditDistribution(segments), total = groups.reduce((sum, group) => sum + group.value, 0);
      const chart = document.createElement("div"), bar = document.createElement("div"), legend = document.createElement("div");
      chart.className = "wb-credit-chart";
      bar.className = "wb-credit-track";
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", total ? groups.filter((g) => g.value).map((g) => g.label + " " + formatCredits(g.value) + " 积分").join("，") : "暂无积分批次数据");
      legend.className = "wb-credit-legend";
      for (const group of groups.filter((g) => g.value > 0)) {
        const part = document.createElement("span"), label = document.createElement("span"), dot = document.createElement("i");
        part.style.width = (group.value / total * 100) + "%";
        part.style.background = dot.style.background = group.color;
        part.title = group.label + "：" + formatCredits(group.value) + " 积分";
        dot.setAttribute("aria-hidden", "true");
        label.append(dot, group.label + " " + formatCredits(group.value));
        bar.append(part);
        legend.append(label);
      }
      if (!total) legend.textContent = "暂无积分批次数据";
      chart.append(bar, legend);
      return chart;
    }

    function creditDetails(segments, withChart = true) {
      const details = document.createElement("details"), summary = document.createElement("summary");
      summary.textContent = "积分批次与到期时间";
      details.append(summary);
      details.className = "wb-credit-details";
      const list = Array.isArray(segments) ? segments : [];
      if (!list.length) details.append("暂无积分批次数据，到期时间未知");
      else if (withChart) details.append(creditChart(list));
      for (const item of list) {
        const line = document.createElement("div");
        line.textContent = String(item.source || "积分") + " · " + formatCredits(item.remaining) + " 积分 · " + expiryDate(item.expiresAt) + (typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) ? " · " + expiryText([item]) : "");
        line.style.overflowWrap = "anywhere";
        details.append(line);
      }
      return details;
    }

    async function authRequest(path, body, sessionId) {
      const options = {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
      };
      if (body !== undefined) {
        options.headers = { "content-type": "application/json" };
        options.body = JSON.stringify({ ...body, ...(sessionId && body.sessionId === undefined ? { sessionId: String(sessionId) } : {}) });
      }
      const query = sessionId && body === undefined ? `?sessionId=${encodeURIComponent(String(sessionId))}` : "";
      const response = await fetch(`${ROUTE}/${path}${query}`, options);
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
      if (typeof document !== "undefined") {
        for (const panel of document.querySelectorAll(`[${PENDING_MARKER}]`)) {
          delete panel.dataset.loaded;
          mountPendingSelector();
        }
      }
    }

    function selectedProvider(selection) {
      return selection?.next?.provider ?? selection?.lastUsed?.provider ?? selection?.provider;
    }

    function pendingCredentialOptions(status, mode) {
      return mode === "token"
        ? (Array.isArray(status.accounts) ? status.accounts : []).map((account) => ({ id: account.id, label: accountText(account) }))
        : (Array.isArray(status.apiKeys) ? status.apiKeys : []).map((key) => ({ id: key.id, label: apiKeyText(key), disabled: key.configured === false }));
    }

    function createPendingSelector() {
      installAccountVisualStyles();
      const panel = document.createElement("div");
      panel.className = "wb-pending-selector";
      panel.setAttribute(PENDING_MARKER, "");
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", "WorkBuddy 新会话凭证");
      Object.assign(panel.style, {
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: "6px",
        width: "100%",
        maxWidth: "var(--dsh-composer-card-max-width, 720px)",
        margin: "0 auto 8px",
        padding: "0 8px",
        color: "var(--dsw-text-tertiary, #98a2b3)",
        fontSize: "12px",
        lineHeight: "20px",
      });
      const label = document.createElement("span");
      label.textContent = "新会话默认凭证";
      const mode = document.createElement("select");
      mode.setAttribute("aria-label", "新会话认证模式");
      const credential = document.createElement("select");
      credential.setAttribute("aria-label", "新会话 WorkBuddy 凭证");
      for (const element of [mode, credential]) Object.assign(element.style, {
        boxSizing: "border-box",
        minWidth: "0",
        maxWidth: "min(240px, 100%)",
        height: "28px",
        padding: "0 6px",
        border: "1px solid var(--dsw-border-subtle, #d0d5dd)",
        borderRadius: "7px",
        background: "var(--dsw-surface-subtle, transparent)",
        color: "inherit",
        font: "inherit",
        fontSize: "12px",
      });
      const hint = document.createElement("span");
      hint.textContent = "发送时自动绑定所选凭证";
      hint.style.color = "var(--dsw-text-tertiary, #98a2b3)";
      panel.append(label, mode, credential, hint);
      panel._workbuddyMode = mode;
      panel._workbuddyCredential = credential;
      panel._workbuddyHint = hint;
      const apply = async () => {
        if (panel.dataset.busy === "1") return;
        const value = credential.value;
        if (!value || credential.selectedOptions[0]?.disabled) return;
        panel.dataset.busy = "1";
        mode.disabled = true;
        credential.disabled = true;
        hint.textContent = "正在保存新会话默认凭证…";
        try {
          const next = mode.value === "token"
            ? await authRequest("token", { accountId: value })
            : await authRequest("api-key", { keyId: value });
          renderPendingSelector(panel, next);
          notifyAuthState();
        } catch (error) {
          hint.textContent = error instanceof Error ? error.message : "保存新会话凭证失败";
          hint.style.color = "var(--dsw-text-danger, #c62828)";
        } finally {
          delete panel.dataset.busy;
          mode.disabled = false;
          credential.disabled = false;
        }
      };
      mode.addEventListener("change", () => {
        renderPendingOptions(panel, panel._workbuddyStatus, mode.value);
        void apply();
      });
      credential.addEventListener("change", () => void apply());
      return panel;
    }

    function renderPendingOptions(panel, status, preferredMode) {
      if (!status) return;
      const tokenOptions = pendingCredentialOptions(status, "token");
      const apiOptions = pendingCredentialOptions(status, "api-key");
      const tokenAvailable = tokenOptions.length > 0;
      const apiAvailable = apiOptions.some((option) => !option.disabled);
      if (!status.routingEnabled || (!tokenAvailable && !apiAvailable)) {
        panel.hidden = true;
        panel.style.setProperty("display", "none", "important");
        return;
      }
      panel.hidden = false;
      panel.style.setProperty("display", "flex", "important");
      const suggestedMode = status.suggestedBinding?.mode;
      const modeAvailable = (value) => value === "token" ? tokenAvailable : value === "api-key" && apiAvailable;
      const mode = modeAvailable(preferredMode)
        ? preferredMode
        : modeAvailable(suggestedMode)
          ? suggestedMode
          : status.mode === "token" && tokenAvailable ? "token" : "api-key";
      const modeSelect = panel._workbuddyMode;
      const credentialSelect = panel._workbuddyCredential;
      modeSelect.replaceChildren();
      for (const [value, label, disabled] of [["token", "令牌", !tokenAvailable], ["api-key", "API Key", !apiAvailable]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.disabled = disabled;
        modeSelect.append(option);
      }
      modeSelect.value = mode;
      const options = mode === "token" ? tokenOptions : apiOptions;
      credentialSelect.replaceChildren(...options.map((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        option.disabled = entry.disabled === true;
        return option;
      }));
      const activeId = mode === "token"
        ? status.suggestedAccountId ?? status.activeAccountId
        : status.suggestedApiKeyId ?? status.activeApiKeyId;
      if (activeId && options.some((entry) => entry.id === activeId && !entry.disabled)) credentialSelect.value = activeId;
      panel._workbuddyHint.textContent = "发送时自动绑定所选凭证";
      panel._workbuddyHint.style.color = "var(--dsw-text-tertiary, #98a2b3)";
    }

    function renderPendingSelector(panel, status) {
      panel._workbuddyStatus = status;
      renderPendingOptions(panel, status, panel._workbuddyMode.value);
    }

    function mountPendingSelector() {
      if (typeof document === "undefined") return;
      const seats = Array.from(document.querySelectorAll("[data-composer-seat]"));
      const seat = seats.find((candidate) => candidate.closest('[data-phase="hero"]'));
      const panels = Array.from(document.querySelectorAll(`[${PENDING_MARKER}]`));
      if (!seat) {
        for (const panel of panels) panel.remove();
        return;
      }
      for (const panel of panels) {
        if (panel.parentElement !== seat) panel.remove();
      }
      const panel = seat.querySelector(`[${PENDING_MARKER}]`) ?? createPendingSelector();
      if (!panel.parentElement) seat.append(panel);
      if (panel.dataset.loading === "1" || panel.dataset.loaded === "1") return;
      panel.dataset.loading = "1";
      authRequest("status")
        .then((status) => {
          panel.dataset.loaded = "1";
          renderPendingSelector(panel, status);
        })
        .catch(() => {
          panel.hidden = true;
          panel.style.setProperty("display", "none", "important");
        })
        .finally(() => {
          delete panel.dataset.loading;
        });
    }

    function creditRingBackground(segments) {
      const groups = creditDistribution(segments).filter((g) => g.value > 0), total = groups.reduce((n, g) => n + g.value, 0);
      if (!total) return "conic-gradient(#94a3b8 0% 100%)";
      let start = 0;
      return "conic-gradient(" + groups.map((group, index) => {
        const end = index === groups.length - 1 ? 100 : start + group.value / total * 100;
        const part = group.color + " " + start + "% " + end + "%";
        start = end;
        return part;
      }).join(", ") + ")";
    }

    function CreditExpiryRing({ segments, credits, accountName, creditError }) {
      const trigger = useRef(null);
      useEffect(() => {
        const anchor = trigger.current;
        if (!anchor) return;
        installAccountVisualStyles();
        const bubble = document.createElement("div"), heading = document.createElement("strong"), owner = document.createElement("div"), visual = document.createElement("div"), ring = document.createElement("div"), center = document.createElement("div"), amount = document.createElement("strong"), caption = document.createElement("small"), legend = document.createElement("div"), upcoming = document.createElement("div"), batches = document.createElement("div");
        const id = "wb-credit-bubble-" + Math.random().toString(36).slice(2);
        bubble.id = id;
        bubble.className = "wb-credit-bubble";
        bubble.setAttribute("role", "tooltip");
        bubble.hidden = true;
        heading.textContent = "积分到期分布";
        owner.className = "wb-credit-bubble-owner";
        owner.textContent = accountName || "当前会话账号";
        visual.className = "wb-credit-bubble-visual";
        ring.className = "wb-credit-big-ring";
        ring.style.background = creditRingBackground(segments);
        center.className = "wb-credit-ring-center";
        amount.textContent = typeof credits === "number" ? formatCredits(credits) : "—";
        caption.textContent = "剩余积分";
        center.append(amount, caption); ring.append(center);
        legend.className = "wb-credit-bubble-legend";
        for (const group of creditDistribution(segments).filter((g) => g.value > 0)) {
          const line = document.createElement("div"), dot = document.createElement("i");
          dot.style.background = group.color;
          line.append(dot, group.label + " · " + formatCredits(group.value));
          legend.append(line);
        }
        if (!legend.childNodes.length) legend.textContent = "暂无批次数据";
        visual.append(ring, legend);
        upcoming.className = "wb-credit-upcoming";
        upcoming.textContent = creditError || expiryText(segments);
        batches.className = "wb-credit-bubble-batches";
        batches.tabIndex = 0;
        batches.setAttribute("aria-label", "积分批次到期明细");
        const items = Array.isArray(segments) ? [...segments].sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity)) : [];
        for (const item of items) {
          const line = document.createElement("div"), title = document.createElement("div"), detail = document.createElement("small");
          title.textContent = String(item.source || "积分") + " · " + formatCredits(item.remaining) + " 积分";
          detail.textContent = expiryDate(item.expiresAt) + (typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) ? " · " + expiryText([item]) : "");
          line.append(title, detail);batches.append(line);
        }
        if (!items.length) batches.textContent = "服务端尚未返回有效的积分批次信息";
        bubble.append(heading, owner, visual, upcoming, batches);
        document.body.append(bubble);
        anchor.setAttribute("aria-controls", id);
        let closeTimer;
        function position() {
          const rect = anchor.getBoundingClientRect();
          bubble.style.width = Math.min(380, window.innerWidth - 24) + "px";
          const above = rect.top - 22, below = window.innerHeight - rect.bottom - 22;
          const useAbove = above >= below;
          bubble.style.maxHeight = Math.min(window.innerHeight - 24, Math.max(180, useAbove ? above : below)) + "px";
          const size = bubble.getBoundingClientRect();
          bubble.style.left = Math.max(12, Math.min(rect.right - size.width, window.innerWidth - size.width - 12)) + "px";
          bubble.style.top = Math.max(12, useAbove ? rect.top - size.height - 10 : Math.min(rect.bottom + 10, window.innerHeight - size.height - 12)) + "px";
        }
        function open() { window.clearTimeout(closeTimer); bubble.hidden = false; anchor.setAttribute("aria-expanded", "true"); anchor.setAttribute("aria-describedby", id); position(); }
        function close() { bubble.hidden = true; anchor.setAttribute("aria-expanded", "false"); anchor.removeAttribute("aria-describedby"); }
        function later() { window.clearTimeout(closeTimer); closeTimer = window.setTimeout(() => { if (!bubble.contains(document.activeElement) && document.activeElement !== anchor) close(); }, 160); }
        function outside(event) { if (!anchor.contains(event.target) && !bubble.contains(event.target)) close(); }
        function scroll(event) { if (!bubble.contains(event.target)) close(); }
        function escape(event) { if (event.key === "Escape") close(); }
        anchor.addEventListener("mouseenter", open);anchor.addEventListener("mouseleave", later);
        anchor.addEventListener("focus", open);anchor.addEventListener("blur", later);anchor.addEventListener("click", open);
        bubble.addEventListener("mouseenter", open);bubble.addEventListener("mouseleave", later);bubble.addEventListener("focusin", open);bubble.addEventListener("focusout", later);
        window.addEventListener("keydown", escape);window.addEventListener("resize", close);window.addEventListener("scroll", scroll, true);window.addEventListener("pointerdown", outside);
        return () => {
          window.clearTimeout(closeTimer);bubble.remove();
          anchor.removeEventListener("mouseenter", open);anchor.removeEventListener("mouseleave", later);anchor.removeEventListener("focus", open);anchor.removeEventListener("blur", later);anchor.removeEventListener("click", open);
          anchor.removeAttribute("aria-controls");anchor.removeAttribute("aria-describedby");
          window.removeEventListener("keydown", escape);window.removeEventListener("resize", close);window.removeEventListener("scroll", scroll, true);window.removeEventListener("pointerdown", outside);
        };
      }, [segments, credits, accountName, creditError]);
      return createElement("button", { ref: trigger, type: "button", className: "wb-credit-mini-trigger", "aria-label": "查看积分到期分布", "aria-expanded": "false" }, createElement("span", { className: "wb-credit-mini-ring", "aria-hidden": true, style: { background: creditRingBackground(segments) } }));
    }

    function WorkBuddyCreditsDock({ useProjection, sessionId }) {
      let selection;
      try {
        selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
      } catch {
        selection = undefined;
      }
      const provider = selectedProvider(selection);
      const selected = isWorkBuddyProvider(provider);
      const modlens = isModLensWorkBuddyProvider(provider);
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
          setState({ mode: "token", creditLoading: true, credits: undefined, segments: [], todayUsage: null, creditError: null, todayUsageError: null });
          let status;
          try {
            status = await authRequest("status", undefined, sessionId);
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
            const result = await authRequest("credits", { accountId: status.activeAccountId }, sessionId);
            if (!disposed && currentRequestId === requestId) setState({ ...status, ...result, creditLoading: false });
          } catch (error) {
            if (!disposed && currentRequestId === requestId) {
              const message = error instanceof Error ? error.message : "查询 WorkBuddy 积分失败";
              setState({
                ...status,
                credits: null, segments: [],
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
      }, [provider, selected, sessionId]);

      const hasTokenAccount = state?.mode === "token" && Boolean(state.activeAccountId);
      if (!selected || !state || (!state.routingEnabled && state.mode !== "token") || (!state.routingEnabled && state.mode === "token" && !state.activeAccountId) || (!sessionId && !hasTokenAccount)) return null;
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
      const modlensHint = modlens ? createElement("span", {
        "data-workbuddy-modlens-hint": true,
        title: "ModLens 会先处理会话中的历史图片，首次响应可能较慢；若超时、无响应或返回 429，请检查视觉引擎登录、网络和额度。纯文本任务可切换 WorkBuddy 直连。",
        style: {
          flex: "1 1 100%",
          minWidth: 0,
          color: "var(--dsw-text-tertiary, #98a2b3)",
          fontSize: "11px",
          lineHeight: "16px",
          textAlign: "right",
        },
      }, "ModLens：历史图片会先处理，响应较慢或出现 429 时请检查视觉引擎与额度；纯文本可切换 WorkBuddy 直连") : null;
      const activeAccount = Array.isArray(state.accounts) ? state.accounts.find((account) => account.id === state.activeAccountId) : undefined;
      const credentialOptions = state.mode === "token"
        ? (Array.isArray(state.accounts) ? state.accounts.map((account) => createElement("option", { key: account.id, value: account.id }, accountText(account))) : [])
        : (Array.isArray(state.apiKeys) ? state.apiKeys.map((key) => createElement("option", { key: key.id, value: key.id, disabled: key.configured === false }, apiKeyText(key))) : []);
      const confirmBindingChange = (message) => typeof window === "undefined" || window.confirm(message);
      const applyBindingResult = async (result) => {
        setState(result);
        if (result.mode === "token" && result.activeAccountId) {
          try {
            const credits = await authRequest("credits", { accountId: result.activeAccountId }, sessionId);
            setState({ ...result, ...credits, creditLoading: false });
          } catch (error) {
            setState({
              ...result,
              credits: null, segments: [],
              creditLoading: false,
              creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败",
              todayUsage: null,
              todayUsageError: "查询 WorkBuddy 今日请求量失败",
            });
          }
        }
      };
      const bindCredential = async (mode, value, failureMessage) => {
        try {
          const result = mode === "token"
            ? await authRequest("token", { accountId: value }, sessionId)
            : await authRequest("api-key", { keyId: value }, sessionId);
          await applyBindingResult(result);
        } catch (error) {
          setState({ ...state, creditError: error instanceof Error ? error.message : failureMessage });
        }
      };
      const onSessionCredentialChange = async (event) => {
        if (!state.routingEnabled || !sessionId) return;
        const value = event.target.value;
        if (!confirmBindingChange("切换后，当前已发出的请求继续使用原凭证；后续模型调用将使用新凭证。确定切换吗？")) {
          event.target.value = state.mode === "token" ? state.activeAccountId ?? "" : state.activeApiKeyId ?? "";
          return;
        }
        await bindCredential(state.mode, value, "切换会话凭证失败");
      };
      const onSessionModeChange = async (event) => {
        if (!state.routingEnabled || !sessionId) return;
        const mode = event.target.value;
        const value = mode === "token" ? state.accounts?.[0]?.id : state.apiKeys?.find((key) => key.configured)?.id;
        if (!value) return;
        if (!confirmBindingChange("切换后，当前已发出的请求继续使用原凭证；后续模型调用将使用新凭证。确定切换认证模式吗？")) {
          event.target.value = state.mode;
          return;
        }
        await bindCredential(mode, value, "切换会话认证模式失败");
      };
      const onUnbind = async () => {
        if (!state.routingEnabled || !sessionId || !state.sessionBinding) return;
        if (!confirmBindingChange("解除后，当前会话将在下一次模型调用时绑定当前默认凭证。确定解除吗？")) return;
        try {
          await applyBindingResult(await authRequest("unbind", {}, sessionId));
        } catch (error) {
          setState({ ...state, creditError: error instanceof Error ? error.message : "解除会话凭证失败" });
        }
      };
      const actionStyle = { border: "0", padding: "0 2px", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer", textDecoration: "underline" };
      const sessionControls = state.routingEnabled && sessionId ? createElement(
        "span",
        { "data-workbuddy-session-controls": true, style: { display: "inline-flex", alignItems: "center", justifyContent: "flex-end", flex: "1 1 100%", flexWrap: "wrap", gap: "4px", minWidth: 0, maxWidth: "100%" } },
        createElement("span", { title: state.sessionBinding ? "当前会话已使用独立凭证" : "当前会话未绑定，下次发送将固化当前默认凭证" }, state.sessionBinding ? "已绑定" : "未绑定"),
        createElement("select", { value: state.mode, onChange: onSessionModeChange, "aria-label": "当前会话认证模式", style: { border: "0", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px", minWidth: 0, maxWidth: "110px" } },
          createElement("option", { value: "token" }, "令牌"),
          createElement("option", { value: "api-key" }, "API Key"),
        ),
        createElement("select", { value: state.mode === "token" ? state.activeAccountId ?? "" : state.activeApiKeyId ?? "", onChange: onSessionCredentialChange, "aria-label": "当前会话凭证", style: { border: "0", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px", minWidth: 0, maxWidth: "190px" } }, credentialOptions),
        state.sessionBinding ? createElement("button", { type: "button", onClick: onUnbind, title: "解除当前绑定，下次发送时重新绑定默认凭证", style: actionStyle }, "解除绑定") : null,
        createElement("span", { "aria-hidden": true, style: { opacity: 0.55, padding: "0 2px" } }, "·"),
      ) : null;
      return createElement(
        "div",
        {
          className: "dsh-workbuddy-credits",
          "data-workbuddy-credits": true,
          "data-workbuddy-session-aware": state.routingEnabled ? true : undefined,
          role: "status",
          "aria-live": "polite",
          title: [activeAccount ? `当前账号：${accountText(activeAccount)}` : "", state.creditError, state.todayUsageError].filter(Boolean).join("；") || undefined,
          style: {
            boxSizing: "border-box",
            minWidth: 0,
            width: "100%",
            maxWidth: "100%",
            minHeight: "20px",
            padding: "0",
            display: "inline-flex",
            flexWrap: "wrap",
            gap: "2px 8px",
            flex: "0 1 auto",
            justifyContent: "flex-end",
            alignItems: "center",
            color: "var(--dsw-text-tertiary, #98a2b3)",
            fontSize: "12px",
            lineHeight: "18px",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "normal",
            overflow: "visible",
            textOverflow: "clip",
          },
        },
        sessionControls,
        state.mode === "token" ? createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: "4px" } }, creditsText,
          !state.creditLoading && !state.unlimited ? createElement(CreditExpiryRing, { segments: state.segments, credits: state.credits, creditError: state.creditError, accountName: activeAccount ? accountText(activeAccount) : "" }) : null,
        ) : null,
        state.mode === "token" ? createElement("span", { "aria-hidden": true, style: { opacity: 0.55, padding: "0 4px" } }, "·") : null,
        state.mode === "token" ? createElement("span", null, usageText) : createElement("span", null, "当前会话 API Key"),
        modlensHint,
      );
    }

    function installComposerDockLayout() {
      if (typeof document === "undefined" || document.querySelector('style[data-plugin-css="dsh-llm-workbuddy-composer-dock"]')) return;
      const style = document.createElement("style");
      style.dataset.plugin = "@axiaohungry/dsh-llm-workbuddy";
      style.dataset.pluginCss = "dsh-llm-workbuddy-composer-dock";
      style.textContent = `
[data-slot="conversation.composer.dock"]:has(> [data-composer-stats]),
[data-slot="conversation.composer.dock"]:has(> [data-workbuddy-credits]) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 4px 4px;
  overflow: hidden;
}
[data-slot="conversation.composer.dock"] > [data-composer-stats] {
  grid-column: 2;
  width: auto !important;
  max-width: 100%;
  min-width: 0;
  margin: 0 !important;
}
[data-slot="conversation.composer.dock"] > [data-workbuddy-credits] {
  grid-column: 3;
  justify-self: end;
  width: 100% !important;
  max-width: 100%;
  min-width: 0;
  margin: 0 !important;
}
[data-slot="conversation.composer.dock"] > [data-workbuddy-credits] > span {
  min-width: 0;
}
[data-slot="conversation.composer.dock"] > [data-workbuddy-credits] > [data-workbuddy-session-controls] {
  flex-basis: 100%;
  width: 100%;
}
@media (max-width: 760px) {
  [data-slot="conversation.composer.dock"]:has(> [data-composer-stats]),
  [data-slot="conversation.composer.dock"]:has(> [data-workbuddy-credits]) {
    display: flex !important;
    flex-wrap: wrap;
    justify-content: center;
  }
  [data-slot="conversation.composer.dock"] > [data-composer-stats],
  [data-slot="conversation.composer.dock"] > [data-workbuddy-credits] {
    flex: 0 1 auto;
  }
}
`;
      document.head.appendChild(style);
    }

    function applyCreditStatus(stats, status, activeAccount) {
      const visible = status.mode === "token" && Boolean(activeAccount);
      setVisible(stats, visible, "grid");
      if (!visible) return;
      const credit = stats.querySelector('[data-workbuddy-stat="credits"]');
      const usage = stats.querySelector('[data-workbuddy-stat="usage"]');
      const expiry = stats.querySelector('[data-workbuddy-stat="expiry"]');
      if (expiry) expiry.textContent = status.creditLoading ? "到期信息读取中…" : status.unlimited ? "" : expiryText(status.segments);
      const batches = stats.querySelector('[data-workbuddy-batches]');
      if (batches) {
        const open = batches.firstElementChild?.open;
        const details = creditDetails(status.segments);
        details.open = Boolean(open);
        batches.replaceChildren(details);
      }
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

    function applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, routingRow, routingToggle, message, status) {
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
      setVisible(accountStats, token && Boolean(activeAccount), "grid");
      applyCreditStatus(accountStats, status, activeAccount);
      routingToggle.checked = status.routingEnabled === true;
      routingToggle.disabled = false;
      routingRow.title = status.routingEnabled ? "已启用：每个会话可单独选择 WorkBuddy 账号或 API Key" : "关闭时使用原有的全局账号或 API Key";
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
      installAccountVisualStyles();
      field.setAttribute("data-workbuddy-auth-field", "");
      input.dataset.workbuddyPlaceholder = input.placeholder;
      for (const nativeNode of field.children) nativeNode.hidden = true;
      Object.assign(field.style, { display: "block", width: "100%", boxSizing: "border-box" });
      const controls = document.createElement("div");
      controls.setAttribute(MARKER, "");
      controls.className = "wb-auth-controls";
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
      const heading = document.createElement("div");
      heading.className = "wb-section-heading";
      const title = document.createElement("strong"), description = document.createElement("span");
      title.textContent = "连接与认证";
      description.textContent = "管理账号、API Key 和会话独立凭据";
      heading.append(title, description);
      const modeRow = row();
      modeRow.className = "wb-mode-tabs";
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
      saveKeyButton.classList.add("wb-button-primary");
      const removeKeyButton = button("删除");
      removeKeyButton.classList.add("wb-button-danger");
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
      addButton.classList.add("wb-button-primary");
      const removeButton = button("删除账号");
      removeButton.classList.add("wb-button-danger");
      const accountLabel = fieldLabel("令牌账号");
      const accountStats = document.createElement("div");
      accountStats.className = "wb-account-stats";
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
      const expiryStat = document.createElement("span");
      expiryStat.dataset.workbuddyStat = "expiry";
      const batches = document.createElement("div");
      batches.dataset.workbuddyBatches = "";
      batches.style.width = "100%";
      accountStats.append(creditStat, usageStat, expiryStat, batches);
      const routingRow = row();
      routingRow.className = "wb-routing-row";
      const routingToggle = document.createElement("input");
      routingToggle.type = "checkbox";
      routingToggle.id = "wb-routing-" + Math.random().toString(36).slice(2);
      routingToggle.setAttribute("aria-label", "启用会话级账号/API Key");
      routingToggle.style.accentColor = "var(--dsw-accent, #2563eb)";
      const routingLabel = document.createElement("label");
      routingLabel.textContent = "会话级账号/API Key";
      routingLabel.htmlFor = routingToggle.id;
      routingLabel.style.fontSize = "13px";
      routingLabel.style.color = "var(--dsw-text-secondary, #667085)";
      const routingHint = document.createElement("span");
      routingHint.textContent = "关闭时保持原有全局认证方式";
      routingHint.style.fontSize = "12px";
      routingHint.style.color = "var(--dsw-text-tertiary, #98a2b3)";
      routingRow.append(routingToggle, routingLabel, routingHint);
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      Object.assign(message.style, { fontSize: "12px", minHeight: "18px", lineHeight: "18px" });
      message.className = "wb-auth-status";
      modeRow.append(keyButton, tokenButton);
      keySourceRow.append(keySourceLabel, keySelect, removeKeyButton);
      keyAddRow.append(newKeyLabel, newKeyInput, newKeyLabelInput, saveKeyButton);
      keySection.append(keySourceRow, keyAddRow, keyHint);
      accountRow.append(accountLabel, accountSelect, accountName, removeButton);
      tokenActionRow.append(addButton);
      tokenSection.append(tokenHint, accountRow, accountStats, tokenActionRow);
      controls.append(heading, modeRow, routingRow, keySection, tokenSection, message);
      field.append(controls);
      let current = { mode: "api-key", authenticated: false, accounts: [], apiKeys: [], credits: undefined, segments: [], creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null };
      const render = (status) => {
        const previousMode = current.mode;
        const previousAccountId = current.activeAccountId;
        const previousApiKeyId = current.activeApiKeyId;
        const previousAccounts = current.accounts;
        const previousApiKeys = current.apiKeys;
        const previousRouting = current.routingEnabled;
        current = { ...current, ...status };
        applyMode(input, keyButton, tokenButton, keySection, keySourceRow, keySelect, keyHint, newKeyInput, newKeyLabelInput, saveKeyButton, removeKeyButton, tokenSection, accountRow, accountSelect, accountName, addButton, removeButton, accountStats, routingRow, routingToggle, message, current);
        if (previousMode !== current.mode || previousAccountId !== current.activeAccountId || previousApiKeyId !== current.activeApiKeyId || previousAccounts !== current.accounts || previousApiKeys !== current.apiKeys || previousRouting !== current.routingEnabled) notifyAuthState();
      };
      render(current);
      mountAccountOverview(controls, () => current, (balance) => render(balance));
      let creditRequestId = 0;
      const loadCredits = async (accountId) => {
        const requestId = ++creditRequestId;
        if (current.mode !== "token" || !accountId) {
          render({ credits: undefined, segments: [], creditLoading: false, creditError: null, todayUsage: null, todayUsageError: null });
          return;
        }
        render({ credits: undefined, segments: [], creditLoading: true, creditError: null, todayUsage: null, todayUsageError: null });
        try {
          const result = await request("credits", { accountId });
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ ...result, creditLoading: false });
        } catch (error) {
          if (requestId !== creditRequestId || current.activeAccountId !== accountId) return;
          render({ credits: null, segments: [], creditLoading: false, creditError: error instanceof Error ? error.message : "查询 WorkBuddy 积分失败", todayUsage: null, todayUsageError: "查询 WorkBuddy 今日请求量失败" });
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
        routingToggle.disabled = busy;
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
      routingToggle.addEventListener("change", async () => {
        setBusy(true);
        message.textContent = routingToggle.checked ? "正在启用会话级认证…" : "正在关闭会话级认证…";
        try {
          render(await authRequest("routing", { enabled: routingToggle.checked }));
        } catch (error) {
          routingToggle.checked = !routingToggle.checked;
          message.textContent = error instanceof Error ? error.message : "切换会话级认证失败";
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

    function installAccountVisualStyles() {
      if (document.querySelector("style[data-workbuddy-dashboard]")) return;
      const style = document.createElement("style");
      style.dataset.workbuddyDashboard = "";
      style.textContent = `
.wb-credit-mini-trigger{display:inline-grid;place-items:center;width:24px;height:24px;padding:2px;border:0;border-radius:50%;background:transparent;cursor:pointer;color:inherit;flex-shrink:0}
.wb-credit-mini-trigger:focus-visible{outline:2px solid #818cf8;outline-offset:2px}.wb-credit-mini-ring{width:17px;height:17px;border-radius:50%;position:relative;display:block;box-shadow:0 0 7px #818cf830}.wb-credit-mini-ring:after{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--dsw-surface,#fff)}
.wb-credit-bubble{display:flex;flex-direction:column;position:fixed;z-index:2147483000;box-sizing:border-box;padding:16px;border-radius:16px;border:1px solid var(--dsw-border,#dbe2ee);background:var(--dsw-surface,#fff);color:var(--dsw-text-primary,#1e293b);box-shadow:0 18px 60px #0f172a35;overflow:auto;font:13px/1.5 system-ui;overflow-wrap:anywhere}.wb-credit-bubble[hidden]{display:none}.wb-credit-bubble>strong{font-size:15px}.wb-credit-bubble-owner{color:var(--dsw-text-secondary,#64748b);font-size:11px;margin-top:2px}
.wb-credit-bubble-visual{flex-shrink:0;display:flex;align-items:center;gap:16px;margin:16px 0}.wb-credit-big-ring{width:112px;height:112px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;box-shadow:0 0 20px #818cf818}.wb-credit-ring-center{width:88px;height:88px;background:var(--dsw-surface,#fff);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}.wb-credit-ring-center strong{font-size:18px;line-height:1.4;font-variant-numeric:tabular-nums}.wb-credit-ring-center small{font-size:11px;color:var(--dsw-text-secondary,#64748b)}
.wb-credit-bubble-legend{font-size:11px;display:grid;gap:8px}.wb-credit-bubble-legend>div{display:flex;gap:6px;align-items:center}.wb-credit-bubble-legend i{width:8px;height:8px;border-radius:50%;flex-shrink:0}.wb-credit-upcoming{flex-shrink:0;padding:9px 10px;border-radius:8px;background:#f9731612;color:var(--dsw-text-warning,#9a4b15);font-size:12px;font-weight:600}
.wb-credit-bubble-batches{min-height:0;flex-shrink:1;max-height:230px;overflow:auto;margin-top:10px;overscroll-behavior:contain}.wb-credit-bubble-batches>div{padding:9px 0;border-bottom:1px solid var(--dsw-border,#e2e8f0)}.wb-credit-bubble-batches small{display:block;color:var(--dsw-text-secondary,#64748b);font-size:11px;margin-top:3px}
.wb-button{border-radius:10px!important;border-color:var(--dsw-border,#dbe2ee)!important;background:var(--dsw-surface,#fff)!important;color:var(--dsw-text-primary,#334155)!important;box-shadow:0 2px 5px #18274804;transition:background-color 120ms,border-color 120ms,box-shadow 120ms!important}
.wb-button:hover:not(:disabled){border-color:#a5b4fc!important;background:var(--dsw-accent-subtle,#eef2ff)!important;box-shadow:0 3px 10px #6366f110}.wb-button:focus-visible,.wb-field-control:focus-visible,.wb-model-editor textarea:focus-visible{outline:2px solid #818cf8;outline-offset:2px}.wb-button:disabled{opacity:.5;cursor:default!important}
.wb-button-primary{background:linear-gradient(135deg,#394daf,#6961c9)!important;border-color:transparent!important;color:#fff!important;box-shadow:0 4px 12px #4f46e522}.wb-button-primary:hover:not(:disabled){background:linear-gradient(135deg,#32449d,#5e55bf)!important;color:#fff!important}.wb-button-danger{color:var(--dsw-text-danger,#b54454)!important;background:var(--dsw-surface,#fff)!important}.wb-button-danger:hover:not(:disabled){border-color:#f3acb8!important;background:#f43f5e0c!important}.wb-button-quiet{background:transparent!important;box-shadow:none}
.wb-field-control,.wb-model-editor textarea{border:1px solid var(--dsw-border,#dbe2ee)!important;border-radius:10px!important;background:var(--dsw-surface,#fff)!important;color:var(--dsw-text-primary,#334155)!important;max-width:100%;box-sizing:border-box}.wb-field-control::placeholder{color:var(--dsw-text-tertiary,#8793a5)}
.wb-section{border:1px solid var(--dsw-border,#dbe2ee)!important;border-radius:14px!important;background:var(--dsw-surface-subtle,#f6f8fc)!important;padding:14px!important;gap:12px!important;min-width:0}
.wb-settings-surface{border:0!important;padding:0!important;background:transparent!important;box-shadow:none}
.wb-auth-controls{gap:12px!important}.wb-section-heading{display:flex;flex-direction:column;gap:3px;padding:4px 0 0}.wb-section-heading strong,.wb-model-heading{font-size:15px;color:var(--dsw-text-primary,#26354d);font-weight:650}.wb-section-heading strong:before,.wb-model-heading:before{content:"";display:inline-block;width:4px;height:13px;background:linear-gradient(#818cf8,#4f46e5);border-radius:4px;margin-right:8px;vertical-align:-1px}.wb-section-heading>span{font-size:12px;color:var(--dsw-text-secondary,#64748b)}
.wb-mode-tabs{width:fit-content!important;max-width:100%;gap:4px!important;padding:4px;background:var(--dsw-surface-subtle,#edf0f8);border:1px solid var(--dsw-border,#dbe2ee);border-radius:12px;box-sizing:border-box}.wb-mode-tabs .wb-button{min-height:36px!important;padding:0 18px!important;background:transparent!important;border-color:transparent!important;box-shadow:none}.wb-mode-tabs .wb-button[aria-pressed="true"]{background:linear-gradient(135deg,#394daf,#6961c9)!important;color:white!important;box-shadow:0 3px 9px #4f46e526}
.wb-routing-row{padding:10px 12px;border:1px solid var(--dsw-border,#dbe2ee);border-radius:12px;background:var(--dsw-surface-subtle,#f6f8fc);box-sizing:border-box}.wb-routing-row label{font-weight:600;cursor:pointer}.wb-routing-row input{width:16px;height:16px;margin:0;accent-color:#6366f1}
.wb-account-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px!important}.wb-account-stats>[data-workbuddy-stat]{display:flex;align-items:center;min-height:52px;box-sizing:border-box;padding:10px;border-radius:10px;background:var(--dsw-surface,#fff);border:1px solid var(--dsw-border,#dbe2ee);font-size:12px;line-height:1.6}.wb-account-stats>[data-workbuddy-stat="expiry"]{color:var(--dsw-text-warning,#9a4b15);background:#f9731608}.wb-account-stats>[data-workbuddy-batches]{grid-column:1/-1}.wb-auth-status{padding:7px 10px;background:var(--dsw-surface-subtle,#f6f8fc);border-radius:9px;border:1px solid var(--dsw-border,#dbe2ee)}
.wb-model-editor{margin-top:16px}.wb-model-heading{display:block;padding:3px 0}.wb-model-card{background:var(--dsw-surface,#fff)!important;border-left:3px solid #818cf8!important}.wb-model-card-heading{font-size:11px;font-weight:650;letter-spacing:.07em;color:var(--dsw-text-secondary,#64748b)}.wb-model-fields{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));align-items:end!important;gap:10px!important}.wb-model-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px;color:var(--dsw-text-secondary,#64748b)}.wb-model-field input{width:100%;min-width:0;flex:none!important}.wb-model-fields>label:not(.wb-model-field){font-size:12px;display:flex;align-items:center;gap:6px;min-height:44px}.wb-model-fields>.wb-button{justify-self:end}.wb-model-editor details{font-size:12px;color:var(--dsw-text-secondary,#64748b)}.wb-model-editor textarea{padding:10px;min-height:72px;margin-top:8px;font:12px/1.6 monospace}.wb-model-candidates:empty{display:none}.wb-model-candidates:not(:empty){padding:12px;border:1px dashed #a5b4fc;border-radius:12px;background:var(--dsw-accent-subtle,#eef2ff)}.wb-model-candidates label{padding:5px 0;overflow-wrap:anywhere}
.wb-pending-selector{padding:8px 10px!important;gap:8px!important;border:1px solid var(--dsw-border,#dbe2ee);border-radius:12px;background:var(--dsw-surface-subtle,#f6f8fc)}.wb-pending-selector select,[data-workbuddy-session-controls] select{border:1px solid var(--dsw-border,#dbe2ee)!important;border-radius:8px!important;background:var(--dsw-surface,#fff)!important;padding:3px 7px!important;color:var(--dsw-text-primary,#475569)!important}.wb-pending-selector select:focus-visible,[data-workbuddy-session-controls] select:focus-visible{outline:2px solid #818cf8;outline-offset:2px}[data-workbuddy-session-controls]>span:first-child{padding:2px 7px;border-radius:7px;background:#6366f110;color:var(--dsw-text-secondary,#64748b)}[data-workbuddy-session-controls] button{border-radius:7px!important;border:1px solid var(--dsw-border,#dbe2ee)!important;padding:2px 7px!important;text-decoration:none!important}
@media(max-width:500px){.wb-account-stats{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.wb-button{transition:none!important}}
.wb-account-panel{padding:12px;border:1px solid var(--dsw-border,#dbe2ee);border-radius:14px;background:var(--dsw-surface-subtle,#f6f8fc);box-sizing:border-box}
.wb-account-panel>summary{font-weight:650;cursor:pointer;padding:4px 0 10px}
.wb-dashboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
.wb-metric{border-radius:12px;padding:14px;color:#f8fafc;background:linear-gradient(135deg,#253d86,#5354be);box-shadow:0 5px 15px #313d7614;display:flex;gap:12px;align-items:center;min-width:0}
.wb-metric:nth-child(2){background:linear-gradient(135deg,#0d596b,#157c83)}
.wb-metric:nth-child(3){background:linear-gradient(135deg,#80502a,#aa5b37)}
.wb-metric small{display:block;color:#e2e8f0;font-size:12px}.wb-metric strong{display:block;font-size:24px;line-height:1.3;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.wb-metric p{margin:4px 0 0;font-size:11px;color:#e2e8f0}
.wb-progress-ring{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;background:conic-gradient(#a5b4fc var(--wb-progress),#ffffff24 0)}
.wb-progress-ring span{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#34438e;color:white;font-weight:700;font-size:12px}
.wb-account-card{padding:14px;margin-top:10px;border:1px solid var(--dsw-border,#dbe2ee);border-radius:12px;background:var(--dsw-surface,#fff);position:relative;overflow:hidden}
.wb-account-card:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:#818cf8}
.wb-account-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px}.wb-account-badge{padding:3px 9px;border-radius:20px;font-size:12px;font-weight:600;background:#64748b20;color:var(--dsw-text-secondary,#475569)}
.wb-account-badge[data-tone="success"]{background:#10b98120;color:var(--dsw-text-success,#12714d)}.wb-account-badge[data-tone="warning"]{background:#f9731620;color:var(--dsw-text-warning,#a34b0e)}
.wb-account-balance{font-size:14px;font-weight:600;color:var(--dsw-text-primary,#1e293b);margin:5px 0}.wb-account-time{font-size:11px;color:var(--dsw-text-secondary,#667085);margin:6px 0}
.wb-credit-chart{margin:10px 0 8px}.wb-credit-track{height:9px;display:flex;gap:2px;border-radius:8px;overflow:hidden;background:var(--dsw-border,#e2e8f0)}.wb-credit-track span{display:block;min-width:2px;border-radius:2px}
.wb-credit-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--dsw-text-secondary,#64748b);margin-top:7px}.wb-credit-legend span{display:inline-flex;align-items:center;gap:4px}.wb-credit-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wb-credit-details{font-size:12px;margin:6px 0}.wb-credit-details summary{cursor:pointer;color:var(--dsw-text-secondary,#475569)}.wb-credit-details>div:not(.wb-credit-chart){padding:5px 0;border-bottom:1px solid var(--dsw-border,#e2e8f0)}
.wb-account-panel button{min-height:34px}.wb-account-panel button:disabled{opacity:.5;cursor:default!important}.wb-account-panel summary:focus-visible{outline:2px solid #818cf8;outline-offset:3px;border-radius:4px}
`;
      document.head.append(style);
    }

    function mountAccountOverview(host, getState, onBalance) {
      installAccountVisualStyles();
      const panel = document.createElement("details"), summary = document.createElement("summary");
      summary.textContent = "全部账号 · 每日签到与积分";
      Object.assign(panel.style, { width: "100%", fontSize: "13px", lineHeight: "1.6", overflowWrap: "anywhere" });
      panel.className = "wb-account-panel";
      panel.open = true;
      const dashboard = document.createElement("div");
      dashboard.className = "wb-dashboard";
      const hint = document.createElement("div");
      hint.textContent = "仅插件保存的登录账号；DSH 启动和跨日自动签到。API Key 不支持签到。";
      const actions = row(), all = button("全部签到"), refresh = button("刷新全部余额");
      const message = document.createElement("div"), list = document.createElement("div");
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      actions.append(all, refresh);
      panel.append(summary, hint, dashboard, actions, message, list);
      host.append(panel);
      let busy = false, requestId = 0, loaded = false, lastOverview = "", renderedAt = 0;
      function renderOverview(data) {
        lastOverview = JSON.stringify(data);
        renderedAt = Date.now();
        const accounts = getState().accounts ?? [];
        const records = data.accounts ?? [];
        const complete = records.filter((a) => a.checkin?.date === data.date && a.checkin.ok).length;
        const eligible = records.filter((a) => !a.checkin?.unsupported).length;
        const known = records.filter((a) => typeof a.credits === "number" && Number.isFinite(a.credits));
        const total = known.reduce((sum, a) => sum + a.credits, 0);
        const soon = records.flatMap((a) => creditDistribution(a.segments).slice(0, 2)).reduce((sum, g) => sum + g.value, 0);
        dashboard.replaceChildren();
        const tiles = [
          ["今日签到", complete + " / " + eligible, "按北京时间每日检查"],
          ["已知总余额", known.length ? formatCredits(total) : "—", "已读取 " + known.length + " / " + records.length + " 个账号"],
          ["7 天内到期", known.length ? formatCredits(soon) : "—", "积分到期后由上游清理"],
        ];
        tiles.forEach(([label, value, note], i) => {
          const tile = document.createElement("div"), text = document.createElement("div"), title = document.createElement("small"), amount = document.createElement("strong"), foot = document.createElement("p");
          tile.className = "wb-metric";
          title.textContent = label; amount.textContent = value; foot.textContent = note;
          if (i === 0) {
            const ring = document.createElement("div"), percent = document.createElement("span");
            ring.className = "wb-progress-ring";
            ring.style.setProperty("--wb-progress", (eligible ? complete / eligible * 100 : 0) + "%");
            percent.textContent = eligible ? Math.round(complete / eligible * 100) + "%" : "—";
            ring.setAttribute("aria-hidden", "true");
            ring.append(percent);tile.append(ring);
          }
          text.append(title, amount, foot);tile.append(text);dashboard.append(tile);
        });
        summary.textContent = "全部账号 · 今日已签到 " + complete + "/" + records.filter((a) => !a.checkin?.unsupported).length + (records.some((a) => a.checkin?.unsupported) ? " · 含不支持签到的账号" : "");
        all.disabled = refresh.disabled = busy || data.running;
        all.title = refresh.title = data.running ? "正在处理账号，请稍候" : "";
        const expanded = new Set(Array.from(list.querySelectorAll("[data-account-id]" )).filter((card) => card.querySelector("details")?.open).map((card) => card.dataset.accountId));
        list.replaceChildren();
        if (!records.length) list.append("尚无登录账号，请先添加账号。");
        for (const item of records) {
          const card = document.createElement("div"), name = document.createElement("strong"), status = document.createElement("div"), balance = document.createElement("div"), last = document.createElement("div"), retry = button("签到 / 重试");
          card.className = "wb-account-card";
          const header = document.createElement("div");
          header.className = "wb-account-header";
          status.className = "wb-account-badge";
          balance.className = "wb-account-balance";
          last.className = "wb-account-time";
          card.dataset.accountId = item.id;
          name.textContent = accountText(accounts.find((a) => a.id === item.id) ?? { id: item.id });
          const checkin = item.checkin;
          status.textContent = checkin?.date === data.date ? checkin.message + (checkin.ok && checkin.reward != null ? " · 获得 " + formatCredits(checkin.reward) + " 积分" : "") : "今日待签到";
          status.dataset.tone = checkin?.date === data.date && checkin.ok ? "success" : checkin?.unsupported ? "neutral" : "warning";
          balance.textContent = item.creditError || (item.unlimited ? "剩余积分：不限量" : typeof item.credits === "number" ? "剩余积分：" + formatCredits(item.credits) + " · " + expiryText(item.segments) : "余额待刷新");
          last.textContent = "最近执行：" + (checkin?.checkedAt ? expiryDate(checkin.checkedAt) : "尚未执行") + (item.balanceAt ? " · 余额更新：" + expiryDate(item.balanceAt) : "");
          retry.disabled = busy || data.running || checkin?.unsupported === true || checkin?.date === data.date && checkin.ok;
          retry.title = checkin?.unsupported ? "企业账号不支持签到，可正常查询余额" : checkin?.date === data.date && checkin.ok ? "今日已完成，无需重复签到" : "为此账号签到，不切换当前账号";
          retry.addEventListener("click", () => run({ accountId: item.id }));
          const batches = creditDetails(item.segments, false);
          batches.open = expanded.has(item.id);
          header.append(name, status);
          card.append(header, balance, creditChart(item.segments), last, batches, retry);
          list.append(card);
        }
        message.textContent = busy || data.running ? "正在处理账号…" : "签到记录日期：" + data.date + "（北京时间）";
      }
      async function load() {
        const id = ++requestId;
        try { const data = await request("accounts", {}); if (id === requestId && (JSON.stringify(data) !== lastOverview || Date.now() - renderedAt >= 60000 && !panel.contains(document.activeElement))) renderOverview(data); }
        catch { if (id === requestId) message.textContent = "读取签到记录失败，请刷新重试"; }
      }
      async function run(body) {
        if (busy) return;
        busy = true;
        all.disabled = refresh.disabled = true;
        list.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        ++requestId;
        message.textContent = "正在处理账号…";
        try {
          const data = await request("checkin", body);
          const active = data.accounts?.find((a) => a.id === getState().activeAccountId);
          if (active?.balanceAt) onBalance({ ...active, creditLoading: false });
          busy = false;
          renderOverview(data);
        } catch (error) { busy = false; await load(); message.textContent = error.message || "操作失败，请重试"; }
      }
      all.addEventListener("click", () => run({}));
      refresh.addEventListener("click", () => run({ refreshOnly: true }));
      panel.addEventListener("toggle", () => { if (panel.open && !loaded) { loaded = true; run({ refreshOnly: true }); } else if (panel.open) load(); });
      const changed = () => { loaded = false; lastOverview = ""; if (!busy) load(); };
      window.addEventListener(AUTH_STATE_EVENT, changed);
      const timer = window.setInterval(() => {
        if (!panel.isConnected) { window.clearInterval(timer); window.removeEventListener(AUTH_STATE_EVENT, changed); }
        else if (panel.open && !busy) load();
      }, 15000);
      load();
    }

    function mountModelEditor(host) {
      installAccountVisualStyles();
      host.classList.add("wb-model-editor");
      const heading = document.createElement("strong");
      heading.textContent = "模型目录";
      heading.className = "wb-model-heading";
      const actions = row();
      const fetchButton = button("获取可用模型");
      const addButton = button("添加模型");
      const resetButton = button("恢复在线目录");
      resetButton.classList.add("wb-button-quiet");
      const saveButton = button("保存模型");
      saveButton.classList.add("wb-button-primary");
      const list = document.createElement("div");
      const candidates = document.createElement("div");
      candidates.className = "wb-model-candidates";
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      Object.assign(host.style, { display: "flex", flexDirection: "column", gap: "10px", width: "100%" });
      Object.assign(list.style, { display: "flex", flexDirection: "column", gap: "8px" });
      Object.assign(message.style, { fontSize: "12px", minHeight: "18px" });
      actions.append(fetchButton, addButton, resetButton, saveButton);
      host.append(heading, actions, list, candidates, message);
      let models = null;
      let revision;
      let busy = false;
      const invalidReasoning = new Set();
      const say = (value, error = false) => {
        message.textContent = value;
        message.style.color = error ? "var(--dsw-text-danger, #c62828)" : "var(--dsw-text-secondary, #667085)";
      };
      const setBusy = (value) => {
        busy = value;
        for (const control of [fetchButton, addButton, resetButton, saveButton]) control.disabled = value;
      };
      const makeInput = (value, label, onChange, type = "text") => {
        const input = textInput(type, label, label);
        input.value = value ?? "";
        input.title = label;
        input.addEventListener("input", () => onChange(input.value));
        return input;
      };
      const render = () => {
        list.replaceChildren();
        if (models === null) {
          const hint = document.createElement("span");
          hint.textContent = "使用当前账号的在线模型目录；获取后可选择模型进行自定义。";
          list.append(hint);
          return;
        }
        for (const [index, model] of models.entries()) {
          const item = section();
          item.classList.add("wb-model-card");
          const modelHeading = document.createElement("strong");
          modelHeading.className = "wb-model-card-heading";
          modelHeading.textContent = "模型 " + String(index + 1).padStart(2, "0");
          item.append(modelHeading);
          const fields = row();
          fields.className = "wb-model-fields";
          const id = makeInput(model.id, "模型 ID", (value) => { model.id = value.trim(); });
          const name = makeInput(model.name, "显示名称", (value) => { model.name = value; });
          const context = makeInput(model.contextWindow, "上下文窗口", (value) => {
            if (value) model.contextWindow = Number(value);
            else delete model.contextWindow;
          }, "number");
          const output = makeInput(model.maxTokens, "最大输出 Token", (value) => {
            if (value) model.maxTokens = Number(value);
            else delete model.maxTokens;
          }, "number");
          for (const input of [id, name, context, output]) {
            input.style.flex = "1 1 140px";
            const field = document.createElement("label"), label = document.createElement("span");
            field.className = "wb-model-field";
            label.textContent = input.getAttribute("aria-label");
            field.append(label, input);
            fields.append(field);
          }
          const imageLabel = document.createElement("label");
          const images = document.createElement("input");
          images.type = "checkbox";
          images.checked = model.input?.includes("image") === true;
          images.addEventListener("change", () => { model.input = images.checked ? ["text", "image"] : ["text"]; });
          imageLabel.append(images, " 图片输入");
          const remove = button("删除");
          remove.classList.add("wb-button-danger");
          remove.addEventListener("click", () => { invalidReasoning.delete(model); models.splice(index, 1); render(); });
          fields.append(imageLabel, remove);
          item.append(fields);
          if (model.reasoningEfforts !== undefined) {
            const thinking = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "模型思考档位";
            const editor = document.createElement("textarea");
            editor.setAttribute("aria-label", `${model.id} 思考档位 JSON`);
            editor.value = JSON.stringify(model.reasoningEfforts);
            editor.style.width = "100%";
            editor.addEventListener("change", () => {
              try {
                const value = JSON.parse(editor.value);
                if (value !== false && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error();
                model.reasoningEfforts = value;
                invalidReasoning.delete(model);
                say("");
              } catch { invalidReasoning.add(model); say("思考档位 JSON 格式无效", true); }
            });
            thinking.append(summary, editor);
            item.append(thinking);
          }
          list.append(item);
        }
      };
      fetch(`${ROUTE}/models`, { cache: "no-store" })
        .then((response) => response.json())
        .then((state) => {
          if (!state.ok) throw new Error(state.message);
          models = state.models?.map((model) => ({ ...model })) ?? null;
          revision = state.revision;
          render();
        })
        .catch((error) => say(error instanceof Error ? error.message : "读取模型失败", true));
      addButton.addEventListener("click", () => {
        models ??= [];
        models.push({ id: "", name: "" });
        render();
        list.lastElementChild?.querySelector('input[aria-label="模型 ID"]')?.focus();
      });
      fetchButton.addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        say("正在获取模型…");
        try {
          const result = await request("models", { action: "discover" });
          candidates.replaceChildren();
          const choices = result.models.filter((model) => !models?.some((existing) => existing.id === model.id));
          if (!choices.length) return say("没有新的可用模型");
          const selected = new Set();
          for (const model of choices) {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.addEventListener("change", () => checkbox.checked ? selected.add(model.id) : selected.delete(model.id));
            label.append(checkbox, ` ${model.name || model.id} (${model.id})`);
            Object.assign(label.style, { display: "block", fontSize: "13px" });
            candidates.append(label);
          }
          const addSelected = button("添加选中模型");
          addSelected.addEventListener("click", () => {
            models ??= [];
            models.push(...choices.filter((model) => selected.has(model.id)).map((model) => ({ ...model })));
            candidates.replaceChildren();
            render();
          });
          candidates.append(addSelected);
          say(`获取到 ${result.models.length} 个模型，请选择后保存`);
        } catch (error) { say(error instanceof Error ? error.message : "获取模型失败", true); }
        finally { setBusy(false); }
      });
      saveButton.addEventListener("click", async () => {
        if (busy || models === null) return;
        if (invalidReasoning.size) return say("请先修正模型思考档位 JSON", true);
        if (models.some((model) => !model.id || !Number.isSafeInteger(model.contextWindow ?? 1)
          || !Number.isSafeInteger(model.maxTokens ?? 1))) return say("请检查模型 ID 和 Token 数值", true);
        setBusy(true);
        try {
          const result = await request("models", { action: "save", models, revision });
          revision = result.revision;
          say("模型已保存");
        } catch (error) { say(error instanceof Error ? error.message : "保存模型失败", true); }
        finally { setBusy(false); }
      });
      resetButton.addEventListener("click", async () => {
        if (busy || !window.confirm("恢复在线模型目录？自定义模型列表会被移除。")) return;
        setBusy(true);
        try {
          const result = await request("models", { action: "reset", revision });
          models = null;
          revision = result.revision;
          candidates.replaceChildren();
          render();
          say("已恢复在线模型目录");
        } catch (error) { say(error instanceof Error ? error.message : "恢复失败", true); }
        finally { setBusy(false); }
      });
      render();
    }

    function WorkBuddySettingsCard({ provider, embedded = false }) {
      const root = useRef(null);
      useEffect(() => {
        if (provider?.provider !== "workbuddy-cn" || !root.current) return;
        const host = root.current;
        const field = section();
        field.classList.add("wb-settings-surface");
        const input = document.createElement("input");
        input.setAttribute("aria-label", "API 密钥");
        field.append(input);
        host.append(field);
        mount(input);
        const models = section();
        host.append(models);
        mountModelEditor(models);
        const scope = embedded ? null : host.closest("li") ?? host.closest('[role="tabpanel"]') ?? host.closest('[class*="_addPanel"]');
        const hidden = new Map();
        const hideNative = () => {
          if (!scope) return;
          for (const node of scope.querySelectorAll('[class*="_editor"], [class*="_rowActions"]')) {
            if (node.contains(host) || host.contains(node) || hidden.has(node)) continue;
            hidden.set(node, {
              hidden: node.hidden,
              display: node.style.getPropertyValue("display"),
              priority: node.style.getPropertyPriority("display"),
            });
            node.hidden = true;
            node.style.setProperty("display", "none", "important");
          }
        };
        const observer = scope ? new MutationObserver(hideNative) : undefined;
        observer?.observe(scope, { childList: true, subtree: true });
        hideNative();
        return () => {
          observer?.disconnect();
          for (const [node, previous] of hidden) {
            node.hidden = previous.hidden;
            if (previous.display) node.style.setProperty("display", previous.display, previous.priority);
            else node.style.removeProperty("display");
          }
        };
      }, [provider?.provider]);
      return provider?.provider === "workbuddy-cn"
        ? createElement("div", { ref: root, "data-workbuddy-settings-card": "" })
        : null;
    }

    function WorkBuddyPluginDetails({ subject }) {
      return subject?.kind === "bundle" && subject.pkg?.name === "@axiaohungry/dsh-llm-workbuddy"
        ? createElement(WorkBuddySettingsCard, { provider: { provider: "workbuddy-cn" }, embedded: true })
        : null;
    }

    function enhance() {
      for (const input of document.querySelectorAll('input[aria-label="API 密钥"]')) {
        if (isWorkBuddy(input)) mount(input);
      }
      mountPendingSelector();
    }

    function apply(ctx) {
      installComposerDockLayout();
      installAccountVisualStyles();
      ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
        name: "settings.models.provider-card",
        key: "llm-workbuddy",
      }, WorkBuddySettingsCard));
      ctx.slots.inject("plugins.detail.section", () => ctx.slots.register({
        name: "plugins.detail.section",
        id: "llm-workbuddy",
      }, WorkBuddyPluginDetails));
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
