import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AlertCircle, RotateCw, Upload, X } from 'lucide-react'
import { cn } from './cn'
import type { UploadController } from './useUpload'

type Props = {
  upload: UploadController
  /** Listen for clipboard images on the whole window. */
  paste?: boolean
  /** Reason string disables the zone and is shown on hover. */
  disabled?: string
  className?: string
}

const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4'

export function UploadDropzone({ upload, paste = true, disabled, className }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const depth = useRef(0)

  const take = (files: File[]) => { if (!disabled && files.length) setErrors(upload.add(files)) }

  useEffect(() => {
    if (!paste || disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      setErrors(upload.add(files))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [paste, disabled, upload.add]) // eslint-disable-line react-hooks/exhaustive-deps

  const isFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const pending = upload.items.filter((x) => x.status !== 'done')

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={!!disabled || undefined}
        title={disabled}
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click() } }}
        onDragEnter={(e) => { if (isFiles(e)) { depth.current++; setOver(true) } }}
        onDragOver={(e) => { if (isFiles(e) && !disabled) e.preventDefault() }}
        onDragLeave={(e) => { if (isFiles(e) && --depth.current <= 0) { depth.current = 0; setOver(false) } }}
        onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); take(Array.from(e.dataTransfer.files)) }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-card px-4 py-6 text-center transition-[background-color,border-color,transform] duration-fast',
          'hover:border-muted hover:bg-subtle active:scale-[.99] motion-reduce:active:scale-100',
          over && !disabled && 'border-acid-deep bg-acid/15',
          disabled && 'cursor-not-allowed opacity-45 hover:border-line hover:bg-card',
        )}
      >
        <Upload size={24} className="text-muted" aria-hidden />
        <p className="text-sm text-ink">{over ? '松开即可上传' : '拖入、粘贴或点击选择文件'}</p>
        <p className="text-xs text-muted">{disabled ?? 'PNG / JPEG / WebP ≤ 20MB，MP4 ≤ 200MB'}</p>
        <input
          ref={input} type="file" accept={ACCEPT} multiple hidden
          onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = '' }}
        />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-xs text-danger">
          {errors.map((m) => <li key={m} className="flex items-center gap-1"><AlertCircle size={12} aria-hidden />{m}</li>)}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="上传队列">
          {pending.map((it) => (
            <li key={it.clientId} className="flex items-center gap-2 rounded-control bg-card px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-ink" title={it.name}>{it.name}</span>
              {it.status === 'uploading' && (
                <span className="h-1 w-20 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(it.progress * 100)} aria-label={`${it.name} 上传进度`}>
                  <span className="block h-full bg-acid-deep transition-[width] duration-fast" style={{ width: `${it.progress * 100}%` }} />
                </span>
              )}
              <span className={cn('shrink-0', it.error ? 'text-danger' : 'text-muted')}>
                {it.status === 'uploading' ? `${Math.round(it.progress * 100)}%` : it.status === 'processing' ? '处理中' : it.error}
              </span>
              {it.status === 'failed' && it.file && (
                <IconButton label="重试上传" onClick={() => upload.retry(it.clientId)}><RotateCw size={12} /></IconButton>
              )}
              {it.status === 'interrupted' && (
                <button type="button" className="shrink-0 rounded-control px-1.5 py-0.5 text-ink underline-offset-2 hover:bg-subtle hover:underline" onClick={() => { upload.remove(it.clientId); input.current?.click() }}>
                  重新选择
                </button>
              )}
              <IconButton label={it.status === 'uploading' || it.status === 'processing' ? '取消上传' : '移除'} onClick={() => upload.remove(it.clientId)}><X size={12} /></IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-control text-muted transition-[background-color,color,transform] duration-fast hover:bg-subtle hover:text-ink active:scale-[.98] motion-reduce:active:scale-100"
    >
      {children}
    </button>
  )
}
