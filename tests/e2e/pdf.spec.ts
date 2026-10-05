/** Validate real offline single/multiple-page PDF output and native-state preservation through desktop IPC. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { deserializeScore, serializeScore } from '../../src/core'
import { launchDesktop, stopDesktop } from './desktop'

test('exports vector A4 piano pages offline without changing native save state', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    await page.getByRole('button', { name: '示例谱', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('有未保存更改')
    const status = await page.getByTestId('document-status').textContent()
    const count = await page.getByTestId('event-count').textContent()
    const output = join(userDataDir, 'piano.pdf')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, output)
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导出五线谱 PDF' }).click()
    await expect(page.getByText(/已导出 piano.pdf/)).toBeVisible({
      timeout: 20_000,
    })
    const bytes = await readFile(output)
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBe(1)
    for (const printed of document.getPages()) {
      expect(printed.getWidth()).toBeCloseTo(595.28, 0)
      expect(printed.getHeight()).toBeCloseTo(841.89, 0)
    }
    await expect(page.getByTestId('document-status')).toHaveText(status!)
    await expect(page.getByTestId('event-count')).toHaveText(count!)
    await mkdir('logs', { recursive: true })
    await writeFile('logs/staff-export-single.pdf', bytes)
    // Repeat an original musical example with fresh document-local identities to create genuine automatic pagination.
    const original = deserializeScore(
      await readFile('tests/fixtures/piano-core.notera.json', 'utf8'),
    )
    const measures = Array.from({ length: 40 }, (_, index) => {
      const source = original.measures[index % 2]
      return {
        ...source,
        id: `long-measure-${index}`,
        voices: source.voices.map((lane) => ({
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
      }
    })
    const longPath = join(userDataDir, 'long.notera')
    await writeFile(
      longPath,
      serializeScore({
        ...original,
        title: '原创钢琴分页验证',
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
    await page.getByRole('button', { name: '放弃并继续', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('long.notera')
    const longOutput = join(userDataDir, 'long.pdf')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, longOutput)
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导出五线谱 PDF' }).click()
    await expect(page.getByText(/已导出 long.pdf/)).toBeVisible({
      timeout: 20_000,
    })
    const longBytes = await readFile(longOutput)
    const longPdf = await PDFDocument.load(longBytes)
    expect(longPdf.getPageCount()).toBeGreaterThan(1)
    await expect(
      page.getByText(
        `已导出 long.pdf（${longPdf.getPageCount()} 页）；原生保存状态未改变。`,
      ),
    ).toBeVisible()
    expect(await readFile(longPath, 'utf8')).toContain('原创钢琴分页验证')
    await writeFile(resolve('logs/staff-export-multiple.pdf'), longBytes)
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({
        canceled: true,
        filePath: '',
      })
    })
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导出五线谱 PDF' }).click()
    await expect(page.getByTestId('document-status')).toHaveText('long.notera')
    await expect(page.getByRole('button', { name: '乐谱交换' })).toBeEnabled()
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
