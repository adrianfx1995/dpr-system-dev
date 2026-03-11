import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProcessAlert {
  time: string;
  message: string;
}

interface ProcessStatus {
  name: string;
  status: "running" | "restarting" | "stopped";
  pid: number | null;
  restartCount: number;
  startedAt: string | null;
  lastRestartAt: string | null;
  alerts: ProcessAlert[];
}

function StatusDot({ status }: { status: ProcessStatus["status"] }) {
  const color =
    status === "running"
      ? "bg-green-500"
      : status === "restarting"
      ? "bg-amber-400 animate-pulse"
      : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function friendlyName(name: string) {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SystemStatusPanel() {
  const [processes, setProcesses] = useState<ProcessStatus[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAlerts, setExpandedAlerts] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/system/status")
        .then((r) => r.json())
        .then((data: ProcessStatus[]) => setProcesses(data))
        .catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const restart = (name: string) =>
    fetch(`/api/system/restart/${name}`, { method: "POST" }).catch(() => {});

  const allRunning = processes.length > 0 && processes.every((p) => p.status === "running");
  const anyAlert   = processes.some((p) => p.status !== "running");

  return (
    <div className={`border-b border-border bg-card/50 text-sm ${anyAlert ? "bg-destructive/5" : ""}`}>
      {/* Header row */}
      <div
        className="flex items-center justify-between px-3 sm:px-6 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">
          <StatusDot status={allRunning ? "running" : anyAlert ? "stopped" : "restarting"} />
          System Status
          {processes.length > 0 && (
            <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
              {processes.filter((p) => p.status === "running").length}/{processes.length} running
            </span>
          )}
        </div>
        <button className="text-muted-foreground hover:text-foreground">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div className="px-3 sm:px-6 pb-3 space-y-1">
          {processes.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              No status data — is dprengine.js running?
            </p>
          )}
          {processes.map((p) => (
            <div key={p.name}>
              <div className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
                <StatusDot status={p.status} />

                {/* Name */}
                <span className="w-44 font-medium text-foreground truncate">
                  {friendlyName(p.name)}
                </span>

                {/* Status badge */}
                <span
                  className={`w-20 text-xs font-mono ${
                    p.status === "running"
                      ? "text-green-600 dark:text-green-400"
                      : p.status === "restarting"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-destructive"
                  }`}
                >
                  {p.status}
                </span>

                {/* PID */}
                <span className="w-20 text-xs text-muted-foreground font-mono">
                  pid: {p.pid ?? "—"}
                </span>

                {/* Restart count */}
                <span className="w-24 text-xs text-muted-foreground">
                  restarts: {p.restartCount}
                </span>

                {/* Last restart */}
                <span className="hidden sm:inline text-xs text-muted-foreground flex-1">
                  {p.lastRestartAt ? `last restart: ${formatTime(p.lastRestartAt)}` : `started: ${formatTime(p.startedAt)}`}
                </span>

                {/* Alert toggle */}
                {p.alerts.length > 0 && (
                  <button
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedAlerts((cur) => (cur === p.name ? null : p.name));
                    }}
                  >
                    {expandedAlerts === p.name ? "hide alerts" : `${p.alerts.length} alert${p.alerts.length > 1 ? "s" : ""}`}
                  </button>
                )}

                {/* Restart button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={(e) => { e.stopPropagation(); restart(p.name); }}
                >
                  <RefreshCw className="w-3 h-3" />
                  Restart
                </Button>
              </div>

              {/* Alerts dropdown */}
              {expandedAlerts === p.name && p.alerts.length > 0 && (
                <div className="ml-6 mb-2 mt-1 space-y-0.5">
                  {p.alerts.slice(0, 5).map((a, i) => (
                    <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/60 font-mono flex-shrink-0">
                        {formatTime(a.time)}
                      </span>
                      <span className={a.message.includes("exited") ? "text-destructive/80" : ""}>
                        {a.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
