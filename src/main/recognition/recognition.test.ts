// @vitest-environment node
/** Verify credential ownership, protocol requests, bounded sources and partial/cancelled recognition work. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPianoScore,
  fraction,
  parseScore,
  serializeScore,
} from '../../core'
import type { Score } from '../../core'
import { RecognitionSettingsStore } from './settings'
import { prepareSources } from './sources'
import { providerRequest, providerText, recognizePage } from './provider'
import type { RecognitionPage } from './provider'
import { RecognitionService, recognitionResult } from './service'
import { reasoningParameters } from './reasoning'
import {
  combineRecognitionScores,
  parseRecognitionScore,
} from '../../recognition/score-result'

const directories: string[] = []
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD9sAAAAASUVORK5CYII=',
  'base64',
)
const configuration = {
  protocol: 'openai-chat' as const,
  baseUrl: 'https://example.test/v1',
  model: 'fixture-vision',
  maxTokens: 4096,
  jsonMode: false,
  reasoningMode: 'auto' as const,
  timeoutSeconds: 180,
}
const dummyKey = 'notera-test-credential'
const encryption = {
  available: () => true,
  encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decrypt: (bytes: Buffer) => bytes.toString().split('').reverse().join(''),
}

/** Create profile-local temporary storage with cleanup independent of successful assertions. */
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'notera-recognition-'))
  directories.push(path)
  return path
}

/** Hand-author one valid piano note so tests exercise real musical and native-envelope validation. */
function music(step: 'C' | 'D' = 'C'): Score {
  const score = createPianoScore({ id: 'recognized', title: `${step} piano` })
  return parseScore({
    ...score,
    measures: [
      {
        ...score.measures[0],
        voices: [
          {
            voiceId: score.voices[0].id,
            events: [
              {
                id: 'event',
                kind: 'note',
                onset: fraction(0),
                duration: { denominator: 4, dots: 0 },
                notes: [{ id: 'note', pitch: { step, alter: 0, octave: 4 } }],
              },
            ],
          },
        ],
      },
    ],
  })
}

