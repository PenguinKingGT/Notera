/** Compose the desktop piano editor, delegating music transactions and engraving to independent modules. */
import { useState, useSyncExternalStore, useEffect } from 'react'
import { FilePlus2, Music2, FolderOpen, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { EditorInspector } from '@/components/editor/EditorInspector'
import { ScoreCanvas } from '@/components/editor/ScoreCanvas'
import { useEngraving } from '@/hooks/useEngraving'
import { DocumentController } from '../editor/document-controller'
import { ExchangeActions } from '@/components/editor/ExchangeActions'
import { DocumentDialogs } from '@/components/editor/DocumentDialogs'
import { EditorSession } from '../editor/session'
import { deserializeScore } from '../core'
import sample from '../assets/piano-example.notera.json'
import { PlaybackController } from '../playback/controller'
import { PlaybackToolbar } from '@/components/editor/PlaybackToolbar'
import type { AppInfo } from '../shared/desktop-api'

/** Present explicit input state, musical selection and recoverable errors through the narrow document capability API. */
export function App() {
  const [session] = useState(() => new EditorSession())
  const [playback] = useState(
    () =>
      new PlaybackController(async () => {
        const { SampledPiano } = await import('../playback/piano')
        return new SampledPiano()
      }),
  )
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const engraving = useEngraving(state.score)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState<{
    documentId: string | undefined
    value: string
  } | null>(null)
  const [documents] = useState(
    () =>
      new DocumentController(session, window.notera, () =>
        deserializeScore(JSON.stringify(sample)),
      ),
  )
  const documentState = useSyncExternalStore(
    documents.subscribe,
    documents.getSnapshot,
  )

  useEffect(() => {
    let score = session.getSnapshot().score
    const stopOnMusicChange = session.subscribe(() => {
      const next = session.getSnapshot().score
      if (next !== score) {
        score = next
        playback.stop()
      }
    })
    const stopOnReplacement = documents.subscribe(() => {
      const current = documents.getSnapshot()
      if (current.editingLocked || current.prompt || current.startup) {
        playback.stop()
      }
    })
    /** Background windows pause rather than relying on throttled renderer timers. */
    function pauseWhenHidden() {
      if (document.hidden) {
        playback.pause()
      }
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => {
      stopOnMusicChange()
      stopOnReplacement()
      document.removeEventListener('visibilitychange', pauseWhenHidden)
      playback.dispose()
    }
  }, [session, documents, playback])

  useEffect(() => {
    const unsubscribe = window.notera.onCloseRequested(() => {
      // Commit an unfinished title before checking dirty content for a native close request.
      if (document.activeElement instanceof HTMLInputElement) {
        document.activeElement.blur()
      }
      playback.stop()
      documents.request('close')
    })
    void documents.start()
    return () => {
      unsubscribe()
      documents.stop()
    }
  }, [documents, playback])

  const eventCount = state.score.measures.reduce(
    (total, measure) =>
      total + measure.voices.reduce((sum, lane) => sum + lane.events.length, 0),
    0,
  )

  /** Read the existing narrow desktop metadata API and surface IPC failure. */
  async function showAppInfo() {
    try {
      setAppInfo(await window.notera.getAppInfo())
      setInfoError(null)
    } catch {
      setInfoError('暂时无法获取应用信息。')
    }
  }

  return (
    <main
      className="editor-shell"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('[role="alertdialog"]')) {
          return
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          ['s', 'o', 'n'].includes(event.key.toLowerCase())
        ) {
          event.preventDefault()
          if (document.activeElement instanceof HTMLInputElement) {
            document.activeElement.blur()
          }
          if (event.key.toLowerCase() === 's') {
            void documents.save(event.shiftKey)
          } else {
            documents.request(event.key.toLowerCase() === 'o' ? 'open' : 'new')
          }
          return
        }
        if (documentState.editingLocked) {
          return
        }
        if (
          target.closest(
            'input, textarea, select, [contenteditable="true"], [role="alertdialog"]',
          )
        ) {
          return
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'z'
        ) {
          event.preventDefault()
          if (event.shiftKey) {
            session.redo()
          } else {
            session.undo()
          }
        }
      }}
    >
      <header className="editor-header">
        <div className="brand">
          <Music2 size={19} aria-hidden="true" />
          <h1>Notera</h1>
        </div>
        <div className="document-name">
          <input
            aria-label="乐谱标题"
            value={
              titleDraft &&
              titleDraft.documentId === documentState.document?.documentId
                ? titleDraft.value
                : state.score.title
            }
            disabled={documentState.editingLocked || !documentState.ready}
            onChange={(event) =>
              setTitleDraft({
                documentId: documentState.document?.documentId,
                value: event.target.value,
              })
            }
            onBlur={() => {
              if (
                titleDraft !== null &&
                titleDraft.documentId === documentState.document?.documentId
              ) {
                session.setTitle(titleDraft.value)
                setTitleDraft(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          <span data-testid="document-status">
            {documentState.busy
              ? '正在处理文件…'
              : state.dirty
                ? '有未保存更改'
                : (documentState.document?.fileName ?? '未保存的新乐谱')}
          </span>
        </div>
        <div className="header-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup)
            }
            onClick={() => documents.request('new')}
          >
            <FilePlus2 />
            新建
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup)
            }
            onClick={() => documents.request('sample')}
          >
            示例谱
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup)
            }
            onClick={() => documents.request('open')}
          >
            <FolderOpen data-icon="inline-start" />
            打开
          </Button>
          <Button
            size="sm"
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup)
            }
            onClick={() => void documents.save()}
          >
            <Save data-icon="inline-start" />
            保存
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup)
            }
            onClick={() => void documents.save(true)}
          >
            另存为
          </Button>
          <ExchangeActions
            controller={documents}
            disabled={
              !documentState.ready ||
              documentState.busy ||
              Boolean(documentState.startup) ||
              Boolean(documentState.prompt)
            }
          />
          <Button size="sm" variant="ghost" onClick={showAppInfo}>
            关于 Notera
          </Button>
        </div>
      </header>
      <div inert={documentState.editingLocked || !documentState.ready}>
        <EditorToolbar session={session} state={state} />
      </div>
      <PlaybackToolbar
        playback={playback}
        session={session}
        disabled={
          !documentState.ready ||
          documentState.editingLocked ||
          Boolean(documentState.prompt) ||
          Boolean(documentState.startup)
        }
      />
      <div
        className="editor-body"
        inert={documentState.editingLocked || !documentState.ready}
      >
        <EditorInspector session={session} state={state} />
        <section className="score-workspace" aria-label="五线谱工作空间">
          <div className="workspace-bar">
            <span>五线谱</span>
            <span aria-live="polite">
              {engraving.pending
                ? '正在排版…'
                : engraving.response && 'pages' in engraving.response
                  ? `${engraving.response.pages.length} 页 · 自动排版`
                  : '排版待重试'}
            </span>
          </div>
          {documentState.error || documentState.recoveryError ? (
            <div className="editor-error" role="alert">
              {documentState.error ?? documentState.recoveryError}
            </div>
          ) : null}
          {state.error ? (
            <div className="editor-error" role="alert">
              {state.error}
            </div>
          ) : null}
          {engraving.response && 'error' in engraving.response ? (
            <div className="editor-error" role="alert">
              {engraving.response.error}
              <Button size="sm" variant="outline" onClick={engraving.retry}>
                重试排版
              </Button>
            </div>
          ) : null}
          <ScoreCanvas
            session={session}
            playback={playback}
            snapshot={state}
            response={engraving.response}
            pending={engraving.pending}
          />
        </section>
      </div>
      <footer className="editor-status">
        <span data-testid="event-count">{eventCount} 个音乐事件</span>
        <span>{state.score.measures.length} 小节 · 本地排版</span>
        <span>
          {appInfo
            ? `${appInfo.name} · ${appInfo.version}`
            : (infoError ??
              documentState.message ??
              documentState.document?.fileName ??
              '未保存的新乐谱')}
        </span>
      </footer>
      <DocumentDialogs controller={documents} state={documentState} />
    </main>
  )
}
