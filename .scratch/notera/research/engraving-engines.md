# 排版引擎研究：VexFlow 与 Verovio

核查日期：2026-10-04。范围：官方文档、发布元数据与源码；运行结果由独立基准记录。本报告不决定 Notera 的许可证或正式排版引擎。

## 已核实事实

| 项目             | VexFlow                                                                                                                                                                                                                                                                | Verovio                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前注册表稳定版 | `5.0.0`；仓库主分支已标记 `5.1.0`，不等同已发布版。[包元数据](https://registry.npmjs.org/vexflow/latest)、[源码元数据](https://github.com/vexflow/vexflow/blob/main/package.json)                                                                                      | `6.3.0`。[包元数据](https://registry.npmjs.org/verovio/latest)、[官方发布](https://github.com/rism-digital/verovio/releases/tag/version-6.3.0)                                                                                                                                                                                      |
| 实现与许可证     | TypeScript，MIT；输出 Canvas/SVG，支持浏览器和 Node。[官方仓库](https://github.com/vexflow/vexflow)                                                                                                                                                                    | C++20 核心、预编译 JavaScript/WASM，包声明 `LGPL-3.0-or-later`。[官方仓库](https://github.com/rism-digital/verovio)、[包元数据](https://registry.npmjs.org/verovio/latest)                                                                                                                                                          |
| 排版职责         | `Formatter` 对齐同谱表及跨谱表的声部、分配节奏间距；`System` 组织乐谱行。[Formatter](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/Formatter.html)、[System](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/System.html)                          | 整份数据排版；`pageWidth/pageHeight`、`breaks` 控制分页、断行，提供 `getPageCount()` 和逐页 SVG。[布局选项](https://book.verovio.org/first-steps/layout-options.html)、[工具选项](https://book.verovio.org/toolkit-reference/toolkit-options.html)                                                                                  |
| 交换格式         | 输入由绘图 API 或 EasyScore 创建；官方旧 wiki 明确 MusicXML 需其他库；5.0.0 导出 API 未提供 MusicXML/MEI 导入导出。[MusicXML 说明](https://github.com/0xfe/vexflow/wiki/Import-MusicXML)、[5.0.0 API 入口](https://github.com/vexflow/vexflow/blob/5.0.0/src/index.ts) | MEI 输入；MusicXML 默认直接转换成 MEI；基础 MXL 用 `loadZipDataBuffer()` / `loadZipDataBase64()`。官方输出列 SVG、MEI、MIDI 等，未列 MusicXML 导出；不构成 MusicXML 往返保证。[输入格式](https://book.verovio.org/toolkit-reference/input-formats.html)、[输出格式](https://book.verovio.org/toolkit-reference/output-formats.html) |

版本来自实际执行 `pnpm view vexflow version license exports --json`、`pnpm view verovio version license exports --json`。正式基准应锁定上述版本，避免 `latest` 漂移。

### 元素映射与命中

- **VexFlow**：`Element` 提供 `setAttribute('id', ...)`、`getSVGElement()`、`getBoundingBox()`；应用可显式设置领域对象 ID。默认自动生成 ID 不是持久化身份方案；和弦整体包围盒不能代替每个音头的命中区域。[Element API](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/Element.html)、[StaveNote API](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/StaveNote.html)
- **Verovio**：MEI 的 `xml:id` 传入 SVG `id`，保留和弦/音符层级；`getElementAttr()` 查询属性，`getPageWithElement()` 查询当前页。手工赋予稳定 MEI ID 比依赖转换器生成 ID 更适合编辑映射。[SVG 结构](https://book.verovio.org/interactive-notation/css-and-svg.html)、[Toolkit 方法](https://book.verovio.org/toolkit-reference/toolkit-methods.html)
- **集成推断**：在 SVG 渲染后，通过 DOM 音符组读取几何区域并转换缩放/视口坐标；空白处插入、拖动选区、跨页面连线还需要 Notera 的命中与选择逻辑。上述 API 不是完整交互编辑器。

### 多声部钢琴、踏板与连线

- VexFlow 有多声部跨谱表对齐，`PedalMarking` 的文字/括线/混合形式，以及 `Curve`、`StaveTie`。这些是绘图构件；跨行切分及重排后的连接需适配层验证。[声部排版](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/Formatter.html)、[踏板](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/PedalMarking.html)、[曲线](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/Curve.html)、[延音线](https://vexflow.github.io/vexflow-docs/api/5.0.0/classes/StaveTie.html)
- Verovio 支持列表包含 `staffGrp/staff/layer/chord`、`pedal/slur/tie/tuplet` 等。支持元素不等于所有 MusicXML 转换组合和复杂钢琴场景均正确。[MEI 支持清单](https://book.verovio.org/toolkit-reference/mei-support.html)

### 重排与编辑集成

Verovio 的 `redoLayout()` 重新计算布局；`redoPagePitchPosLayout()` 仅重算当前绘制页的音高纵向位置。`edit()` 和 `editInfo()` 官方标为实验性，不宜作为正式编辑命令层。[Toolkit 方法](https://book.verovio.org/toolkit-reference/toolkit-methods.html)

**集成推断**：独立模型先应用编辑命令，再转换为引擎输入、生成新布局，保留对象 ID。VexFlow 需要应用组织行/页与装饰位置；Verovio 提供整谱排版，但模型转换、选择恢复、撤销重做仍归 Notera。不能仅比较一张 SVG 的生成时间，就判定整体编辑成本。

## 当前加载方式

以下是验证目录内的示例，不要求向正式应用添加依赖：

```sh
pnpm add --save-exact vexflow@5.0.0 verovio@6.3.0
```

VexFlow 支持 ESM `import { Factory, Formatter } from 'vexflow'` 和 CommonJS。5.0.0 的 `vexflow/core` 可通过 `VexFlow.loadFonts()`、`setFonts()` 配置字体；源码支持自定义字体地址。基准需等待字体就绪，桌面离线版应打包已确认许可的字体。[包入口](https://github.com/vexflow/vexflow/blob/5.0.0/package.json)、[字体加载源码](https://github.com/vexflow/vexflow/blob/5.0.0/src/vexflow.ts)

Verovio 官方推荐 Vite/React 使用 Promise 初始化的 ESM/WASM 入口；Node 同样可使用：

```js
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'

const module = await createVerovioModule()
const toolkit = new VerovioToolkit(module)
toolkit.loadData(meiText)
const firstPageSvg = toolkit.renderToSVG(1)
```

这条路线消费预编译 WASM，不要求 Notera 编写 C++；Vite 资源打包、Electron 沙箱和离线加载仍需实际运行验证。[官方 JavaScript/WASM 安装指南](https://book.verovio.org/installing-or-building-from-sources/javascript-and-webassembly.html)

## 对 Notera 的建议与待验证项

以下均为工程判断：

1. 优先验证 Verovio 的整谱自动排版能否减少个人维护的断行、分页与碰撞工作；保留 VexFlow 作为可控绘图对照。此建议不自动决定许可证，也不意味着达到 Dorico。
2. 保持原生乐谱 JSON 和编辑命令独立。引擎接收投影数据，MusicXML 导入导出另设交换层；Verovio 输出可能丢弃不支持的 MEI 元素，不应作为原生存储权威来源。[转换限制](https://book.verovio.org/toolkit-reference/output-formats.html)
3. 同一组钢琴谱例检查双手节拍对齐、多声部休止/二度和弦碰撞、三连音、跨行连线、踏板和力度纵向空间、页边界；修改节奏后重新测页面和 ID 映射。
4. 分别测首次 WASM/字体初始化、整谱加载、逐页绘制、一次编辑后的重排，以及 SVG 几何查询。记录谱例规模、机器和版本，不宣称单次时间代表生产性能。
5. 正式采用前决定开源许可证与分发方式，核查引擎及字体的许可文本。当前只将 LGPL 标为选型约束，不推导 Notera 必须采用某个许可证。[Verovio 许可文本](https://github.com/rism-digital/verovio/blob/develop/COPYING.LESSER)、[VexFlow 许可文本](https://github.com/vexflow/vexflow/blob/main/LICENSE)