/** Return a protocol response containing the real native file envelope. */
function response(score = music()) {
  return new Response(
    JSON.stringify({
      choices: [
        { finish_reason: 'stop', message: { content: serializeScore(score) } },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** Configure a real store using injected encryption and no live network credentials. */
async function store(path: string) {
  const settings = new RecognitionSettingsStore(
    join(path, 'ai', 'settings.json'),
    encryption,
  )
  await settings.save({ ...configuration, apiKey: dummyKey, clearKey: false })
  return settings
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('AI settings', () => {
  it('migrates old encrypted settings without losing key or changing the saved token limit', async () => {
    const path = await directory()
    const settings = await store(path)
    const previous = JSON.parse(await readFile(settings.path, 'utf8'))
    delete previous.reasoningMode
    delete previous.timeoutSeconds
    await writeFile(settings.path, JSON.stringify(previous))
    expect(await settings.get()).toMatchObject({
      reasoningMode: 'auto',
      timeoutSeconds: 180,
      maxTokens: 4096,
      hasKey: true,
    })
    expect((await settings.credentials()).apiKey).toBe(dummyKey)
    previous.reasoningMode = 'openrouter-off'
    await writeFile(settings.path, JSON.stringify(previous))
    expect(await settings.get()).toMatchObject({
      reasoningMode: 'auto',
      hasKey: true,
    })
    expect((await settings.credentials()).apiKey).toBe(dummyKey)
    await settings.save({
      ...configuration,
      reasoningMode: 'service-default',
      timeoutSeconds: 300,
      apiKey: '',
      clearKey: false,
    })
    expect(await settings.get()).toMatchObject({
      reasoningMode: 'service-default',
      timeoutSeconds: 300,
    })
    expect((await settings.credentials()).apiKey).toBe(dummyKey)
    await expect(
      settings.save({
        ...configuration,
        timeoutSeconds: 601,
        apiKey: '',
        clearKey: false,
      }),
    ).rejects.toThrow('有效协议')
  })
  it('stores only encrypted key bytes and requires an explicit key for a changed destination', async () => {
    const path = await directory()
    const settings = await store(path)
    expect(await readFile(settings.path, 'utf8')).not.toContain(dummyKey)
    expect(await settings.get()).toEqual({ ...configuration, hasKey: true })
    expect(JSON.stringify(await settings.get())).not.toContain('encryptedKey')
    expect((await settings.credentials()).apiKey).toBe(dummyKey)
    await expect(
      settings.save({
        ...configuration,
        baseUrl: 'https://different.test/v1',
        apiKey: '',
        clearKey: false,
      }),
    ).rejects.toThrow('服务地址或协议已改变')
    expect((await settings.credentials()).baseUrl).toBe(configuration.baseUrl)
    await settings.save({
      ...configuration,
      model: 'other-vision',
      apiKey: '',
      clearKey: false,
    })
    expect((await settings.credentials()).apiKey).toBe(dummyKey)
    await settings.save({ ...configuration, apiKey: '', clearKey: true })
    expect((await settings.get()).hasKey).toBe(false)
    await expect(settings.credentials()).rejects.toThrow('请先配置')
  })

  it('rejects plaintext backends and secret-bearing or non-local HTTP URLs without writing', async () => {
    const path = await directory()
    const settings = new RecognitionSettingsStore(join(path, 'settings.json'), {
      ...encryption,
      available: () => false,
    })
    await expect(
      settings.save({ ...configuration, apiKey: dummyKey, clearKey: false }),
    ).rejects.toThrow('加密不可用')
    await expect(readFile(settings.path)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const available = await store(path)
    for (const baseUrl of [
      'http://remote.test/v1',
      'https://user:pass@example.test/v1',
      'https://example.test/v1?api_key=secret',
      'file:///tmp/file',
    ]) {
      await expect(
        available.save({
          ...configuration,
          baseUrl,
          apiKey: dummyKey,
          clearKey: false,
        }),
      ).rejects.toThrow('有效协议')
    }
  })
})

describe('provider adapters', () => {
  const image: RecognitionPage = {
    id: 'source',
    name: 'source.png',
    kind: 'image',
    mediaType: 'image/png',
    bytes: png,
  }
  it('encodes direct DeepSeek SDK-compatible endpoints and token fields, rejecting unsupported PDF before HTTP', async () => {
    for (const baseUrl of [
      'https://api.deepseek.com',
      'https://api.deepseek.com/v1',
    ]) {
      const chat = providerRequest(
        { ...configuration, baseUrl, model: 'deepseek-flash' },
        dummyKey,
        image,
        1,
      )
      expect(chat.url).toBe(`${baseUrl}/chat/completions`)
      expect(chat.body).toMatchObject({
        max_tokens: 4096,
        thinking: { type: 'disabled' },
      })
      expect(chat.body).not.toHaveProperty('max_completion_tokens')
    }
    for (const baseUrl of [
      'https://api.deepseek.com/anthropic',
      'https://api.deepseek.com/anthropic/v1',
    ]) {
      const claude = providerRequest(
        {
          ...configuration,
          protocol: 'claude',
          baseUrl,
          model: 'deepseek-flash',
        },
        dummyKey,
        image,
        1,
      )
      expect(claude.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
      expect(claude.body).toMatchObject({
        max_tokens: 4096,
        thinking: { type: 'disabled' },
      })
      expect(claude.headers).toHaveProperty('x-api-key', dummyKey)
    }
    const request = vi.fn<typeof fetch>()
    await expect(
      recognizePage(
        {
          ...configuration,
          apiKey: dummyKey,
          baseUrl: 'https://api.deepseek.com/anthropic',
          protocol: 'claude',
        },
        { ...image, kind: 'pdf', mediaType: 'application/pdf' },
        1,
        new AbortController().signal,
        request,
      ),
    ).rejects.toThrow('PDF 页面转换成 PNG/JPEG')
    expect(request).not.toHaveBeenCalled()
  })
  it('adapts known services and mandatory reasoning without sending unknown gateway extensions', () => {
    const policy = (
      baseUrl: string,
      model: string,
      protocol = configuration.protocol as
        'openai-chat' | 'openai-responses' | 'claude',
    ) => reasoningParameters({ ...configuration, baseUrl, model, protocol })
    expect(policy('https://api.deepseek.com/v1', 'deepseek-flash')).toEqual({
      thinking: { type: 'disabled' },
    })
    expect(
      policy(
        'https://api.deepseek.com/v1',
        'deepseek-flash',
        'openai-responses',
      ),
    ).toEqual({ reasoning: { effort: 'none' } })
    expect(policy('https://api.openai.com/v1', 'gpt-5.5')).toEqual({
      reasoning_effort: 'none',
    })
    expect(
      policy('https://api.openai.com/v1', 'gpt-5.4', 'openai-responses'),
    ).toEqual({ reasoning: { effort: 'none' } })
    expect(
      policy('https://api.openai.com/v1', 'gpt-6-astra', 'openai-responses'),
    ).toEqual({ reasoning: { effort: 'low' } })
    for (const model of ['gpt-4o', 'gpt-5.3-codex', 'gpt-5.2-pro', 'o3']) {
      expect(policy('https://api.openai.com/v1', model)).toEqual({})
    }
    expect(
      policy('https://api.anthropic.com/v1', 'claude-sonnet-4-6', 'claude'),
    ).toEqual({ thinking: { type: 'disabled' } })
    expect(
      policy('https://api.anthropic.com/v1', 'claude-opus-5', 'claude'),
    ).toEqual({
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    })
    expect(
      policy('https://api.anthropic.com/v1', 'claude-sonnet-5.5', 'claude'),
    ).toEqual({
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    })
    expect(
      policy('https://api.anthropic.com/v1', 'claude-opus-5.5', 'claude'),
    ).toEqual({})
    expect(
      policy(
        'https://api.anthropic.com/v1',
        'claude-3-5-sonnet-latest',
        'claude',
      ),
    ).toEqual({})
    expect(policy('https://custom.test/v1', 'deepseek-flash')).toEqual({})
    expect(policy('https://api.deepseek.com.custom.test/v1', 'model')).toEqual(
      {},
    )
  })

  it('encodes explicit compatibility overrides and rejects mismatched protocols before requesting', () => {
    for (const [reasoningMode, protocol, expected] of [
      ['openai-none', 'openai-chat', { reasoning_effort: 'none' }],
      ['openai-none', 'openai-responses', { reasoning: { effort: 'none' } }],
      ['thinking-off', 'claude', { thinking: { type: 'disabled' } }],
      ['thinking-off', 'openai-chat', { thinking: { type: 'disabled' } }],
    ] as const) {
      expect(
        providerRequest(
          { ...configuration, reasoningMode, protocol },
          dummyKey,
          image,
          1,
        ).body,
      ).toMatchObject(expected)
    }
    expect(
      reasoningParameters({
        ...configuration,
        reasoningMode: 'service-default',
        baseUrl: 'https://api.deepseek.com',
      }),
    ).toEqual({})
    expect(() =>
      providerRequest(
        { ...configuration, protocol: 'claude', reasoningMode: 'openai-none' },
        dummyKey,
        image,
        1,
      ),
    ).toThrow('不适用于当前协议')
  })

  it('reports reasoning budget exhaustion separately from invalid music', () => {
    expect(() =>
      providerText('openai-chat', {
        choices: [{ finish_reason: 'length', message: { content: null } }],
        usage: { completion_tokens_details: { reasoning_tokens: 16384 } },
      }),
    ).toThrow('推理耗尽输出预算')
  })

  it('uses the configured deadline and distinguishes timeout from explicit cancellation', async () => {
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal)
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async (_url, init) => {
          const signal = init!.signal!
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }
          return await new Promise<Response>((_resolve, reject) =>
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            ),
          )
        })
      const pending = recognizePage(
        { ...configuration, apiKey: dummyKey },
        image,
        1,
        new AbortController().signal,
        request,
      )
      expect(timeout).toHaveBeenCalledWith(180_000)
      const rejected = expect(pending).rejects.toThrow('超过 180 秒')
      deadline.abort()
      await rejected
      const cancel = new AbortController()
      cancel.abort()
      await expect(
        recognizePage(
          { ...configuration, timeoutSeconds: 300, apiKey: dummyKey },
          image,
          1,
          cancel.signal,
          request,
        ),
      ).rejects.toThrow('识谱已取消。')
      expect(timeout).toHaveBeenLastCalledWith(300_000)
    } finally {
      timeout.mockRestore()
    }
  })
  it.each(['openai-chat', 'openai-responses', 'claude'] as const)(
    'encodes images and PDF bytes for %s',
    (protocol) => {
      const encoded = providerRequest(
        { ...configuration, protocol },
        dummyKey,
        image,
        1,
      )
      expect(encoded.url).toBe(
        `${configuration.baseUrl}/${protocol === 'claude' ? 'messages' : protocol === 'openai-responses' ? 'responses' : 'chat/completions'}`,
      )
      expect(JSON.stringify(encoded.body)).toContain(png.toString('base64'))
      expect(JSON.stringify(encoded.body)).not.toContain(dummyKey)
      const pdf = providerRequest(
        { ...configuration, protocol },
        dummyKey,
        {
          ...image,
          kind: 'pdf',
          mediaType: 'application/pdf',
          name: 'score.pdf',
        },
        2,
      )
      expect(JSON.stringify(pdf.body)).toContain(
        protocol === 'claude'
          ? 'document'
          : protocol === 'openai-responses'
            ? 'input_file'
            : 'file_data',
      )
    },
  )

  it('recognizes valid native music with bounded, non-redirecting requests', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response())
    const score = await recognizePage(
      { ...configuration, apiKey: dummyKey },
      image,
      1,
      new AbortController().signal,
      request,
    )
    expect(score).toEqual(music())
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'error', method: 'POST' }),
    )
  })

  it('rejects truncation, refusal, invalid music and oversized response bodies', async () => {
    expect(() =>
      providerText('openai-chat', {
        choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      }),
    ).toThrow('截断')
    expect(() =>
      providerText('claude', { stop_reason: 'max_tokens', content: [] }),
    ).toThrow('未完成')
    expect(() =>
      providerText('openai-responses', { status: 'incomplete', output: [] }),
    ).toThrow('未完成')
    expect(() =>
      parseRecognitionScore('{"secret":"do not echo this"}'),
    ).toThrow('音乐规则')
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    await expect(
      recognizePage(
        { ...configuration, apiKey: dummyKey },
        image,
        1,
        new AbortController().signal,
        request,
      ),
    ).rejects.toThrow('超过 2 MiB')
  })

  it('does not echo remote error bodies or thrown credential-bearing details', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(dummyKey, { status: 401 }))
    const result = await recognitionResult(() =>
      recognizePage(
        { ...configuration, apiKey: dummyKey },
        image,
        1,
        new AbortController().signal,
        request,
      ),
    )
    expect(JSON.stringify(result)).toContain('HTTP 401')
    expect(JSON.stringify(result)).not.toContain(dummyKey)
    request.mockRejectedValue(new Error(dummyKey))
    const failed = await recognitionResult(() =>
      recognizePage(
        { ...configuration, apiKey: dummyKey },
        image,
        1,
        new AbortController().signal,
        request,
      ),
    )
    expect(JSON.stringify(failed)).not.toContain(dummyKey)
  })
})

