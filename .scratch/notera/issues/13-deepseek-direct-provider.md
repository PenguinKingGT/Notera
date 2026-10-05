# DeepSeek 官方接口配置

Status: resolved
Type: task
Blocked by: 12

## 目标

按用户选择移除 OpenRouter 专用选项及请求适配，支持 DeepSeek 官方 OpenAI/Anthropic 兼容协议。

## 范围

- 官方地址与视觉模型配置入口、关闭推理编码和原生请求参数。
- 旧策略安全迁移，改变服务不能沿用旧密钥。
- 明确图片/PDF 适配边界，避免向已知不支持的输入接口发送请求。
- 单元与桌面验证、构建及打包；不使用旧服务 Key 请求 DeepSeek。

## Answer

- 已移除应用的 OpenRouter 专用 UI、策略类型和请求参数适配。旧配置中已移除策略只在读取时转换为自动策略，保留加密 Key；更换地址仍需新服务 Key，历史评估记录保留。
- 新配置默认 DeepSeek 官方 OpenAI 地址与 `deepseek-flash`，提供一键填写配置；切换到 Claude 协议会改为 `/anthropic` 基础地址。Chat 使用 `max_tokens`；Claude 请求使用 SDK 对应的 `/anthropic/v1/messages`，关闭推理保持服务对应参数。
- 官方 DeepSeek 适配的 PDF 在 HTTP 请求前拒绝，并提示先转换为 PNG/JPEG；没有添加 PDF 栅格化回退，不声明 SDK 兼容等同全部多模态能力支持。
- 143 项单元测试、类型检查、lint、格式检查与生产构建通过；2 项 macOS 生产、2 项未签名 macOS arm64 打包桌面测试通过，覆盖配置入口、协议地址切换、策略保存和现有导入闭环。
- 通过正常退出流程更新 `dist/mac-arm64/Notera.app` 并重新启动，旧包备份在忽略的 `dist/previous/`。本轮未调用真实模型或读取用户 Key。

## Comments

用户澄清 DeepSeek 仅为测试使用，产品不应突出该服务。专用表单入口及默认值由任务 14 移除，后端兼容适配保留。
