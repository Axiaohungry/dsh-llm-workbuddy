# DSH WorkBuddy Provider

为 DeepSeek Harness（DSH）增加 `WorkBuddy 中国区` Provider。插件通过
WorkBuddy 提供的 API Key，或 WorkBuddy 中国站的网页登录令牌调用模型，并在
DSH WebUI 中管理模型和认证方式。

> [!IMPORTANT]
> API Key 来自 **WorkBuddy**，用于调用供 WorkBuddy 使用的模型服务。本插件是第三方
> 适配器，不属于 WorkBuddy、WorkBuddy 或 DSH 官方项目。

## 功能

- 在 DSH WebUI 中使用 `WorkBuddy 中国区`；
- 支持 WorkBuddy API Key 和 WorkBuddy 中国站账号令牌；
- 两种认证模式互相独立，可以随时切换；
- API Key 支持环境变量、多个 DSH 保存值，并可通过下拉列表切换；
- 令牌支持浏览器登录、多个账号持久化、账号名称展示和下拉切换；
- 令牌模式显示剩余积分、今日请求次数和今日积分用量；
- 自动兼容 `modlens-workbuddy-cn` 等带有 WorkBuddy/CodeBuddy 标识的包装 Provider；
- 用量信息与 DSH 的 Token/缓存统计显示在输入框底部同一行；
- 自动从 WorkBuddy 获取当前账号可用模型；
- 支持编辑模型 ID、名称、上下文窗口、最大输出 Token 和模型思考档位；
- 支持添加、删除模型以及恢复在线模型目录；
- 不依赖本机 WorkBuddy CLI。

## 环境要求

- 已安装 DSH；
- Node.js `>= 22.19.0`；
- Windows、Linux 或 macOS。

插件 `1.3.7` 及以上版本要求 DSH `>= 0.1.2-alpha.2`。`1.3.9` 起兼容新版 DSH
的 settings 注册接口。该版本不再携带旧版 DSH
运行时副本，而是复用宿主 DSH 的运行时，避免更新 DSH 后出现 Provider 目录接口
（`llm/listProviders`）不兼容。`1.3.10` 起，WorkBuddy 认证助手同时兼容新旧 DSH
的 `signal` 调用约定。升级插件后请重新安装一次并重启 DSH。

## 安装

