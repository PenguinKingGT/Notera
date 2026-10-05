/** Encode main-owned image/PDF requests for configurable protocols and read bounded JSON-only music. */
import {
  recognitionPrompt,
  parseRecognitionScore,
} from '../../recognition/score-result'
import { RecognitionError } from '../../recognition/errors'
import type { Score } from '../../core'
import type { ProviderConfiguration } from './settings'
import { reasoningParameters } from './reasoning'
import { isDeepSeekService } from '../../shared/recognition-api'

/** The provider needs only a string URL and standard request initialization. */
export type RecognitionFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>

/** Prepared local page; bytes and filenames are never accepted directly from renderer requests. */
export interface RecognitionPage {
  id: string
  name: string
  kind: 'image' | 'pdf'
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'
  bytes: Uint8Array
}

/** Build only the chosen provider path; redirects are rejected to avoid forwarding credentials elsewhere. */
export function providerRequest(
  configuration: ProviderConfiguration,
  apiKey: string,
  page: RecognitionPage,
  pageNumber: number,
) {
  const baseUrl = configuration.baseUrl.replace(/\/+$/, '')
  const deepSeek = isDeepSeekService(baseUrl)
  if (deepSeek && page.kind === 'pdf') {
    throw new RecognitionError(
      '当前服务的识谱适配仅支持图片，请先将 PDF 页面转换成 PNG/JPEG。',
    )
  }
  const data = Buffer.from(page.bytes).toString('base64')
  const prompt = recognitionPrompt(pageNumber)
  const dataUrl = `data:${page.mediaType};base64,${data}`
  const reasoning = reasoningParameters(configuration)
  if (configuration.protocol === 'claude') {
    return {
      // The DeepSeek SDK base is /anthropic; Anthropic SDKs append /v1/messages.
      url: `${baseUrl}${deepSeek && !baseUrl.endsWith('/v1') ? '/v1' : ''}/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: configuration.model,
        max_tokens: configuration.maxTokens,
        ...reasoning,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: page.kind === 'pdf' ? 'document' : 'image',
                source: { type: 'base64', media_type: page.mediaType, data },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
    }
  }
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (configuration.protocol === 'openai-responses') {
    return {
      url: `${baseUrl}/responses`,
      headers,
      body: {
        model: configuration.model,
        store: false,
        max_output_tokens: configuration.maxTokens,
        ...reasoning,
        ...(configuration.jsonMode
          ? { text: { format: { type: 'json_object' } } }
          : {}),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              page.kind === 'pdf'
                ? {
                    type: 'input_file',
                    filename: 'source.pdf',
                    file_data: dataUrl,
                  }
                : { type: 'input_image', image_url: dataUrl, detail: 'high' },
            ],
          },
        ],
      },
    }
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body: {
      model: configuration.model,
      ...(deepSeek
        ? { max_tokens: configuration.maxTokens }
        : { max_completion_tokens: configuration.maxTokens }),
      ...reasoning,
      ...(configuration.jsonMode
        ? { response_format: { type: 'json_object' } }
        : {}),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            page.kind === 'pdf'
              ? {
                  type: 'file',
                  file: { filename: 'source.pdf', file_data: dataUrl },
                }
              : {
                  type: 'image_url',
                  image_url: { url: dataUrl, detail: 'high' },
                },
          ],
        },
      ],
    },
  }
}

/** Reject refusals and truncation separately before local native music validation. */
export function providerText(
  protocol: ProviderConfiguration['protocol'],
  value: unknown,
): string {
  const object = value as {
    choices?: {
      finish_reason?: string
      message?: { content?: unknown; refusal?: unknown }
    }[]
    status?: string
    stop_reason?: string
    output?: { type?: string; content?: { type?: string; text?: unknown }[] }[]
    content?: { type?: string; text?: unknown }[]
    usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } }
  }
  if (!object || typeof object !== 'object') {
    throw new RecognitionError('服务响应格式不兼容。')
  }
  if (protocol === 'openai-chat') {
    const choice = object.choices?.[0]
    const reasoningTokens =
      object.usage?.completion_tokens_details?.reasoning_tokens
    if (
      choice?.finish_reason === 'length' &&
      !choice.message?.content &&
      typeof reasoningTokens === 'number' &&
      reasoningTokens > 0
    ) {
      throw new RecognitionError(
        '推理耗尽输出预算，未生成乐谱正文。请关闭或降低推理，或提高输出 Token 上限。',
      )
    }
    if (
      choice?.finish_reason !== 'stop' ||
      choice.message?.refusal ||
      typeof choice.message?.content !== 'string'
    ) {
      throw new RecognitionError(
        '模型拒绝、输出截断或响应格式不兼容，请调整模型/输出上限并重试。',
      )
    }
    return choice.message.content
  }
  if (
    (protocol === 'claude' && object.stop_reason !== 'end_turn') ||
    (protocol === 'openai-responses' && object.status !== 'completed')
  ) {
    throw new RecognitionError(
      '模型输出未完成，可能拒绝或截断，请调整输出上限并重试。',
    )
  }
  const blocks =
    protocol === 'claude'
      ? object.content
      : object.output
          ?.filter((item) => item.type === 'message')
          .flatMap((item) => item.content ?? [])
  const text = blocks
    ?.filter((block) => block.type === 'text' || block.type === 'output_text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
  if (!text) {
    throw new RecognitionError('服务未返回可解析的识谱文本。')
  }
  return text
}

/** Issue one bounded, cancellable request; never echo remote error bodies or fetch exceptions into logs/UI. */
export async function recognizePage(
  configuration: ProviderConfiguration & { apiKey: string },
  page: RecognitionPage,
  pageNumber: number,
  signal: AbortSignal,
  request: RecognitionFetch = fetch,
): Promise<Score> {
  const encoded = providerRequest(
    configuration,
    configuration.apiKey,
    page,
    pageNumber,
  )
  const timeout = AbortSignal.timeout(configuration.timeoutSeconds * 1000)
  const abort = AbortSignal.any([signal, timeout])
  /** Keep cancellation distinct from deadline expiry even when both signals eventually abort. */
  const abortMessage = () =>
    signal.aborted
      ? '识谱已取消。'
      : `识谱请求超过 ${configuration.timeoutSeconds} 秒，请调整超时或推理策略后重试。`
  try {
    const response = await request(encoded.url, {
      method: 'POST',
      headers: encoded.headers,
      body: JSON.stringify(encoded.body),
      signal: abort,
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new RecognitionError(
        `识谱服务返回 HTTP ${response.status}。请检查模型、API Key、图片/PDF 能力、额度及推理参数兼容性。`,
      )
    }
    if (!response.body) {
      throw new RecognitionError('识谱服务返回空响应。')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        total += value.byteLength
        if (total > 2 * 1024 * 1024) {
          throw new RecognitionError('服务响应超过 2 MiB，请缩小来源页。')
        }
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    if (abort.aborted) {
      throw new RecognitionError(abortMessage())
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new RecognitionError('服务返回非 JSON 响应，请检查兼容接口。')
    }
    return parseRecognitionScore(providerText(configuration.protocol, decoded))
  } catch (error) {
    if (error instanceof RecognitionError) {
      throw error
    }
    throw new RecognitionError(
      abort.aborted
        ? abortMessage()
        : '无法连接识谱服务，请检查服务地址、网络与协议。',
    )
  }
}
