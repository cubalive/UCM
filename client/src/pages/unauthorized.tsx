import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";
import { useLocation } from "wouter";

export default function UnauthorizedPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex items-center justify-center min-h-[80vh]" data-testid="unauthorized-page">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="flex flex-row items-center gap-3">
          <ShieldX className="h-6 w-6 text-destructive flex-shrink-0" />
          <CardTitle data-testid="text-unauthorized-title">Access Denied</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-unauthorized-message">
            You do not have permission to access this page. Contact your administrator if you believe this is an error.
          </p>
          <Button
            onClick={() => setLocation("/")}
            className="w-full"
            data-testid="button-go-home"
          >
            Go to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
