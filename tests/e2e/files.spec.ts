/** Verify real main-process disk operations and crash recovery through the renderer's narrow document API. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop, stopDesktop } from './desktop'
import { deserializeScore } from '../../src/core'

test('saves, saves as, opens, retains failed operations and cancels native close', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    const canvas = page.getByTestId('score-canvas')
    await expect(
      page.getByRole('button', { name: '保存', exact: true }),
    ).toBeEnabled()
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.focus()
    await page.keyboard.press('c')
    await page.keyboard.press('Shift+e')
    await page.keyboard.press('r')
    const firstPath = join(userDataDir, 'first.notera')
    // Replace only native picker outcomes; production IPC, validation, snapshot tracking and disk writes stay real.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, firstPath)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('first.notera')
    const original = deserializeScore(await readFile(firstPath, 'utf8'))
    expect(original.measures[0].voices[0].events).toHaveLength(2)
    await canvas.focus()
    await page.keyboard.press('g')
    const secondPath = join(userDataDir, 'second.notera')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, secondPath)
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'second.notera',
    )
    expect(deserializeScore(await readFile(firstPath, 'utf8'))).toEqual(
      original,
    )
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, firstPath)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    const invalidPath = join(userDataDir, 'broken.notera')
    await writeFile(invalidPath, 'not JSON')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, invalidPath)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('有效的 Notera 乐谱')
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.locator('g.rest[data-event-id]').click()
    await page.keyboard.press('n')
    await page.keyboard.press('d')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByTestId('event-count')).toHaveText('3 个音乐事件')
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({
        canceled: true,
        filePath: '',
      })
    })
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('有未保存更改')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText('first.notera')
    await mkdir('logs', { recursive: true })
    await page.screenshot({ path: 'logs/file-workflow-preview.png' })
    expect(await page.evaluate(() => 'require' in window)).toBe(false)
    await canvas.focus()
    await page.keyboard.press('f')
    await app.evaluate(({ app }) => {
      app.quit()
    })
    await expect(page.getByRole('alertdialog')).toBeVisible()
    const closing = app.waitForEvent('close')
    await page.getByRole('button', { name: '保存并继续', exact: true }).click()
    await closing
    expect(
      deserializeScore(await readFile(firstPath, 'utf8')).measures[0].voices[0]
        .events,
    ).toHaveLength(4)
    await expect(
      readFile(join(userDataDir, 'recovery', 'current.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('restores a crash checkpoint as editable untitled music and preserves it until saved', async () => {
  const first = await launchDesktop()
  let active = first.app
  try {
    let page = await active.firstWindow()
    await expect(
      page.getByRole('button', { name: '保存', exact: true }),
    ).toBeEnabled()
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.focus()
    await page.keyboard.press('c')
    await page.keyboard.press('d')
    const recoveryPath = join(first.userDataDir, 'recovery', 'current.json')
    await expect
      .poll(async () => {
        try {
          return JSON.parse(
            await readFile(recoveryPath, 'utf8'),
          ).scoreFile.includes('notes')
        } catch {
          return false
        }
      })
      .toBe(true)
    await page.reload()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '恢复乐谱', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    await stopDesktop(active)
    active = (await launchDesktop(first.userDataDir)).app
    page = await active.firstWindow()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: '恢复乐谱', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('2 个音乐事件')
    await expect(page.getByTestId('document-status')).toHaveText('有未保存更改')
    const path = join(first.userDataDir, 'recovered.notera')
    await active.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      })
    }, path)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'recovered.notera',
    )
    expect(
      deserializeScore(await readFile(path, 'utf8')).measures[0].voices[0]
        .events,
    ).toHaveLength(2)
    await expect
      .poll(async () => {
        try {
          await readFile(recoveryPath)
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
  } finally {
    await stopDesktop(active)
    await rm(first.userDataDir, { recursive: true, force: true })
  }
})
