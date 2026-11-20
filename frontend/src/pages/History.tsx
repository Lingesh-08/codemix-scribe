import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Transcription } from "../api";
import ResultPanels from "../components/ResultPanels";
import ClinicalCodes from "../components/ClinicalCodes";
import Icon from "../components/Icon";
import { Badge, btn, Card, CopyButton, ErrorNote, formatDuration, inputCls, langName, PageHeader, timeAgo } from "../components/ui";

const STATUS_TONE = { CORRECTED: "emerald", UNAVAILABLE: "amber", SKIPPED: "slate" } as const;
const STATUS_LABEL = { CORRECTED: "Gemma corrected", UNAVAILABLE: "Raw only", SKIPPED: "Skipped" } as const;

export default function History() {
  const [items, setItems] = useState<Transcription[]>([]);
  const [selected, setSelected] = useState<Transcription | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () =>
    api
      .list()
      .then((list) => {
        setItems(list);
        setSelected((s) => (s ? list.find((x) => x.id === s.id) ?? list[0] ?? null : list[0] ?? null));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) => [t.title, t.rawText, t.correctedText ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [items, query]);

  const remove = async (t: Transcription) => {
    if (!confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
    await api.remove(t.id).catch((e) => setError(e.message));
    setSelected(null);
    load();
  };

  const download = (t: Transcription) => {
    const body = `${t.title}\n${new Date(t.createdAt).toLocaleString()}\n\n--- Corrected ---\n${t.correctedText ?? ""}\n\n--- Raw ---\n${t.rawText}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.title.replace(/[^\w\- ]+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="History"
        subtitle={items.length ? `${items.length} transcript${items.length === 1 ? "" : "s"} saved` : "Your saved transcripts"}
      />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {!loading && items.length === 0 ? (
        <Card className="grid place-items-center px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Icon name="history" className="w-6 h-6" />
          </div>
          <h3 className="mt-4 font-semibold text-slate-800">No transcripts yet</h3>
          <p className="mt-1 text-sm text-slate-500">Record live or upload a file, and it will appear here.</p>
          <div className="mt-5 flex gap-2">
            <Link to="/live" className={btn.primary}><Icon name="mic" className="w-4 h-4" /> Start recording</Link>
            <Link to="/upload" className={btn.secondary}><Icon name="upload" className="w-4 h-4" /> Upload</Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* list */}
          <Card className="flex max-h-[calc(100vh-11rem)] flex-col overflow-hidden lg:sticky lg:top-8">
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transcripts…" className={`${inputCls} pl-9`} />
              </div>
            </div>
            <div className="scroll-thin flex-1 space-y-1 overflow-y-auto p-2">
              {filtered.map((t) => {
                const active = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${t.source === "LIVE" ? "bg-rose-50 text-rose-500" : "bg-sky-50 text-sky-600"}`}>
                        <Icon name={t.source === "LIVE" ? "mic" : "file"} className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-medium ${active ? "text-indigo-900" : "text-slate-800"}`}>{t.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {timeAgo(t.createdAt)} · {langName(t.language)} · {formatDuration(t.durationSec)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No matches.</p>}
            </div>
          </Card>

          {/* detail */}
          <section className="min-w-0">
            {selected && (
              <div key={selected.id} className="space-y-4 animate-fade-in">
                <Card className="p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-lg font-semibold text-slate-900">{selected.title}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">{new Date(selected.createdAt).toLocaleString()}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge tone={selected.source === "LIVE" ? "rose" : "indigo"} icon={selected.source === "LIVE" ? "mic" : "file"}>
                          {selected.source === "LIVE" ? "Live" : "Upload"}
                        </Badge>
                        <Badge icon="globe">{langName(selected.language)}</Badge>
                        <Badge icon="clock">{formatDuration(selected.durationSec)}</Badge>
                        <Badge tone={STATUS_TONE[selected.correctionStatus]} icon="sparkles">{STATUS_LABEL[selected.correctionStatus]}</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton text={selected.correctedText ?? selected.rawText} className={btn.secondary} />
                      <button onClick={() => download(selected)} className={btn.secondary}>
                        <Icon name="download" className="w-4 h-4" /> .txt
                      </button>
                      <button onClick={() => remove(selected)} className={btn.danger} title="Delete">
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </Card>
                <ResultPanels raw={selected.rawText} corrected={selected.correctedText} status={selected.correctionStatus} columns="2xl:grid-cols-2" />
                <ClinicalCodes
                  key={`codes-${selected.id}`}
                  text={selected.correctedText || selected.rawText}
                  raw={selected.rawText}
                  transcriptionId={selected.id}
                  saved={selected.clinicalCodes}
                  onSaved={(r) => setItems((list) => list.map((x) => (x.id === selected.id ? { ...x, clinicalCodes: r } : x)))}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
