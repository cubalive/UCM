import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, Eye } from "lucide-react";

interface TripRefProps {
  tripId: number;
  publicId?: string;
  label?: string;
  showIcon?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function TripRef({ tripId, publicId, label, showIcon = true, className = "", size = "sm" }: TripRefProps) {
  const [, navigate] = useLocation();

  if (!tripId) return <span className="text-muted-foreground text-xs">—</span>;

  const display = label || publicId || `#${tripId}`;
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/trips/${tripId}`);
      }}
      className={`inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer font-medium ${textSize} ${className}`}
      title={`View Trip ${display}`}
      data-testid={`link-trip-${tripId}`}
    >
      {showIcon && <Eye className="w-3 h-3 flex-shrink-0" />}
      <span>{display}</span>
    </button>
  );
}

interface InvoiceRefProps {
  invoiceId: number;
  invoiceNumber?: string;
  label?: string;
  showIcon?: boolean;
  className?: string;
  size?: "sm" | "md";
  route?: string;
}

export function InvoiceRef({ invoiceId, invoiceNumber, label, showIcon = true, className = "", size = "sm", route }: InvoiceRefProps) {
  const [, navigate] = useLocation();

  if (!invoiceId) return <span className="text-muted-foreground text-xs">—</span>;

  const display = label || invoiceNumber || `#${invoiceId}`;
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const targetRoute = route || `/clinic-invoices`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(targetRoute);
      }}
      className={`inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer font-medium ${textSize} ${className}`}
      title={`View Invoice ${display}`}
      data-testid={`link-invoice-${invoiceId}`}
    >
      {showIcon && <FileText className="w-3 h-3 flex-shrink-0" />}
      <span>{display}</span>
    </button>
  );
}

interface ClickableRowProps {
  to: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

export function ClickableRow({ to, children, className = "", testId }: ClickableRowProps) {
  const [, navigate] = useLocation();

  return (
    <tr
      onClick={() => navigate(to)}
      className={`cursor-pointer hover:bg-muted/50 transition-colors ${className}`}
      data-testid={testId}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(to); }}
    >
      {children}
    </tr>
  );
}
