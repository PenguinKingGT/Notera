/** Run an offline engine comparison and emit reviewable SVG/PNG/PDF plus measured JSON. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import { allEvents, createScore, editScore } from './fixtures.mjs'
import { toMei, toMusicXml } from './formats.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = resolve(
  scriptDirectory,
  '../../test-results/notation-benchmark',
)

/** Fail on missing, empty or clipped event regions so incorrect adapter margins are visible. */
function validateGeometry(geometry, label) {
  assert.deepEqual(geometry.missing, [], `${label}: missing stable IDs`)
  assert.deepEqual(geometry.empty, [], `${label}: empty painted regions`)
  assert.deepEqual(
    geometry.clipped,
    [],
    `${label}: clipped event regions ${JSON.stringify(geometry.clipped.map((id) => geometry.boxes[id]))}`,
  )
  assert.equal(
    geometry.mapped,
    geometry.expected,
    `${label}: incomplete mapping`,
  )
}

/** Load a full score into a fresh toolkit and measure all pages, excluding WASM initialization. */
function renderVerovio(module, data, width, format = 'mei') {
  const toolkit = new VerovioToolkit(module)
  try {
    toolkit.setOptions({
      inputFrom: format,
      pageWidth: Math.round(width * 2.5),
      pageHeight: 2800,
      scale: 40,
      adjustPageHeight: false,
      breaks: 'auto',
      header: 'none',
      footer: 'none',
      xmlIdSeed: 1,
    })
    const started = performance.now()
    assert.ok(toolkit.loadData(data), `Verovio could not load ${format}`)
    const pages = toolkit.getPageCount()
    const svgs = Array.from({ length: pages }, (_, index) =>
      toolkit.renderToSVG(index + 1),
    )
    return {
      renderMs: performance.now() - started,
      pages,
      svgs,
      version: toolkit.getVersion(),
    }
  } finally {
    toolkit.destroy()
  }
}

