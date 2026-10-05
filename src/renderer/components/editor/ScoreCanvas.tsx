/** Display engine-owned SVG pages while mapping every selection back to native musical identities. */
import { useEffect, useRef, useMemo, memo } from 'react'
import type { PlaybackController } from '../../../playback/controller'
import type { EditorSession, EditorSnapshot } from '../../../editor/session'
import type { EngraveResponse } from '../../../notation/protocol'

interface ScoreCanvasProps {
  readonly playback: PlaybackController
  readonly session: EditorSession
  readonly snapshot: EditorSnapshot
  readonly response: EngraveResponse | null
  readonly pending: boolean
}

/** Keep keyboard music input scoped to the focused score, away from title and configuration fields. */
export function ScoreCanvas({
  session,
  playback,
  snapshot,
  response,
  pending,
}: ScoreCanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const targets = useMemo(
    () => (response && 'pages' in response ? response.targets : {}),
    [response],
  )
  const pages = response && 'pages' in response ? response.pages : []

  useEffect(() => {
    const nodes = host.current?.querySelectorAll<SVGGElement>('g[id]') ?? []
    for (const node of nodes) {
      const target = targets[node.id]
      if (!target) {
        continue
      }
      node.dataset.target = target.kind
      const selected =
        target.kind === 'event' &&
        target.eventId === snapshot.selection?.eventId &&
        (!snapshot.selection.noteId ||
          target.noteId === snapshot.selection.noteId)
      node.dataset.selected = String(selected)
      if (target.kind === 'event') {
        node.dataset.eventId = target.eventId
        if (target.noteId) {
          node.dataset.noteId = target.noteId
        } else {
          delete node.dataset.noteId
        }
      }
    }
  }, [targets, snapshot.selection])

  useEffect(() => {
    let previous = ''
    /** Update transient SVG annotations directly; raw pages and native music remain unchanged. */
    function updatePlayhead() {
      const state = playback.getSnapshot()
      const active = new Set(pending ? [] : state.activeEventIds)
      const key = `${state.visit?.index}:${state.visit?.pass}:${[...active].join(',')}:${state.follow}`
      if (key === previous) {
        return
      }
      const nodes =
        host.current?.querySelectorAll<SVGGElement>('g[data-event-id]') ?? []
      let first: SVGGElement | null = null
      for (const node of nodes) {
        const playing = active.has(node.dataset.eventId!)
        node.dataset.playing = String(playing)
        if (playing && !first) {
          first = node
        }
      }
      if (first && state.follow && key !== previous) {
        const viewport = host.current?.closest('.score-workspace')
        if (viewport) {
          const bounds = viewport.getBoundingClientRect()
          const target = first.getBoundingClientRect()
          if (
            target.top < bounds.top + 55 ||
            target.bottom > bounds.bottom - 35
          ) {
            first.scrollIntoView({
              block: 'center',
              inline: 'nearest',
              behavior: 'auto',
            })
          }
        }
      }
      previous = key
    }
    updatePlayhead()
    return playback.subscribe(updatePlayhead)
  }, [playback, targets, pending])

  return (
    <div
      ref={host}
      className="score-canvas"
      data-testid="score-canvas"
      tabIndex={0}
      aria-label="乐谱编辑区"
      aria-busy={pending}
      onClick={(event) => {
        // A stale page remains visible during layout but cannot target deleted musical objects.
        if (pending) {
          return
        }
        let element = event.target as Element | null
        while (element && element !== event.currentTarget) {
          const target = targets[element.id]
          if (target) {
            session.select(target)
            break
          }
          element = element.parentElement
        }
        event.currentTarget.focus({ preventScroll: true })
      }}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return
        }
        const key = event.key.toUpperCase()
        if (event.code === 'Space') {
          if (playback.getSnapshot().status === 'playing') {
            playback.pause()
          } else {
            void playback.play(session.getSnapshot().score)
          }
        } else if (/^[A-G]$/.test(key)) {
          session.inputPitch(
            key as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G',
            event.shiftKey,
          )
        } else if (key === 'R') {
          session.inputRest()
        } else if (key === 'N') {
          session.setMode(snapshot.mode === 'write' ? 'edit' : 'write')
        } else if (key === 'ARROWLEFT' || key === 'ARROWRIGHT') {
          session.navigate(key === 'ARROWLEFT' ? -1 : 1)
        } else if (key === 'DELETE' || key === 'BACKSPACE') {
          session.deleteSelection()
        } else if (key === 'ARROWUP' || key === 'ARROWDOWN') {
          session.transposeSelected(key === 'ARROWUP' ? 1 : -1)
        } else {
          return
        }
        event.preventDefault()
      }}
    >
      {pages.length === 0 ? (
        <div className="engraving-placeholder">正在准备钢琴谱面…</div>
      ) : (
        pages.map((svg, index) => (
          <ScorePage
            key={index}
            svg={svg}
            title={snapshot.score.title}
            index={index}
          />
        ))
      )}
    </div>
  )
}

/** Memoize the raw SVG host so unrelated file-state renders cannot erase imperative selection annotations. */
const ScorePage = memo(function ScorePage({
  svg,
  title,
  index,
}: {
  svg: string
  title: string
  index: number
}) {
  return (
    <section className="score-page" aria-label={`谱面第 ${index + 1} 页`}>
      <header className="score-paper-heading">
        <h2>{title}</h2>
        <p>钢琴</p>
      </header>
      {/* Only locally generated SVG from validated, XML-escaped music enters this host. */}
      <div className="notation-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      <footer className="paper-footer">{index + 1}</footer>
    </section>
  )
})
