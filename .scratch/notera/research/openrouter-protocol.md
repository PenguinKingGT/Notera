# OpenRouter 乐谱图片实测协议

核查日期：2026-10-05。仅查 OpenRouter 官方公开文档及无需鉴权的模型端点元数据；未读取环境文件或凭据，未调用推理 API。

## 模型能力

`deepseek/deepseek-v4.1-flash` 官方模型页明确说明接受文字和图片输入、返回文字。公开端点元数据也给出 `modality: "text+image->text"`、`input_modalities: ["text", "image"]`。这说明可以提交乐谱图片，不代表已经验证其识谱准确率。来源：[模型页](https://openrouter.ai/deepseek/deepseek-v4.1-flash)、[官方公开端点元数据](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints)。

## 图片请求

使用 `POST https://openrouter.ai/api/v1/chat/completions`，请求头为 `Authorization: Bearer <API_KEY>` 和 `Content-Type: application/json`。用户消息的 `content` 用数组，文字在前、图片在后；本地图片采用带真实 MIME 类型的 base64 data URL。支持 PNG、JPEG、WebP、GIF，多图使用多个图片条目，数量上限因模型和供应商而异。来源：[图片输入](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)、[Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)。

```json
{
  "model": "deepseek/deepseek-v4.1-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "读取乐谱中的音高、时值、休止符和小节；不确定处明确标记。"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,<BASE64_IMAGE>"
          }
        }
      ]
    }
  ],
  "max_completion_tokens": 8192,
  "stream": true
}
```

此处 `8192` 是实测预算示例，不是模型默认值。`modalities` 描述输出模态，识图并返回文字无需指定图片输出。来源：[Chat Completions 参数](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)。

## token 上限参数

- API 请求 schema 同时接受 `max_completion_tokens` 与 `max_tokens`，前者是推荐字段，后者标记为 deprecated；部分供应商要求至少 16。来源：[请求参数](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)。
- 核查时，该模型各供应商的 `supported_parameters` 都列出 `max_tokens`，未列出 `max_completion_tokens`。同时端点记录的 `max_completion_tokens` 是供应商的输出容量数值，例如 DeepSeek 为 393216、DeepInfra 为 131072，并非请求参数支持列表。来源：[端点元数据](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints)。
- 因此官方通用 schema 支持推荐字段，但不能仅凭元数据断言每个供应商对该字段的具体转发行为。首次实测可使用推荐字段并保存实际响应；若明确收到字段相关拒绝，再单独改用 `max_tokens`，不要同时发送两个上限。此为依据上述资料的测试建议，未通过付费调用验证。

## 流式响应

`stream: true` 返回 SSE。解析器需要跨网络块缓冲完整事件，忽略以 `:` 开头的注释，识别 `data: [DONE]`，拼接 `choices[0].delta.content`。HTTP 非成功状态先按 JSON 错误处理；HTTP 200 的 SSE 也可能携带顶层 `error` 与 `finish_reason: "error"`，甚至没有任何正文。

最终 usage 帧位于 `[DONE]` 前，可能重复终止原因；把它作为计费统计帧，保存 `usage`，不要重复追加正文或重复判定完成。记录 generation ID、供应商、终止原因、正文和错误，才能区分正常完成、截断与供应商失败。来源：[官方 Streaming 文档](https://openrouter.ai/docs/api_reference/streaming)。

断开流只有在支持取消的供应商上才会停止模型处理和计费；文档列出的支持者包括 DeepSeek、DeepInfra、Together，未支持者包括 InferenceNet、Modal、Alibaba。来源：[Stream cancellation](https://openrouter.ai/docs/api_reference/streaming#stream-cancellation)。