/** Produce one small standalone review page; each SVG is isolated to avoid duplicate IDs. */
function reviewHtml(cases) {
  const sections = cases
    .map((item) => {
      const artifacts = item.artifacts.map(
        (file) => `
        <p><a href="${file}">${file}</a></p>
        <iframe title="${file}" src="${file}" width="1050" height="600"></iframe>`,
      )
      return `
        <section>
          <h2>${item.name}</h2>
          <p>Measures: ${item.measures}. See results.json for timings and ID/geometry checks.</p>
          ${artifacts.join('')}
        </section>`
    })
    .join('')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Notera engine comparison</title>
    <style>
      body { font: 16px system-ui; margin: 32px; max-width: 1100px; }
      iframe { border: 1px solid #ddd; display: block; }
      section { margin-bottom: 40px; }
    </style>
  </head>
  <body>
    <h1>Notera engine comparison</h1>
    <p>Offline evaluation, not the product editor. VexFlow systems are placed by benchmark code;
      Verovio paginates automatically. Passing ID checks does not establish engraving quality.</p>
    ${sections}
  </body>
</html>`
}

/** Write source expectations and both interchange inputs before engine rendering. */
async function saveSources(name, score) {
  await writeFile(
    resolve(outputDirectory, `${name}.expected.json`),
    `${JSON.stringify(score, null, 2)}\n`,
  )
  await writeFile(resolve(outputDirectory, `${name}.mei`), toMei(score))
  await writeFile(
    resolve(outputDirectory, `${name}.musicxml`),
    toMusicXml(score),
  )
}

/** Compare baseline, changed pitch/chord, narrow width and a repeated multi-page score. */
async function run() {
  await mkdir(outputDirectory, { recursive: true })
  // Invalidate previous results before starting so a failed run cannot leave a stale success report.
  await writeFile(
    resolve(outputDirectory, 'results.json'),
    `${JSON.stringify({ status: 'running' })}\n`,
  )
  const server = await createServer({
    configFile: false,
    root: scriptDirectory,
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { include: ['vexflow'] },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1300 },
    })
    const browserErrors = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    await page.goto(server.resolvedUrls.local[0])
    await page.waitForFunction(() => Boolean(globalThis.notationBenchmark))
    const wasmStarted = performance.now()
    const module = await createVerovioModule()
    const wasmInitMs = performance.now() - wasmStarted
    const base = createScore()
    const inputs = [
      { name: 'piano-4', score: base, width: 1000 },
      { name: 'piano-4-edited', score: editScore(base), width: 1000 },
      { name: 'piano-4-narrow', score: base, width: 650 },
      { name: 'piano-48', score: createScore(48), width: 1000 },
    ]
    const cases = []
    for (const input of inputs) {
      await saveSources(input.name, input.score)
      const vexflow = await page.evaluate(
        ({ score, width }) =>
          globalThis.notationBenchmark.renderVexflow(score, width),
        input,
      )
      validateGeometry(vexflow.geometry, `${input.name}/vexflow`)
      const vexflowFile = `${input.name}.vexflow.svg`
      await writeFile(resolve(outputDirectory, vexflowFile), vexflow.svg)
      await page.locator('#score').screenshot({
        path: resolve(outputDirectory, `${input.name}.vexflow.png`),
      })
      const verovio = renderVerovio(module, toMei(input.score), input.width)
      const geometry = await page.evaluate(
        ({ svgs, score }) =>
          globalThis.notationBenchmark.mountVerovio(svgs, score),
        { svgs: verovio.svgs, score: input.score },
      )
      validateGeometry(geometry, `${input.name}/verovio`)
      const verovioFiles = []
      for (let index = 0; index < verovio.svgs.length; index += 1) {
        const file = `${input.name}.verovio.page-${index + 1}.svg`
        verovioFiles.push(file)
        await writeFile(resolve(outputDirectory, file), verovio.svgs[index])
        await page
          .locator('#score > svg')
          .nth(index)
          .screenshot({
            path: resolve(outputDirectory, file.replace('.svg', '.png')),
          })
      }
      if (input.name === 'piano-4') {
        // The same source is rendered to a PDF and raster page for a future real recognition run.
        await page.addStyleTag({
          content:
            '@media print { @page { size: A4; margin: 0; } #score { width: 100%; } #score > svg { width: 100%; height: auto; break-after: page; } }',
        })
        await page.pdf({
          path: resolve(outputDirectory, 'recognition-input.pdf'),
          printBackground: true,
          preferCSSPageSize: true,
        })
      }
      const { svg, ...vexflowMetrics } = vexflow
      void svg
      cases.push({
        name: input.name,
        measures: input.score.measures.length,
        width: input.width,
        events: allEvents(input.score).length,
        vexflow: vexflowMetrics,
        verovio: {
          renderMs: verovio.renderMs,
          pages: verovio.pages,
          version: verovio.version,
          geometry,
        },
        artifacts: [vexflowFile, ...verovioFiles],
      })
      console.log(
        `${input.name}: VexFlow ${vexflow.renderMs.toFixed(1)}ms, Verovio ${verovio.renderMs.toFixed(1)}ms/${verovio.pages} pages; IDs ${geometry.mapped}/${geometry.expected}`,
      )
    }
    const importResult = renderVerovio(
      module,
      toMusicXml(base),
      1000,
      'musicxml',
    )
    const importedSvg = importResult.svgs.join('')
    const musicXmlImport = {
      pages: importResult.pages,
      renderMs: importResult.renderMs,
      svgNotes: (importedSvg.match(/class="note"/g) ?? []).length,
      expectedPitchedNotes: allEvents(base).reduce(
        (total, event) => total + event.pitches.length,
        0,
      ),
    }
    assert.equal(
      musicXmlImport.svgNotes,
      musicXmlImport.expectedPitchedNotes,
      'MusicXML importer changed the pitched note count',
    )
    await writeFile(
      resolve(outputDirectory, 'piano-4.musicxml-import.svg'),
      importResult.svgs[0],
    )
    assert.deepEqual(browserErrors, [], 'Browser rendering errors')
    for (const engine of ['vexflow', 'verovio']) {
      const baselineIds = Object.keys(cases[0][engine].geometry.boxes).sort()
      assert.deepEqual(
        Object.keys(cases[1][engine].geometry.boxes).sort(),
        baselineIds,
        `${engine}: edit changed event identities`,
      )
      assert.notDeepEqual(
        cases[0][engine].geometry.boxes,
        cases[1][engine].geometry.boxes,
        `${engine}: edit did not change geometry`,
      )
    }
    const restored = renderVerovio(module, toMei(base), 1000)
    const restoredGeometry = await page.evaluate(
      ({ svgs, score }) =>
        globalThis.notationBenchmark.mountVerovio(svgs, score),
      { svgs: restored.svgs, score: base },
    )
    assert.deepEqual(
      restoredGeometry.boxes,
      cases[0].verovio.geometry.boxes,
      'Restoring baseline changed geometry',
    )
    assert.ok(
      cases[3].verovio.pages > 1,
      'Long score did not exercise pagination',
    )
    const result = {
      status: 'passed',
      recordedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        browser: browser.version(),
        platform: process.platform,
        arch: process.arch,
      },
      wasmInitMs,
      timings:
        'Single samples; Verovio uses Node WASM, VexFlow uses browser SVG. Not a controlled performance ranking.',
      checks: {
        stableIdsAfterEdit: true,
        geometryChangedAfterEdit: true,
        verovioGeometryRestored: true,
        verovioMultiPage: true,
      },
      musicXmlImport,
      cases,
    }
    await writeFile(
      resolve(outputDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    await writeFile(resolve(outputDirectory, 'index.html'), reviewHtml(cases))
    console.log(`Artifacts: ${outputDirectory}/index.html`)
  } finally {
    if (browser) {
      await browser.close()
    }
    await server.close()
  }
}

await run()
