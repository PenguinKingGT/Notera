/** Isolate each desktop test's profile and force cleanup without depending on a user-facing close decision. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import type { ChildProcess } from 'node:child_process'
import type { ElectronApplication } from 'playwright'

const processes = new WeakMap<ElectronApplication, ChildProcess>()

/** Launch production or packaged Electron with an app-owned temporary recovery directory. */
export async function launchDesktop(profile?: string) {
  const userDataDir =
    profile ?? (await mkdtemp(join(tmpdir(), 'notera-desktop-')))
  const executablePath = process.env.NOTERA_EXECUTABLE_PATH
  const app = await electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve('.')],
    env: { ...process.env, NOTERA_USER_DATA_DIR: userDataDir },
  })
  processes.set(app, app.process())
  return { app, userDataDir }
}

/** Kill only the test's child process; this also models abnormal exit for recovery integration tests. */
export async function stopDesktop(app: ElectronApplication): Promise<void> {
  // Playwright releases its process channel after a normal exit; retain the owned child handle for cleanup.
  const process = processes.get(app)!
  if (process.exitCode !== null || process.signalCode !== null) {
    return
  }
  const exited = new Promise<void>((resolve) =>
    process.once('exit', () => resolve()),
  )
  process.kill('SIGKILL')
  await exited
}
