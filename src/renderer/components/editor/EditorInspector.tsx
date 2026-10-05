/** Show active musical location and selected-note properties independently of score engraving. */
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { findEvent } from '../../../editor/session'
import type { EditorSession, EditorSnapshot } from '../../../editor/session'

/** Edit one chosen chord tone or delete its event through the session's transactional interface. */
export function EditorInspector({
  session,
  state,
}: {
  session: EditorSession
  state: EditorSnapshot
}) {
  const measureIndex = state.score.measures.findIndex(
    (measure) => measure.id === state.cursor.measureId,
  )
  const selected =
    state.selection && findEvent(state.score, state.selection.eventId)
  const note =
    selected?.event.kind === 'note'
      ? selected.event.notes.find((item) => item.id === state.selection?.noteId)
      : undefined

  return (
    <aside className="editor-inspector" aria-label="输入与选择属性">
      <h2>钢琴谱</h2>
      <label htmlFor="voice">谱表 / 声部</label>
      <select
        id="voice"
        value={state.cursor.voiceId}
        onChange={(event) => session.setVoice(event.target.value)}
      >
        {state.score.voices.map((voice) => {
          const staff = state.score.staves.find(
            (item) => item.id === voice.staffId,
          )!
          const siblings = state.score.voices.filter(
            (item) => item.staffId === voice.staffId,
          )
          return (
            <option key={voice.id} value={voice.id}>
              {staff.clef === 'treble' ? '高音谱表' : '低音谱表'} · 声部{' '}
              {siblings.indexOf(voice) + 1}
            </option>
          )
        })}
      </select>
      <label htmlFor="octave">输入八度</label>
      <select
        id="octave"
        value={state.octave}
        onChange={(event) => session.setOctave(Number(event.target.value))}
      >
        {Array.from({ length: 10 }, (_, octave) => (
          <option key={octave} value={octave}>
            {octave}
            {octave === 4 ? ' · 中央 C' : ''}
          </option>
        ))}
      </select>
      <div className="inspector-section">
        <h3>当前位置</h3>
        <p>第 {measureIndex + 1} 小节</p>
        <p className="tabular">
          起点 {state.cursor.onset.numerator}/{state.cursor.onset.denominator}{' '}
          全音符
        </p>
        <span className="mode-label">
          {state.mode === 'write' ? '连续输入' : '修改选中音符'}
        </span>
      </div>
      <div className="inspector-section">
        <h3>选中内容</h3>
        <p data-testid="selection-description" aria-live="polite">
          {selected
            ? selected.event.kind === 'rest'
              ? '休止符'
              : `${note?.pitch.step ?? '和弦'}${note?.pitch.alter === 1 ? '♯' : note?.pitch.alter === -1 ? '♭' : ''}${note?.pitch.octave ?? ''} · ${selected.event.notes.length} 个音`
            : '点击音符或浅色休止符'}
        </p>
        <div className="accidentals">
          <Button
            size="sm"
            variant="outline"
            disabled={!note}
            aria-label="降号"
            onClick={() => session.alterSelected(-1)}
          >
            ♭
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!note}
            aria-label="还原号"
            onClick={() => session.alterSelected(0)}
          >
            ♮
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!note}
            aria-label="升号"
            onClick={() => session.alterSelected(1)}
          >
            ♯
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected}
          onClick={() => session.applyDuration()}
        >
          应用当前时值
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!selected}
          onClick={() => session.deleteSelection()}
        >
          <Trash2 />
          删除事件
        </Button>
      </div>
      <div className="input-help">
        <h3>键盘输入</h3>
        <p>
          <kbd>A–G</kbd> 音名
        </p>
        <p>
          <kbd>Shift + A–G</kbd> 添加和弦音
        </p>
        <p>
          <kbd>↑ ↓</kbd> 改变所选音高
        </p>
        <p>
          <kbd>← →</kbd> 选择同声部事件
        </p>
        <p>
          <kbd>⌘ Z</kbd> 撤销
        </p>
        <p>先点击谱面，再用键盘输入。浅色休止只是空白位置提示。</p>
      </div>
    </aside>
  )
}
