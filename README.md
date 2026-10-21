# DSH WorkBuddy Provider

为 DeepSeek Harness（DSH）增加 `WorkBuddy 中国区` Provider。插件通过
WorkBuddy 提供的 API Key，或 WorkBuddy 中国站的网页登录令牌调用模型，并在
DSH WebUI 或桌面端中管理模型和认证方式。

> [!IMPORTANT]
> API Key 来自 **WorkBuddy**，用于调用供 WorkBuddy 使用的模型服务。本插件是第三方
> 适配器，不属于 WorkBuddy 或 DSH 官方项目。

## 功能

- 在 DSH WebUI 和桌面端使用 `WorkBuddy 中国区`；
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

插件兼容旧版 DSH 和 `0.1.7-rc.1`（`next`）的按插件条目管理配置方式。
旧版由插件接管 `llm-pi-ai`；`next` 保留内置 `llm-pi-ai` 处理自定义提供方，
WorkBuddy 使用自己的配置条目。升级后请完整退出并重新启动 DSH，再检查模型卡片与凭证模式。
`1.3.21` 适配桌面版 DSH `0.2.0-rc.2` 的模型调用、插件详情页认证设置和会话级凭证控件；
同时保留旧版 DSH 的适配器调用路径，以及 `web` / `headless` Profile 的安装方式。
桌面端已验证实际模型回复；旧版 Web/Headless 路径通过自动化检查，未在本次更新中重新实机调用。
桌面版同样保留内置 `llm-pi-ai`，由 WorkBuddy 插件使用自己的配置条目。
`1.3.22` 起，宿主版本声明覆盖 DSH `0.2.x` 系列（包含预发布版），避免每次小版本更新后
因写死单个版本号而被拒绝加载；`0.2.1-rc.2` 的宿主适配器已通过流式调用兼容检查。
旧版 Web/Headless 调用路径继续保留。版本范围不代表对未来接口变更的保证；升级到 `0.3.x`
等新系列时，需要重新核验兼容性。
在 `next` 上，命令行 `login` 只保存令牌；认证模式需在 WorkBuddy 模型卡片中选择
“令牌登录”，不会再写入旧版 `settings.yaml`。`next` 的模型页通过插件扩展位显示
WorkBuddy 专属认证与模型管理区域；旧版 DSH 继续使用原有编辑界面。

## 安装

