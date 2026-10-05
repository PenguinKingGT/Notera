/** Translate recognition latency preferences into provider-specific fields without guessing unknown gateways' capabilities. */
import type { ProviderConfiguration } from './settings'
import { RecognitionError } from '../../recognition/errors'

/** Select an explicit compatibility override or a conservative known-service mapping; never enable thinking. */
export function reasoningParameters(
  configuration: ProviderConfiguration,
): Record<string, unknown> {
  const { protocol, reasoningMode, model } = configuration
  const hostname = new URL(configuration.baseUrl).hostname
  let mode = reasoningMode
  if (mode === 'auto') {
    if (hostname === 'api.deepseek.com') {
      // DeepSeek exposes thinking in Chat/Messages and reasoning.effort in Responses.
      mode = protocol === 'openai-responses' ? 'openai-none' : 'thinking-off'
    } else if (protocol === 'claude' && hostname === 'api.anthropic.com') {
      if (/^claude-sonnet-5[.-]5(?:-|$)/.test(model)) {
        return {
          thinking: { type: 'between_tools' },
          output_config: { effort: 'low' },
        }
      }
      if (/^claude-(?:opus|sonnet)-5(?:-\d{8})?$/.test(model)) {
        return {
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
        }
      }
      if (
        /^claude-(?:(?:opus|sonnet|haiku)-4(?:\.[5-8]|-[5-8])(?:-|$)|3[.-]7(?:-|$))/.test(
          model,
        )
      ) {
        mode = 'thinking-off'
      } else {
        return {}
      }
    } else if (hostname === 'api.openai.com' && protocol !== 'claude') {
      // Only known general GPT models receive none; Codex, Pro and unknown IDs are not inferred.
      if (/^gpt-5\.(?:1|2|4|5)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
        mode = 'openai-none'
      } else if (
        /^gpt-(?:6-(?:astra|sol|luna)|6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(
          model,
        )
      ) {
        return protocol === 'openai-responses'
          ? { reasoning: { effort: 'low' } }
          : { reasoning_effort: 'low' }
      } else {
        return {}
      }
    } else {
      // Compatibility alone says nothing about supported reasoning extensions.
      return {}
    }
  }
  if (mode === 'service-default') {
    return {}
  }
  if (mode === 'openai-none' && protocol !== 'claude') {
    return protocol === 'openai-responses'
      ? { reasoning: { effort: 'none' } }
      : { reasoning_effort: 'none' }
  }
  if (mode === 'thinking-off' && protocol !== 'openai-responses') {
    return { thinking: { type: 'disabled' } }
  }
  throw new RecognitionError(
    '所选推理策略不适用于当前协议，请选择自动适配或服务默认。',
  )
}
