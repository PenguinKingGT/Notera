/** Verify real MusicXML/MXL disk exchange, normal editing and failed-import preservation in Electron. */
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { deserializeScore } from '../../src/core'
import { importMusicXml, packMxl, unpackMxl } from '../../src/exchange'
import { launchDesktop, stopDesktop } from './desktop'

test('imports external piano, edits and undoes, saves native and exports both formats', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    const xml = await readFile('tests/fixtures/external-piano.musicxml', 'utf8')
    const importedPath = join(userDataDir, 'external.mxl')
    const originalArchive = Buffer.from(packMxl(xml))
    await writeFile(importedPath, originalArchive)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      })
    }, importedPath)
    await expect(page.getByRole('button', { name: '乐谱交换' })).toBeEnabled()
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导入 MusicXML / MXL' }).click()
    await expect(page.getByTestId('event-count')).toHaveText('10 个音乐事件')
    await expect(page.getByTestId('document-status')).toHaveText('有未保存更改')
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await canvas.locator('g.note[data-note-id]').first().click()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled()
    await page.getByRole('button', { name: '撤销' }).click()
    const nativePath = join(userDataDir, 'imported.notera')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, nativePath)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'imported.notera',
    )
    const native = deserializeScore(await readFile(nativePath, 'utf8'))
    expect(native.measures[0].voices[0].events[0]).toMatchObject({
      notes: [
        { pitch: { step: 'C', alter: 1, octave: 5 } },
        { pitch: { step: 'E', alter: 0, octave: 5 } },
      ],
    })
    expect(native.marks).toHaveLength(5)
    for (const compressed of [false, true]) {
      const path = join(
        userDataDir,
        compressed ? 'export.mxl' : 'export.musicxml',
      )
      await app.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: target,
        })
      }, path)
      await page.getByRole('button', { name: '乐谱交换' }).click()
      await page
        .getByRole('menuitem', {
          name: compressed ? '导出压缩 MXL' : '导出 MusicXML',
          exact: true,
        })
        .click()
      await expect
        .poll(async () => {
          try {
            return (await readFile(path)).length > 0
          } catch {
            return false
          }
        })
        .toBe(true)
      const bytes = await readFile(path)
      const exported = importMusicXml(
        compressed ? unpackMxl(bytes) : bytes.toString('utf8'),
      ).score
      expect(exported.title).toBe(native.title)
      expect(exported.marks).toHaveLength(5)
      await expect(page.getByTestId('document-status')).toHaveText(
        'imported.notera',
      )
    }
    const invalid = join(userDataDir, 'broken.musicxml')
    await writeFile(invalid, '<score-partwise>broken')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, invalid)
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导入 MusicXML / MXL' }).click()
    await expect(page.getByRole('alert')).toContainText('XML 格式损坏')
    await expect(page.getByTestId('event-count')).toHaveText('10 个音乐事件')
    const warningPath = join(userDataDir, 'decorated.musicxml')
    await writeFile(
      warningPath,
      xml.replace(
        '<notations>',
        '<notations><articulations><staccato/></articulations>',
      ),
    )
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      })
    }, warningPath)
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导入 MusicXML / MXL' }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'imported.notera',
    )
    await expect(page.getByTestId('event-count')).toHaveText('10 个音乐事件')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, nativePath)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.getByTestId('event-count')).toHaveText('10 个音乐事件')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    await mkdir('logs', { recursive: true })
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await expect(
      page.getByRole('menuitem', { name: '导入 MusicXML / MXL' }),
    ).toBeVisible()
    await page.screenshot({
      path: 'logs/musicxml-exchange-preview.png',
      animations: 'disabled',
    })
    expect(await readFile(importedPath)).toEqual(originalArchive)
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
