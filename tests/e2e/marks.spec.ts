/** Verify authored marks in real offline engraving, transactional history and native disk persistence. */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { deserializeScore } from '../../src/core'
import { launchDesktop, stopDesktop } from './desktop'

test('creates and revises musical marks, engraves them and preserves them on reopen', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.focus()
    await page.keyboard.press('c')
    await page.keyboard.press('c')
    await page.keyboard.press('d')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    const notes = canvas.locator('g[data-note-id]')
    await expect(notes).toHaveCount(3)
    await notes.first().click()
    const inspector = page.getByRole('region', {
      name: '音乐记号',
      exact: true,
    })
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('力度值', { exact: true }).selectOption('p')
    await inspector
      .getByRole('button', { name: '添加到乐谱', exact: true })
      .click()
    await expect(canvas.locator('g.dynam')).toHaveCount(1)
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('记号类型').selectOption('tie')
    await inspector
      .getByRole('button', { name: '添加到乐谱', exact: true })
      .click()
    await expect(canvas.locator('g.tie')).toHaveCount(1)
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('记号类型').selectOption('slur')
    // Pick the third event so the slur covers both C notes and the final D.
    const ends = await page
      .getByLabel('记号终点')
      .locator('option')
      .evaluateAll((options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .filter(Boolean),
      )
    await page.getByLabel('记号终点').selectOption(ends.at(-1)!)
    await inspector
      .getByRole('button', { name: '添加到乐谱', exact: true })
      .click()
    await expect(canvas.locator('g.slur')).toHaveCount(1)
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('记号类型').selectOption('pedal')
    await inspector
      .getByRole('button', { name: '添加到乐谱', exact: true })
      .click()
    await expect(canvas.locator('g.pedal')).toHaveCount(2)
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('记号类型').selectOption('repeat')
    await page.getByLabel('演奏遍数').fill('3')
    await inspector
      .getByRole('button', { name: '添加到乐谱', exact: true })
      .click()
    await expect(inspector.getByRole('listitem')).toHaveCount(5)
    await expect(canvas.locator('g.dir')).toContainText('3×')
    await inspector.getByRole('button', { name: /^修改力度/ }).click()
    await page.getByLabel('力度值', { exact: true }).selectOption('ff')
    await inspector
      .getByRole('button', { name: '应用记号修改', exact: true })
      .click()
    await expect(
      inspector.getByRole('button', { name: /^修改力度 ff/ }),
    ).toBeVisible()
    await inspector.getByRole('button', { name: /^删除连奏线/ }).click()
    await expect(canvas.locator('g.slur')).toHaveCount(0)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(canvas.locator('g.slur')).toHaveCount(1)
    const path = join(userDataDir, 'marks.notera')
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      })
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [target],
      })
    }, path)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('marks.notera')
    const score = deserializeScore(await readFile(path, 'utf8'))
    expect(score.marks.map((mark) => mark.kind).sort()).toEqual([
      'dynamic',
      'pedal',
      'repeat',
      'slur',
      'tie',
    ])
    expect(score.marks.find((mark) => mark.kind === 'dynamic')).toMatchObject({
      value: 'ff',
    })
    expect(score.marks.find((mark) => mark.kind === 'repeat')).toMatchObject({
      times: 3,
    })
    // A file replacement must discard an uncommitted mark draft, even when the score ID is unchanged.
    await inspector.getByRole('button', { name: /^修改力度/ }).click()
    await page.getByLabel('力度值', { exact: true }).selectOption('ppp')
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByRole('form', { name: '修改音乐记号' })).toHaveCount(
      0,
    )
    await expect(inspector.getByRole('listitem')).toHaveCount(5)
    await expect(
      inspector.getByRole('button', { name: /^修改力度 ff/ }),
    ).toBeVisible()
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await expect(canvas.locator('g.tie')).toHaveCount(1)
    // The final D cannot tie forward; the form must refuse submission without changing music.
    await canvas.locator('g[data-note-id]').last().click()
    await inspector
      .getByRole('button', { name: '添加记号', exact: true })
      .click()
    await page.getByLabel('记号类型').selectOption('tie')
    await expect(
      inspector.getByRole('button', { name: '添加到乐谱', exact: true }),
    ).toBeDisabled()
    await inspector
      .getByRole('button', { name: '取消记号编辑', exact: true })
      .click()
    await expect(page.getByTestId('document-status')).toHaveText('marks.notera')
    await inspector.getByRole('button', { name: /^修改基础反复/ }).click()
    await page.getByLabel('演奏遍数').scrollIntoViewIfNeeded()
    await mkdir('logs', { recursive: true })
    await page.screenshot({ path: 'logs/mark-editing-preview.png' })
    expect(errors).toEqual([])
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
