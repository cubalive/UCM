ull rounded-full transition-all duration-500 ${progressColorClasses[bonus.progressColor] || "bg-muted-foreground"}`}
            style={{ width: `${Math.min(100, bonus.overallProgress)}%` }}
            data-testid="div-bonus-progress-bar"
          />
        </div>
      </div>

      {bonus.requirements && (
        <div className="space-y-2 text-sm">
          <BonusRequirement
            label="Trips"
            current={bonus.requirements.currentTrips}
            required={bonus.requirements.minTrips}
            met={bonus.requirements.currentTrips >= bonus.requirements.minTrips}
          />
          <BonusRequirement
            label="On-Time Rate"
            current={`${bonus.requirements.currentOnTimeRate}%`}
            required={`${bonus.requirements.minOnTimeRate}%`}
            met={bonus.requirements.currentOnTimeRate >= bonus.requirements.minOnTimeRate}
          />
          <BonusRequirement
            label="Completion Rate"
            current={`${bonus.requirements.currentCompletionRate}%`}
            required={`${bonus.requirements.minCompletionRate}%`}
            met={bonus.requirements.currentCompletionRate >= bonus.requirements.minCompletionRate}
          />
        </div>
      )}

      <div className="text-center">
        <Badge variant={bonus.qualifies ? "default" : "secondary"} className={bonus.qualifies ? "bg-green-600 text-white" : ""}>
          {bonus.qualifies ? "Qualified" : "Not Yet Qualified"}
        </Badge>
      </div>
    </div>
  );
}

function BonusRequirement({ label, current, required, met }: { label: string; current: string | number; required: string | number; met: boolean }) {
  return (
    <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
      <div className="flex items-center gap-2">
        {met ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
        <span>{label}</span>
      </div>
      <span className="font-medium">{current} / {required}</span>
    </div>
  );
}

function TripCard({
  trip,
  onStatusChange,
  isPending,
  readonly,
  onOpenChat,
  token,
}: {
  trip: any;
  onStatusChange?: (status: string) => void;
  isPending?: boolean;
  readonly?: boolean;
  onOpenChat?: () => void;
  token?: string | null;
}) {
  const statusAction = STATUS_FLOW[trip.status];
  const statusColorClass = STATUS_COLORS[trip.status] || "";
  const isCompleted = trip.status === "COMPLETED";
  const isCancelled = trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const isLocked = isCompleted || isCancelled;

  const [showProgress, setShowProgress] = useState(false);

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>{trip.publicId}</span>
              <Badge className={statusColorClass} data-testid={`badge-trip-status-${trip.id}`}>
                {STATUS_LABELS[trip.status] || trip.status.replace(/_/g, " ")}
              </Badge>
              {isLocked && <Lock className="w-4 h-4 text-muted-foreground" />}
            </div>

            <TripDateTimeHeader trip={trip} />

            <div className="space-y-1">
              <div className="flex items-start gap-2 text-base">
                <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                <span className="truncate" data-testid={`text-pickup-${trip.id}`}>{trip.pickupAddress || "Pickup not set"}</span>
              </div>
              <div className="flex items-start gap-2 text-base">
                <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
                <span className="truncate" data-testid={`text-dropoff-${trip.id}`}>{trip.dropoffAddress || "Dropoff not set"}</span>
              </div>
            </div>

            <TripMetricsCard trip={trip} />

            {trip.patientName && (
              <div className="flex items-center gap-2 text-base text-muted-foreground">
                <User className="w-5 h-5" />
                <span>{trip.patientName}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-end">
            {!readonly && !isLocked && statusAction && onStatusChange && (
              <Button
                onClick={() => onStatusChange(statusAction.next)}
                disabled={isPending}
                className="min-h-[44px] text-base"
                data-testid={`button-trip-action-${trip.id}`}
              >
                <statusAction.icon className="w-5 h-5 mr-2" />
                {statusAction.label}
              </Button>
            )}
            {!isLocked && onOpenChat && ACTIVE_STATUSES.includes(trip.status) && (
              <Button
                variant="outline"
                onClick={onOpenChat}
                className="min-h-[44px] text-base"
                data-testid={`button-trip-chat-${trip.id}`}
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Contact Dispatch
              </Button>
            )}
          </div>
        </div>

        {(isCompleted || isCancelled || ACTIVE_STATUSES.includes(trip.status)) && (
          <div className="mt-3 border-t pt-3">
            <button
              type="button"
              className="text-sm text-muted-foreground flex items-center gap-1.5 mb-2 min-h-[44px]"
              onClick={() => setShowProgress(!showProgress)}
              data-testid={`button-toggle-progress-${trip.id}`}
            >
              <CheckCircle className="w-4 h-4" />
              {showProgress ? "Hide" : "Show"} Trip Progress
            </button>
            {showProgress && (
              <TripProgressTimeline trip={trip} compact showHeader={false} showMetrics={false} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TripChat({
  tripId,
  token,
  onClose,
  userId,
}: {
  tripId: number;
  token: string | null;
  onClose: () => void;
  userId?: number;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "messages"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/messages`, token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      apiFetch(`/api/trips/${tripId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      }),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "messages"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const messages = messagesQuery.data || [];

  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center">
      <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 p-4 border-b">
          <span className="text-lg font-semibold">Trip Messages</span>
          <Button variant="ghost" size="icon" onClick={onClose} className="min-w-[44px] min-h-[44px]" data-testid="button-close-chat">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <CardContent className="flex-1 overflow-y-auto min-h-[200px] space-y-2 pb-2">
          {messages.length === 0 ? (
            <p className="text-base text-muted-foreground text-center py-4">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex ${msg.senderId === userId ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-base ${
                    msg.senderId === userId
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                  data-testid={`message-${msg.id}`}
                >
                  <p className="text-xs opacity-70 mb-1">
                    {msg.senderRole === "DRIVER" ? "Driver" : "Dispatch"} - {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                  <p>{msg.message}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-3 border-t flex gap-2">
          <Textarea
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 min-h-[44px] resize-none text-base"
            rows={1}
            data-testid="input-chat-message"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim()) sendMutation.mutate(message.trim());
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => { if (message.trim()) sendMutation.mutate(message.trim()); }}
            disabled={sendMutation.isPending || !message.trim()}
            className="min-w-[44px] min-h-[44px]"
            data-testid="button-send-message"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