在 PowerShell 或终端执行：

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest install
```

安装器会为 DSH 的 `web` 和 `headless` Profile 安装插件。安装完成后重启 DSH。
桌面端请在「设置 → 插件 → 添加插件」中安装 `@axiaohungry/dsh-llm-workbuddy`，
再打开该插件的详情页配置认证与模型；上面的命令行安装器不会安装到桌面 Profile。
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

## WebUI / 桌面端配置

打开 **设置 → 模型**。在 `next` 中，点击“添加模型提供商”，从“第三方模型提供商”
选择 `WorkBuddy 中国区`；已配置后直接编辑它的模型卡片。桌面版 `0.2.0-rc.2` 请在
「设置 → 插件」打开 WorkBuddy 插件详情页，使用其中的认证与模型管理区域；旧版 DSH
继续从提供方列表添加或编辑。认证区域有两个模式按钮：

- `API Key`：只显示 API Key 来源和新增 Key 功能；
- `令牌登录`：只显示令牌账号、登录、切换以及账号用量信息。

切换模式后，另一种模式的账号或 Key 控件会隐藏，不会同时占用页面空间。
会话输入框底部的账号/API Key 选择仅在开启下述“会话级账号/API Key”后显示；
令牌积分在令牌模式下显示，与该开关无关。API Key 模式不显示令牌积分。

### 可选：会话级账号/API Key

认证区域提供“会话级账号/API Key”开关：

- **关闭（默认）**：保持旧版行为。所有会话共用模型设置中当前选中的全局账号或 API Key；
  不会改变已有配置和调用方式。
- **打开**：模型设置中选择的账号或 API Key 作为未绑定会话的默认预选。每个会话也可以在
  输入框底部单独选择“令牌 / API Key”以及对应账号或 Key。切换当前会话的凭证不会修改
  其他会话，也不会中断已有会话上下文。

会话级绑定只保存会话 ID 与账号 ID/API Key 引用，不会把令牌或 API Key 写入会话路由配置。
关闭开关后，已保存的绑定会暂时停用；重新打开后会继续生效。新增或删除账号、Key 时，
对应的无效绑定会自动清理。

开启后，点击“新会话”时会在输入框上方显示“新会话默认凭证”，可以在发送第一条消息前
选择令牌账号或 API Key。新会话或历史未绑定会话第一次调用 WorkBuddy 模型时，插件会先把
当时的默认预选固化到该 `sessionId`，再发出模型请求。固化后，即使模型设置中的默认预选发生
变化，该会话仍继续使用自己的绑定；也可以在会话底部再次切换或解除绑定。解除后，下一次发送
会重新固化当时的默认预选。运行时请求如果缺少 `sessionId`，则使用原有全局认证配置。

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
2. 点击“令牌登录”（已有账号时为“添加账号”），插件会打开 WorkBuddy 中国站；
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

1. 在 `WorkBuddy 中国区` 的设置中点击“获取可用模型”；
2. 插件会使用当前选中的 API Key 或令牌请求 WorkBuddy 模型目录；
3. 选择要使用的模型，按需使用“添加模型”补充，然后点击“保存模型”；
4. 再次编辑时，可以直接修改模型 ID、显示名称、上下文窗口和最大输出 Token。

“恢复在线目录”会移除手工覆盖的模型列表，恢复按在线目录读取。获取在线模型后，
若要固定当前选择或编辑结果，仍需点击“保存模型”。

模型目录按当前账号权限返回。更换 API Key 或令牌账号后，建议重新点击“获取可用模型”。
如果在线目录暂时失败，插件会使用内置目录作为兜底。
在 headless 模式指定内置目录尚未收录的 WorkBuddy 模型时，插件会在调用前查询当前
凭证可用的在线模型目录；模型仍不存在或查询失败时会明确报错。若在配置中手动指定了
模型列表，请把要使用的模型 ID 也加入该列表。

旧版 DSH 中，插件接管 `llm-pi-ai` 后也负责自定义 OpenAI Completions、OpenAI Responses
和 Anthropic Messages 提供方的模型探测；`next` 则保留 DSH 内置的自定义提供方页面与
探测器。两种方式都会请求已配置的模型端点；服务未提供标准目录时，可手工填写模型 ID。

## ModLens 兼容性

插件兼容 `modlens-workbuddy-cn`、`modlens-codebuddy-cn` 等包装 Provider。包装 Provider
会先由 ModLens 处理图片，再把请求转发给 WorkBuddy，因此它不是另一个 WorkBuddy 账号：

- 会话历史中有图片时，首次响应可能比 WorkBuddy 直连慢；旧会话中的历史图片也可能再次参与处理；
- 超时、无响应或 `429`/“配额耗尽”通常来自 ModLens 的视觉引擎，不代表 WorkBuddy 令牌或 API Key 失效；
- 纯文本任务可切换到 `workbuddy-cn/<model-id>`，绕过视觉桥接；
- WorkBuddy 的令牌积分和请求量与 ModLens 视觉引擎额度相互独立，插件不会混合统计。
- ModLens 会保留原始 `sessionId`，因此与 WorkBuddy 直连使用同一套会话凭证固化和切换规则。

遇到包装模型异常时，可运行 ModLens 提供的诊断命令检查视觉引擎状态：

```powershell
modlens doctor --json
```

如果纯文本直连正常、而带历史图片的请求变慢或失败，优先检查 ModLens 的视觉引擎登录状态、网络
和额度；切换 WorkBuddy 账号不会恢复已经耗尽的视觉引擎配额。

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
凭据后重新获取模型目录。如果出现 `Unexpected end of JSON input`、空响应或模型页接口
`404`，请先完整退出并重新启动 DSH，再刷新页面；只刷新浏览器不会更新正在运行的后端插件。
若返回 `401` 或 `403`，则检查当前凭证及该账号的模型权限。

### 请求卡住或超时

插件会在 DSH 日志中记录不含密钥、令牌和消息内容的请求阶段：认证、HTTP 响应头、
首个模型事件、完成或取消。可用同一请求编号判断停在认证、连接还是生成阶段；
若使用 ModLens 包装 Provider，还应单独检查其视觉引擎状态与额度。

### 令牌登录后没有积分

积分查询只支持令牌模式，并依赖 WorkBuddy 中国站 billing 接口。网络、账号类型或接口
暂时不可用时，页面会显示“暂不可用”，不影响模型调用。

用量栏会识别 `workbuddy` 或 `codebuddy` 词段的 Provider ID，因此通过 ModLens 等插件
包装的 Provider（例如 `modlens-workbuddy-cn`）也可以显示当前账号用量。

### 调用时报 `400` / `11128`：1.3.25 修复说明

`11128`（或 `11-128`）是上游的渠道校验错误。历史会话先前成功，不能说明后续请求
一定仍会被接受；新增的上下文或上游规则调整都可能改变结果。本次无法确定上游规则
生效的准确时间，但通过同一凭据、端点和模型的对照请求，定位了可复现条件。

#### 根因与对照证据

`1.3.23` 仅处理开头的客户端身份介绍句，遗漏了 system/developer 中其余运行环境说明：

```text
You are interacting with the user through the DeepSeek Harness Web GUI…
The runtime context names the DeepSeek Harness implementation checkout…
```

2026-10-21 对照结果：

| 请求条件 | 结果 |
| --- | --- |
| 最小文本、单图请求，使用旧版或新版请求头 | 均成功 |
| 历史请求结构，仅更换 User-Agent、补充 IDE/Agent/会话追踪头 | 400 / 11128 |
| 历史请求结构，移除全部图片但保留原 system | 400 / 11128 |
| 仅保留历史 system 和简短用户消息 | 400 / 11128 |
| 仅调整 system 中遗留的宿主名称，其余历史内容保留 | 200，SSE 正常结束 |
| 最终插件处理后的历史结构回放 | 200，SSE 正常结束 |

因此，升级 User-Agent、换 Key、清空图片都不是这次问题的充分修复。
这是当前实验的结论，不代表所有 `11128` 都由同一个原因触发。

#### 1.3.25 的具体改动

1. **出站指令身份统一。** 对 system/developer 中匹配的身份介绍句使用
   `You are CodeBuddy, an AI coding assistant.`，并将其中的 `DeepSeek Harness`
   名称替换为 `CodeBuddy`。支持字符串和文本块数组。
2. **客户端头统一。** 模型推理、模型发现、登录和令牌刷新复用同一套
   CodeBuddy 客户端头；推理请求在最终 `fetch` 边界再次处理，避免 SDK 覆盖。
3. **清除 SDK 自动标识。** 推理出站移除 `X-Stainless-*` 头，保留认证和其他协议字段。
4. **API Key 双认证头。** API Key 模式同时发送 `X-API-Key` 与 `Authorization: Bearer`；
   登录令牌模式保持 Bearer，不把登录令牌复制成 API Key。
5. **保留系统提示词和工具。** 旧 DSH 适配器可能仍提供 `Context.systemPrompt`
   和 `Context.tools`；调用新版 pi-ai 的底层 API 前，复用其 `normalizeContext()`
   转成消息中的系统指令和工具定义，避免请求成功却遗漏这些内容。

客户端头基线来自 CodeBuddy `2.171.0`：

```http
User-Agent: CLI/2.171.0 CodeBuddy/2.171.0
X-Product: SaaS
X-IDE-Type: CLI
X-IDE-Name: CodeBuddy
X-IDE-Version: 2.171.0
```

模型配置使用 `GET https://copilot.tencent.com/v3/config`；
推理使用 `POST https://copilot.tencent.com/v2/chat/completions` 和 `stream: true`。
配置地址不是推理 Base URL。本次非流式试验返回 `11101`，与 `11128` 不同。

