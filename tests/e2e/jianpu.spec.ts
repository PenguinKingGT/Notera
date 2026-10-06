/** Exercise numbered-notation synchronization, read-only behavior, real offline vector PDF and independent pagination. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { deserializeScore, serializeScore } from '../../src/core'
import { launchDesktop, stopDesktop } from './desktop'

test('shares edits with a read-only piano Jianpu view and exports independent A4 pages offline', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('radio', { name: '4分音符', exact: true }).click()
    await canvas.focus()
    await page.keyboard.press('c')
    await expect(page.getByTestId('event-count')).toHaveText('1 个音乐事件')
    await page.getByRole('radio', { name: '简谱', exact: true }).click()
    const jianpu = page.getByTestId('jianpu-canvas')
    await expect(jianpu).toHaveAttribute('aria-busy', 'false')
    await expect(
      jianpu.locator('[data-first="true"] [data-degree="1"]'),
    ).toHaveCount(1)
    await expect(jianpu.getByText('右手', { exact: true })).toBeVisible()
    await expect(jianpu.getByText('左手', { exact: true })).toBeVisible()
    await expect(jianpu.locator('[data-context="true"]')).toHaveCount(1)
    await expect(jianpu.locator('[data-piano-bracket="true"]')).toHaveCount(1)
    await jianpu.focus()
    await page.keyboard.press('g')
    await expect(page.getByTestId('event-count')).toHaveText('1 个音乐事件')

    await page.getByRole('radio', { name: '五线谱', exact: true }).click()
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.locator('g.note').first().click()
    await page.keyboard.press('ArrowUp')
    await page.getByRole('radio', { name: '简谱', exact: true }).click()
    await expect(jianpu).toHaveAttribute('aria-busy', 'false')
    await expect(
      jianpu.locator('[data-first="true"] [data-degree="2"]'),
    ).toHaveCount(1)
    await page.keyboard.press('Meta+z')
    await expect(
      jianpu.locator('[data-first="true"] [data-degree="1"]'),
    ).toHaveCount(1)

    const fixture = resolve('tests/fixtures/piano-core.notera.json')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, fixture)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await page.getByRole('button', { name: '放弃并继续', exact: true }).click()
    await expect(jianpu).toHaveAttribute('aria-busy', 'false')
    await expect(
      jianpu.locator(
        '[data-first="true"][data-event-id="event-chord"] [data-note-id]',
      ),
    ).toHaveCount(2)
    await expect(jianpu.locator('[data-tuplet="3"]')).toHaveCount(1)
    await expect(jianpu.getByText('右手 2', { exact: true })).toBeVisible()
    for (const kind of ['tie', 'slur', 'dynamic', 'pedal']) {
      await expect(
        jianpu.locator(`[data-mark-kind="${kind}"]`).first(),
      ).toBeVisible()
    }
    const aligned = await jianpu.evaluate((host) => {
      return ['event-chord', 'event-inner-1', 'event-lower-chord'].map((id) =>
        host
          .querySelector(`[data-first="true"][data-event-id="${id}"] text`)
          ?.getAttribute('x'),
      )
    })
    expect(new Set(aligned).size).toBe(1)
    expect(aligned[0]).toBeTruthy()
    const beforeStatus = await page.getByTestId('document-status').textContent()
    const beforeCount = await page.getByTestId('event-count').textContent()
    const nativeBytes = await readFile(fixture)
    const output = join(userDataDir, 'numbered.pdf')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, output)
    await page.getByRole('button', { name: '乐谱交换', exact: true }).click()
    await page
      .getByRole('menuitem', { name: '导出简谱 PDF', exact: true })
      .click()
    await expect(page.getByText(/已导出 numbered.pdf/)).toBeVisible({
      timeout: 20_000,
    })
    const bytes = await readFile(output)
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 0)
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89, 0)
    await expect(page.getByTestId('document-status')).toHaveText(beforeStatus!)
    await expect(page.getByTestId('event-count')).toHaveText(beforeCount!)
    expect(await readFile(fixture)).toEqual(nativeBytes)
    await mkdir('logs', { recursive: true })
    await writeFile('logs/jianpu-export-single.pdf', bytes)
    await page.screenshot({ path: 'logs/jianpu-preview.png' })

    const original = deserializeScore(nativeBytes.toString())
    const measures = Array.from({ length: 24 }, (_, index) => ({
      ...original.measures[index % 2],
      id: `jianpu-measure-${index}`,
      voices: original.measures[index % 2].voices.map((lane) => ({
        ...lane,
        events: lane.events.map((event) => ({
          ...event,
          id: `${event.id}-${index}`,
          ...(event.kind === 'note'
            ? {
                notes: event.notes.map((note) => ({
                  ...note,
                  id: `${note.id}-${index}`,
                })),
              }
            : {}),
        })),
      })),
    }))
    const longPath = join(userDataDir, 'jianpu-long.notera')
    await writeFile(
      longPath,
      serializeScore({
        ...original,
        title: '原创钢琴简谱分页验证',
        measures,
        marks: [],
      }),
    )
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, longPath)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'jianpu-long.notera',
    )
    await expect(jianpu).toHaveAttribute('aria-busy', 'false')
    const pages = await jianpu.locator('.score-page').count()
    expect(pages).toBeGreaterThan(1)
    const longOutput = join(userDataDir, 'jianpu-long.pdf')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, longOutput)
    await page.getByRole('button', { name: '乐谱交换', exact: true }).click()
    await page
      .getByRole('menuitem', { name: '导出简谱 PDF', exact: true })
      .click()
    await expect(page.getByText(/已导出 jianpu-long.pdf/)).toBeVisible({
      timeout: 20_000,
    })
    const longBytes = await readFile(longOutput)
    expect((await PDFDocument.load(longBytes)).getPageCount()).toBe(pages)
    await writeFile('logs/jianpu-export-multiple.pdf', longBytes)
    await page.screenshot({ path: 'logs/jianpu-multiple-preview.png' })
    await expect(page.getByTestId('document-status')).toHaveText(
      'jianpu-long.notera',
    )
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
    })
    await page.getByRole('button', { name: '乐谱交换', exact: true }).click()
    await page
      .getByRole('menuitem', { name: '导出简谱 PDF', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: '乐谱交换', exact: true }),
    ).toBeEnabled()
    await expect(page.getByTestId('document-status')).toHaveText(
      'jianpu-long.notera',
    )
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
