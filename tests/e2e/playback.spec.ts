/** Exercise offline sampled piano, transient score following and cancellation through the real desktop UI. */
import { mkdir, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launchDesktop, stopDesktop } from './desktop'

test('plays local piano samples and preserves music while pausing, changing tempo and editing', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    await page.getByRole('button', { name: '示例谱', exact: true }).click()
    const canvas = page.getByTestId('score-canvas')
    await expect(canvas).toHaveAttribute('aria-busy', 'false')
    const count = await page.getByTestId('event-count').textContent()
    const status = await page.getByTestId('document-status').textContent()
    const position = page.getByTestId('playback-position')
    await page.evaluate(() => {
      const observations = { analysers: [] as AnalyserNode[], attacks: 0 }
      Object.assign(window, { pianoObservations: observations })
      const connect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function (
        this: AudioNode,
        ...args: unknown[]
      ) {
        const result = Reflect.apply(connect, this, args)
        if (args[0] instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser()
          Reflect.apply(connect, this, [analyser])
          observations.analysers.push(analyser)
        }
        return result
      } as typeof connect
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (
        ...args: Parameters<typeof start>
      ) {
        observations.attacks++
        return Reflect.apply(start, this, args)
      }
    })
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'playing')
    await expect.poll(() => audioLevel(page)).toBeGreaterThan(0.0001)
    await expect(canvas.locator('g[data-playing="true"]').first()).toBeVisible()
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'paused')
    await expect(canvas.locator('g[data-playing="true"]')).toHaveCount(0)
    await expect.poll(() => audioLevel(page)).toBeLessThan(0.00001)
    const paused = await position.textContent()
    await page.waitForTimeout(200)
    expect(await position.textContent()).toBe(paused)
    await page.getByLabel('播放速度 BPM').fill('60')
    await page.getByRole('button', { name: '继续播放', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'playing')
    await expect(page.getByTestId('event-count')).toHaveText(count!)
    await expect(page.getByTestId('document-status')).toHaveText(status!)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 800),
    )
    const settings = await page.locator('.playback-settings').boundingBox()
    const indicator = await position.boundingBox()
    expect(settings).not.toBeNull()
    expect(settings!.width).toBeGreaterThan(200)
    expect(indicator).not.toBeNull()
    const separateRows = indicator!.y >= settings!.y + settings!.height
    expect(separateRows || indicator!.x >= settings!.x + settings!.width).toBe(
      true,
    )
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 820),
    )
    await mkdir('logs', { recursive: true })
    await page.screenshot({ path: 'logs/playback-preview.png' })
    await canvas.focus()
    await page.keyboard.press('Space')
    await expect(position).toHaveAttribute('data-status', 'paused')
    await page.keyboard.press('Space')
    await expect(position).toHaveAttribute('data-status', 'playing')
    await canvas.locator('g[data-note-id]').first().click()
    await page.keyboard.press('ArrowUp')
    await expect(position).toHaveAttribute('data-status', 'stopped')
    await expect(canvas.locator('g[data-playing="true"]')).toHaveCount(0)
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'playing')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'stopped')
    await page.getByRole('button', { name: '放弃并继续', exact: true }).click()
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('没有可试听')
    expect(failures).toEqual([])
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/** Read the actual desktop output graph without adding a diagnostic API to the application. */
async function audioLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const observations = (
      window as unknown as { pianoObservations: { analysers: AnalyserNode[] } }
    ).pianoObservations
    return observations.analysers.reduce((peak, analyser) => {
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(
        samples.reduce((total, value) => total + value * value, 0) /
          samples.length,
      )
      return Math.max(peak, rms)
    }, 0)
  })
}

test('recovers from a failed local sample bank and stops before a cancelled import', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await page.context().setOffline(true)
    await page.getByRole('button', { name: '示例谱', exact: true }).click()
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window)
      let failed = false
      window.fetch = (input, init) => {
        if (!failed && String(input).endsWith('.mp3')) {
          failed = true
          return Promise.reject(new Error('Injected sample failure'))
        }
        return fetch(input, init)
      }
    })
    const position = page.getByTestId('playback-position')
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'error')
    await expect(page.getByRole('alert')).toContainText('音色加载失败')
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(position).toHaveAttribute('data-status', 'playing')
    // Saving keeps transport alive; replacement starts stopping it before the native picker returns.
    await app.evaluate(({ dialog }, profile) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: `${profile}/playback.notera`,
      })
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    }, userDataDir)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByTestId('document-status')).toHaveText(
      'playback.notera',
    )
    await expect(position).toHaveAttribute('data-status', 'playing')
    await page.getByRole('button', { name: '乐谱交换' }).click()
    await page.getByRole('menuitem', { name: '导入 MusicXML / MXL' }).click()
    await expect(position).toHaveAttribute('data-status', 'stopped')
    await expect(page.getByTestId('document-status')).toHaveText(
      'playback.notera',
    )
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
