import { useEffect, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Transcription } from "../api";
import ResultPanels from "../components/ResultPanels";
import ClinicalCodes from "../components/ClinicalCodes";
import Icon from "../components/Icon";
import { Badge, btn, Card, ErrorNote, formatDuration, langName, PageHeader } from "../components/ui";

const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Transcription | null>(null);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError("");
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.upload(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Upload audio" subtitle="Transcribe a recorded conversation. Any common audio or video format, up to 100 MB." />

      <Card className="p-6">
        <label
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            drag ? "border-indigo-400 bg-indigo-50/60" : "border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/30"
          }`}
        >
          <input
            type="file"
            accept="audio/*,video/*,.mpeg,.mp3,.wav,.m4a,.ogg,.webm"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200">
            <Icon name="upload" className="w-6 h-6" />
          </div>
          <div className="mt-4 text-sm font-semibold text-slate-800">
            <span className="text-indigo-600">Click to choose</span> or drag a file here
          </div>
          <div className="mt-1 text-xs text-slate-500">MP3, WAV, M4A, MPEG, OGG, WEBM, MP4 · max 100 MB</div>
        </label>

        {file && (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
              <Icon name="file" className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
              <div className="text-xs text-slate-500">{fmtSize(file.size)}</div>
            </div>
            <button onClick={submit} disabled={busy} className={btn.primary}>
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Processing · {elapsed}s
                </>
              ) : (
                <>
                  <Icon name="wave" className="w-4 h-4" /> Transcribe
                </>
              )}
            </button>
          </div>
        )}

        {busy && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {elapsed < 4 ? "Uploading…" : "Whisper is transcribing, then Gemma corrects the text. Long files can take a minute."}
            </p>
            <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
          </div>
        )}

        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
      </Card>

      {result && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo" icon="globe">{langName(result.language)}</Badge>
            <Badge icon="clock">{formatDuration(result.durationSec)}</Badge>
            <Badge tone="emerald" icon="check">Saved</Badge>
            <Link to="/history" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Open in History <Icon name="arrow" className="w-4 h-4" />
            </Link>
          </div>
          <ResultPanels raw={result.rawText} corrected={result.correctedText} status={result.correctionStatus} />
          <ClinicalCodes key={result.id} text={result.correctedText || result.rawText} raw={result.rawText} transcriptionId={result.id} auto />
        </div>
      )}
    </div>
  );
}
