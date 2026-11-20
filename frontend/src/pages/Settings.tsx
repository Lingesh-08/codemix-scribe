import { useEffect, useState, type ReactNode } from "react";
import { api, type Health } from "../api";
import Icon, { type IconName } from "../components/Icon";
import { btn, Card, ErrorNote, inputCls, PageHeader, StatusDot } from "../components/ui";

export default function Settings() {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    return api
      .health()
      .then((h) => (setHealth(h), setHealthErr("")))
      .catch((e) => setHealthErr(e.message))
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    api.getGemmaUrl().then((r) => setUrl(r.url)).catch(() => {});
    refresh();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.setGemmaUrl(url.trim());
      setMsg(
        r.reachable
          ? { ok: true, text: "Saved. Gemma is reachable." }
          : { ok: false, text: "Saved, but Gemma is not reachable. Is the Kaggle notebook still running?" },
      );
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="Connect the Gemma correction server and check the speech engine." />

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <Icon name="link" className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">Gemma correction server</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste the <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">https://….trycloudflare.com</code> URL printed by the Kaggle
              notebook. It changes every Kaggle session.
            </p>
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" className={`${inputCls} font-mono`} />
              <button disabled={saving} className={`${btn.primary} shrink-0`}>
                {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="check" className="w-4 h-4" />}
                Save &amp; test
              </button>
            </form>
            {msg && (
              <p className={`mt-3 flex items-center gap-2 text-sm ${msg.ok ? "text-emerald-700" : "text-amber-700"}`}>
                <Icon name={msg.ok ? "check" : "alert"} className="w-4 h-4" /> {msg.text}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">System status</h2>
        <button onClick={refresh} className={btn.ghost}>
          <Icon name="refresh" className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {healthErr && <div className="mb-4"><ErrorNote>ai-service: {healthErr}</ErrorNote></div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Tile icon="wave" title="Whisper model" ok={!!health?.modelLoaded} value={health ? (health.modelLoaded ? "large-v3-turbo · loaded" : "Not loaded") : "—"} />
        <Tile icon="cpu" title="GPU" ok={!!health?.gpu} value={health?.gpu ?? "—"} sub={health?.computeType ? `compute: ${health.computeType}` : undefined} />
        <Tile
          icon="globe"
          title="Default ASR language"
          ok={!!health}
          value={health ? (health.asrLanguage.startsWith("auto") ? "Auto · Tamil / Hindi" : health.asrLanguage) : "—"}
          sub="The Live page picker overrides this"
        />
        <Tile
          icon="sparkles"
          title="Gemma correction"
          ok={!!health?.gemma.reachable}
          value={health ? (health.gemma.reachable ? "Connected" : health.gemma.url ? "Unreachable" : "No URL set") : "—"}
          sub={health?.gemma.url ?? undefined}
        />
      </div>
    </div>
  );
}

function Tile({ icon, title, value, sub, ok }: { icon: IconName; title: string; value: ReactNode; sub?: string; ok: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-500">
          <Icon name={icon} className="w-4 h-4 text-slate-400" /> {title}
        </div>
        <StatusDot ok={ok} />
      </div>
      <div className="mt-3 truncate font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-1 truncate font-mono text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}
