# Notera

基于 Electron、Vite、React、TypeScript 和 shadcn/ui 的桌面乐谱应用。
[首版范围](.scratch/notera/spec.md)已确认；独立音乐核心与基础钢琴谱编辑界面已完成。支持离线自动排版、音符/和弦/休止输入、修改与撤销、原生文件打开/保存、异常退出恢复及 MusicXML/MXL 交换。现已支持离线钢琴试听、谱面跟随与五线谱 PDF 导出，简谱及 AI 识谱尚未接入。

## 环境

- Node.js 22.13+（22.x）或 24+，建议 Node.js 24 LTS
- pnpm 11.8.0（版本固定在 `package.json`）

## 开发

项目使用 pnpm，提交 `pnpm-lock.yaml`。`pnpm-workspace.yaml` 仅配置当前单包项目的依赖布局与构建脚本许可。

依赖安装会通过 `postinstall` 下载 Electron 运行时，需要访问其发布下载地址。

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

React 界面支持热更新，preload 修改会重新加载窗口。修改 Electron 主进程后重启开发命令。

## 命令

| 命令                          | 用途                                       |
| ----------------------------- | ------------------------------------------ |
| `pnpm run dev`                | 启动 Vite 与 Electron                      |
| `pnpm run build`              | 类型检查并构建到 `out/`                    |
| `pnpm start`                  | 运行已构建的桌面应用                       |
| `pnpm run lint`               | ESLint 检查                                |
| `pnpm run typecheck`          | 检查主进程与界面类型                       |
| `pnpm run format:check`       | Prettier 格式检查                          |
| `pnpm run format`             | 格式化文件                                 |
| `pnpm test`                   | 运行音乐核心等 Vitest 单元测试             |
| `pnpm run test:e2e`           | 构建并启动真实 Electron，验证编辑与 IPC    |
| `pnpm run benchmark:notation` | 运行离线排版基准，生成 SVG、截图与测量结果 |
| `pnpm run package`            | 构建并生成当前平台的应用目录               |
| `pnpm run dist`               | 构建并生成当前平台安装包                   |

桌面测试需要可用的图形环境；Linux CI 可使用 `xvfb-run pnpm run test:e2e`。
可通过 `NOTERA_EXECUTABLE_PATH` 对已打包应用运行同一套冒烟测试，例如 macOS：

```bash
NOTERA_EXECUTABLE_PATH="$PWD/dist/mac-arm64/Notera.app/Contents/MacOS/Notera" pnpm exec playwright test
```

安装包配置为 macOS DMG、Windows NSIS、Linux AppImage。发布签名、更新与各平台发行验证将在发布阶段配置。

## 目录

```text
src/
  main/       Electron 生命周期、文件读写、恢复与 IPC
  preload/    暴露给界面的最小类型化 API
  renderer/   React 界面、shadcn/ui 组件和样式
  shared/     主进程和界面共用的类型与 IPC 定义
  core/       乐谱模型、校验、编辑事务与文件编解码
  editor/     输入会话、音乐光标与选择
  notation/   MEI 适配、SVG 映射与离线 WASM Worker
  exchange/   独立 MusicXML/MXL 转换、身份与损失报告
  playback/   精确演奏时间线、可取消调度与本地钢琴音色
  assets/     原创钢琴示例与附许可的本地钢琴采样
tests/
  e2e/        桌面启动与 IPC 冒烟测试
  fixtures/   原生钢琴谱等音乐测试文件
```

渲染进程启用隔离与沙箱，通过 `window.notera` 调用指定功能，不直接访问 Node.js 或任意 IPC 通道。
乐谱采用独立、带版本号的 JSON 格式。主进程通过原生对话框选择文件，并执行校验和临时文件替换保存。模型规则与使用示例见 [音乐核心说明](src/core/README.md)。

本地任务规范见 `docs/agents/issue-tracker.md`，贡献规则见 `AGENTS.md`。

## 基础钢琴编辑

启动后先点击谱面，再用键盘输入。工具栏选择输入时值、附点和三连音；左侧选择谱表/声部与八度。

| 操作                 | 作用                                          |
| -------------------- | --------------------------------------------- |
| `A–G`                | 输入音名；选择模式下修改所选音                |
| `Shift + A–G`        | 为所选事件添加和弦音                          |
| `R`                  | 输入休止符                                    |
| `N`                  | 切换输入/选择模式；继续输入从所选事件之后开始 |
| `← / →`              | 选择同声部的前后事件                          |
| `↑ / ↓`              | 按谱线音级移动所选音                          |
| `Delete / Backspace` | 删除整个选中事件                              |
| `⌘ Z / ⌘ Shift Z`    | 撤销 / 重做；非 macOS 使用 Ctrl               |

点击已有音符可选择和弦中的单个音；点击浅色休止符定位输入。这些浅色提示不写入原生乐谱。修改工具栏时值不会改动已有音乐，点击「应用当前时值」才修改选中事件，且不会移动后续事件。

连续输入会跨小节，末尾必要时增加小节；单个事件不能越过小节线，不能覆盖同声部已有内容。当前仅支持基础音高与时值编辑，延音线单端修改可能被核心拒绝；连线、力度、踏板、重复等记号可显示，创建这些记号、自动连梁和跨谱表输入待后续完善。

