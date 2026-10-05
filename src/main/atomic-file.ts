/** Replace score/recovery files through synced temporary siblings, preserving the old file on pre-commit failure. */
import { randomUUID } from 'node:crypto'
import { open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Write, sync and replace in the same directory; failed writes remove only the temporary sibling. */
export async function atomicWrite(
  path: string,
  content: string | Uint8Array,
  replace: typeof rename = rename,
): Promise<void> {
  let mode = 0o600
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  )
  try {
    const file = await open(temporary, 'wx', mode)
    try {
      await file.writeFile(content, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await replace(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
