import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import TopBar, { NewAccountDetails } from "@/components/TopBar";
import MasterAccountList, { MasterAccount } from "@/components/MasterAccountList";
import SlaveAccountPanel, { SlaveAccount } from "@/components/SlaveAccountPanel";

async function fetchData() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error("Failed to fetch data");
  return res.json();
}

const Index = () => {
  const queryClient = useQueryClient();
  const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["data"],
    queryFn: fetchData,
    refetchInterval: 5000, // auto-refresh every 5 seconds
  });

  const masters: MasterAccount[] = data?.masterAccounts ?? [];
  const slaves: SlaveAccount[] = data?.slaveAccounts ?? [];

  const maxId = [...masters, ...slaves].reduce((max, a) => {
    const n = parseInt(a.id.slice(1));
    return isNaN(n) ? max : Math.max(max, n);
  }, 99);
  const nextIdRef = useRef(maxId + 1);
  if (maxId >= nextIdRef.current) nextIdRef.current = maxId + 1;

  // Set default selection once data loads
  if (selectedMasterId === null && masters.length > 0) {
    setSelectedMasterId(masters[0].id);
  }

  const addMutation = useMutation({
    mutationFn: async ({ type, account }: { type: "master" | "slave"; account: MasterAccount | SlaveAccount }) => {
      const url = type === "master" ? "/api/masters" : "/api/slaves";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account),
      });
      if (!res.ok) throw new Error("Failed to add account");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data"] }),
  });

  const removeMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "master" | "slave"; id: string }) => {
      const url = type === "master" ? `/api/masters/${id}` : `/api/slaves/${id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove account");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data"] }),
  });

  const handleAddAccount = ({ type, name, accountNumber, masterPass, server, mt5Path }: NewAccountDetails) => {
    const id = `${type[0]}${nextIdRef.current++}`;
    const today = new Date().toISOString().split("T")[0];
    if (type === "master") {
      const newMaster: MasterAccount = {
        id, name,
        accountNumber,
        masterPass,
        broker: server,
        mt5Path: mt5Path.trim() || undefined,
        currency: "USD",
        balance: 0, equity: 0, margin: 0, freeMargin: 0,
        pnl: 0, totalPnl: 0,
        status: "paused", slaveCount: 0,
        createdAt: today, lastUpdated: today,
      };
      addMutation.mutate({ type, account: newMaster });
    } else {
      const masterId = selectedMasterId || masters[0]?.id || "";
      const newSlave: SlaveAccount = {
        id, name,
        accountNumber,
        masterPass,
        broker: server,
        mt5Path: mt5Path.trim() || undefined,
        currency: "USD",
        masterId,
        balance: 0, equity: 0,
        pnl: 0, totalPnl: 0,
        copyRatio: 0.1,
        status: "pending",
        mtStatus: "disconnected",
        mtMessage: "Waiting for worker connection",
        createdAt: today, lastUpdated: today,
      };
      addMutation.mutate({ type, account: newSlave });
    }
  };

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/masters/${id}/activate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to activate master");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data"] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/masters/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (!res.ok) throw new Error("Failed to deactivate master");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data"] }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ type, id, updates }: { type: "master" | "slave"; id: string; updates: object }) => {
      const url = type === "master" ? `/api/masters/${id}` : `/api/slaves/${id}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update account");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data"] }),
  });

  const handleRemoveAccount = (type: "master" | "slave", id: string) => {
    if (type === "master" && selectedMasterId === id) setSelectedMasterId(null);
    removeMutation.mutate({ type, id });
  };

  const handleEditMaster = (id: string, updates: Partial<MasterAccount>) =>
    editMutation.mutate({ type: "master", id, updates });

  const handleEditSlave = (id: string, updates: Partial<SlaveAccount>) =>
    editMutation.mutate({ type: "slave", id, updates });

  const SLOT_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD"];
  const assignedSymbols: Record<string, string> = {};
  [...slaves].sort((a, b) => a.id.localeCompare(b.id)).forEach((s, i) => {
    assignedSymbols[s.id] = SLOT_SYMBOLS[i % SLOT_SYMBOLS.length];
  });

  const filteredSlaves = selectedMasterId ? slaves.filter((s) => s.masterId === selectedMasterId) : [];
  const selectedMaster = masters.find((m) => m.id === selectedMasterId);
  const totalMasterBalance = masters.reduce((s, a) => s + a.balance, 0);
  const totalSlaveBalance = slaves.reduce((s, a) => s + a.balance, 0);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-destructive">
        Failed to connect to API. Make sure the server is running.
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar
        totalMasterBalance={totalMasterBalance}
        totalSlaveBalance={totalSlaveBalance}
        onAddAccount={handleAddAccount}
        onRemoveAccount={handleRemoveAccount}
        masterAccounts={masters}
        slaveAccounts={slaves}
      />

      <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
        <div className="w-full h-[40vh] sm:h-full sm:w-[240px] lg:w-[340px] flex-shrink-0 border-b sm:border-b-0 sm:border-r border-border">
          <MasterAccountList
            accounts={masters}
            selectedId={selectedMasterId}
            onSelect={setSelectedMasterId}
            onEdit={handleEditMaster}
            onActivate={(id) => activateMutation.mutate(id)}
            onDeactivate={(id) => deactivateMutation.mutate(id)}
          />
        </div>

        <div className="flex-1 min-h-0">
          <SlaveAccountPanel
            accounts={filteredSlaves}
            masterName={selectedMaster?.name || null}
            onEdit={handleEditSlave}
            assignedSymbols={assignedSymbols}
          />
        </div>
      </div>
    </div>
  );
};

export default Index;
