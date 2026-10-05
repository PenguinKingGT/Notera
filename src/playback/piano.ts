/** Decode bundled Salamander samples and schedule independent Tone.js sources in an owned offline-capable context. */
import { Context, Gain, Limiter, ToneBufferSource } from 'tone'
import type { PianoAudio, AudioAttack } from './controller'

const sampleUrls = import.meta.glob('../assets/piano/*.mp3', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Translate the fixed sample filenames into MIDI pitches, including upstream Ds/Fs spelling. */
function samplePitch(path: string): number {
  const match = /\/(C|Ds|Fs|A)(\d)\.mp3$/.exec(path)!
  const steps: Record<string, number> = { C: 0, Ds: 3, Fs: 6, A: 9 }
  return (Number(match[2]) + 1) * 12 + steps[match[1]]
}

/** Own decoded resources and sources; source disposal cancels future attacks as well as sounding notes. */
export class SampledPiano implements PianoAudio {
  readonly #context = new Context({
    clockSource: 'timeout',
    lookAhead: 0,
    latencyHint: 'interactive',
  })
  readonly #limiter = new Limiter({
    context: this.#context,
    threshold: -1,
  }).toDestination()
  readonly #output = new Gain({
    context: this.#context,
    gain: 0.22,
  }).connect(this.#limiter)
  readonly #sources = new Set<ToneBufferSource>()
  readonly #buffers = new Map<number, AudioBuffer>()
  readonly #abort = new AbortController()
  #loading: Promise<void> | null = null
  #disposed = false

  /** Resume only after the user requests playback, and decode all local samples once per context. */
  async prepare(): Promise<void> {
    await this.#context.resume()
    if (!this.#loading) {
      this.#loading = this.load()
    }
    await this.#loading
    if (this.#disposed) {
      throw new Error('钢琴音频资源已关闭。')
    }
  }

  /** Load local bundled bytes with bounded requests; any incomplete bank fails explicitly. */
  private async load(): Promise<void> {
    const results = await Promise.allSettled(
      Object.entries(sampleUrls).map(async ([path, url]) => {
        const response = await globalThis.fetch(url, {
          signal: AbortSignal.any([
            this.#abort.signal,
            AbortSignal.timeout(30_000),
          ]),
        })
        if (!response.ok) {
          throw new Error(`无法加载钢琴采样：${path.split('/').at(-1)}`)
        }
        const buffer = await this.#context.decodeAudioData(
          await response.arrayBuffer(),
        )
        if (!this.#disposed) {
          this.#buffers.set(samplePitch(path), buffer)
        }
      }),
    )
    if (
      Object.keys(sampleUrls).length !== 30 ||
      results.some((result) => result.status === 'rejected')
    ) {
      throw new Error('本地钢琴音色加载失败，请停止后重试。')
    }
  }

  /** Expose the audio hardware clock for musical transport. */
  now(): number {
    return this.#context.currentTime
  }

  /** Detect system suspension rather than allowing a visual clock to drift silently. */
  running(): boolean {
    return this.#context.state === 'running'
  }

  /** Repitch the nearest sample and give each occurrence its own release envelope. */
  schedule({ note, start, end, offset }: AudioAttack): void {
    let nearest = -1
    for (const pitch of this.#buffers.keys()) {
      if (
        nearest < 0 ||
        Math.abs(pitch - note.pitch) < Math.abs(nearest - note.pitch)
      ) {
        nearest = pitch
      }
    }
    const buffer = this.#buffers.get(nearest)
    if (!buffer || this.#disposed) {
      throw new Error('钢琴音色尚未准备好。')
    }
    const rate = 2 ** ((note.pitch - nearest) / 12)
    // Natural sample decay may already be exhausted after a long held note; never substitute a new attack.
    if (offset * rate >= buffer.duration) {
      return
    }
    const source = new ToneBufferSource({
      context: this.#context,
      url: buffer,
      playbackRate: rate,
      fadeIn: 0.003,
      fadeOut: 0.12,
      onended: () => {
        this.#sources.delete(source)
        source.dispose()
      },
    }).connect(this.#output)
    this.#sources.add(source)
    source.start(start, offset * rate, undefined, note.velocity)
    source.stop(end)
  }

  /** Immediately disconnect every owned source, including notes queued ahead of the current clock. */
  silence(): void {
    for (const source of this.#sources) {
      source.cancelStop()
      source.dispose()
    }
    this.#sources.clear()
  }

  /** Abort loading and close the owned context without modifying Tone's global context. */
  dispose(): void {
    this.#disposed = true
    this.#abort.abort()
    this.silence()
    this.#buffers.clear()
    this.#output.dispose()
    this.#limiter.dispose()
    this.#context.dispose()
  }
}