describe('sources and task ownership', () => {
  it('splits a two-page PDF after ordered images and rejects invalid source headers', async () => {
    const path = await directory()
    const image = join(path, 'screenshot.png')
    await writeFile(image, png)
    const pdf = await PDFDocument.create()
    pdf.addPage()
    pdf.addPage()
    const pdfPath = join(path, 'music.pdf')
    await writeFile(pdfPath, await pdf.save())
    const pages = await prepareSources([image, pdfPath])
    expect(pages.map((page) => page.kind)).toEqual(['image', 'pdf', 'pdf'])
    expect(pages[2].name).toContain('第 2 页')
    expect((await PDFDocument.load(pages[1].bytes)).getPageCount()).toBe(1)
    expect(new Set(pages.map((page) => page.id)).size).toBe(3)
    await writeFile(image, 'not PNG')
    await expect(prepareSources([image])).rejects.toThrow('有效的 PNG')
    await expect(prepareSources(['relative.png'])).rejects.toThrow('文件选择器')
  })

  it('retains successful pages, retries only failed pages and merges fresh identities in requested order', async () => {
    const path = await directory()
    const files = [join(path, 'first.png'), join(path, 'second.png')]
    await Promise.all(files.map((file) => writeFile(file, png)))
    const settings = await store(path)
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(music('C')))
      .mockResolvedValueOnce(new Response('private', { status: 429 }))
      .mockResolvedValueOnce(response(music('D')))
    const service = new RecognitionService(settings, async () => files, request)
    const selected = await service.chooseSources()
    if (selected.status !== 'success') {
      throw new Error('Expected sources')
    }
    const taskId = selected.value.id
    const ids = selected.value.sources.map((source) => source.id)
    expect(
      (await service.run({ taskId, sourceIds: ids })).sources.map(
        (source) => source.status,
      ),
    ).toEqual(['success', 'error'])
    expect(service.result({ taskId, sourceIds: ids }).measures).toHaveLength(1)
    const partial = service.resultWithSources({ taskId, sourceIds: ids })
    expect(partial.sourceOrder).toEqual(ids)
    expect(partial.fragments).toEqual([
      {
        sourceId: ids[0],
        measureIds: partial.score.measures.map((measure) => measure.id),
      },
    ])
    await service.run({ taskId, sourceIds: [ids[1]] })
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[2][1]?.body).toContain('source page 2')
    const merged = service.result({ taskId, sourceIds: [...ids].reverse() })
    expect(merged.measures).toHaveLength(2)
    const first = merged.measures[0].voices[0].events[0]
    expect(first.kind === 'note' && first.notes[0].pitch.step).toBe('D')
    expect(() => parseScore(merged)).not.toThrow()
    expect(merged.measures[0].id).not.toBe(merged.measures[1].id)
    const complete = service.resultWithSources({
      taskId,
      sourceIds: [...ids].reverse(),
    })
    expect(complete.fragments.map((fragment) => fragment.sourceId)).toEqual(
      [...ids].reverse(),
    )
    expect(
      complete.fragments.flatMap((fragment) => fragment.measureIds),
    ).toEqual(complete.score.measures.map((measure) => measure.id))
    service.dispose()
  })

  it('reserves the run before awaiting credentials and discards a late cancelled response', async () => {
    const path = await directory()
    const file = join(path, 'source.png')
    await writeFile(file, png)
    const settings = await store(path)
    let complete!: (response: Response) => void
    const request = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const service = new RecognitionService(
      settings,
      async () => [file],
      request,
    )
    await service.chooseSources()
    const task = service.getTask()!
    const input = {
      taskId: task.id,
      sourceIds: task.sources.map((source) => source.id),
    }
    const running = service.run(input)
    await expect(service.run(input)).rejects.toThrow('正在运行')
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    service.cancel(task.id)
    complete(response())
    expect((await running).sources[0].status).toBe('pending')
    expect(() => service.result(input)).toThrow('尚无通过校验')
    await expect(
      service.run({
        ...input,
        sourceIds: [input.sourceIds[0], input.sourceIds[0]],
      }),
    ).rejects.toThrow('无效')
    service.dispose()
  })
})

it('composes all anchored marks with remapped identities without changing original pages', () => {
  const score = music()
  const withDynamic = parseScore({
    ...score,
    marks: [{ id: 'dynamic', kind: 'dynamic', eventId: 'event', value: 'p' }],
  })
  const before = serializeScore(withDynamic)
  const merged = combineRecognitionScores(
    [withDynamic, withDynamic],
    'combined',
  )
  expect(merged.marks).toHaveLength(2)
  expect(merged.marks[0]).toMatchObject({
    eventId: merged.measures[0].voices[0].events[0].id,
  })
  expect(serializeScore(withDynamic)).toBe(before)
})
