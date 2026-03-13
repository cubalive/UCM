import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Plus, Loader2, AlertTriangle, Search, Filter, Building2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getStoredCompanyScopeId, setStoredCompanyScopeId } from "@/lib/api";

export default function SupportChatPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [selectedThread, setSelectedThread] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [threadStatusFilter, setThreadStatusFilter] = useState<"all" | "OPEN" | "CLOSED">("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isClinic = user?.role === "VIEWER" || user?.role === "CLINIC_USER";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [companyScopeId, setCompanyScopeIdState] = useState<string | null>(getStoredCompanyScopeId());
  const hasCompanyScope = isSuperAdmin ? !!companyScopeId : true;

  const companiesQuery = useQuery<any[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiFetch("/api/companies", token),
    enabled: !!token && isSuperAdmin && !hasCompanyScope,
  });

  const handleCompanyChange = (value: string) => {
    setStoredCompanyScopeId(value);
    setCompanyScopeIdState(value);
    queryClient.invalidateQueries();
  };

  if (isSuperAdmin && !hasCompanyScope) {
    const companies = companiesQuery.data || [];
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4" data-testid="support-no-company">
        <Building2 className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Select a Company</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          As a Super Admin, select a company to access support threads.
        </p>
        <div className="w-full max-w-xs">
          {companiesQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : companiesQuery.isError ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">Failed to load companies</p>
              <Button variant="outline" size="sm" onClick={() => companiesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies found.</p>
          ) : (
            <Select onValueChange={handleCompanyChange}>
              <SelectTrigger data-testid="select-company-scope">
                <SelectValue placeholder="Choose a company..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    );
  }

  const threadsQuery = useQuery<any[]>({
    queryKey: isClinic ? ["/api/clinic/support/thread"] : ["/api/company/support/threads"],
    queryFn: () => apiFetch(isClinic ? "/api/clinic/support/thread" : "/api/company/support/threads", token),
    enabled: !!token,
    refetchInterval: 10000,
  });

  const messagesQuery = useQuery<any>({
    queryKey: isClinic
      ? ["/api/clinic/support/thread", selectedThread, "messages"]
      : ["/api/company/support/threads", selectedThread, "messages"],
    queryFn: () =>
      apiFetch(
        isClinic
          ? `/api/clinic/support/thread/${selectedThread}/messages`
          : `/api/company/support/threads/${selectedThread}/messages`,
        token
      ),
    enabled: !!token && selectedThread !== null,
    refetchInterval: 5000,
  });

  const createThreadMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/clinic/support/thread", token, {
        method: "POST",
        body: JSON.stringify({ subject: newSubject || "Support Request" }),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/support/thread"] });
      setSelectedThread(data.id);
      setNewSubject("");
      toast({ title: "Support thread created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sendMessageMutation = useMutation({
    mutationFn: (body: string) => {
      const url = isClinic
        ? "/api/clinic/support/message"
        : `/api/company/support/threads/${selectedThread}/message`;
      return apiFetch(url, token, {
        method: "POST",
        body: JSON.stringify(isClinic ? { threadId: selectedThread, body } : { body }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: isClinic
          ? ["/api/clinic/support/thread", selectedThread, "messages"]
          : ["/api/company/support/threads", selectedThread, "messages"],
      });
      setNewMessage("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const closeThreadMutation = useMutation({
    mutationFn: (threadId: number) =>
      apiFetch(`/api/company/support/threads/${threadId}/close`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/support/threads"] });
      toast({ title: "Thread closed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const allThreads = threadsQuery.data || [];
  const threads = allThreads.filter((t: any) => {
    if (threadStatusFilter !== "all" && t.status !== threadStatusFilter) return false;
    if (threadSearch.trim()) {
      const q = threadSearch.toLowerCase();
      const subjectMatch = t.subject?.toLowerCase().includes(q);
      const clinicMatch = t.clinicName?.toLowerCase().includes(q);
      if (!subjectMatch && !clinicMatch) return false;
    }
    return true;
  });
  const messages = messagesQuery.data?.messages || [];
  const currentThread = messagesQuery.data?.thread;

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMessageMutation.mutate(newMessage.trim());
  };

  return (
    <div className="p-4 max-w-5xl mx-auto" data-testid="support-chat-page">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          {isClinic ? "Support" : "Support Threads"}
        </h1>
        {isClinic && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Subject (optional)"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              className="w-48"
              data-testid="input-new-subject"
            />
            <Button
              onClick={() => createThreadMutation.mutate()}
              disabled={createThreadMutation.isPending}
              data-testid="button-new-thread"
            >
              {createThreadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              New Thread
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-12rem)]">
        <Card className="md:col-span-1 overflow-hidden flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Threads</CardTitle>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <div className="px-3 pb-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search threads..."
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
                data-testid="input-thread-search"
              />
            </div>
            <Select value={threadStatusFilter} onValueChange={(v) => setThreadStatusFilter(v as any)}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-thread-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardContent className="flex-1 overflow-y-auto p-2 space-y-1">
            {threadsQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : threads.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2" data-testid="text-no-threads">No support threads yet.</p>
            ) : (
              threads.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t.id)}
                  className={`w-full text-left p-3 rounded-md transition-colors ${
                    selectedThread === t.id ? "bg-accent" : "hover-elevate"
                  }`}
                  data-testid={`button-thread-${t.id}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-sm truncate">{t.clinicName || t.subject}</span>
                    <Badge variant={t.status === "OPEN" ? "default" : "secondary"} className="text-xs">
                      {t.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(t.lastMessageAt)}</p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2 overflow-hidden flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">
              {currentThread ? currentThread.subject : "Select a thread"}
            </CardTitle>
            {!isClinic && currentThread?.status === "OPEN" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => closeThreadMutation.mutate(currentThread.id)}
                disabled={closeThreadMutation.isPending}
                data-testid="button-close-thread"
              >
                Close Thread
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
            {selectedThread === null ? (
              <p className="text-sm text-muted-foreground" data-testid="text-select-thread">Select a thread to view messages.</p>
            ) : messagesQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-messages">No messages yet. Send the first message.</p>
            ) : (
              messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`flex ${m.senderRole === "CLINIC" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${m.id}`}
                >
                  <div
                    className={`max-w-[75%] rounded-md p-3 ${
                      m.senderRole === "CLINIC"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-xs opacity-70 mb-1">
                      {m.senderRole === "CLINIC" ? "You" : "Dispatch"} - {new Date(m.createdAt).toLocaleTimeString()}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </CardContent>
          {selectedThread !== null && currentThread?.status === "OPEN" && (
            <div className="p-3 border-t flex gap-2">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                data-testid="input-message"
              />
              <Button
                onClick={handleSend}
                disabled={!newMessage.trim() || sendMessageMutation.isPending}
                data-testid="button-send-message"
              >
                {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
