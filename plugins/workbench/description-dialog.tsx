import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";

export interface DescriptionDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  submitting: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: () => void;
}

export function DescriptionDialogView({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  value,
  onValueChange,
  submitting,
  error,
  submitLabel,
  onSubmit,
}: DescriptionDialogViewProps) {
  const canSubmit = value.trim().length > 0 && !submitting;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogTitle className="px-4 pt-4 text-sm font-medium text-foreground">
          {title}
        </DialogTitle>
        <DialogDescription className="px-4 pt-1 text-xs text-muted-foreground">
          {description}
        </DialogDescription>
        <div className="px-4 pt-3">
          <Textarea
            autoFocus
            value={value}
            disabled={submitting}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            className="min-h-28 resize-y bg-background text-sm"
          />
          {error !== null ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="mt-4 border-t border-border-hairline px-4 py-3">
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onSubmit}
          >
            {submitting ? "Sending…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
