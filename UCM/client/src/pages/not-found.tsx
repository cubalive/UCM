import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" data-testid="not-found-page">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive flex-shrink-0" />
            <h1 className="text-2xl font-bold" data-testid="text-not-found-title">404 Page Not Found</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground" data-testid="text-not-found-message">
            The page you are looking for does not exist.
          </p>
          <Link href="/">
            <Button className="mt-4 w-full" data-testid="button-go-home">Go Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
