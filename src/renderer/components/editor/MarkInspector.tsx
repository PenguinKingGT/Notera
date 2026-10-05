/** Create and revise anchored musical marks through the editor's atomic command interface. */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import type { ScoreMark } from '../../../core'
import {
  compatibleMarkEnd,
  describeMark,
  markAnchors,
  markEndpoints,
  MARK_LABELS,
} from '../../../editor/marks'
import type { MarkInput, MarkEndpoint } from '../../../editor/marks'
import type { EditorSession, EditorSnapshot } from '../../../editor/session'

type DynamicValue = Extract<ScoreMark, { kind: 'dynamic' }>['value']
const DYNAMICS: readonly DynamicValue[] = [
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
]

interface MarkDraft {
  kind: ScoreMark['kind']
  start: string
  end: string
  value: DynamicValue
  times: number
}

/** Prefer the selected individual chord tone for ties and the cursor measure for repeats. */
function initialDraft(
  state: EditorSnapshot,
  kind: ScoreMark['kind'],
  mark?: ScoreMark,
): MarkDraft {
  const choices = markEndpoints(state.score, kind)
  const preferred =
    kind === 'tie'
      ? state.selection?.noteId
      : kind === 'repeat'
        ? state.cursor.measureId
        : state.selection?.eventId
  return {
    kind,
    start: mark
      ? markAnchors(mark).start
      : (choices.find((choice) => choice.id === preferred)?.id ??
        choices[0]?.id ??
        ''),
    end: mark ? markAnchors(mark).end : '',
    value: mark?.kind === 'dynamic' ? mark.value : 'mf',
    times: mark?.kind === 'repeat' ? mark.times : 2,
  }
}

/** Translate form fields into the native union; no form-only fields enter the score file. */
function draftInput(draft: MarkDraft, end: string): MarkInput {
  switch (draft.kind) {
    case 'tie':
      return { kind: 'tie', startNoteId: draft.start, endNoteId: end }
    case 'slur':
    case 'pedal':
      return { kind: draft.kind, startEventId: draft.start, endEventId: end }
    case 'dynamic':
      return { kind: 'dynamic', eventId: draft.start, value: draft.value }
    case 'repeat':
      return {
        kind: 'repeat',
        startMeasureId: draft.start,
        endMeasureId: end,
        times: draft.times,
      }
  }
}

/** Reuse native-select options for potentially long score-position lists. */
function EndpointOptions({ choices }: { choices: readonly MarkEndpoint[] }) {
  return choices.map((choice) => (
    <NativeSelectOption key={choice.id} value={choice.id}>
      {choice.label}
    </NativeSelectOption>
  ))
}

