import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AlertTriangle, CircleCheck, Info, Trash2, X } from 'lucide-react'

const DialogContext = createContext(null)

export function useDialog() {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialog 必须在 DialogProvider 中使用')
  return value
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)

  const open = useCallback((options) => new Promise((resolve) => {
    setDialog({ ...options, value: options.defaultValue || '', resolve })
  }), [])

  const actions = useMemo(() => ({
    confirm(message, options = {}) {
      return open({ kind: 'confirm', message, title: '请确认操作', confirmText: '确认', cancelText: '取消', tone: 'default', ...options })
    },
    alert(message, options = {}) {
      return open({ kind: 'alert', message, title: '操作提示', confirmText: '知道了', tone: 'info', ...options })
    },
    prompt(message, options = {}) {
      return open({ kind: 'prompt', message, title: '请输入信息', confirmText: '确认', cancelText: '取消', tone: 'default', ...options })
    },
  }), [open])

  function finish(value) {
    const resolve = dialog.resolve
    setDialog(null)
    resolve(value)
  }

  function cancel() {
    finish(dialog.kind === 'prompt' ? null : false)
  }

  function confirm() {
    finish(dialog.kind === 'prompt' ? dialog.value : true)
  }

  const Icon = dialog?.tone === 'danger' ? Trash2 : dialog?.tone === 'success' ? CircleCheck : dialog?.tone === 'warning' ? AlertTriangle : Info

  return (
    <DialogContext.Provider value={actions}>
      {children}
      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && (dialog.kind === 'alert' ? confirm() : cancel())}>
          <section className="modal modal-confirm" role="dialog" aria-modal="true" aria-label={dialog.title}>
            <header className="modal-header">
              <div><h2>{dialog.title}</h2>{dialog.description && <p>{dialog.description}</p>}</div>
              <button className="icon-button" onClick={dialog.kind === 'alert' ? confirm : cancel} aria-label="关闭"><X size={18} /></button>
            </header>
            <div className="modal-body dialog-body">
              <span className={`dialog-icon dialog-icon-${dialog.tone}`}><Icon size={21} /></span>
              <div className="dialog-copy">
                <p>{dialog.message}</p>
                {dialog.kind === 'prompt' && (
                  <label className="field dialog-field">
                    <span>{dialog.label || '输入内容'}</span>
                    <input
                      autoFocus
                      type={dialog.inputType || 'text'}
                      value={dialog.value}
                      min={dialog.min}
                      max={dialog.max}
                      onChange={(event) => setDialog((current) => ({ ...current, value: event.target.value }))}
                      onKeyDown={(event) => event.key === 'Enter' && dialog.value && confirm()}
                    />
                  </label>
                )}
              </div>
            </div>
            <footer className="modal-footer">
              {dialog.kind !== 'alert' && <button className="button button-secondary" onClick={cancel}>{dialog.cancelText}</button>}
              <button
                className={`button ${dialog.tone === 'danger' ? 'button-danger' : 'button-primary'}`}
                onClick={confirm}
                disabled={dialog.kind === 'prompt' && !dialog.value}
              >
                {dialog.confirmText}
              </button>
            </footer>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  )
}
