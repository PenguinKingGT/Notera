import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AppInfo } from '../shared/desktop-api'

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function showAppInfo() {
    setPending(true)
    setError(null)
    try {
      setAppInfo(await window.notera.getAppInfo())
    } catch {
      setError('暂时无法获取应用信息，请重试。')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <section
        className="flex max-w-lg flex-col items-center gap-6 text-center"
        aria-labelledby="app-title"
      >
        <div className="flex flex-col gap-3">
          <h1 id="app-title" className="text-5xl font-semibold tracking-tight">
            Notera
          </h1>
          <p className="text-lg text-muted-foreground">你的乐谱工作空间。</p>
        </div>
        <Button variant="outline" disabled={pending} onClick={showAppInfo}>
          {pending ? '正在读取…' : '关于 Notera'}
        </Button>
        <p className="min-h-6 text-sm text-muted-foreground" aria-live="polite">
          {appInfo ? `${appInfo.name} · ${appInfo.version}` : ''}
        </p>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </main>
  )
}
