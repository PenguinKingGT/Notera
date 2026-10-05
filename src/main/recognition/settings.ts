/** Store validated provider settings and OS-encrypted credentials with atomic, private writes. */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { RecognitionSettings } from '../../shared/recognition-api'
import { RecognitionError } from '../../recognition/errors'
import { atomicWrite } from '../atomic-file'

export const configurationSchema = z.strictObject({
  protocol: z.enum(['openai-chat', 'openai-responses', 'claude']),
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((text) => {
      try {
        const url = new URL(text)
        return (
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }),
  model: z.string().trim().min(1).max(256),
  maxTokens: z.number().int().min(512).max(32768),
  jsonMode: z.boolean(),
  // Defaults also migrate older encrypted configurations without rewriting or dropping their key.
  reasoningMode: z
    .enum(['auto', 'service-default', 'openai-none', 'thinking-off'])
    .default('auto'),
  timeoutSeconds: z.number().int().min(30).max(600).default(180),
})
const savedSchema = configurationSchema.extend({
  encryptedKey: z.string().max(16384),
})
const saveSchema = configurationSchema.extend({
  apiKey: z.string().trim().max(4096),
  clearKey: z.boolean(),
})
export type ProviderConfiguration = z.infer<typeof configurationSchema>

/** Inject the OS credential mechanism so encryption failures can be tested in Node. */
export interface SecretEncryption {
  available: () => boolean
  encrypt: (text: string) => Buffer
  decrypt: (bytes: Buffer) => string
}

/** Own the secret without ever returning it through public settings. */
export class RecognitionSettingsStore {
  #tail: Promise<unknown> = Promise.resolve()
  /** Bind one profile-local file and the platform's safe-storage implementation. */
  constructor(
    readonly path: string,
    readonly encryption: SecretEncryption,
  ) {}

  /** Read validated data; a corrupt configuration is not silently replaced or logged. */
  private async readSaved() {
    try {
      const saved: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      // Retire the removed strategy without losing access to previously encrypted credentials.
      const migrated =
        saved &&
        typeof saved === 'object' &&
        'reasoningMode' in saved &&
        saved.reasoningMode === 'openrouter-off'
          ? { ...saved, reasoningMode: 'auto' }
          : saved
      return savedSchema.parse(migrated)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw new RecognitionError('AI 配置无法读取，请检查或重新配置。')
    }
  }

  /** Return editable metadata and only the presence of a saved credential. */
  async get(): Promise<RecognitionSettings> {
    const saved = await this.readSaved()
    return saved
      ? {
          protocol: saved.protocol,
          baseUrl: saved.baseUrl,
          model: saved.model,
          maxTokens: saved.maxTokens,
          jsonMode: saved.jsonMode,
          reasoningMode: saved.reasoningMode,
          timeoutSeconds: saved.timeoutSeconds,
          hasKey: Boolean(saved.encryptedKey),
        }
      : {
          protocol: 'openai-chat',
          baseUrl: '',
          model: '',
          maxTokens: 32768,
          jsonMode: false,
          reasoningMode: 'auto',
          timeoutSeconds: 180,
          hasKey: false,
        }
  }

  /** Serialize settings mutations; changing provider/URL requires explicitly supplying a new credential. */
  save(input: unknown): Promise<RecognitionSettings> {
    const operation = this.#tail.then(async () => {
      const parsed = saveSchema.safeParse(input)
      if (!parsed.success) {
        throw new RecognitionError(
          '请填写有效协议、HTTPS 服务地址（本机可用 HTTP）、模型及输出上限。',
        )
      }
      const value = parsed.data
      const previous = await this.readSaved()
      const baseUrl = value.baseUrl.replace(/\/+$/, '')
      const sameProvider =
        previous?.baseUrl === baseUrl && previous.protocol === value.protocol
      let encryptedKey = sameProvider ? previous.encryptedKey : ''
      if (value.clearKey) {
        encryptedKey = ''
      } else if (value.apiKey) {
        if (!this.encryption.available()) {
          throw new RecognitionError('系统凭据加密不可用，API Key 未保存。')
        }
        try {
          encryptedKey = this.encryption
            .encrypt(value.apiKey)
            .toString('base64')
        } catch {
          throw new RecognitionError('系统凭据加密失败，原配置已保留。')
        }
      } else if (!sameProvider && previous?.encryptedKey) {
        throw new RecognitionError(
          '服务地址或协议已改变，请重新填写 API Key，避免将旧密钥发送到新服务。',
        )
      }
      const configuration = configurationSchema.parse({
        protocol: value.protocol,
        baseUrl,
        model: value.model,
        maxTokens: value.maxTokens,
        jsonMode: value.jsonMode,
        reasoningMode: value.reasoningMode,
        timeoutSeconds: value.timeoutSeconds,
      })
      await mkdir(dirname(this.path), { recursive: true })
      await atomicWrite(
        this.path,
        JSON.stringify({ ...configuration, encryptedKey }),
      )
      return this.get()
    })
    this.#tail = operation.catch(() => {})
    return operation
  }

  /** Decrypt only for a main-owned request; the key never appears in public metadata. */
  async credentials(): Promise<ProviderConfiguration & { apiKey: string }> {
    await this.#tail
    const saved = await this.readSaved()
    if (!saved?.encryptedKey || !this.encryption.available()) {
      throw new RecognitionError('请先配置服务、模型及 API Key。')
    }
    try {
      return {
        ...configurationSchema.parse({
          protocol: saved.protocol,
          baseUrl: saved.baseUrl,
          model: saved.model,
          maxTokens: saved.maxTokens,
          jsonMode: saved.jsonMode,
          reasoningMode: saved.reasoningMode,
          timeoutSeconds: saved.timeoutSeconds,
        }),
        apiKey: this.encryption.decrypt(
          Buffer.from(saved.encryptedKey, 'base64'),
        ),
      }
    } catch {
      throw new RecognitionError('无法解密 API Key，请重新填写并保存。')
    }
  }
}
