/** Present provider configuration and ordered recognition tasks without showing source images or secret data. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { RecognitionController } from '../../../recognition/controller'
import type { DocumentController } from '../../../editor/document-controller'
import { RecognitionSettingsForm } from './RecognitionSettingsForm'

const STATUS_LABELS = {
  pending: '待识别',
  running: '识别中…',
  success: '通过乐谱校验',
  error: '识别失败',
}

/** Keep a controller across panel openings so recognition can finish while the editor remains available. */
export function RecognitionPanel({
  documents,
  disabled,
}: {
  documents: DocumentController
  disabled: boolean
}) {
  const [controller] = useState(
    () =>
      new RecognitionController(
        window.notera.recognition,
        (score, origin) => documents.importRecognition(score, origin),
        {
          capture: (taskId) => documents.recognitionMergeTarget(taskId),
          apply: (result, mode, target) =>
            documents.mergeRecognition(result, mode, target),
        },
      ),
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )
  const [open, setOpen] = useState(false)
  const running = state.task?.running || state.busy
  useEffect(() => {
    if (!open || !running) {
      return
    }
    const timer = setInterval(() => void controller.poll(), 500)
    return () => clearInterval(timer)
  }, [controller, open, running])
  const successes =
    state.task?.sources.filter((source) => source.status === 'success')
      .length ?? 0
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true)
          void controller.open()
        }}
      >
        AI 识谱
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="recognition-dialog"
          aria-describedby="recognition-description"
        >
          <DialogHeader>
            <DialogTitle>AI 五线谱识别</DialogTitle>
            <DialogDescription id="recognition-description">
              识别截图、多张图片或
              PDF，结果导入普通可编辑乐谱。关闭面板不会取消正在运行的任务。
            </DialogDescription>
          </DialogHeader>
          {state.error ? (
            <Alert variant="destructive">
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          {state.message ? <p role="status">{state.message}</p> : null}
          {state.settings ? (
            <RecognitionSettingsForm
              key={JSON.stringify(state.settings)}
              controller={controller}
              settings={state.settings}
              disabled={Boolean(running)}
            />
          ) : (
            <p>正在读取 AI 配置…</p>
          )}
          <Separator />
          <section aria-label="识谱来源页" className="flex flex-col gap-3">
            <h3>来源页</h3>
            <p className="text-sm text-muted-foreground">
              点击开始后，所选文件内容会发送到配置的服务。PNG/JPEG 或 PDF
              每文件最多 10 MiB，合计最多 30 页。一次任务对应一首曲子。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(running)}
                onClick={() => void controller.choose()}
              >
                选择图片或 PDF
              </Button>
              <Button
                size="sm"
                disabled={
                  Boolean(running) ||
                  !state.settings?.hasKey ||
                  !state.task?.sources.some(
                    (source) => source.status !== 'success',
                  )
                }
                onClick={() => void controller.run()}
              >
                开始识谱 / 重试未完成页
              </Button>
              {state.busy && state.task ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void controller.cancel()}
                >
                  取消识谱
                </Button>
              ) : null}
            </div>
            {state.task ? (
              <ol className="recognition-sources">
                {state.task.sources.map((source, index) => (
                  <li key={source.id}>
                    <div className="flex flex-col gap-1">
                      <strong>
                        {index + 1}. {source.name}
                      </strong>
                      <span>
                        {STATUS_LABELS[source.status]}
                        {source.status === 'success'
                          ? ` · ${source.measures} 小节`
                          : ''}
                      </span>
                      {source.error ? <p>{source.error}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`上移 ${source.name}`}
                        disabled={Boolean(running) || index === 0}
                        onClick={() => controller.move(source.id, -1)}
                      >
                        上移
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`下移 ${source.name}`}
                        disabled={
                          Boolean(running) ||
                          index === state.task!.sources.length - 1
                        }
                        onClick={() => controller.move(source.id, 1)}
                      >
                        下移
                      </Button>
                      {source.status === 'error' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`重试 ${source.name}`}
                          disabled={Boolean(running)}
                          onClick={() => void controller.run(source.id)}
                        >
                          重试此页
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>尚未选择来源文件。</p>
            )}
            {successes > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  将按当前顺序导入 {successes}{' '}
                  个成功页，跳过未成功页。通过校验不代表识谱正确；页间小节与跨页连线需手工检查。
                </p>
                {state.task &&
                documents.recognitionMergeTarget(state.task.id) ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">
                      已导入此任务。补入只加入尚未导入的成功页，保留当前编辑；顺序冲突时可明确选择追加到末尾。补入可撤销，来源关联仅在当前应用会话中保留。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={Boolean(running) || disabled}
                        onClick={() => void controller.mergeScore('ordered')}
                      >
                        按来源顺序补入当前乐谱
                      </Button>
                      <Button
                        variant="outline"
                        disabled={Boolean(running) || disabled}
                        onClick={() => void controller.mergeScore('append')}
                      >
                        追加补识别页到末尾
                      </Button>
                    </div>
                  </div>
                ) : null}
                <Button
                  disabled={Boolean(running) || disabled}
                  onClick={() => {
                    void controller.importScore().then((accepted) => {
                      if (accepted) {
                        setOpen(false)
                      }
                    })
                  }}
                >
                  导入成功页为新乐谱
                </Button>
              </>
            ) : null}
          </section>
        </DialogContent>
      </Dialog>
    </>
  )
}
