# 排版与 AI 识谱风险验证

Status: resolved
Type: research

## 目标

用可复现的钢琴谱例与官方资料确认排版集成路径及识谱评估方案，为音乐核心设计提供依据。

## 验收

- VexFlow 与 Verovio 使用相同的音乐输入，验证双谱表、多声部、和弦、附点、三连音、连线、力度、踏板、反复及分页。
- 记录稳定对象标识、命中区域和修改后重排结果；提供 SVG、截图与执行命令。
- 引擎结论区分实际测量、视觉检查、尚未验证内容及许可证约束。
- OpenAI 兼容与 Claude 输入能力依据官方资料，识谱基准包含人工定义的期望音乐内容。
- 没有模型配置时不调用云端，不宣称已验证识谱准确度。

## Comments

- Q33：用户确认产品范围与实施顺序，先验证排版及识谱。
- 用户暂时没有模型配置，本轮完成本地基准和接口资料验证，真实识谱评估待配置可用。

## Answer

本地排版基准与官方接口研究已完成，结果见 [本地基准](../research/local-benchmark.md)、[引擎研究](../research/engraving-engines.md)及 [AI 研究](../research/ai-recognition.md)。
四类场景通过事件标识与可见区域检查，48 小节 Verovio 输出两页；MusicXML 导入检查保留 44 个有音高音符。生成 SVG、PNG、PDF 及独立音乐期望，提供 `pnpm run benchmark:notation` 复现。
优先验证 Verovio 作为后续排版候选，保留独立音乐模型；未正式锁定引擎或承诺排版质量。
无服务配置时不执行云端识谱，本任务完成的是本地验证与研究；真实识谱评估继续跟踪于 [任务 03](03-live-recognition-evaluation.md)。
ESLint、Prettier、类型检查、生产构建与真实 Electron 冒烟测试通过。
