# 钢琴谱面与基础输入

Status: resolved
Type: task
Blocked by: 02

## 目标

将独立音乐核心接入桌面界面，先打通新建、谱面显示、基础输入、修改和撤销/重做，为连续输入体验建立可操作基础。

## 范围

- 为钢琴乐谱提供编辑界面、谱表/声部选择、时值选择和当前输入位置反馈。
- 建立核心音乐内容到候选 Verovio 输入的适配，保留事件和和弦音符标识；布局不得成为音乐数据源。
- 为输入中的空白声部和小节提供明确的临时显示策略；临时显示内容不污染原生文件。
- 鼠标选择已有音符、基础键盘输入与修改、删除、撤销/重做都通过核心命令完成。
- 展示正在使用的输入模式、谱表/声部、时值和选中对象；错误清晰反馈，焦点在输入框时快捷键不误操作乐谱。
- 保持上下文隔离和窄 preload 接口；模型服务配置未提供时继续本地编辑工作。

## 验收

- 在真实 Electron 中完成新建钢琴谱、输入音符/和弦/休止、修改、删除、撤销与重做。
- 音乐编辑后排版更新，选择和音乐对象映射可以验证，修饰记号与空白位置输入逐步扩展。
- 候选引擎能离线运行，资源打包与错误处理明确；记录尚未覆盖的输入和记号。
- 提供界面截图、核心/交互验证结果及 pnpm 复现命令。

## Comments

- 依赖任务 02 已完成的音乐核心。MusicXML 交换、正式文件读写/恢复、播放和 AI 识谱分别按后续阶段接入。
- 正式引擎锁定仍需真实曲目与分发许可核查，不以最小编辑闭环替代完整排版验收。

## Answer

- 已实现 `src/editor/session.ts`：输入光标、模式、声部、八度、和弦音选择和核心命令桥接，独立于 React。新增小节与首个输入是同一撤销事务；空缺声部在插入时按需建立。
- 已实现 `src/notation/`：原生模型转 MEI、准确补齐临时显示休止、稳定 SVG 事件/音符映射、自然音还原号与多声部变音上下文。临时提示不进入音乐数据。
- Verovio 6.3.0 WASM 随本地 Worker 打包，严格 CSP 仅新增 `wasm-unsafe-eval` 与本地 Worker 许可。Worker 结果按请求版本丢弃过期映射，失败可重新启动；preload 仍只暴露应用信息。
- 编辑界面支持新建/原创示例、声部与时值选择、附点/三连音、A–G 输入、Shift 和弦音、R 休止、鼠标及方向键选择、音高/变音与显式时值修改、删除、撤销/重做。标题输入与确认弹窗保持快捷键隔离。
- 验证：`pnpm test` 50 个测试通过；`pnpm run lint`、`pnpm run typecheck`、`pnpm run format:check`、`pnpm run test:e2e` 通过。实际开发 Electron 中的本地 Worker 与键盘重排通过。macOS arm64 未签名应用目录打包后，同一套 2 个桌面测试通过；编辑测试将 renderer 设为断网，覆盖新建、低音谱表三连音、和弦修改、删除与撤销重做。
- 截图：`logs/editor-preview.png`（忽略的本地产物）；操作说明见根 `README.md`。

### 复现打包验证

```bash
pnpm run build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --config.electronDist=node_modules/electron/dist
NOTERA_EXECUTABLE_PATH="$PWD/dist/mac-arm64/Notera.app/Contents/MacOS/Notera" pnpm exec playwright test
```

### 边界

- 文件仍在内存，退出尚无保存/恢复；下一阶段为 [任务 05](05-native-file-persistence.md)。
- 支持显示既有延音线、连奏线、力度、踏板与重复；这些记号的创建、联合修改和高级排版控制尚未接入。单端延音线音高或时值修改可能被核心拒绝。
- 不自动切分跨小节事件或移动后续事件；连梁、明确连音组、跨谱表输入、弱起、缩放、播放、导出和完整 MusicXML 交换仍待后续实现。
- 固定纸张范围的自动排版只验证了当前原创谱例。真实曲目质量、引擎正式选择、LGPL 分发材料与发布签名仍需后续核查。本地产物尚非正式发行包。
- 构建有 Zod 注释与 Verovio 浏览器分支的第三方警告；真实开发、生产和打包 renderer 的 WASM 路径均运行通过。
