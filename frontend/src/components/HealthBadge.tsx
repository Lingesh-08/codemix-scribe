import { useEffect, useState } from "react";
import { api, type Health } from "../api";
import { StatusDot } from "./ui";

/** Polls the ai-service /health every 15 s. */
export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .health()
        .then((r) => alive && (setHealth(r), setDown(false)))
        .catch(() => alive && setDown(true));
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return { health, down };
}

/** Service status block for the sidebar: Whisper (ai-service) and Gemma (Kaggle). */
export default function HealthBadge({ compact = false }: { compact?: boolean }) {
  const { health, down } = useHealth();
  const asrOk = !down && !!health?.modelLoaded;
  const gemmaOk = !!health?.gemma.reachable;
  const pending = !health && !down;
  const gpu = health?.gpu?.replace(/^NVIDIA\s+/, "").replace(/\s*Laptop GPU$/, "");

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-slate-300">
        <span className="flex items-center gap-1.5"><StatusDot ok={asrOk} pending={pending} /> ASR</span>
        <span className="flex items-center gap-1.5"><StatusDot ok={gemmaOk} pending={pending} /> Gemma</span>
      </div>
    );
  }

  const Row = ({ ok, title, detail }: { ok: boolean; title: string; detail: string }) => (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
      <StatusDot ok={ok} pulse pending={pending} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-200">{title}</div>
        <div className="truncate text-[11px] text-slate-400">{detail}</div>
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-1">
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Services</div>
      <Row ok={asrOk} title="Whisper ASR" detail={pending ? "Checking…" : down ? "ai-service offline" : asrOk ? gpu ?? "GPU" : "Loading model…"} />
      <Row ok={gemmaOk} title="Gemma correction" detail={pending ? "Checking…" : gemmaOk ? "Kaggle · connected" : health?.gemma.url ? "Unreachable" : "No URL set"} />
    </div>
  );
}
