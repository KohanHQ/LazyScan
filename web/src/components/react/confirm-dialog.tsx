import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirm modal replacing components/dialog.ts confirmDialog. Mount it while a
// confirmation is pending; Escape/backdrop/X resolve as cancel (radix handles
// keys, so vanilla's Enter-confirms is dropped).
export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="secondary-button"
            type="button"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            className={props.danger ? "danger-button" : "primary-button"}
            type="button"
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
