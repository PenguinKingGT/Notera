/** Present transport controls while subscribing locally so the score editor does not rerender at audio-clock frequency. */
import { useSyncExternalStore, useState } from 'react'
import { Play, Pause, Square } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import type { PlaybackController } from '../../../playback/controller'
import type { EditorSession } from '../../../editor/session'

/** Keep tempo and following outside score files; playback never creates an undoable music edit. */
export function PlaybackToolbar({
  playback,
  session,
  disabled,
}: {
  playback: PlaybackController
  session: EditorSession
  disabled: boolean
}) {
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot)
  const [tempoDraft, setTempoDraft] = useState<string | null>(null)
  const playing = state.status === 'playing'
  const beat = state.visit
    ? Math.max(
        0,
        state.position -
          (4 * state.visit.start.numerator) / state.visit.start.denominator,
      )
    : 0
  return (
    <section className="playback-toolbar" aria-label="钢琴试听">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || state.status === 'loading'}
        onClick={() =>
          playing
            ? playback.pause()
            : void playback.play(session.getSnapshot().score)
        }
      >
        {playing ? (
          <Pause data-icon="inline-start" />
        ) : (
          <Play data-icon="inline-start" />
        )}
        {playing
          ? '暂停'
          : state.status === 'loading'
            ? '加载音色…'
            : state.status === 'paused'
              ? '继续播放'
              : '播放'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={state.status === 'stopped'}
        onClick={() => playback.stop()}
      >
        <Square data-icon="inline-start" />
        停止
      </Button>
      <FieldGroup className="playback-settings">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="playback-tempo">速度 ♩ =</FieldLabel>
          <Input
            id="playback-tempo"
            aria-label="播放速度 BPM"
            type="number"
            min={30}
            max={240}
            value={tempoDraft ?? state.bpm}
            onChange={(event) => {
              setTempoDraft(event.target.value)
              playback.setTempo(Number(event.target.value))
            }}
            onBlur={() => setTempoDraft(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            className="w-20"
          />
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="playback-follow"
            checked={state.follow}
            onCheckedChange={(checked) => playback.setFollow(checked === true)}
          />
          <FieldLabel htmlFor="playback-follow">谱面跟随</FieldLabel>
        </Field>
      </FieldGroup>
      <output data-testid="playback-position" data-status={state.status}>
        {state.visit
          ? `第 ${state.visit.index + 1} 小节 · 第 ${Math.floor((beat * state.visit.beatType) / 4) + 1} 拍 · 第 ${state.visit.pass} 遍`
          : state.status === 'paused'
            ? '已暂停'
            : '从头播放'}
      </output>
      <span
        className="piano-credit"
        title="Salamander Grand Piano · Alexander Holm · CC BY 3.0 · https://creativecommons.org/licenses/by/3.0/ · MP3 source: https://github.com/Tonejs/audio/tree/master/salamander"
      >
        Salamander · Alexander Holm · CC BY 3.0
      </span>
      {state.error ? (
        <span className="playback-error" role="alert">
          {state.error}
        </span>
      ) : null}
    </section>
  )
}
