/** Edit provider metadata and submit a transient password field without retaining saved credentials. */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { RecognitionSettings } from '../../../shared/recognition-api'
import type { RecognitionController } from '../../../recognition/controller'

/** Initialize an editable configuration when public settings change; clear typed secrets immediately after submission. */
export function RecognitionSettingsForm({
  controller,
  settings,
  disabled,
}: {
  controller: RecognitionController
  settings: RecognitionSettings
  disabled: boolean
}) {
  const [configuration, setConfiguration] = useState(() => ({
    protocol: settings.protocol,
    baseUrl: settings.baseUrl,
    model: settings.model,
    maxTokens: settings.maxTokens,
    jsonMode: settings.jsonMode,
    reasoningMode: settings.reasoningMode,
    timeoutSeconds: settings.timeoutSeconds,
  }))
  const [key, setKey] = useState('')
  const sameService =
    settings.protocol === configuration.protocol &&
    settings.baseUrl.replace(/\/+$/, '') ===
      configuration.baseUrl.replace(/\/+$/, '')
  return (
    <form
      aria-label="AI 服务配置"
      onSubmit={(event) => {
        event.preventDefault()
        const apiKey = key
        setKey('')
        void controller.saveSettings({
          ...configuration,
          apiKey,
          clearKey: false,
        })
      }}
    >
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="ai-protocol">服务协议</FieldLabel>
          <NativeSelect
            id="ai-protocol"
            value={configuration.protocol}
            disabled={disabled}
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                protocol: event.target.value as RecognitionSettings['protocol'],
                reasoningMode: 'auto',
              })
            }
          >
            <NativeSelectOption value="openai-chat">
              OpenAI 兼容 · Chat Completions
            </NativeSelectOption>
            <NativeSelectOption value="openai-responses">
              OpenAI 兼容 · Responses
            </NativeSelectOption>
            <NativeSelectOption value="claude">
              Claude 兼容 · Messages
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-url">服务地址</FieldLabel>
          <Input
            id="ai-url"
            value={configuration.baseUrl}
            disabled={disabled}
            required
            placeholder="https://api.example.com/v1"
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                baseUrl: event.target.value,
              })
            }
          />
          <FieldDescription>
            填写服务提供的 API 基础地址，不含请求路径（如 /messages、
            /chat/completions 或 /responses）；地址前缀按服务文档填写。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-model">视觉模型</FieldLabel>
          <Input
            id="ai-model"
            value={configuration.model}
            disabled={disabled}
            required
            placeholder="填写服务提供的模型标识"
            onChange={(event) =>
              setConfiguration({ ...configuration, model: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-key">API Key</FieldLabel>
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            value={key}
            disabled={disabled}
            placeholder={
              settings.hasKey && sameService
                ? '已加密保存；留空保留原 Key'
                : '输入当前服务的 API Key'
            }
            onChange={(event) => setKey(event.target.value)}
          />
          <FieldDescription>
            更换服务地址或协议时重新填写。已保存的 Key 不会返回此界面。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-tokens">输出 Token 上限</FieldLabel>
          <Input
            id="ai-tokens"
            type="number"
            min={512}
            max={32768}
            value={
              Number.isNaN(configuration.maxTokens)
                ? ''
                : configuration.maxTokens
            }
            disabled={disabled}
            required
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                maxTokens: event.target.valueAsNumber,
              })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-reasoning">推理策略</FieldLabel>
          <NativeSelect
            id="ai-reasoning"
            value={configuration.reasoningMode}
            disabled={disabled}
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                reasoningMode: event.target
                  .value as RecognitionSettings['reasoningMode'],
              })
            }
          >
            <NativeSelectOption value="auto">
              自动适配（支持时关闭或降低推理）
            </NativeSelectOption>
            <NativeSelectOption value="service-default">
              保留服务默认
            </NativeSelectOption>
            <NativeSelectOption
              value="openai-none"
              disabled={configuration.protocol === 'claude'}
            >
              关闭推理 · none（服务需支持）
            </NativeSelectOption>
            <NativeSelectOption
              value="thinking-off"
              disabled={configuration.protocol === 'openai-responses'}
            >
              关闭思考 · thinking（服务需支持）
            </NativeSelectOption>
          </NativeSelect>
          <FieldDescription>
            自动识别官方服务地址；未知兼容服务保留其默认。自定义代理可按服务文档选择关闭方式，参数不支持时不会自动重发。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-timeout">单页超时（秒）</FieldLabel>
          <Input
            id="ai-timeout"
            type="number"
            min={30}
            max={600}
            required
            disabled={disabled}
            value={
              Number.isNaN(configuration.timeoutSeconds)
                ? ''
                : configuration.timeoutSeconds
            }
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                timeoutSeconds: event.target.valueAsNumber,
              })
            }
          />
          <FieldDescription>
            默认 180 秒，支持 30–600 秒。取消仍可立即中止等待。
          </FieldDescription>
        </Field>
        {configuration.protocol !== 'claude' ? (
          <Field orientation="horizontal">
            <Checkbox
              id="ai-json"
              checked={configuration.jsonMode}
              disabled={disabled}
              onCheckedChange={(value) =>
                setConfiguration({ ...configuration, jsonMode: value === true })
              }
            />
            <FieldLabel htmlFor="ai-json">
              请求 JSON 模式（服务需支持）
            </FieldLabel>
          </Field>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit" disabled={disabled}>
            保存 AI 配置
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            disabled={disabled || !settings.hasKey}
            onClick={() => {
              setKey('')
              void controller.saveSettings({
                protocol: settings.protocol,
                baseUrl: settings.baseUrl,
                model: settings.model,
                maxTokens: settings.maxTokens,
                jsonMode: settings.jsonMode,
                reasoningMode: settings.reasoningMode,
                timeoutSeconds: settings.timeoutSeconds,
                apiKey: '',
                clearKey: true,
              })
            }}
          >
            删除已保存 Key
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
