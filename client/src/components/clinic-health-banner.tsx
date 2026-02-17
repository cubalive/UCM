import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { isOpsAllowed } from "@/lib/hostDetection";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Phone,
  Siren,
  Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ClinicHealthAlert {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  count: number;
  actionUrl?: string;
}

interface ClinicHealthData {
  overall: "green" | "yellow" | "red";
  clinicId: number;
  clinicName: string;
  date: string;
  alerts: ClinicHealthAlert[];
  lastAlertSentAt?: string | null;
}

export function ClinicHealthBanner({ clinicId }: { clinicId: number }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState("");

  const opsAllowed = isOpsAllowed(user?.role);

  const healthQuery = useQuery<ClinicHealthData>({
    queryKey: ["/api/ops/clinic-health", clinicId],
    queryFn: () => apiFetch(`/api/ops/clinic-health?clinic_id=${clinicId}`, token),
    enabled: opsAllowed && !!clinicId && !!token,
    refetchInterval: 60000,
    retry: false,
  });

  const helpMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/ops/clinic-help", token, {
        method: "POST",
        body: JSON.stringify({ clinic_id: clinicId, message: helpMessage }),
      }),
    onSuccess: () => {
      toast({ title: "Help request sent to dispatch" });
      setHelpOpen(false);
      setHelpMessage("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!healthQuery.data || healthQuery.data.overall === "green") return null;

  const health = healthQuery.data;
  const criticals = health.alerts.filter(a => a.severity === "critical");
  const warnings = health.alerts.filter(a => a.severity === "warning");

  const bannerConfig = {
    yellow: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-800 dark:text-yellow-200", Icon: AlertTriangle },
    red: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", Icon: XCircle },
    green: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", text: "text-green-800 dark:text-green-200", Icon: CheckCircle },
  };

  const config = bannerConfig[health.overall];

  return (
    <>
      <Card className={`${config.border}`} data-testid={`card-clinic-health-${clinicId}`}>
        <CardContent className="p-4">
          <div className={`flex items-center gap-2 mb-3 ${config.bg} p-2 rounded-md`}>
            <config.Icon className={`w-5 h-5 ${config.text}`} />
            <span className={`font-medium ${config.text}`} data-testid={`text-clinic-health-status-${clinicId}`}>
              {health.overall === "red" ? "Critical Issues" : "Warnings"}
            </span>
            {health.lastAlertSentAt && (
              <Badge variant="outline" className="ml-auto">
                <Clock className="w-3 h-3 mr-1" />
                Alert sent: {new Date(health.lastAlertSentAt).toLocaleTimeString()}
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            {criticals.slice(0, 3).map(alert => (
              <div key={alert.code} className="flex items-center gap-2 text-sm" data-testid={`text-clinic-alert-${alert.code}`}>
                <Siren className="w-3 h-3 text-red-500 shrink-0" />
                <span>{alert.title}</span>
                <Badge variant="destructive">{alert.count}</Badge>
              </div>
            ))}
            {warnings.slice(0, 2).map(alert => (
              <div key={alert.code} className="flex items-center gap-2 text-sm" data-testid={`text-clinic-warning-${alert.code}`}>
                <AlertTriangle className="w-3 h-3 text-yellow-500 shrink-0" />
                <span>{alert.title}</span>
                <Badge variant="secondary">{alert.count}</Badge>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHelpOpen(true)}
              data-testid={`button-request-help-${clinicId}`}
            >
              <Phone className="w-4 h-4 mr-1" />
              Request Dispatch Help
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Dispatch Help</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Describe the issue and dispatch will be notified.
          </p>
          <Textarea
            placeholder="Describe the issue..."
            value={helpMessage}
            onChange={(e) => setHelpMessage(e.target.value)}
            className="min-h-[100px]"
            data-testid="textarea-help-message"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setHelpOpen(false)}>Cancel</Button>
            <Button
              onClick={() => helpMutation.mutate()}
              disabled={helpMutation.isPending || !helpMessage.trim()}
              data-testid="button-submit-help"
            >
              {helpMutation.isPending ? "Sending..." : "Send Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
