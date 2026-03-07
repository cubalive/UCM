import { Button } from "@/components/ui/button";
import { SearchX, Plus, Inbox, FileQuestion } from "lucide-react";

interface EmptyStateProps {
  icon?: "search" | "empty" | "add" | "question";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  testId?: string;
}

const iconMap = {
  search: SearchX,
  empty: Inbox,
  add: Plus,
  question: FileQuestion,
};

export function EmptyState({
  icon = "empty",
  title,
  description,
  actionLabel,
  onAction,
  className = "",
  testId,
}: EmptyStateProps) {
  const Icon = iconMap[icon];

  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}
      data-testid={testId || "empty-state"}
    >
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-1" data-testid="empty-state-title">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4" data-testid="empty-state-description">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm" data-testid="empty-state-action">
          <Plus className="h-4 w-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
