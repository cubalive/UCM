import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, Check, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export function NotificationCenter() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);

  const notifQuery = useQuery<any>({
    queryKey: ["/api/notifications"],
    queryFn: () => apiFetch("/api/notifications", token),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (notifId: string) =>
      apiFetch(`/api/notifications/${notifId}/read`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/notifications/mark-all-read", token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const notifications = notifQuery.data?.notifications || [];
  const unreadCount = notifQuery.data?.unreadCount || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="relative" data-testid="button-notification-bell" aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}>
          <Bell className="w-4 h-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full flex items-center justify-center" data-testid="badge-unread-count">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7"
              onClick={() => markAllReadMutation.mutate()}
              data-testid="button-mark-all-read"
            >
              <Check className="w-3 h-3 mr-1" aria-hidden="true" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-notifications">
              No notifications
            </div>
          ) : (
            notifications.map((n: any) => (
              <div
                key={n.id}
                className={`p-3 border-b last:border-0 hover:bg-muted/50 transition-colors ${
                  !n.read ? "bg-primary/5" : ""
                }`}
                data-testid={`notif-${n.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {!n.read && (
                        <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(n.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {!n.read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => markReadMutation.mutate(n.id)}
                        data-testid={`button-mark-read-${n.id}`}
                      >
                        <Check className="w-3 h-3" />
                      </Button>
                    )}
                    {n.link && (
                      <Link href={n.link}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => setOpen(false)}
                          data-testid={`button-link-${n.id}`}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-t">
          <Link href="/notification-preferences">
            <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setOpen(false)} data-testid="button-notif-settings">
              Notification Settings
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
