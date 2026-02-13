import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2 } from "lucide-react";
import { LogoTileAnimation } from "@/components/logo-tile-animation";
import { useSearch } from "wouter";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const searchString = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const token = params.get("token");
    if (!token) return;

    setTokenLoading(true);
    setTokenError(null);

    fetch("/api/auth/token-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Login link failed");
        }
        localStorage.setItem("ucm_token", data.token);
        window.location.href = "/";
      })
      .catch((err: any) => {
        setTokenError(err.message || "Login link failed");
        toast({
          title: "Login Link Failed",
          description: err.message || "This link may be expired or already used.",
          variant: "destructive",
        });
      })
      .finally(() => setTokenLoading(false));
  }, [searchString]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      toast({
        title: "Login Failed",
        description: err.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (tokenLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <LogoTileAnimation className="mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight">United Care Mobility</h1>
          <Card>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground" data-testid="text-token-loading">
                  Signing you in...
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <LogoTileAnimation className="mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-app-title">
            United Care Mobility
          </h1>
          <p className="text-sm text-muted-foreground">
            Medical Transportation Management
          </p>
        </div>

        {tokenError && (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-sm text-destructive" data-testid="text-token-error">
                {tokenError}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Please use the form below to sign in, or request a new login link from your administrator.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Secure Login</span>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@unitedcare.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  data-testid="input-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                data-testid="button-login"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          v1.0 &middot; United Care Mobility System
        </p>
      </div>
    </div>
  );
}
