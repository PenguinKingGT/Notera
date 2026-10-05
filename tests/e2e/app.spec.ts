/** Verify the isolated window exposes only documented desktop capabilities. */
import { rm } from 'node:fs/promises'
import { launchDesktop, stopDesktop } from './desktop'
import { expect, test } from '@playwright/test'

test('launches the desktop shell with isolated IPC', async () => {
  const { app, userDataDir } = await launchDesktop()
  try {
    const page = await app.firstWindow()
    await expect(
      page.getByRole('heading', { name: 'Notera', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '关于 Notera' }).click()
    await expect(
      page.getByText('Notera · 0.1.0', { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => 'require' in window)).toBe(false)
    expect(await page.evaluate(() => Object.keys(window.notera))).toEqual([
      'recognition',
      'getAppInfo',
      'initializeDocument',
      'createDocument',
      'openDocument',
      'importMusic',
      'exportMusic',
      'exportPdf',
      'saveDocument',
      'checkpointDocument',
      'resolveRecovery',
      'closeDocument',
      'cancelCloseRequest',
      'onCloseRequested',
    ])
    expect(
      await page.evaluate(() => Object.keys(window.notera.recognition)),
    ).toEqual([
      'getSettings',
      'saveSettings',
      'chooseSources',
      'getTask',
      'run',
      'cancel',
      'result',
    ])
  } finally {
    await stopDesktop(app)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
