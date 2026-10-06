/** Exercise recognition through a local fake HTTP service, real trusted IPC, encrypted settings and editable import. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import {
  createPianoScore,
  deserializeScore,
  fraction,
  serializeScore,
} from '../../src/core'
import { launchDesktop, stopDesktop } from './desktop'

/** Produce a tiny hand-authored score; this verifies plumbing, not visual-model recognition accuracy. */
function fixture(step: 'C' | 'D') {
  const score = createPianoScore({
    id: 'fake-service-score',
    title: 'AI 导入测试',
  })
  return {
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
                kind: 'note' as const,
                onset: fraction(0),
                duration: { denominator: 4 as const, dots: 0 },
                notes: [{ id: 'note', pitch: { step, alter: 0, octave: 4 } }],
              },
            ],
          },
        ],
      },
    ],
  }
}

test('configures AI, retains partial results, retries a page and imports editable music without silent replacement', async () => {
  let calls = 0
  const bodies: Record<string, unknown>[] = []
  const paths: string[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(chunk as Buffer)
    }
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()))
    paths.push(request.url!)
    calls += 1
    response.setHeader('content-type', 'application/json')
    if (calls === 2) {
      response.writeHead(503)
      response.end('{"error":"temporary fixture failure"}')
      return
    }
    const text = serializeScore(fixture(calls === 1 ? 'C' : 'D'))
    if (request.url?.endsWith('/messages')) {
      response.end(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text }],
        }),
      )
    } else if (request.url?.endsWith('/responses')) {
      response.end(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'output_text', text }] },
          ],
        }),
      )
    } else {
      response.end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: text } }],
        }),
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const { app, userDataDir } = await launchDesktop()
  const dummyKey = 'notera-local-test-key'
  try {
    const page = await app.firstWindow()
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.focus()
    await page.keyboard.press('g')
    await page.getByRole('button', { name: 'AI 识谱', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'AI 五线谱识别' })
    await expect(panel.getByLabel('服务地址', { exact: true })).toHaveValue('')
    await expect(panel.getByLabel('视觉模型', { exact: true })).toHaveValue('')
    await expect(
      panel.getByRole('button', { name: '使用 DeepSeek 配置', exact: true }),
    ).toHaveCount(0)
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    await panel.getByLabel('服务地址', { exact: true }).fill(baseUrl)
    await panel.getByLabel('服务协议').selectOption('claude')
    await expect(panel.getByLabel('服务地址', { exact: true })).toHaveValue(
      baseUrl,
    )
    await panel.getByLabel('服务协议').selectOption('openai-chat')
    await expect(panel.getByLabel('服务地址', { exact: true })).toHaveValue(
      baseUrl,
    )
    await panel
      .getByLabel('视觉模型', { exact: true })
      .fill('local-fixture-vision')
    await panel.getByLabel('API Key', { exact: true }).fill(dummyKey)
    await expect(
      panel.getByLabel('单页超时（秒）', { exact: true }),
    ).toHaveValue('180')
    await panel
      .getByLabel('推理策略', { exact: true })
      .selectOption('thinking-off')
    await panel
      .getByRole('button', { name: '保存 AI 配置', exact: true })
      .click()
    await expect(panel.getByRole('status')).toHaveText('AI 配置已保存。')
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('')
    const settingsBytes = await readFile(
      join(userDataDir, 'ai', 'settings.json'),
      'utf8',
    )
    expect(settingsBytes).not.toContain(dummyKey)
    expect(settingsBytes).toContain('encryptedKey')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD9sAAAAASUVORK5CYII=',
      'base64',
    )
    const selected = [
      join(userDataDir, 'first.png'),
      join(userDataDir, 'second.png'),
    ]
    await Promise.all(selected.map((path) => writeFile(path, png)))
    await app.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
    }, selected)
    await panel
      .getByRole('button', { name: '选择图片或 PDF', exact: true })
      .click()
    const sources = panel.getByRole('region', { name: '识谱来源页' })
    await expect(sources.getByRole('listitem')).toHaveCount(2)
    await panel
      .getByRole('button', { name: '上移 second.png', exact: true })
      .click()
    await expect(sources.getByRole('listitem').first()).toContainText(
      'second.png',
    )
    await panel
      .getByRole('button', { name: '开始识谱 / 重试未完成页', exact: true })
      .click()
    await expect(sources.getByRole('listitem').first()).toContainText(
      '通过乐谱校验',
    )
    await expect(sources.getByRole('listitem').last()).toContainText('HTTP 503')
    expect(calls).toBe(2)
    expect(JSON.stringify(bodies[0])).toContain('image_url')
    expect(bodies[0].thinking).toEqual({ type: 'disabled' })
    const publicSettings = await page.evaluate(() =>
      window.notera.recognition.getSettings(),
    )
    expect(JSON.stringify(publicSettings)).not.toContain(dummyKey)
    expect(JSON.stringify(publicSettings)).not.toContain('encryptedKey')
    await mkdir('logs', { recursive: true })
    await sources.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'logs/recognition-preview.png' })
    await panel
      .getByRole('button', { name: '导入成功页为新乐谱', exact: true })
      .click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('1 个音乐事件')
    await page.getByRole('button', { name: 'AI 识谱', exact: true }).click()
    await panel
      .getByRole('button', { name: '导入成功页为新乐谱', exact: true })
      .click()
    await page.getByRole('button', { name: '放弃并继续', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('1 个音乐事件')
    // The previous document also has one note; its SVG stays visible during engraving.
    // Wait for the imported score before clicking a painted notehead, not the group's blank area.
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await expect(canvas.locator('g[data-note-id]')).toHaveCount(1)
    await canvas.locator('g[data-note-id] .notehead use').first().click()
    await expect(page.getByTestId('selection-description')).toContainText('C4')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('selection-description')).toContainText('D4')
    // Retry after accepting and editing a partial import; merge must preserve the edited D4.
    await page.getByRole('button', { name: 'AI 识谱', exact: true }).click()
    await panel
      .getByRole('button', { name: '重试 first.png', exact: true })
      .click()
    await expect(sources.getByRole('listitem').last()).toContainText(
      '通过乐谱校验',
    )
    expect(calls).toBe(3)
    await panel
      .getByRole('button', { name: '按来源顺序补入当前乐谱', exact: true })
      .click()
    await expect(panel.getByRole('status')).toContainText('已有编辑保留')
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    await panel
      .getByRole('button', { name: '按来源顺序补入当前乐谱', exact: true })
      .click()
    await expect(panel.getByText(/没有可重复加入的页/)).toBeVisible()
    await page.screenshot({ path: 'logs/recognition-merge-preview.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('selection-description')).toContainText('D4')
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('1 个音乐事件')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.locator('g[data-note-id] .notehead use').first().click()
    await expect(page.getByTestId('selection-description')).toContainText('D4')
    await page.getByRole('button', { name: '重做', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    const saved = join(userDataDir, 'recognized.notera')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, saved)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'recognized.notera',
    )
    const music = deserializeScore(await readFile(saved, 'utf8'))
    expect(music.measures).toHaveLength(2)
    const editedEvent = music.measures[0].voices[0].events[0]
    expect(editedEvent.kind === 'note' && editedEvent.notes[0].pitch.step).toBe(
      'D',
    )
    expect(JSON.stringify(music)).not.toContain(dummyKey)
    expect(await readFile(selected[0])).toEqual(png)
    // Reuse the same real protocol boundary for Claude PDF and Responses image inputs.
    await page.getByRole('button', { name: 'AI 识谱', exact: true }).click()
    await panel.getByLabel('服务协议').selectOption('claude')
    await expect(panel.getByLabel('推理策略', { exact: true })).toHaveValue(
      'auto',
    )
    await panel
      .getByLabel('推理策略', { exact: true })
      .selectOption('thinking-off')
    await panel.getByLabel('API Key', { exact: true }).fill(dummyKey)
    await panel
      .getByRole('button', { name: '保存 AI 配置', exact: true })
      .click()
    await expect(panel.getByRole('status')).toHaveText('AI 配置已保存。')
    const pdf = await PDFDocument.create()
    pdf.addPage()
    const pdfPath = join(userDataDir, 'source.pdf')
    await writeFile(pdfPath, await pdf.save())
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      })
    }, pdfPath)
    await panel
      .getByRole('button', { name: '选择图片或 PDF', exact: true })
      .click()
    await expect(sources.getByRole('listitem')).toHaveCount(1)
    await panel
      .getByRole('button', { name: '开始识谱 / 重试未完成页', exact: true })
      .click()
    await expect(sources.getByRole('listitem')).toContainText('通过乐谱校验')
    expect(paths.at(-1)).toBe('/v1/messages')
    expect(JSON.stringify(bodies.at(-1))).toContain('application/pdf')
    expect(bodies.at(-1)?.thinking).toEqual({ type: 'disabled' })
    await panel.getByLabel('服务协议').selectOption('openai-responses')
    await panel
      .getByLabel('推理策略', { exact: true })
      .selectOption('openai-none')
    await panel.getByLabel('单页超时（秒）', { exact: true }).fill('300')
    await panel.getByLabel('API Key', { exact: true }).fill(dummyKey)
    await panel
      .getByRole('button', { name: '保存 AI 配置', exact: true })
      .click()
    await expect(panel.getByRole('status')).toHaveText('AI 配置已保存。')
    await app.evaluate(
      ({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
      },
      [selected[0]],
    )
    await panel
      .getByRole('button', { name: '选择图片或 PDF', exact: true })
      .click()
    await panel
      .getByRole('button', { name: '开始识谱 / 重试未完成页', exact: true })
      .click()
    await expect(sources.getByRole('listitem')).toContainText('通过乐谱校验')
    expect(paths.at(-1)).toBe('/v1/responses')
    expect(bodies.at(-1)?.reasoning).toEqual({ effort: 'none' })
    const policySettings = await page.evaluate(() =>
      window.notera.recognition.getSettings(),
    )
    expect(policySettings).toMatchObject({
      status: 'success',
      value: { reasoningMode: 'openai-none', timeoutSeconds: 300 },
    })
    await panel
      .getByRole('button', { name: '删除已保存 Key', exact: true })
      .click()
    await expect(panel.getByRole('status')).toHaveText('AI 配置已保存。')
    await expect(
      panel.getByRole('button', {
        name: '开始识谱 / 重试未完成页',
        exact: true,
      }),
    ).toBeDisabled()
    expect(failures).toEqual([])
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
