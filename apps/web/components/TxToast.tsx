"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, SendHorizonal, X, XCircle } from "lucide-react";

import { shortenSignature, solanaFmTxUrl } from "@/lib/format";

type TxStatus = "signing" | "sent" | "confirmed" | "failed";

interface Toast {
  id: number;
  label: string;
  status: TxStatus;
  signature?: string;
  error?: string;
}

interface TxToastContextValue {
  /**
   * Runs `fn` (a StakingVaultClient write call) through the toast lifecycle: signing ->
   * sent(signature) -> confirmed, or -> failed on error. Returns/throws whatever `fn` does.
   */
  track: (label: string, fn: () => Promise<string>) => Promise<string>;
}

const TxToastContext = createContext<TxToastContextValue | null>(null);

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Wallet-adapter and Anchor errors are often long; keep the toast readable.
    return err.message.length > 140 ? `${err.message.slice(0, 140)}…` : err.message;
  }
  return "Unknown error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function TxToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const track = useCallback(
    async (label: string, fn: () => Promise<string>): Promise<string> => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, label, status: "signing" }]);

      try {
        const signature = await fn();
        // The SDK's write methods use Anchor's `.rpc()`, which already awaits on-chain
        // confirmation before resolving — so by the time `signature` is in hand the tx is
        // already confirmed. The "sent" beat below is a deliberate UI pause, not a second
        // network round trip, so the user actually sees the signature before "confirmed".
        update(id, { status: "sent", signature });
        await sleep(450);
        update(id, { status: "confirmed", signature });
        setTimeout(() => remove(id), 5000);
        return signature;
      } catch (err) {
        update(id, { status: "failed", error: errorMessage(err) });
        setTimeout(() => remove(id), 8000);
        throw err;
      }
    },
    [remove, update],
  );

  return (
    <TxToastContext.Provider value={{ track }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={() => remove(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </TxToastContext.Provider>
  );
}

const STATUS_META: Record<TxStatus, { ring: string; text: string; icon: ReactNode }> = {
  signing: {
    ring: "border-white/10",
    text: "Waiting for signature…",
    icon: <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />,
  },
  sent: {
    ring: "border-white/15",
    text: "Sent",
    icon: <SendHorizonal className="h-4 w-4 text-neutral-300" />,
  },
  confirmed: {
    ring: "border-emerald-500/25",
    text: "Confirmed",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  },
  failed: {
    ring: "border-red-500/25",
    text: "Failed",
    icon: <XCircle className="h-4 w-4 text-red-400" />,
  },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const meta = STATUS_META[toast.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
      role="status"
      className={`pointer-events-auto rounded-xl border bg-[#0a0a0a] px-4 py-3.5 text-sm text-neutral-100 ${meta.ring}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{toast.label}</p>
          <p className="mt-1 flex items-center gap-1.5 text-neutral-400">
            {meta.icon}
            {meta.text}
            {toast.signature && toast.status !== "failed" ? (
              <span className="font-mono text-xs text-neutral-500">· {shortenSignature(toast.signature)}</span>
            ) : null}
          </p>
          {toast.status === "failed" && toast.error && <p className="mt-1 text-xs text-red-400/80">{toast.error}</p>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {toast.signature && (toast.status === "sent" || toast.status === "confirmed") && (
        <a
          href={solanaFmTxUrl(toast.signature)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-neutral-300 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-white"
        >
          View on SolanaFM ↗
        </a>
      )}
    </motion.div>
  );
}

export function useTxToast(): TxToastContextValue {
  const ctx = useContext(TxToastContext);
  if (!ctx) {
    throw new Error("useTxToast must be used within a TxToastProvider");
  }
  return ctx;
}
