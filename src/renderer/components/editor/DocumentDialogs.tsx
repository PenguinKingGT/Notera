/** Present document save/discard/cancel and startup recovery decisions with accessible Radix dialogs. */
import { AlertDialog } from 'radix-ui'
import { Button } from '@/components/ui/button'
import type {
  DocumentController,
  DocumentState,
} from '../../../editor/document-controller'

/** Keep transitions pending when saving fails or its native dialog is cancelled. */
export function DocumentDialogs({
  controller,
  state,
}: {
  controller: DocumentController
  state: DocumentState
}) {
  return (
    <>
      <AlertDialog.Root
        open={state.prompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            controller.cancel()
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog-content">
            <AlertDialog.Title>保存当前更改？</AlertDialog.Title>
            <AlertDialog.Description>
              当前乐谱有未保存的更改。保存后继续，或明确放弃这些更改。
            </AlertDialog.Description>
            {state.error ? <p role="alert">{state.error}</p> : null}
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => controller.cancel()}
              >
                取消
              </Button>
              <Button
                variant="ghost"
                disabled={state.busy}
                onClick={() => controller.discard()}
              >
                放弃并继续
              </Button>
              <Button
                disabled={state.busy}
                onClick={() => void controller.saveAndContinue()}
              >
                {state.busy ? '正在保存…' : '保存并继续'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root open={state.startup !== null}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog-content">
            <AlertDialog.Title>发现未保存的乐谱</AlertDialog.Title>
            <AlertDialog.Description>
              {state.startup?.recovery
                ? `“${state.startup.recovery.title}”有上次留下的恢复副本。恢复后请重新选择保存位置。`
                : state.startup?.recoveryError}
            </AlertDialog.Description>
            {state.error ? <p role="alert">{state.error}</p> : null}
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => controller.request('close')}
              >
                保留副本并退出
              </Button>
              <Button
                variant="ghost"
                disabled={state.busy}
                onClick={() => void controller.resolveRecovery(false)}
              >
                放弃副本
              </Button>
              {state.startup?.recovery ? (
                <Button
                  disabled={state.busy}
                  onClick={() => void controller.resolveRecovery(true)}
                >
                  恢复乐谱
                </Button>
              ) : null}
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}
