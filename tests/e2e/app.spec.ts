import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

test('launches the desktop shell with isolated IPC', async () => {
  const executablePath = process.env.NOTERA_EXECUTABLE_PATH
  const app = await electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve('.')],
  })
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
      'getAppInfo',
    ])
  } finally {
    await app.close()
  }
})
