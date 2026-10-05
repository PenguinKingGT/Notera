/** Present piano interchange commands in one keyboard-accessible menu without changing native save semantics. */
import { ArrowLeftRight, FileInput, FileOutput, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DocumentController } from '../../../editor/document-controller'

/** Dispatch named import/export intentions; selected paths and format validation remain in the main process. */
export function ExchangeActions({
  controller,
  disabled,
}: {
  controller: DocumentController
  disabled: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <ArrowLeftRight data-icon="inline-start" />
          乐谱交换
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void controller.exportPdf()}>
            <FileDown />
            导出五线谱 PDF
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>MusicXML</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => controller.request('import')}>
            <FileInput />
            导入 MusicXML / MXL
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void controller.exportMusic(false)}>
            <FileOutput />
            导出 MusicXML
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void controller.exportMusic(true)}>
            <FileOutput />
            导出压缩 MXL
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
