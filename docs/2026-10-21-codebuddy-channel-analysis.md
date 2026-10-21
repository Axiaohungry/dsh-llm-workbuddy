---
tags: [DSH, CodeBuddy, WorkBuddy, API]
date: 2026-10-21
source: CodeBuddy 2.171.0 安装包源码、脱敏日志与真实接口对照
---

# CodeBuddy 调用方式与渠道兼容分析（1.3.25）

## 结论

本次可复现的渠道错误与 system prompt 中的客户端运行环境说明有关。
相同凭据、端点和模型下，仅更换新版请求头仍返回 11128；调整指令中的宿主名称即可成功。
无法据此确定上游何时改变规则，也不能将所有 11128 归为同一原因。

最终实现、安装方法和完整验证矩阵见 [README 的 1.3.25 修复说明](../README.md)。
README 中的标题可直接通过页面目录定位。

## 取证来源和调用链

检查对象为 npm 包 `@tencent-ai/codebuddy-code@2.171.0`，
重点为 `dist/codebuddy-headless.js` 的 ModelProvider 请求构建、
`getCustomHeaders()`、登录与认证路径，以及官方客户端成功日志。
诊断过程没有输出或写入凭据值；公开文档不附个人路径、会话 ID 或原始业务日志。

| 项目 | 当前源码/日志表现 |
| --- | --- |
| 模型配置 | GET https://copilot.tencent.com/v3/config |
| 推理接口 | POST https://copilot.tencent.com/v2/chat/completions |
| 协议 | OpenAI Chat Completions 结构，stream=true，返回 SSE |
| API Key | 读取配置/环境中的 Key，同时设置 X-API-Key 和 Authorization: Bearer |
| 登录令牌 | 使用账号 session 的 accessToken，与 API Key 是不同凭证路径 |
| User-Agent | CLI/2.171.0 CodeBuddy/2.171.0 |
| 产品 | X-Product: SaaS |
| IDE 信息 | X-IDE-Type、X-IDE-Name、X-IDE-Version |
| Agent 信息 | X-Agent-Type、X-Agent-Intent、X-Agent-Runtime 等 |
| 会话追踪 | X-Conversation-ID、X-Conversation-Request-ID、X-Conversation-Message-ID、X-Request-ID |
| 请求体 | model、messages、tools、stream、reasoning_effort，另有条件性缓存等字段 |

Agent 和会话追踪头描述官方客户端行为，不意味着插件必须全部复制。
本次补齐这些头没有单独解决原请求失败，因此没有添加未经证明必要的追踪字段。

官方 CLI 的中国版 API Key 要求 `CODEBUDDY_INTERNET_ENVIRONMENT=internal`；
本插件通过中国区固定 URL 路由，不改写机器环境变量。
参考：[身份和访问管理](https://www.codebuddy.cn/docs/cli/iam)、
[环境变量参考](https://www.codebuddy.cn/docs/cli/env-vars)。

## 实验与推断边界

历史会话报错前能持续生成工具调用，失败紧接一次图片工具结果。
但移除图片仍失败、同一张图片的最小请求却成功，因此不能将图片相邻发生当作图片根因。

同一 system prompt 的最小请求也会返回 11128，调整客户端身份说明后成功。
这提供了内容相关的直接对照证据，而不是只根据错误文案推测认证变化。

完整历史结构回放约 5.5 MB，包含 840 条 OpenAI 消息、57 个工具和 21 条图片消息。
它来自导出事件的重建；图片转接消息、角色映射、输出上限和思考档位经过诊断处理。
模型返回的工具调用不会被执行。该实验不等同于原始 HTTP 的逐字节回放。

## 系统指令和工具定义的兼容性

工作区旧版 DSH 适配器使用 `Context.systemPrompt` 和 `Context.tools`。
新版 pi-ai 底层 API 使用归一化后的 transcript。
仅观察到模型返回文本不足以证明系统说明、权限指令或工具定义真的被发送。

本次通过加强测试先复现遗漏，然后在 WorkBuddy API 包装入口复用 pi-ai 的
`normalizeContext()`。已归一化的消息不会重复添加旧字段。
最终实网验收在 HTTP 边界断言系统身份说明、客户端头、认证头和工具定义，
再检查响应 200、文本输出与正常结束。

## 保留范围与风险

处理仅覆盖 WorkBuddy/CodeBuddy 中国区的插件出站客户端身份。
本地界面、Provider ID、凭据引用、历史消息、图片和真实路径保留；
通用第三方 Provider 不套用该处理。
本地业务内容仍可能体现真实环境，不承诺请求无法被识别来源。

API Key 路径已做真实接口验证；令牌刷新等分支使用自动化测试，
本次未重新完成所有账号、模型和包装 Provider 的实网测试。
后续上游规则改变时，应重新做最小差异对照，不应盲目替换更多业务文本。
