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
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
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
          title: t("login.loginLinkFailed"),
          description: err.message || t("login.linkExpired"),
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
        title: t("login.loginFailed"),
        description: err.message || t("login.invalidCredentials"),
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
        title: t("login.resetLinkSent"),
        description: t("login.resetLinkSentDesc"),
      });
    } catch (err: any) {
      toast({
        title: t("login.error"),
        description: err.message || t("login.failedSendReset"),
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
          <h1 className="text-2xl font-semibold tracking-tight">{t("app.title")}</h1>
          <Card>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground" data-testid="text-token-loading">
                  {t("login.signingYouIn")}
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
            {t("app.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </div>

        {tokenError && (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-sm text-destructive" data-testid="text-token-error">
                {tokenError}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("login.tokenErrorHelp")}
              </p>
            </CardContent>
          </Card>
        )}

        {forgotMode ? (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("login.resetPassword")}</span>
              </div>
            </CardHeader>
            <CardContent>
              {forgotSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm" data-testid="text-forgot-sent">
                    {t("login.resetSent")}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setForgotMode(false); setForgotSent(false); setForgotEmail(""); }}
                    data-testid="button-back-to-login"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t("login.backToSignIn")}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t("login.resetPrompt")}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">{t("login.email")}</Label>
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
                        {t("login.sending")}
                      </>
                    ) : (
                      t("login.sendResetLink")
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
                    {t("login.backToSignIn")}
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
                <span className="text-sm text-muted-foreground">{t("login.secureLogin")}</span>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t("login.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("login.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t("login.passwordPlaceholder")}
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
                  {loading ? t("login.signingIn") : t("login.signIn")}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setForgotMode(true)}
                    className="text-sm text-muted-foreground hover:underline"
                    data-testid="link-forgot-password"
                  >
                    {t("login.forgotPassword")}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {t("app.versionFull")}
        </p>

        <div className="flex items-center justify-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
