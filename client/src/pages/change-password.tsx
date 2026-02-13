import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

export default function ChangePasswordPage() {
  const { token, clearMustChangePassword, user } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await apiFetch("/api/auth/change-password", token, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (result.success) {
        toast({ title: "Password changed successfully" });
        clearMustChangePassword();
      }
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4" data-testid="change-password-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex items-center justify-center">
            <img src="/branding/logo-small.png" alt="UCM" className="h-16 w-auto" data-testid="img-change-password-logo" />
          </div>
          <CardTitle className="text-xl">Change Your Password</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            You are using a temporary password. Please set a new password to continue.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current Password</Label>
              <Input
                id="current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New Password</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                data-testid="input-new-password"
              />
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm New Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                data-testid="input-confirm-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-change-password-error">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              data-testid="button-change-password"
            >
              {loading ? "Changing..." : "Set New Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
