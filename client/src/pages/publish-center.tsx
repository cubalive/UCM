import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Send,
  Plus,
  Trash2,
  Globe,
  Lock,
  Building2,
  Eye,
  EyeOff,
  UserPlus,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const MODULES = [
  { value: "certification", label: "Certification" },
  { value: "ranking", label: "Ranking" },
  { value: "audit", label: "Audit Shield" },
  { value: "prediction", label: "Prediction" },
  { value: "indexes", label: "Indexes" },
];

function getCurrentQuarterKey() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

export default function PublishCenterPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newModule, setNewModule] = useState("certification");
  const [newQuarterKey, setNewQuarterKey] = useState(getCurrentQuarterKey());
  const [newScope, setNewScope] = useState("");
  const [newState, setNewState] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newMetricKey, setNewMetricKey] = useState("");
  const [showTargetDialog, setShowTargetDialog] = useState<number | null>(null);
  const [targetType, setTargetType] = useState("all_clinics");
  const [selectedClinicId, setSelectedClinicId] = useState("");

  const pubsQuery = useQuery({
    queryKey: ["/api/intelligence/publications"],
    queryFn: () => apiFetch("/api/intelligence/publications", token),
  });

  const clinicsQuery = useQuery({
    queryKey: ["/api/intelligence/clinics-list"],
    queryFn: () => apiFetch("/api/intelligence/clinics-list", token),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/intelligence/publications", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      setShowCreateDialog(false);
      toast({ title: "Publication created" });
    },
    onError: () => toast({ title: "Failed to create publication", variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/intelligence/publications/${id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      toast({ title: "Published" });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/intelligence/publications/${id}/unpublish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      toast({ title: "Unpublished" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/intelligence/publications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      toast({ title: "Publication deleted" });
    },
  });

  const addTargetMutation = useMutation({
    mutationFn: ({ pubId, body }: { pubId: number; body: any }) =>
      apiRequest("POST", `/api/intelligence/publications/${pubId}/targets`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      setShowTargetDialog(null);
      toast({ title: "Target added" });
    },
  });

  const removeTargetMutation = useMutation({
    mutationFn: ({ pubId, targetId }: { pubId: number; targetId: number }) =>
      apiRequest("DELETE", `/api/intelligence/publications/${pubId}/targets/${targetId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      toast({ title: "Target removed" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ id, configJson }: { id: number; configJson: any }) =>
      apiRequest("PATCH", `/api/intelligence/publications/${id}`, { configJson }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/publications"] });
      toast({ title: "Configuration updated" });
    },
  });

  const publications = pubsQuery.data?.publications || [];
  const clinicsList = clinicsQuery.data?.clinics || [];

  const handleCreate = () => {
    createMutation.mutate({
      module: newModule,
      quarterKey: newQuarterKey,
      ...(newScope ? { scope: newScope } : {}),
      ...(newState ? { state: newState } : {}),
      ...(newCity ? { city: newCity } : {}),
      ...(newMetricKey ? { metricKey: newMetricKey } : {}),
      targets: [{ targetType: "all_clinics" }],
    });
  };

  const handleAddTarget = (pubId: number) => {
    const body: any = { targetType };
    if (targetType === "clinic" && selectedClinicId) {
      body.clinicId = parseInt(selectedClinicId);
    }
    addTargetMutation.mutate({ pubId, body });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="publish-center-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Send className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Publish Center</h1>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-publication">
              <Plus className="h-4 w-4 mr-2" />
              New Publication
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-create-publication">
            <DialogHeader>
              <DialogTitle>Create Publication</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Module</Label>
                <Select value={newModule} onValueChange={setNewModule}>
                  <SelectTrigger data-testid="select-new-module">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quarter Key</Label>
                <Input
                  value={newQuarterKey}
                  onChange={(e) => setNewQuarterKey(e.target.value)}
                  placeholder="e.g. 2026-Q1"
                  data-testid="input-new-quarter"
                />
              </div>
              {(newModule === "ranking") && (
                <>
                  <div className="space-y-2">
                    <Label>Scope</Label>
                    <Select value={newScope || "national"} onValueChange={setNewScope}>
                      <SelectTrigger data-testid="select-new-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="national">National</SelectItem>
                        <SelectItem value="state">State</SelectItem>
                        <SelectItem value="city">City</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newScope === "state" && (
                    <div className="space-y-2">
                      <Label>State</Label>
                      <Input
                        value={newState}
                        onChange={(e) => setNewState(e.target.value)}
                        placeholder="e.g. TX"
                        data-testid="input-new-state"
                      />
                    </div>
                  )}
                  {newScope === "city" && (
                    <div className="space-y-2">
                      <Label>City</Label>
                      <Input
                        value={newCity}
                        onChange={(e) => setNewCity(e.target.value)}
                        placeholder="e.g. Houston"
                        data-testid="input-new-city"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Metric Key</Label>
                    <Select value={newMetricKey || "tri"} onValueChange={setNewMetricKey}>
                      <SelectTrigger data-testid="select-new-metric-key">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tri">TRI</SelectItem>
                        <SelectItem value="cts">CTS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                data-testid="button-confirm-create"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {pubsQuery.isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : publications.length === 0 ? (
        <Card data-testid="card-no-publications">
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center">
              <Send className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No publications yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create a publication to control clinic access to intelligence modules.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {publications.map((pub: any) => (
            <Card key={pub.id} data-testid={`publication-card-${pub.id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base">{pub.module}</CardTitle>
                  {pub.quarterKey && <Badge variant="secondary">{pub.quarterKey}</Badge>}
                  {pub.published ? (
                    <Badge variant="default" data-testid={`badge-published-${pub.id}`}>
                      <Globe className="h-3 w-3 mr-1" /> Published
                    </Badge>
                  ) : (
                    <Badge variant="outline" data-testid={`badge-draft-${pub.id}`}>
                      <Lock className="h-3 w-3 mr-1" /> Draft
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {pub.published ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unpublishMutation.mutate(pub.id)}
                      disabled={unpublishMutation.isPending}
                      data-testid={`button-unpublish-${pub.id}`}
                    >
                      <EyeOff className="h-3 w-3 mr-1" /> Unpublish
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publishMutation.mutate(pub.id)}
                      disabled={publishMutation.isPending}
                      data-testid={`button-publish-${pub.id}`}
                    >
                      <Eye className="h-3 w-3 mr-1" /> Publish
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowTargetDialog(pub.id);
                      setTargetType("all_clinics");
                      setSelectedClinicId("");
                    }}
                    data-testid={`button-add-target-${pub.id}`}
                  >
                    <UserPlus className="h-3 w-3 mr-1" /> Add Target
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this publication?")) {
                        deleteMutation.mutate(pub.id);
                      }
                    }}
                    data-testid={`button-delete-${pub.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Configuration</p>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pub.configJson?.allow_pdf_download !== false}
                        onCheckedChange={(checked) =>
                          updateConfigMutation.mutate({
                            id: pub.id,
                            configJson: { ...pub.configJson, allow_pdf_download: checked },
                          })
                        }
                        data-testid={`switch-pdf-${pub.id}`}
                      />
                      <Label className="text-xs">PDF Download</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pub.configJson?.show_full_ranking_list === true}
                        onCheckedChange={(checked) =>
                          updateConfigMutation.mutate({
                            id: pub.id,
                            configJson: { ...pub.configJson, show_full_ranking_list: checked },
                          })
                        }
                        data-testid={`switch-full-list-${pub.id}`}
                      />
                      <Label className="text-xs">Full Ranking List</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pub.configJson?.show_peer_names === true}
                        onCheckedChange={(checked) =>
                          updateConfigMutation.mutate({
                            id: pub.id,
                            configJson: { ...pub.configJson, show_peer_names: checked },
                          })
                        }
                        data-testid={`switch-peer-names-${pub.id}`}
                      />
                      <Label className="text-xs">Show Peer Names</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={pub.configJson?.show_score_breakdown === true}
                        onCheckedChange={(checked) =>
                          updateConfigMutation.mutate({
                            id: pub.id,
                            configJson: { ...pub.configJson, show_score_breakdown: checked },
                          })
                        }
                        data-testid={`switch-score-breakdown-${pub.id}`}
                      />
                      <Label className="text-xs">Score Breakdown</Label>
                    </div>
                  </div>
                </div>

                {pub.targets && pub.targets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Targets ({pub.targets.length})</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {pub.targets.map((t: any) => (
                        <Badge
                          key={t.id}
                          variant="outline"
                          className="flex items-center gap-1"
                          data-testid={`target-badge-${t.id}`}
                        >
                          {t.targetType === "all_clinics" ? (
                            <>
                              <Globe className="h-3 w-3" />
                              All Clinics
                            </>
                          ) : (
                            <>
                              <Building2 className="h-3 w-3" />
                              {t.clinicName || `Clinic #${t.clinicId}`}
                            </>
                          )}
                          <button
                            className="ml-1 rounded-full p-0.5 hover:bg-muted"
                            onClick={() => removeTargetMutation.mutate({ pubId: pub.id, targetId: t.id })}
                            data-testid={`button-remove-target-${t.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {pub.publishedAt && (
                  <p className="text-xs text-muted-foreground">
                    Published: {formatDateTime(pub.publishedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showTargetDialog !== null} onOpenChange={(open) => !open && setShowTargetDialog(null)}>
        <DialogContent data-testid="dialog-add-target">
          <DialogHeader>
            <DialogTitle>Add Target</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Target Type</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger data-testid="select-target-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_clinics">All Clinics</SelectItem>
                  <SelectItem value="clinic">Specific Clinic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetType === "clinic" && (
              <div className="space-y-2">
                <Label>Clinic</Label>
                <Select value={selectedClinicId} onValueChange={setSelectedClinicId}>
                  <SelectTrigger data-testid="select-clinic">
                    <SelectValue placeholder="Select a clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {clinicsList.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => showTargetDialog && handleAddTarget(showTargetDialog)}
              disabled={addTargetMutation.isPending || (targetType === "clinic" && !selectedClinicId)}
              data-testid="button-confirm-add-target"
            >
              Add Target
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
