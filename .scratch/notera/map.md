# Notera 实施导航

## Notes

- [产品范围](spec.md) 已通过 Q33 确认。
- 本地验证已完成：[排版与 AI 识谱风险验证](issues/01-risk-validation.md)。
- 音乐核心已完成：[独立音乐核心与编辑命令](issues/02-score-core.md)。
- 基础编辑已完成：[钢琴谱面与基础输入](issues/04-piano-score-editor.md)。
- 文件工作流已完成：[原生乐谱文件读写与恢复](issues/05-native-file-persistence.md)。
- 乐谱交换已完成：[MusicXML 乐谱交换](issues/06-musicxml-exchange.md)。
- 试听已完成：[钢琴试听与谱面跟随](issues/07-piano-playback.md)。
- PDF 已完成：[五线谱 PDF 导出](issues/08-staff-pdf-export.md)，基础五线谱输入、编辑、保存、试听、导出闭环已打通。
- 待服务配置：[真实模型识谱评估](issues/03-live-recognition-evaluation.md)。

## Decisions-so-far

- 五线谱与简谱共享音乐内容，简谱首版用于查看和导出。
- 乐谱模型独立于排版与识谱服务，具体引擎通过钢琴谱例验证后确定。
- 用户暂时没有模型配置，先完成本地基准和接口资料验证。
- [任务 01](issues/01-risk-validation.md)：本地事件映射、修改重排和分页验证通过，Verovio 为下一阶段整谱排版候选，尚未正式锁定。
- [任务 02](issues/02-score-core.md)：独立音乐模型、精确时值、原子命令、撤销/重做和版本化 JSON 编解码已实现，39 个 Node 核心测试通过。

- [任务 04](issues/04-piano-score-editor.md)：基础钢琴谱输入、选择与修改、离线 Worker 排版及桌面闭环已实现，50 个单元测试和 macOS 开发/生产/打包验证通过。

- [任务 05](issues/05-native-file-persistence.md)：原生文件打开/保存/另存为、未保存决策和恢复已实现，64 个单元测试与 4 个 macOS 生产/打包桌面测试通过；开发 URL 的 IPC/磁盘保存已验证。

- [任务 06](issues/06-musicxml-exchange.md)：MusicXML/MXL 独立交换、身份往返、损失确认与桌面闭环已实现，80 个单元测试、5 个生产/打包桌面测试及官方 XSD 校验通过；Verovio 独立读谱验证通过，MuseScore/Dorico GUI 互操作待人工检查。

- [任务 07](issues/07-piano-playback.md)：离线钢琴试听、可取消调度、精确音乐时间线、播放控制与谱面跟随已实现；91 个单元测试、7 个生产/打包桌面测试通过，音色听感及真实长谱体验待人工检查。

- [任务 08](issues/08-staff-pdf-export.md)：快照一致的矢量 A4 五线谱 PDF、独立排版线程与安全原子输出已实现；97 个单元测试、8 个生产/打包桌面测试通过，单页/两页 PDF 经独立读取器及渲染检查。

## Fog

- 真实曲目的排版质量、高级编辑交互、更广的 MusicXML 曲目/GUI 互操作、其他平台打包和分发许可仍需验证。
- 云端识谱准确度待服务配置可用后实测。