#### 处理边界

- 本地界面、Provider ID、凭据引用、账号与会话绑定不因身份兼容处理而改名。
- 用户消息、助手历史、工具参数/返回值、图片和本地会话文件不改写。
- 真实文件路径和业务文本可能体现实际运行环境；不承诺整个请求不可识别。
- 积分查询保留 CodeBuddy 网站的 Web 协议；通用第三方 Provider 不套用这套处理。
- 不额外复制官方 Agent/会话追踪字段，不对 `400` 进行自动重试。
- 此兼容实现基于本次检查与测试，不是上游对第三方客户端或未来版本的兼容承诺。

#### 验证结果

- `npm run check`：语法检查、42 项测试及 `CLI-SELF-TEST-OK` 通过。
- 测试覆盖出站身份、最终请求头、认证区别、原对象不变、重复处理幂等性及错误脱敏。
- 强化适配器测试：明确断言 HTTP 请求里存在系统身份说明和工具定义。
- 真实适配器调用：核对出站 CodeBuddy 身份、客户端头、双认证头及工具定义，
  收到 HTTP 200、文本输出和 `finish=stop`。
- 历史结构回放：约 5.5 MB、840 条消息、57 个工具、21 条图片消息，返回 200。
  回放由导出事件重建，角色/图片转接、输出上限与思考档位有所调整，
  **不是原始线上 HTTP 的逐字节录制**。