在 PowerShell 或终端执行：

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest install
```

安装器会为 DSH 的 `web` 和 `headless` Profile 安装插件。安装完成后重启 DSH。
只使用 WebUI 时，也可以单独安装 Web Profile：

```powershell
dsh plugin --profile web add @axiaohungry/dsh-llm-workbuddy@latest
```

### 从旧版升级

插件 npm 包现在是 `@axiaohungry/dsh-llm-workbuddy`。重新执行上面的安装命令时，安装器会在
`web` 和 `headless` Profile 中自动移除旧包（包括 `dsh-llm-workbuddy` 和
`dsh-llm-codebuddy`），再安装新包；已有 Provider、模型、
API Key 和令牌凭据会保留。

新版本内部 Provider ID 为 `workbuddy-cn`。旧配置中的 `codebuddy-cn` 会在运行时兼容，并在
切换认证模式时迁移为新 ID。

## WebUI 配置

打开 **设置 → 模型**，添加或编辑 `WorkBuddy 中国区`。认证区域有两个模式按钮：

- `API Key`：只显示 API Key 来源和新增 Key 功能；
- `令牌登录`：只显示令牌账号、登录、切换以及账号用量信息。

切换模式后，另一种模式的账号或 Key 控件会隐藏，不会同时占用页面空间。

### 可选：会话级账号/API Key

认证区域提供“会话级账号/API Key”开关：

- **关闭（默认）**：保持旧版行为。所有会话共用模型设置中当前选中的全局账号或 API Key；
  不会改变已有配置和调用方式。
- **打开**：每个会话可以在输入框底部单独选择“令牌 / API Key”以及对应账号或 Key。切换
  当前会话的凭证不会修改其他会话，也不会中断已有会话上下文。

会话级绑定只保存会话 ID 与账号 ID/API Key 引用，不会把令牌或 API Key 写入会话路由配置。
关闭开关后，已保存的绑定会暂时停用；重新打开后会继续生效。新增或删除账号、Key 时，
对应的无效绑定会自动清理。

开启后，点击“新会话”时会在输入框上方显示“新会话默认凭证”，可以在发送第一条消息前
选择令牌账号或 API Key。此时 DSH 还没有 `sessionId`，插件会先保存最近一次选择；会话创建
后带有 `sessionId` 的首个请求会使用该默认凭证。已经有明确会话绑定的会话优先使用自己的绑定；
运行时请求如果缺少 `sessionId`，不会误用最近会话凭证，而是回退到全局认证配置。

模型目录仍由 DSH 统一管理，模型选择本身按会话保存。更换会话凭证后，如果该账号的模型
权限不同，请在模型设置中重新获取一次在线模型目录。

### 方式一：WorkBuddy API Key

#### 使用环境变量中的 Key

插件会自动检测：

```text
WORKBUDDY_API_KEY
```

如果这个环境变量存在，API Key 来源下拉列表会显示“环境变量 WORKBUDDY_API_KEY”。
选择它即可使用；密钥值不会显示在页面中，也不会写入 `settings.yaml`。

旧版插件使用的 `CODEBUDDY_API_KEY` 仍会作为兼容环境变量自动识别，但新配置建议统一使用
`WORKBUDDY_API_KEY`。

#### 在 DSH 中保存新的 Key

1. 选择 `API Key` 模式；
2. 在“新增 API Key”输入框粘贴 WorkBuddy Key；
3. 可填写一个名称，例如“工作账号”或“测试账号”；
4. 点击“添加并使用”；
5. 新 Key 会出现在“当前 API Key”下拉列表中，并立即切换为当前 Key。

DSH 保存的 Key 存放在 DSH 凭据服务中。可以保存多个 Key 并随时切换；环境变量 Key
和 DSH 保存的 Key 互不覆盖。删除操作只允许删除 DSH 保存的 Key，不会删除环境变量。

### 方式二：WorkBuddy 账号令牌

1. 选择 `令牌登录` 模式；
2. 点击“登录 WorkBuddy”，插件会打开 WorkBuddy 中国站；
3. 在浏览器完成账号登录；
4. 返回 DSH 后，账号会保存到本地凭据并自动启用。

再次打开页面时，可以在“令牌账号”下拉列表中切换账号。点击“添加账号”可以登录
另一个账号，点击“删除账号”会移除当前账号的本地令牌。令牌登录不需要安装
本机 WorkBuddy 命令行工具。

令牌模式下，插件会尝试显示：

- 剩余积分或企业账号的“不限量”；
- 今日请求次数；
- 今日请求消耗的积分。

积分接口属于 WorkBuddy 中国站的账号服务，仅令牌模式使用；API Key 模式不会调用该
接口。如果服务暂时不可用，页面会保留账号登录状态并显示“暂不可用”。

## 获取和编辑模型

1. 在 `WorkBuddy 中国区` 的自定义设置中点击“获取可用模型”；
2. 插件会使用当前选中的 API Key 或令牌请求 WorkBuddy 模型目录；
3. 选择要使用的模型并保存；
4. 再次编辑时，可以直接修改模型 ID、显示名称、上下文窗口和最大输出 Token。

模型目录按当前账号权限返回。更换 API Key 或令牌账号后，建议重新点击“获取可用模型”。
如果在线目录暂时失败，插件会使用内置目录作为兜底。

## 思考程度

思考档位按模型分别决定，插件不会给所有模型强行使用同一套选项。在线模型目录会声明
每个模型是否支持思考、支持哪些档位以及默认档位，WebUI 会据此显示可用选项。

常见档位包括：

```text
off / minimal / low / medium / high / xhigh / max
```

实际选项可能因模型不同而不同。未手动指定时，使用 WorkBuddy 返回的默认档位；服务端
没有声明思考能力时，插件不会额外发送思考参数。

## 认证和请求说明

- API Key 请求使用 WorkBuddy 的 OpenAI-compatible 接口；
- 令牌请求使用 WorkBuddy 中国站的登录令牌，并在过期前自动刷新；
- DSH 负责 Agent 循环、上下文、工具调用和权限；
- WorkBuddy 负责模型推理并返回结果；
- 访问令牌、刷新令牌和 DSH 保存的 API Key 不会写入模型目录或 `settings.yaml`。

## 更新

重新执行安装命令即可更新：

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest install
```

更新后重启 DSH。已有的模型配置、API Key 和登录令牌会保留。

## 卸载

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest uninstall
```

卸载会移除 `WorkBuddy 中国区` 的 Provider 和插件包，并备份 DSH 设置文件。为方便以后
重新安装，API Key 和登录令牌默认保留在 DSH 凭据服务中。

## 常见问题

### 看不到 WorkBuddy Provider

重启 DSH 后重新打开 **设置 → 模型**。也可以检查：

```powershell
dsh plugin --profile web list --depth 0
```

### API Key 下拉列表只有环境变量

不要使用 DSH 原生的旧密钥输入框提交。选择 `API Key` 模式，在插件自己的“新增 API Key”
区域粘贴 Key 并点击“添加并使用”。成功后新 Key 会出现在“当前 API Key”下拉列表。

### 获取模型失败

确认当前选中的 Key 来自 WorkBuddy 且仍然有效，或确认令牌账号登录状态正常。更换认证
凭据后重新获取模型目录。

### 令牌登录后没有积分

积分查询只支持令牌模式，并依赖 WorkBuddy 中国站 billing 接口。网络、账号类型或接口
暂时不可用时，页面会显示“暂不可用”，不影响模型调用。

用量栏会识别 `workbuddy` 或 `codebuddy` 词段的 Provider ID，因此通过 ModLens 等插件
包装的 Provider（例如 `modlens-workbuddy-cn`）也可以显示当前账号用量。

### 调用时报 `500 status code (no body)`

先更新插件并重启 DSH：

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest install
```

最新版会恢复 WorkBuddy 官方请求标识，兼容 API Key 和令牌模式。

### 修改后页面仍显示旧布局

浏览器执行 `Ctrl+F5` 强制刷新；如果 DSH 进程已经运行较久，再关闭并重新启动 DSH。

## License

[MIT](./LICENSE)
