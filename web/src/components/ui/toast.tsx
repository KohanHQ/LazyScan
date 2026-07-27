import * as React from "react"

import { cn } from "@/lib/utils"

// Action-failure notifications (submit/save/delete/upload); page-load failures
// stay inline as <ErrorState>. Sits above dialogs (z-1000), below the route
// curtain (z-2000).
// ponytail: hand-rolled — fixed stack, no enter/exit animation, no dedupe or
// promise helpers. If any of those are wanted, swap in sonner (same
// toast.error/toast.success call shape) and delete this file.

const TOAST_TTL_MS = 5000

type ToastVariant = "error" | "success"
type ToastItem = { id: number; message: string; variant: ToastVariant }
type ToastApi = { error: (message: string) => void; success: (message: string) => void }

const ToastContext = React.createContext<ToastApi | null>(null)

let nextId = 0

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const timersRef = React.useRef(new Map<number, number>())

  const dismiss = React.useCallback((id: number): void => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  React.useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const api = React.useMemo<ToastApi>(() => {
    const push =
      (variant: ToastVariant) =>
      (message: string): void => {
        const id = ++nextId
        setToasts((current) => [...current, { id, message, variant }])
        timersRef.current.set(
          id,
          window.setTimeout(() => dismiss(id), TOAST_TTL_MS)
        )
      }
    return { error: push("error"), success: push("success") }
  }, [dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        data-slot="toast-stack"
        className="pointer-events-none fixed right-4 bottom-4 z-[1100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div key={toast.id} role={toast.variant === "error" ? "alert" : "status"}>
            <button
              data-slot="toast"
              type="button"
              onClick={() => dismiss(toast.id)}
              className={cn(
                "pointer-events-auto block w-full rounded-md border px-4 py-3 text-left shadow-lg",
                toast.variant === "error"
                  ? "border-danger-border bg-danger-surface text-danger"
                  : "border-accent-fg/40 bg-surface-raised text-accent-fg"
              )}
            >
              {/* base.css's unlayered `button { font: inherit }` beats any font
                  utility on the button itself, so the type scale lives here. */}
              <span className="text-sm font-medium">{toast.message}</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function useToast(): ToastApi {
  const api = React.useContext(ToastContext)
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>")
  }
  return api
}

export { ToastProvider, useToast }