上述真实验证主要覆盖中国区 `deepseek-v4.1-flash` 的 API Key 路径；
登录/刷新与积分分支有自动化覆盖，本次没有重新进行全部账号、模型和 ModLens 的实网验收。

#### 更新、生效与回退

桌面 profile 更新：

```powershell
dsh plugin --profile desktop add @axiaohungry/dsh-llm-workbuddy@1.3.25
dsh plugin --profile desktop list --depth 0
```

Web profile 将 `desktop` 换为 `web`。也可以使用本文前面的安装器。
更新后需**完整退出并重新启动 DSH**，只刷新页面不会重载后端插件。
账号、Key 和绑定配置可继续使用，不需要为这次修复清空历史会话。

如需回退，可指定先前版本重新安装并重启，例如：

```powershell
dsh plugin --profile desktop add @axiaohungry/dsh-llm-workbuddy@1.3.23
```

回退会同时恢复该版本的旧行为，可能重新触发本次 `11128`，不会解决上游校验变化。

若仍然失败，先记录 HTTP 状态、业务码、插件版本、直连或包装 Provider，
以及错误发生在文本还是图片/工具结果之后。日志中的数字业务码可用于定位，
不要公开 Key、Token、完整敏感请求或未经脱敏的会话导出。
`400` 不一定是渠道问题；业务码不同时应按实际错误排查。

详细调用链与实验边界见
[CodeBuddy 调用方式与渠道兼容分析](./docs/2026-10-21-codebuddy-channel-analysis.md)。

### 调用时报 `500 status code (no body)`

先更新插件并重启 DSH：

```powershell
npx --yes @axiaohungry/dsh-llm-workbuddy@latest install
```

最新版会恢复 WorkBuddy 官方请求标识，兼容 API Key 和令牌模式。

### 修改后页面仍显示旧布局

完整退出并重新启动 DSH，再在浏览器执行 `Ctrl+F5` 强制刷新。

## License

[MIT](./LICENSE)
