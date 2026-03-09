import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

export default function DeleteAccountPage() {
  const { token, logout } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && confirmText === "DELETE";

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (confirmText !== "DELETE") {
      setError("Please type DELETE to confirm");
      return;
    }

    setLoading(true);
    try {
      const result = await apiFetch("/api/auth/delete-account", token, {
        method: "POST",
        body: JSON.stringify({ password, reason }),
      });

      if (result.success) {
        toast({ title: "Account deleted", description: "Your account has been permanently deleted." });
        setTimeout(() => logout(), 1500);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4" data-testid="delete-account-page">
      <Card className="w-full max-w-md border-destructive/50">
        <CardHeader className="text-center">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:underline"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle className="text-xl text-destructive">Delete Account</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            This action is permanent and cannot be undone. All your personal data will be removed.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDelete} className="space-y-4">
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-sm space-y-1">
              <p className="font-medium text-destructive">What happens when you delete your account:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Your profile and personal information will be erased</li>
                <li>You will lose access to all app features</li>
                <li>Trip history will be anonymized (kept for regulatory compliance)</li>
                <li>This cannot be reversed</li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Confirm your password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your current password"
                required
                data-testid="input-delete-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason for leaving (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Help us improve..."
                rows={2}
                data-testid="input-delete-reason"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm</Label>
              <Input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                required
                data-testid="input-delete-confirm"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" data-testid="text-delete-error">{error}</p>
            )}

            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={loading || !canSubmit}
              data-testid="button-delete-account"
            >
              {loading ? "Deleting account..." : "Permanently Delete My Account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
