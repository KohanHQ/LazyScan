import { useState, type ReactElement } from "react";
import { useReaderState, useSession } from "@/state/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Throwaway coexistence probe — delete when pages/home.ts converts to React.
// Each element gates one migration risk: token-backed utilities in both themes,
// `border` rendering without preflight, the data-theme dark variant, base.css's
// element rules under a utility-styled <button>, a live state update, and
// shadcn Button variants + Dialog in the LazyScan palette.
export function ReactProbe(): ReactElement {
  const [count, setCount] = useState(0);
  const session = useSession();
  const reader = useReaderState();

  return (
    <div className="m-8 rounded-lg border border-border bg-surface p-6 text-text">
      <h2 className="text-accent-fg">React probe</h2>
      <p className="text-text-secondary dark:text-accent-fg">
        This line turns mint in dark mode via the data-theme variant.
      </p>
      <p className="text-text-muted">
        Store adapters: session{" "}
        {session.isBootstrapping
          ? "bootstrapping"
          : (session.user?.username ?? "anonymous")}
        , reader page {reader.currentPageIndex + 1}.
      </p>
      <button
        className="rounded-md border border-primary bg-primary px-4 py-2 text-text-on-accent"
        type="button"
        onClick={() => setCount(count + 1)}
      >
        Clicked {count}
      </button>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>shadcn dialog</DialogTitle>
              <DialogDescription>
                Radix behavior (focus trap, esc, overlay close) in the LazyScan
                palette. Both themes must read from the base.css tokens.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
