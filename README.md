# Notera

基于 Electron、Vite、React、TypeScript 和 shadcn/ui 的桌面乐谱应用。
当前仅完成项目初始化与启动窗口；乐谱编辑、排版、播放和文件格式将在后续需求分析中设计。

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

| 命令                    | 用途                                     |
| ----------------------- | ---------------------------------------- |
| `pnpm run dev`          | 启动 Vite 与 Electron                    |
| `pnpm run build`        | 类型检查并构建到 `out/`                  |
| `pnpm start`            | 运行已构建的桌面应用                     |
| `pnpm run lint`         | ESLint 检查                              |
| `pnpm run typecheck`    | 检查主进程与界面类型                     |
| `pnpm run format:check` | Prettier 格式检查                        |
| `pnpm run format`       | 格式化文件                               |
| `pnpm test`             | 运行 Vitest 单元测试；暂无测试时正常退出 |
| `pnpm run test:e2e`     | 构建并启动真实 Electron，验证窗口与 IPC  |
| `pnpm run package`      | 构建并生成当前平台的应用目录             |
| `pnpm run dist`         | 构建并生成当前平台安装包                 |

桌面测试需要可用的图形环境；Linux CI 可使用 `xvfb-run pnpm run test:e2e`。
可通过 `NOTERA_EXECUTABLE_PATH` 对已打包应用运行同一套冒烟测试，例如 macOS：

```bash
NOTERA_EXECUTABLE_PATH="$PWD/dist/mac-arm64/Notera.app/Contents/MacOS/Notera" pnpm exec playwright test
```

安装包配置为 macOS DMG、Windows NSIS、Linux AppImage。发布签名、更新与各平台发行验证将在发布阶段配置。

## 目录

```text
src/
  main/       Electron 生命周期和 IPC
  preload/    暴露给界面的最小类型化 API
  renderer/   React 界面、shadcn/ui 组件和样式
  shared/     主进程和界面共用的类型与 IPC 定义
  core/       后续乐谱模型与编辑命令
  assets/     后续本地字体、图标等资源
tests/
  e2e/        桌面启动与 IPC 冒烟测试
  fixtures/   后续乐谱测试文件
```

渲染进程启用隔离与沙箱，通过 `window.notera` 调用指定功能，不直接访问 Node.js 或任意 IPC 通道。
乐谱将采用独立、带版本号的文件持久化；当前尚未实现读写。

本地任务规范见 `docs/agents/issue-tracker.md`，贡献规则见 `AGENTS.md`。
