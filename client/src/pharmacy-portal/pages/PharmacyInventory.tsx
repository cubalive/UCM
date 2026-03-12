import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Package,
  Search,
  AlertTriangle,
  Plus,
  Minus,
  Filter,
  RefreshCw,
  Pill,
} from "lucide-react";

interface InventoryItem {
  medicationName: string;
  ndc: string | null;
  isControlled: boolean;
  scheduleClass: string | null;
  requiresRefrigeration: boolean;
  totalOrdered: number;
  orderCount: number;
  stockLevel: number;
  lowStockThreshold: number;
  isLowStock: boolean;
}

export default function PharmacyInventory() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  // New item form state
  const [newMedName, setNewMedName] = useState("");
  const [newNdc, setNewNdc] = useState("");
  const [newStock, setNewStock] = useState(100);
  const [newThreshold, setNewThreshold] = useState(10);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/pharmacy/inventory", search, showLowOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (showLowOnly) params.set("lowStock", "true");
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/inventory?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load inventory");
      return res.json();
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({ medicationName, adjustment, reason }: { medicationName: string; adjustment: number; reason: string }) => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/inventory`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ medicationName, adjustment, reason }),
      });
      if (!res.ok) throw new Error("Failed to adjust stock");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/inventory"] });
      setAdjustItem(null);
      setAdjustAmount(0);
      setAdjustReason("");
    },
  });

  const addMutation = useMutation({
    mutationFn: async (item: { medicationName: string; ndc: string; stockLevel: number; lowStockThreshold: number }) => {
      const res = await fetch(`${API_BASE_URL}/api/pharmacy/inventory`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!res.ok) throw new Error("Failed to add item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/inventory"] });
      setShowAddModal(false);
      setNewMedName("");
      setNewNdc("");
      setNewStock(100);
      setNewThreshold(10);
    },
  });

  const inventory: InventoryItem[] = data?.inventory || [];
  const lowStockCount = data?.lowStockCount || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package className="w-6 h-6 text-violet-400" />
            Inventory Management
          </h1>
          <p className="text-sm text-gray-400 mt-1">Track medication stock levels and manage inventory</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              {lowStockCount} medication{lowStockCount !== 1 ? "s" : ""} below low-stock threshold
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Review and restock items to avoid delivery delays.</p>
          </div>
          <button
            onClick={() => setShowLowOnly(!showLowOnly)}
            className="ml-auto px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
          >
            {showLowOnly ? "Show All" : "Show Low Stock"}
          </button>
        </div>
      )}

      {/* Search + filters */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by medication name or NDC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <button
          onClick={() => setShowLowOnly(!showLowOnly)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            showLowOnly ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-[#0a0f1e] text-gray-400 border border-[#1e293b] hover:text-white"
          }`}
        >
          <Filter className="w-3 h-3" />
          Low Stock Only
        </button>
        <span className="text-xs text-gray-500">{inventory.length} items</span>
      </div>

      {/* Inventory Table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e293b]">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medication</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">NDC</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stock Level</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Threshold</th>
              <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Ordered</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Flags</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-[#1e293b]/50">
                  <td colSpan={8} className="px-5 py-4"><div className="h-4 bg-gray-700 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : inventory.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center text-gray-500">
                  <Pill className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No inventory items found</p>
                </td>
              </tr>
            ) : (
              inventory.map((item) => (
                <tr key={item.medicationName} className={`border-b border-[#1e293b]/50 hover:bg-white/[0.02] transition-colors ${item.isLowStock ? "bg-amber-500/[0.03]" : ""}`}>
                  <td className="px-5 py-3">
                    <p className="text-sm text-white font-medium">{item.medicationName}</p>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400 font-mono">{item.ndc || "---"}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`text-sm font-bold ${item.isLowStock ? "text-amber-400" : "text-white"}`}>
                      {item.stockLevel}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-500">{item.lowStockThreshold}</td>
                  <td className="px-5 py-3 text-right text-sm text-gray-400">{item.totalOrdered}</td>
                  <td className="px-5 py-3 text-center space-x-1">
                    {item.isControlled && <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">CTRL</span>}
                    {item.requiresRefrigeration && <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">COLD</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {item.isLowStock ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Low Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        In Stock
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => { setAdjustItem(item); setAdjustAmount(10); setAdjustReason("Restock"); }}
                        className="p-1.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        title="Add stock"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => { setAdjustItem(item); setAdjustAmount(-1); setAdjustReason("Adjustment"); }}
                        className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Remove stock"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust Stock Modal */}
      {adjustItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setAdjustItem(null)}>
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Adjust Stock</h3>
            <p className="text-sm text-gray-400">{adjustItem.medicationName}</p>
            <p className="text-xs text-gray-500">Current stock: {adjustItem.stockLevel}</p>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Adjustment Amount</label>
              <input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(Number(e.target.value))}
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <p className="text-[10px] text-gray-600 mt-1">Use negative numbers to remove stock</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Reason</label>
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Restock, damage, expired..."
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setAdjustItem(null)} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700">Cancel</button>
              <button
                onClick={() => adjustMutation.mutate({ medicationName: adjustItem.medicationName, adjustment: adjustAmount, reason: adjustReason })}
                disabled={adjustMutation.isPending || adjustAmount === 0}
                className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50"
              >
                {adjustMutation.isPending ? "Saving..." : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Add Inventory Item</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Medication Name *</label>
              <input type="text" value={newMedName} onChange={(e) => setNewMedName(e.target.value)} className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">NDC</label>
              <input type="text" value={newNdc} onChange={(e) => setNewNdc(e.target.value)} placeholder="12345-678-90" className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Initial Stock</label>
                <input type="number" value={newStock} onChange={(e) => setNewStock(Number(e.target.value))} className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Low Stock Threshold</label>
                <input type="number" value={newThreshold} onChange={(e) => setNewThreshold(Number(e.target.value))} className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700">Cancel</button>
              <button
                onClick={() => addMutation.mutate({ medicationName: newMedName, ndc: newNdc, stockLevel: newStock, lowStockThreshold: newThreshold })}
                disabled={addMutation.isPending || !newMedName.trim()}
                className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50"
              >
                {addMutation.isPending ? "Adding..." : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
