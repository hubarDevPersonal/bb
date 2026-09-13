import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

interface ThreadApplyConflictDialogProps {
  conflictedFiles: readonly string[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function ThreadApplyConflictDialog({
  conflictedFiles,
  onOpenChange,
  open,
}: ThreadApplyConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Apply changes locally: conflicts found</DialogTitle>
          <DialogDescription>
            The main checkout was left untouched. Resolve the conflicts
            manually, then try again.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto px-6 pb-5 font-mono text-xs text-muted-foreground">
          {conflictedFiles.map((path) => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
        </ul>
        <DialogFooter className="px-6 pb-5">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
