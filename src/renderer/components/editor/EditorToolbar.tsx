/** Compose explicit mode and duration controls using accessible Radix selection groups. */
import { ToggleGroup } from 'radix-ui'
import { Undo2, Redo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NotatedDuration } from '../../../core'
import type { EditorSession, EditorSnapshot } from '../../../editor/session'

/** Configure subsequent inputs without silently rewriting existing rhythmic content. */
export function EditorToolbar({
  session,
  state,
}: {
  session: EditorSession
  state: EditorSnapshot
}) {
  return (
    <div className="editor-toolbar" aria-label="音乐输入工具">
      <div className="toolbar-history">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="撤销"
          disabled={!state.canUndo}
          onClick={() => session.undo()}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="重做"
          disabled={!state.canRedo}
          onClick={() => session.redo()}
        >
          <Redo2 />
        </Button>
      </div>
      <ToggleGroup.Root
        type="single"
        value={state.mode}
        aria-label="编辑模式"
        onValueChange={(value) => {
          if (value === 'write' || value === 'edit') {
            session.setMode(value)
          }
        }}
        className="segmented"
      >
        <ToggleGroup.Item value="write">
          输入 <kbd>N</kbd>
        </ToggleGroup.Item>
        <ToggleGroup.Item value="edit">选择</ToggleGroup.Item>
      </ToggleGroup.Root>
      <ToggleGroup.Root
        type="single"
        value={String(state.duration.denominator)}
        aria-label="输入时值"
        className="segmented duration-controls"
        onValueChange={(value) => {
          if (value) {
            session.setDuration({
              ...state.duration,
              denominator: Number(value) as NotatedDuration['denominator'],
            })
          }
        }}
      >
        {([1, 2, 4, 8, 16, 32] as const).map((duration) => (
          <ToggleGroup.Item
            key={duration}
            value={String(duration)}
            aria-label={`${duration}分音符`}
          >
            {duration === 1 ? '全音符' : `1/${duration}`}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <ToggleGroup.Root
        type="single"
        value={String(state.duration.dots)}
        aria-label="附点"
        className="segmented"
        onValueChange={(value) => {
          if (value) {
            session.setDuration({ ...state.duration, dots: Number(value) })
          }
        }}
      >
        <ToggleGroup.Item value="0" aria-label="无附点">
          无附点
        </ToggleGroup.Item>
        <ToggleGroup.Item value="1" aria-label="附点">
          ·
        </ToggleGroup.Item>
      </ToggleGroup.Root>
      <Button
        size="sm"
        variant={state.duration.tuplet ? 'secondary' : 'ghost'}
        aria-pressed={Boolean(state.duration.tuplet)}
        onClick={() =>
          session.setDuration({
            denominator: state.duration.denominator,
            dots: state.duration.dots,
            ...(state.duration.tuplet
              ? {}
              : { tuplet: { actual: 3, normal: 2 } }),
          })
        }
      >
        三连音
      </Button>
      <Button size="sm" variant="ghost" onClick={() => session.inputRest()}>
        休止 <kbd>R</kbd>
      </Button>
    </div>
  )
}
