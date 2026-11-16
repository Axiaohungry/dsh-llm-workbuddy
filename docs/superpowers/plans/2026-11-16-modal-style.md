# Modal Style Implementation Plan

**Goal:** 统一插件字体、控件与信息层级，适配窄弹窗，保留现有业务行为。
**Architecture:** 复用 client.js DOM 组件和主题变量，以命名容器查询响应弹窗内部宽度；仅调整布局、语义分组和样式。
**Tech Stack:** 原生 DOM/CSS，container queries；无新依赖。
**Spec:** 当前会话确认范围：统一字体；小弹窗友好；按认证→账号→统计→模型目录排列。

## Global Constraints
保留账号与用量默认折叠、全 DSH 统计口径、现有凭据及调用链、1.5.0 版本；不发布或提交。
## Review Focus
大视口内窄弹窗；长模型和账号名称；API Key/令牌两种状态；空列表；模型添加及保存反馈；键盘焦点和浅深主题。

- [x] 在 client.js 中统一字体尺寸、间距和 box-sizing；增加明确的字段/工具栏类，使用按容器宽度的布局。
- [x] 调整模型编辑操作分组、保存位置，保留已有事件和状态处理。
- [x] 在隔离的真实组件弹窗中验证 360/420/560/760px 宽度、长名称、折叠/展开、两种认证和模型编辑；统计使用真实只读数据。
- [x] 检查语法/现有检查、打本机包并对比安装文件；README 补充，未验证真实宿主重启。

## Verification evidence
- 62 checks and CLI self-test passed.
- Dialog widths 360/420/560/760px within a 1280px viewport: outer content did not overflow horizontally; chart/table scroll is contained.
- Real component fixture: long account/model labels, both authentication modes, default accordions, empty states, model add/edit/delete/save, light/dark theme verified. Account/model operations use only fixture memory.
- Local 1.5.0 package installed and runtime files byte-matched; other plugin dependencies/bundles and transitive package versions preserved.
- Real DSH post-restart acceptance remains unverified; no app restart, Git submission or npm publication performed.