UI 集成测试会生成 `logs/editor-preview.png` 与 `logs/file-workflow-preview.png`。

## 文件保存与恢复

- 「保存」首次选择位置，之后保存到当前文件；「另存为」选择新位置。原生扩展名为 `.notera`，内容仍是版本化 JSON。
- `⌘ S` 保存、`⌘ Shift S` 另存为、`⌘ O` 打开、`⌘ N` 新建；非 macOS 使用 Ctrl。
- 新建、载入示例、打开其他乐谱或退出时，如有未保存更改，会提供「保存并继续 / 放弃并继续 / 取消」。保存失败、取消原生对话框或发现文件版本无效时，当前乐谱仍然保留。
- 保存期间可以继续编辑；较早的保存不会把较新的编辑误标成已保存。文件被其他程序改动时，普通保存会提示重新打开或另存为。
- 音乐内容修改后约 500ms 写入本地恢复副本。下次启动可恢复、放弃，或保留副本并退出。恢复后是未保存文档，需要重新选择保存位置，不会自动覆盖旧文件。

当前每个应用配置目录仅支持一个文档与恢复副本。恢复不能保证保留最后约 500ms 的输入、尚未提交的标题草稿或断电时正在写入的数据。恢复副本保存在应用数据目录的 `recovery/current.json`；写入失败时会提示手动保存。详细实现边界见 [桌面文档服务](src/main/README.md)。

桌面测试使用独立临时配置目录，通过真实 IPC 和磁盘验证文件行为，并在主进程替换原生对话框的选择结果；系统对话框控件本身需要人工验收。

## MusicXML 交换

点击「乐谱交换」菜单可导入 `.musicxml`、`.xml`、`.mxl`，或导出 MusicXML / 压缩 MXL。首版支持单个钢琴声部、双谱表、多声部、和弦、精确时值及常用连线、力度、踏板和基础反复。

导入后与新建乐谱一样可以编辑、撤销和保存为 `.notera`；原 MusicXML 不会成为普通保存目标。导出不改变原生文件位置或未保存状态。无法保留的记号先列出提示，取消或读取失败时保留当前文档；弱起、跨谱表及复杂反复等暂不支持。完整范围、限制和官方依据见 [MusicXML 交换说明](src/exchange/README.md)。

`pnpm run verify:musicxml` 可用官方 MusicXML 4.0 Schema 校验谱例，需要网络下载和本地 `xmllint`；结果保存在忽略的 `logs/musicxml-schema/`。桌面流程截图为 `logs/musicxml-exchange-preview.png`。

## 排版与识谱验证

基准运行步骤、谱例和证据边界见 [notation benchmark](scripts/notation-benchmark/README.md)。
本地结论见 [排版基准结果](.scratch/notera/research/local-benchmark.md)，官方接口资料见 [AI 识谱研究](.scratch/notera/research/ai-recognition.md)。
Verovio 6.3.0 已作为候选引擎接入应用，WASM 随本地 Worker 一起打包；VexFlow 仍只用于开发基准。正式引擎锁定和分发许可核查仍待后续阶段；没有模型服务配置时不执行云端识谱。

## 钢琴试听

- 点击「播放 / 暂停 / 停止」；谱面聚焦时按空格暂停或继续。停止后从头开始。
- 速度为四分音符 BPM，范围 30–240，默认 120；播放中可调整。位置显示源小节、拍号中的拍与反复遍次。
- 支持多声部、和弦、休止、精确连音时值、延音线、谱表力度、踏板延长和基础反复。绿色标记表示当前演奏事件；「谱面跟随」控制自动滚动。
- 编辑音乐、切换文档、开始导入和退出会停止播放；选择音符和保存不改变播放。窗口隐藏或调度中断时暂停，初始化失败可以重试。
- 音色随应用打包，首次播放在本地解码，断网可用。使用 [Alexander Holm 的 Salamander Grand Piano（CC BY 3.0）](src/assets/piano/README.md)。当前为单采样力度层试听，力度通过音量实现，尚无真实踏板共鸣和击弦噪声；听感需人工试听。

实现边界与验收方法见 [试听模块说明](src/playback/README.md)。桌面测试生成 `logs/playback-preview.png`。

## 五线谱 PDF 导出

在「乐谱交换」菜单中选择「导出五线谱 PDF」，再选择保存位置。默认 A4 纵向，16 mm 纸张边距，包含乐谱标题、自动分页与页码；音乐符号为矢量内容，可放大查看和打印。

导出使用点击时的音乐快照，期间可以继续编辑；不会改变 `.notera` 保存位置、未保存状态、撤销历史或恢复内容。选中标记、播放高亮、工具栏和浅色输入提示不会进入 PDF，已输入的休止符仍然保留。取消或失败会保留当前乐谱与原有目标文件。

当前单次导出限制为 200 页、32 MiB 中间 SVG、64 MiB PDF；排版和打印各有 60 秒超时。已验证 macOS 离线生产及本地打包版本，实际打印效果需人工检查。模块边界见 [PDF 导出说明](src/main/PDF.md)，原创单页和多页验收输出位于 `logs/staff-export-single.pdf`、`logs/staff-export-multiple.pdf`。
