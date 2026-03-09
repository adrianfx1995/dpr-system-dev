import { useState } from "react";
import { Link2, Circle, ArrowUpRight, ArrowDownRight, Users, Pencil, Wifi, WifiOff, AlertTriangle, Loader } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SlaveAccount {
  id: string;
  name: string;
  accountNumber: string;
  masterPass: string;
  broker: string;
  mt5Path?: string;
  currency: string;
  masterId: string;
  balance: number;
  equity: number;
  pnl: number;
  totalPnl: number;
  copyRatio: number;
  status: "synced" | "pending" | "error";
  mtStatus?: "connected" | "disconnected" | "error" | "connecting";
  mtMessage?: string;
  createdAt: string;
  lastUpdated: string;
}

const SLOT_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD"];

interface SlaveAccountPanelProps {
  accounts: SlaveAccount[];
  masterName: string | null;
  onEdit: (id: string, updates: Partial<SlaveAccount>) => void;
  assignedSymbols?: Record<string, string>;
}

const statusConfig = {
  synced: { label: "Synced", color: "text-badge-success", bg: "bg-badge-success/10" },
  pending: { label: "Pending", color: "text-badge-warning", bg: "bg-badge-warning/10" },
  error: { label: "Error", color: "text-destructive", bg: "bg-destructive/10" },
};

function SlaveMt5Badge({ status, message }: { status?: string; message?: string }) {
  if (!status || status === "disconnected") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <WifiOff className="w-3 h-3" />
        <span>MT5 offline</span>
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-badge-warning">
        <Loader className="w-3 h-3 animate-spin" />
        <span>Connecting...</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-destructive" title={message || "MT5 error"}>
        <AlertTriangle className="w-3 h-3" />
        <span className="max-w-[120px] truncate">{message || "MT5 error"}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-badge-success">
      <Wifi className="w-3 h-3" />
      <span>MT5 live</span>
    </span>
  );
}

const SlaveAccountPanel = ({ accounts, masterName, onEdit, assignedSymbols = {} }: SlaveAccountPanelProps) => {
  const [editAccount, setEditAccount] = useState<SlaveAccount | null>(null);
  const [form, setForm] = useState<Partial<SlaveAccount>>({});

  const openEdit = (account: SlaveAccount) => {
    setEditAccount(account);
    setForm({
      name: account.name,
      accountNumber: account.accountNumber,
      masterPass: account.masterPass,
      broker: account.broker,
      mt5Path: account.mt5Path,
      copyRatio: account.copyRatio,
      status: account.status,
    });
  };

  const handleSave = () => {
    if (editAccount) {
      onEdit(editAccount.id, form);
      setEditAccount(null);
    }
  };

  const setField = (field: keyof SlaveAccount) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: field === "copyRatio" ? parseFloat(e.target.value) : e.target.value }));

  if (!masterName) {
    return (
      <div className="h-full flex items-center justify-center bg-slave text-slave-foreground">
        <div className="text-center">
          <Users className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-base sm:text-lg font-medium text-muted-foreground/60">Select a Master Account</p>
          <p className="text-xs sm:text-sm text-muted-foreground/40 mt-1">Click on a master account to view linked slaves</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slave text-slave-foreground flex flex-col">
      <div className="p-3 sm:p-5 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          <h2 className="text-sm sm:text-base font-semibold tracking-tight">Slave Accounts</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Linked to <span className="text-primary font-medium">{masterName}</span> · {accounts.length} accounts
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="grid gap-2 sm:gap-3 grid-cols-1 lg:grid-cols-2">
          {accounts.map((account) => {
            const st = statusConfig[account.status];
            const symbol = assignedSymbols[account.id];
            return (
              <div
                key={account.id}
                className="rounded-xl border border-border p-3 sm:p-4 hover:shadow-md transition-shadow duration-200 bg-card group"
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-secondary flex items-center justify-center">
                      <span className="text-xs font-bold text-secondary-foreground">
                        {account.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-semibold">{account.name}</p>
                      <p className="text-[10px] text-muted-foreground">{account.broker} · {account.accountNumber}</p>
                      {symbol && (
                        <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {symbol}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(account)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted"
                      title="Edit account"
                    >
                      <Pencil className="w-3 h-3 text-muted-foreground" />
                    </button>
                    <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-1 rounded-full ${st.color} ${st.bg}`}>
                      <Circle className="w-1.5 h-1.5 fill-current inline mr-1" />
                      {st.label}
                    </span>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Balance</p>
                    <p className="text-base sm:text-lg font-semibold font-mono">${account.balance.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Equity</p>
                    <p className="text-base sm:text-lg font-semibold font-mono">${account.equity.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Today P&L</p>
                    <p className={`text-sm font-semibold font-mono flex items-center gap-0.5 ${account.pnl >= 0 ? "text-badge-success" : "text-destructive"}`}>
                      {account.pnl >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      ${Math.abs(account.pnl).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Total P&L</p>
                    <p className={`text-sm font-semibold font-mono flex items-center gap-0.5 ${account.totalPnl >= 0 ? "text-badge-success" : "text-destructive"}`}>
                      {account.totalPnl >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      ${Math.abs(account.totalPnl).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Copy Ratio</span>
                  <span className="text-[10px] font-semibold font-mono">{account.copyRatio}x</span>
                </div>
                <div className="mt-2">
                  <SlaveMt5Badge status={account.mtStatus} message={account.mtMessage} />
                </div>
                {account.mt5Path && (
                  <div className="mt-2 text-[10px] text-muted-foreground truncate" title={account.mt5Path}>
                    MT5: {account.mt5Path}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Slave Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Account Name</Label>
              <Input value={form.name ?? ""} onChange={setField("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Account Number</Label>
              <Input value={form.accountNumber ?? ""} onChange={setField("accountNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label>Master Password</Label>
              <Input type="password" value={form.masterPass ?? ""} onChange={setField("masterPass")} />
            </div>
            <div className="space-y-1.5">
              <Label>Server</Label>
              <Input value={form.broker ?? ""} onChange={setField("broker")} />
            </div>
            <div className="space-y-1.5">
              <Label>MT5 Terminal Path (Optional)</Label>
              <Input value={form.mt5Path ?? ""} onChange={setField("mt5Path")} />
            </div>
            <div className="space-y-1.5">
              <Label>Copy Ratio</Label>
              <Input type="number" step="0.01" min="0" max="1" value={form.copyRatio ?? ""} onChange={setField("copyRatio")} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as SlaveAccount["status"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="synced">Synced</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} className="w-full">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SlaveAccountPanel;
