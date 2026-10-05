/** Download official version-4.0 schemas and verify exported/original piano fixtures using a local XSD validator. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'

const directory = resolve('logs/musicxml-schema')
await mkdir(directory, { recursive: true })

// Schemas come from one pinned official tag. Local import paths plus --nonet prevent validator network resolution.
const names = ['musicxml.xsd', 'xml.xsd', 'xlink.xsd']
const responses = await Promise.all(
  names.map(async (name) => {
    const response = await fetch(
      `https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/${name}`,
      { signal: AbortSignal.timeout(20_000) },
    )
    if (!response.ok) {
      throw new Error(`Official schema download failed: ${response.status}`)
    }
    return (await response.text())
      .replaceAll('http://www.musicxml.org/xsd/xml.xsd', 'xml.xsd')
      .replaceAll('http://www.musicxml.org/xsd/xlink.xsd', 'xlink.xsd')
  }),
)
for (const [index, name] of names.entries()) {
  await writeFile(join(directory, name), responses[index])
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
})
try {
  const { exportMusicXml } = await server.ssrLoadModule(
    '/src/exchange/export.ts',
  )
  const native = JSON.parse(
    await readFile('tests/fixtures/piano-core.notera.json', 'utf8'),
  )
  const exported = join(directory, 'original.musicxml')
  await writeFile(exported, exportMusicXml(native.score))
  for (const path of [
    exported,
    resolve('tests/fixtures/external-piano.musicxml'),
  ]) {
    execFileSync(
      'xmllint',
      ['--nonet', '--noout', '--schema', join(directory, 'musicxml.xsd'), path],
      { stdio: 'inherit' },
    )
  }
} finally {
  await server.close()
}
