import { useState, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export const LANG_NAMES: Record<string, string> = { ta: "Tamil", hi: "Hindi", en: "English", ml: "Malayalam" };
export const langName = (code: string | null | undefined) => (code ? LANG_NAMES[code] ?? code.toUpperCase() : "—");

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

type Tone = "slate" | "indigo" | "emerald" | "rose" | "amber" | "violet";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ children, tone = "slate", icon }: { children: ReactNode; tone?: Tone; icon?: IconName }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
      {children}
    </span>
  );
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-rose-600 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-50",
  ghost: "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800",
};

export const inputCls =
  "w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-indigo-500";

/** Copy button that briefly shows a check mark. */
export function CopyButton({ text, label = "Copy", className = btn.ghost }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <Icon name={done ? "check" : "copy"} className="w-4 h-4" />
      {done ? "Copied" : label}
    </button>
  );
}

export function StatusDot({ ok, pulse, pending }: { ok: boolean; pulse?: boolean; pending?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {ok && pulse && !pending && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${pending ? "bg-slate-500" : ok ? "bg-emerald-500" : "bg-rose-500"}`} />
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
      <Icon name="alert" className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return "—";
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
