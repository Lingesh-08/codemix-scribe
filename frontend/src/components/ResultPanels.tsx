import { useMemo, useState, type ReactNode } from "react";
import Icon from "./Icon";
import { CopyButton } from "./ui";

interface Props {
  raw: string;
  corrected: string | null;
  status?: string | null;
  correcting?: boolean;
  /** Tailwind class deciding when raw/corrected sit side by side. */
  columns?: string;
}

type Op = { kind: "same" | "del" | "ins"; word: string };

/** Words compared without case and punctuation, so "है." vs "है।" is not counted as a fix. */
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");

/** Word-level diff (longest common subsequence) between raw and corrected text. */
function diffWords(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const na = a.map(norm), nb = b.map(norm);
  const L = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * (m + 1) + j] = na[i] === nb[j] ? L[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) { ops.push({ kind: "same", word: b[j] }); i++; j++; }
    else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) ops.push({ kind: "del", word: a[i++] });
    else ops.push({ kind: "ins", word: b[j++] });
  }
  while (i < n) ops.push({ kind: "del", word: a[i++] });
  while (j < m) ops.push({ kind: "ins", word: b[j++] });
  return ops;
}

/** Raw Whisper text vs Gemma-corrected text, side by side, with Gemma's changes highlighted. */
export default function ResultPanels({ raw, corrected, status, correcting, columns = "lg:grid-cols-2" }: Props) {
  const [highlight, setHighlight] = useState(true);
  const showDiff = !correcting && status === "CORRECTED" && !!corrected;

  const ops = useMemo(
    () => (showDiff ? diffWords(raw.split(/\s+/).filter(Boolean), corrected!.split(/\s+/).filter(Boolean)) : []),
    [showDiff, raw, corrected],
  );
  const changed = ops.filter((o) => o.kind === "ins").length;
  const total = ops.filter((o) => o.kind !== "del").length;

  const render = (side: "raw" | "corrected"): ReactNode =>
    ops
      .filter((o) => o.kind === "same" || (side === "raw" ? o.kind === "del" : o.kind === "ins"))
      .map((o, k) => (
        <span key={k}>
          {o.kind === "same" ? (
            o.word
          ) : o.kind === "del" ? (
            <span className="rounded bg-rose-100/80 px-0.5 text-rose-700 line-through decoration-rose-400/70">{o.word}</span>
          ) : (
            <span className="rounded bg-emerald-100 px-0.5 text-emerald-900 shadow-[inset_0_-2px_0_rgb(16_185_129/0.45)]">{o.word}</span>
          )}{" "}
        </span>
      ));

  const note = correcting
    ? null
    : status === "UNAVAILABLE"
      ? "Gemma was unreachable, so this is the raw text. Check the Gemma URL in Settings."
      : status === "SKIPPED"
        ? "Nothing to correct."
        : null;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/80">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <Icon name="sparkles" className="w-5 h-5" />
          </div>
          <div>
            {correcting ? (
              <div className="text-sm font-semibold text-slate-800">Gemma is reviewing the transcript…</div>
            ) : showDiff ? (
              <div className="text-sm font-semibold text-slate-800">
                {changed === 0 ? "Gemma found nothing to change" : <>Gemma corrected <span className="text-emerald-600">{changed}</span> of {total} words</>}
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-800">Gemma correction</div>
            )}
            <div className="text-xs text-slate-500">Fine-tuned Gemma LoRA · fixes ASR errors, keeps each script</div>
          </div>
        </div>
        {showDiff && changed > 0 && (
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="hidden sm:flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-300" />Gemma's fix</span>
            <span className="hidden sm:flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-300" />Replaced</span>
            <label className="flex cursor-pointer select-none items-center gap-2 font-medium">
              <button
                type="button"
                role="switch"
                aria-checked={highlight}
                onClick={() => setHighlight(!highlight)}
                className={`relative h-5 w-9 rounded-full transition ${highlight ? "bg-indigo-600" : "bg-slate-300"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${highlight ? "left-[18px]" : "left-0.5"}`} />
              </button>
              Highlight
            </label>
          </div>
        )}
      </div>

      <div className={`grid gap-4 ${columns}`}>
        <Panel
          title="Raw transcript"
          subtitle="faster-whisper large-v3-turbo"
          icon="wave"
          accent="slate"
          text={raw}
          body={showDiff && highlight ? render("raw") : undefined}
        />
        <Panel
          title="Corrected transcript"
          subtitle="Gemma 4 + CodeMix Scribe LoRA"
          icon="sparkles"
          accent="emerald"
          text={correcting ? "" : corrected ?? ""}
          body={showDiff && highlight ? render("corrected") : undefined}
          note={note}
          loading={correcting}
        />
      </div>
    </div>
  );
}

function Panel(props: {
  title: string;
  subtitle: string;
  icon: "wave" | "sparkles";
  accent: "slate" | "emerald";
  text: string;
  body?: ReactNode;
  note?: string | null;
  loading?: boolean;
}) {
  const { title, subtitle, icon, accent, text, body, note, loading } = props;
  return (
    <div className={`flex flex-col rounded-2xl bg-white ring-1 ${accent === "emerald" ? "ring-emerald-200" : "ring-slate-200/80"}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-7 w-7 place-items-center rounded-lg ${accent === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            <p className="text-[11px] text-slate-400">{subtitle}</p>
          </div>
        </div>
        {text && <CopyButton text={text} />}
      </div>
      <div className="scroll-thin max-h-[28rem] overflow-y-auto px-5 py-4">
        {note && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
            <Icon name="alert" className="mt-px h-4 w-4 shrink-0" /> {note}
          </p>
        )}
        {loading ? (
          <div className="space-y-2.5 py-1">
            {[92, 100, 85, 96, 60].map((w, i) => (
              <div key={i} className="h-3.5 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-script text-[17px] leading-8 text-slate-800">{body ?? text}</p>
        )}
      </div>
    </div>
  );
}