/** Hold an uncommitted draft; submitting a mark creates exactly one history entry. */
function MarkForm({
  session,
  state,
  mark,
  onClose,
}: {
  session: EditorSession
  state: EditorSnapshot
  mark?: ScoreMark
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() =>
    initialDraft(state, mark?.kind ?? 'dynamic', mark),
  )
  const choices = useMemo(
    () => markEndpoints(state.score, draft.kind),
    [state.score, draft.kind],
  )
  const start = choices.find((choice) => choice.id === draft.start)
  const ends = start
    ? choices.filter((choice) => compatibleMarkEnd(draft.kind, start, choice))
    : []
  // Derive a safe default from current music. An explicitly chosen stale endpoint stays invalid.
  const endId = draft.end || ends[0]?.id || ''
  const validEnd =
    draft.kind === 'dynamic' || ends.some((choice) => choice.id === endId)
  const valid =
    Boolean(start) &&
    validEnd &&
    (draft.kind !== 'repeat' ||
      (Number.isInteger(draft.times) && draft.times >= 2 && draft.times <= 16))
  return (
    <form
      aria-label={mark ? '修改音乐记号' : '添加音乐记号'}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && session.putMark(draftInput(draft, endId), mark?.id)) {
          onClose()
        }
      }}
    >
      <FieldGroup className="gap-3">
        <Field data-disabled={Boolean(mark)}>
          <FieldLabel htmlFor="mark-kind">记号类型</FieldLabel>
          <NativeSelect
            id="mark-kind"
            value={draft.kind}
            disabled={Boolean(mark)}
            onChange={(event) =>
              setDraft(
                initialDraft(state, event.target.value as ScoreMark['kind']),
              )
            }
          >
            {Object.entries(MARK_LABELS).map(([kind, label]) => (
              <NativeSelectOption key={kind} value={kind}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={!start}>
          <FieldLabel htmlFor="mark-start">
            {draft.kind === 'dynamic' ? '力度位置' : '记号起点'}
          </FieldLabel>
          <NativeSelect
            id="mark-start"
            title={start?.label}
            value={start ? draft.start : ''}
            aria-invalid={!start}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value, end: '' })
            }
          >
            <NativeSelectOption value="">请选择音乐位置</NativeSelectOption>
            <EndpointOptions choices={choices} />
          </NativeSelect>
        </Field>
        {draft.kind === 'dynamic' ? (
          <Field>
            <FieldLabel htmlFor="mark-dynamic">力度值</FieldLabel>
            <NativeSelect
              id="mark-dynamic"
              value={draft.value}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  value: event.target.value as DynamicValue,
                })
              }
            >
              {DYNAMICS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <Field data-invalid={!validEnd}>
            <FieldLabel htmlFor="mark-end">记号终点</FieldLabel>
            <NativeSelect
              id="mark-end"
              title={ends.find((choice) => choice.id === endId)?.label}
              value={validEnd ? endId : ''}
              aria-invalid={!validEnd}
              onChange={(event) =>
                setDraft({ ...draft, end: event.target.value })
              }
            >
              <NativeSelectOption value="">暂无兼容终点</NativeSelectOption>
              <EndpointOptions choices={ends} />
            </NativeSelect>
            <FieldDescription>
              {draft.kind === 'tie'
                ? '连接同声部连续的同音高音符，可跨小节。'
                : draft.kind === 'slur'
                  ? '连接同声部的两个音符或和弦。'
                  : draft.kind === 'pedal'
                    ? '起点踩下，终点起始位置松开；限同一谱表。'
                    : '遍数包含首次演奏；反复范围不能重叠。'}
            </FieldDescription>
          </Field>
        )}
        {draft.kind === 'repeat' ? (
          <Field
            data-invalid={
              !Number.isInteger(draft.times) ||
              draft.times < 2 ||
              draft.times > 16
            }
          >
            <FieldLabel htmlFor="mark-times">演奏遍数</FieldLabel>
            <Input
              id="mark-times"
              type="number"
              min={2}
              max={16}
              step={1}
              value={Number.isNaN(draft.times) ? '' : draft.times}
              aria-invalid={
                !Number.isInteger(draft.times) ||
                draft.times < 2 ||
                draft.times > 16
              }
              onChange={(event) =>
                setDraft({ ...draft, times: event.target.valueAsNumber })
              }
            />
          </Field>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit" disabled={!valid}>
            {mark ? '应用记号修改' : '添加到乐谱'}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={onClose}>
            取消记号编辑
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

/** List all native marks, including imports; reset drafts when selection or historical mark data changes. */
export function MarkInspector({
  session,
  state,
}: {
  session: EditorSession
  state: EditorSnapshot
}) {
  const [editing, setEditing] = useState<
    { kind: 'new' } | { kind: 'existing'; id: string } | null
  >(null)
  const mark = state.score.marks.find(
    (candidate) => editing?.kind === 'existing' && candidate.id === editing.id,
  )
  const endpoints = useMemo(() => {
    return Object.fromEntries(
      Object.keys(MARK_LABELS).map((kind) => [
        kind,
        markEndpoints(state.score, kind as ScoreMark['kind']),
      ]),
    ) as Record<ScoreMark['kind'], MarkEndpoint[]>
  }, [state.score])
  const showForm = editing?.kind === 'new' || Boolean(mark)
  return (
    <section className="inspector-section mark-inspector" aria-label="音乐记号">
      <h3>音乐记号 · {state.score.marks.length}</h3>
      {showForm ? (
        <MarkForm
          key={
            mark
              ? JSON.stringify(mark)
              : `${state.selection?.eventId ?? state.cursor.measureId}:${state.selection?.noteId ?? ''}`
          }
          session={session}
          state={state}
          mark={mark}
          onClose={() => setEditing(null)}
        />
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing({ kind: 'new' })}
        >
          添加记号
        </Button>
      )}
      {state.score.marks.length > 0 ? (
        <>
          <Separator className="my-3" />
          <ul className="mark-list" aria-label="已有音乐记号">
            {state.score.marks.map((item) => {
              const description = describeMark(item, endpoints[item.kind])
              return (
                <li key={item.id}>
                  <p>{description}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`修改${description}`}
                      onClick={() =>
                        setEditing({ kind: 'existing', id: item.id })
                      }
                    >
                      修改
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`删除${description}`}
                      onClick={() => {
                        session.deleteMark(item.id)
                        if (
                          editing?.kind === 'existing' &&
                          editing.id === item.id
                        ) {
                          setEditing(null)
                        }
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="mark-help">
          选择谱面音符后添加记号，也可在表单中选择位置。
        </p>
      )}
    </section>
  )
}
