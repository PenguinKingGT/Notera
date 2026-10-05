/** Verify real beam engraving, selection/undo after edits, compound meter and offline PDF export. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { createPianoScore, fraction, serializeScore } from '../../src/core'
import { launchDesktop, stopDesktop } from './desktop'

test('automatically beams ordinary and compound rhythms without losing editable note identities', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('radio', { name: '8分音符', exact: true }).click()
    await canvas.focus()
    for (const pitch of ['c', 'd', 'e', 'f', 'g', 'a', 'b', 'c']) {
      await page.keyboard.press(pitch)
    }
    await expect(canvas.locator('g.beam')).toHaveCount(4)
    await expect(canvas.locator('g[data-note-id]')).toHaveCount(8)
    const first = canvas.locator('g[data-note-id]').first()
    const identity = await first.getAttribute('data-note-id')
    await first.click()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('selection-description')).toContainText('D4')
    await expect(
      canvas.locator(`g[data-note-id="${identity}"]`),
    ).toHaveAttribute('data-selected', 'true')
    await expect(canvas.locator('g.beam')).toHaveCount(4)
    await page.keyboard.press('Backspace')
    await expect(canvas.locator('g.beam')).toHaveCount(3)
    await expect(canvas.locator('g[data-note-id]')).toHaveCount(7)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(canvas.locator('g.beam')).toHaveCount(4)
    await expect(canvas.locator(`g[data-note-id="${identity}"]`)).toHaveCount(1)
    const savedPath = join(userDataDir, 'beamed.notera')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, savedPath)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'beamed.notera',
    )
    const initial = createPianoScore({
      id: 'compound',
      title: '6/8 自动连梁',
      measureCount: 1,
    })
    const compound = {
      ...initial,
      measures: [
        {
          ...initial.measures[0],
          timeSignature: { beats: 6, beatType: 8 as const },
          voices: initial.voices.map((voice) => ({
            voiceId: voice.id,
            events: Array.from({ length: 6 }, (_, index) => ({
              id: `${voice.id}-event-${index}`,
              kind: 'note' as const,
              onset: fraction(index, 8),
              duration: { denominator: 8 as const, dots: 0 },
              notes: [
                {
                  id: `${voice.id}-note-${index}`,
                  pitch: {
                    step: 'C' as const,
                    alter: 0,
                    octave: voice === initial.voices[0] ? 4 : 3,
                  },
                },
              ],
            })),
          })),
        },
      ],
    }
    const compoundPath = join(userDataDir, 'compound.notera')
    await writeFile(compoundPath, serializeScore(compound))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, compoundPath)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByTestId('document-status')).toHaveText(
      'compound.notera',
    )
    await expect(canvas.locator('g.beam')).toHaveCount(4)
    await expect(canvas.locator('g[data-note-id]')).toHaveCount(12)
    const before = await readFile(compoundPath, 'utf8')
    const pdfPath = join(userDataDir, 'beamed.pdf')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, pdfPath)
    await page.getByRole('button', { name: '乐谱交换', exact: true }).click()
    await page
      .getByRole('menuitem', { name: '导出五线谱 PDF', exact: true })
      .click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'compound.notera',
    )
    await expect
      .poll(async () => {
        try {
          return (await readFile(pdfPath)).length
        } catch {
          return 0
        }
      })
      .toBeGreaterThan(0)
    const pdfBytes = await readFile(pdfPath)
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1)
    expect(await readFile(compoundPath, 'utf8')).toBe(before)
    await mkdir('logs', { recursive: true })
    await writeFile('logs/beaming-export.pdf', pdfBytes)
    await page.screenshot({ path: 'logs/beaming-preview.png' })
    // A real eighth-triplet group receives one beam while keeping all three selectable notes.
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.getByRole('radio', { name: '8分音符', exact: true }).click()
    await page.getByRole('button', { name: '三连音', exact: true }).click()
    await canvas.focus()
    for (const pitch of ['c', 'd', 'e']) {
      await page.keyboard.press(pitch)
    }
    await expect(canvas.locator('g.tuplet')).toHaveCount(1)
    await expect(canvas.locator('g.beam')).toHaveCount(1)
    await expect(canvas.locator('g[data-note-id]')).toHaveCount(3)
    expect(failures).toEqual([])
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
