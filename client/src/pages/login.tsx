import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, ArrowLeft, Mail } from "lucide-react";
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
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to send reset link");
      }
      setForgotSent(true);
      toast({
        title: "Reset Link Sent",
        description: "Check your email for password reset instructions.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send reset link",
        variant: "destructive",
      });
    } finally {
      setForgotLoading(false);
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

        {forgotMode ? (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Reset Password</span>
              </div>
            </CardHeader>
            <CardContent>
              {forgotSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm" data-testid="text-forgot-sent">
                    If an account exists with that email, a password reset link has been sent. Please check your inbox.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}
                    data-testid="button-back-to-login"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sign In
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter your email address and we'll send you a link to reset your password.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="your@email.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={forgotLoading}
                    data-testid="button-send-reset"
                  >
                    {forgotLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send Reset Link"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => { setForgotMode(false); setForgotEmail(""); }}
                    data-testid="button-cancel-forgot"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Sign In
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
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
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setForgotMode(true)}
                    className="text-sm text-muted-foreground hover:underline"
                    data-testid="link-forgot-password"
                  >
                    Forgot your password?
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          v1.0 &middot; United Care Mobility System
        </p>
      </div>
    </div>
  );
}
