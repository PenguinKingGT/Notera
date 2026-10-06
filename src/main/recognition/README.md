# AI 桌面服务

本模块拥有服务凭据、所选文件字节和窗口内识谱任务。渲染进程只接收公开配置、来源元数据与通过校验的音乐，不提供任意路径读取或任意请求接口。

## 模块职责

- `settings.ts`：验证协议、模型、基础 URL 和输出上限；串行原子保存配置，使用注入的加密接口包装系统 `safeStorage`。禁止不可用加密后端及 Linux `basic_text` 明文后端。更换服务地址或协议不能沿用旧 Key。
- `sources.ts`：读取原生对话框选择的 PNG/JPEG/PDF；限制文件、页数和图片尺寸，使用 `pdf-lib` 拆出单页 PDF。全部准备成功才替换当前任务。
- `provider.ts`：编码三种协议，拒绝重定向，有界读取响应，检查完成状态并调用原生音乐校验。生产使用 Electron `net.fetch`；错误只暴露安全诊断信息，不回显远端错误正文。
- `reasoning.ts`：把自动策略及显式兼容选项转成协议参数；未知服务/模型不猜测字段，不自动降级重发。
- `service.ts`：顺序执行来源页，保留成功结果、重试失败页、取消请求；运行前预留任务锁，防止异步凭据读取期间并发启动。过期任务或已取消请求的结果不会写回。

IPC 在 `src/main/index.ts` 注册，通过可信窗口检查和 `src/shared/recognition-api.ts` 固定通道访问。窗口关闭时中止请求并释放来源字节和结果。只有加密配置持久化，任务不跨重启恢复。结果 IPC 返回普通乐谱及主进程生成的来源页/小节关联；关联依据实际生成小节而非模型 ID 或界面计数。渲染侧合并不请求新服务调用，也不提供文件写入目标。

## 协议与限制

基础 URL 使用 HTTPS；仅本机回环允许 HTTP，不允许 URL 凭据、查询或片段。路径分别追加 `/chat/completions`、`/responses`、`/messages`。服务必须实际支持对应模型和图片/PDF 输入；JSON 模式由用户按服务能力开启，Claude 使用 JSON 输出提示。

每个原文件和准备后的页面最多 10 MiB，总计 30 页、40 MiB；图片最长边 8000、面积最多 2500 万像素。每页默认超时 180 秒，可设 30–600 秒，包含响应正文读取；响应最多 2 MiB。加密 PDF、损坏文件及不支持格式拒绝导入；不提供栅格化回退。

## 推理策略

新配置不预选服务地址或模型，由用户按服务文档填写。推理策略默认 `auto`，旧配置读取时补齐此字段和 180 秒超时，不改变密钥或已设置的 Token 上限。新配置输出上限默认 32768。协议切换会把表单推理策略重置为自动。

| 服务          | 自动行为                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek 官方 | Chat/Messages 使用 `thinking.type=disabled`，Responses 使用 `reasoning.effort=none`                                                            |
| OpenAI 官方   | 已知 GPT-5.1/5.2/5.4/5.5 通用型号使用 `none`；已知 GPT-6 系列使用 `low`；其他/Pro/Codex 型号保留默认                                           |
| Claude 官方   | 已知可关闭的 3.7、4.5–4.8、Sonnet/Opus 5 使用 `disabled`；5 系列同时限制 effort；Sonnet 5.5 使用 `between_tools` 与低 effort；其他型号保留默认 |
| 自定义地址    | 保留服务默认；用户可显式选择 OpenAI none 或 thinking 关闭方式                                                                                  |

自动表是保守的已知能力映射，不是所有模型的运行时能力检测。新模型应核对官方支持并补测试；不得仅因型号名称类似就发送 `none`。显式选项需要服务实际支持，不兼容协议在发送前拒绝；远端拒绝后提示用户调整，不自动重发产生重复计费。`service-default` 完全不添加推理字段。

原始推理耗尽且正文为空的 Chat 响应报告预算诊断；输出截断、音乐校验、网络、超时与用户取消仍分开处理。关闭推理不能保证识谱正确或完全避免超时。

参数依据：[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[Claude thinking 配置](https://platform.claude.com/docs/en/build-with-claude/thinking)。

官方格式依据：[OpenAI 图片](https://developers.openai.com/api/docs/guides/images-vision)、[OpenAI PDF](https://developers.openai.com/api/docs/guides/file-inputs)、[Claude 图片](https://platform.claude.com/docs/en/build-with-claude/vision)、[Claude PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。兼容网关的实际能力仍需验证。

## 验证

`pnpm test` 覆盖配置加密、密钥边界、协议编码、响应上限、校验、部分失败重试、并发及取消后的迟到结果。`tests/e2e/recognition.spec.ts` 通过本地假 HTTP 服务、真实 Electron IPC 和磁盘验证三种协议、PDF、重试及普通编辑保存；不评估真实识谱准确率，也不调用真实模型。

## 服务兼容适配示例

官方 DeepSeek 的 OpenAI Chat/Responses 基础地址为 `https://api.deepseek.com`；Claude Messages 基础地址为 `https://api.deepseek.com/anthropic`，请求路径遵循 Anthropic SDK 的 `/v1/messages`。这些是后端协议适配边界，不是产品预设；表单切换协议不会修改用户地址。

Chat 使用 `max_tokens`，Chat/Messages 自动发送 `thinking.type=disabled`；Responses 自动发送 `reasoning.effort=none`。视觉模型使用官方 `deepseek-flash` 标识。旧服务的地址和密钥不自动迁移到新服务；已移除策略值只转换成自动策略，防止旧加密配置无法读取。

当前官方 DeepSeek 适配只接收图片；PDF 在 HTTP 请求前拒绝并提示先转 PNG/JPEG。Anthropic 兼容文档明确不支持 `document`，Chat/Responses 的原生 PDF 视觉输入也未纳入已核实范围；本次不添加 PDF 栅格化回退，不把 SDK 兼容性当成所有多模态输入均受支持。

依据：[DeepSeek 图片](https://api-docs.deepseek.com/guides/vision/)、[DeepSeek Anthropic 协议](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/)、[DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/)、[Anthropic SDK 请求路径](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/resources/messages/messages.py)。
