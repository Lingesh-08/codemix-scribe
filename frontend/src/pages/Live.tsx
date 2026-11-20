import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { liveSocketUrl, type LiveLanguage } from "../api";
import { MicRecorder } from "../audio/recorder";
import ResultPanels from "../components/ResultPanels";
import ClinicalCodes from "../components/ClinicalCodes";
import Icon from "../components/Icon";
import { Card, ErrorNote, PageHeader } from "../components/ui";

const LANGS: { value: LiveLanguage; label: string; hint: string }[] = [
  { value: "ta", label: "தமிழ் + English", hint: "Tamil" },
  { value: "hi", label: "हिन्दी + English", hint: "Hindi" },
  { value: "auto", label: "Auto", hint: "Tamil / Hindi" },
];

function savedLang(): LiveLanguage {
  try {
    const v = localStorage.getItem("scribe_live_lang");
    if (v === "ta" || v === "hi" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "ta";
}

type Phase = "idle" | "connecting" | "recording" | "finishing" | "correcting" | "done";

const STEPS = [
  { t: "Record", d: "Mic → 16 kHz stream" },
  { t: "Transcribe", d: "Whisper on local GPU" },
  { t: "Gemma correction", d: "Fine-tuned Gemma on Kaggle" },
  { t: "Saved", d: "Stored in PostgreSQL" },
];
const stepIndex = (p: Phase) => ({ idle: -1, connecting: 0, recording: 0, finishing: 1, correcting: 2, done: 4 })[p];

const BARS = 72;

export default function Live({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lang, setLang] = useState<LiveLanguage>(savedLang);
  const [finalText, setFinalText] = useState("");
  const [partial, setPartial] = useState("");
  const [raw, setRaw] = useState("");
  const [corrected, setCorrected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levels = useRef<number[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // waveform: mirrored rounded bars, newest on the right
  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const { width: W, height: H } = c;
    g.clearRect(0, 0, W, H);
    const step = W / BARS;
    const bw = Math.max(2, step * 0.55);
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "rgba(99,102,241,0.25)");
    grad.addColorStop(1, "rgba(139,92,246,1)");
    g.fillStyle = grad;
    for (let i = 0; i < BARS; i++) {
      const v = levels.current[levels.current.length - BARS + i] ?? 0;
      const h = Math.max(bw, v * H * 0.9);
      const x = i * step + (step - bw) / 2;
      g.beginPath();
      g.roundRect(x, (H - h) / 2, bw, h, bw / 2);
      g.fill();
    }
  };
  const drawLevel = (rms: number) => {
    levels.current.push(Math.min(1, rms * 7));
    if (levels.current.length > BARS) levels.current.shift();
    draw();
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (c) {
      const dpr = window.devicePixelRatio || 1;
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      draw();
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finalText, partial]);

  useEffect(() => () => {
    recRef.current?.stop();
    wsRef.current?.close();
  }, []);

  const start = async () => {
    setError("");
    setFinalText("");
    setPartial("");
    setRaw("");
    setCorrected(null);
    setStatus(null);
    setSavedId(null);
    setSeconds(0);
    levels.current = [];
    draw();
    setPhase("connecting");

    const ws = new WebSocket(liveSocketUrl(token, lang));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.type) {
        case "partial":
          setPartial(m.text);
          break;
        case "final_segment":
          setFinalText((t) => (t ? t + " " : "") + m.text);
          break;
        case "raw_complete":
          setRaw(m.text);
          setPartial("");
          setPhase("correcting");
          break;
        case "corrected":
          setCorrected(m.text);
          setStatus(m.status);
          setPhase("done");
          break;
        case "saved":
          setSavedId(m.id);
          break;
        case "error":
          setError(m.message);
          break;
      }
    };
    ws.onerror = () => setError("Cannot connect to the ai-service on port 8001. Is it running?");
    ws.onclose = () => {
      recRef.current?.stop();
      setPhase((p) => (p === "done" ? p : p === "correcting" ? "done" : "idle"));
    };
    ws.onopen = async () => {
      try {
        const rec = new MicRecorder((pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm), drawLevel);
        await rec.start();
        recRef.current = rec;
        setPhase("recording");
      } catch (err) {
        setError("Microphone error: " + (err as Error).message);
        ws.close();
      }
    };
  };

  const stop = async () => {
    await recRef.current?.stop();
    recRef.current = null;
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    setPhase("finishing");
  };

  const recording = phase === "recording";
  const busy = phase === "connecting" || phase === "finishing" || phase === "correcting";
  const canPickLang = phase === "idle" || phase === "done";
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const si = stepIndex(phase);
  const showTranscript = phase !== "idle" || finalText;

  const statusLine = {
    idle: "Ready. Press the microphone to start",
    connecting: "Connecting to the speech engine…",
    recording: "Listening… speak naturally",
    finishing: "Finishing the last words…",
    correcting: "Gemma is correcting the transcript…",
    done: "Transcript ready",
  }[phase];

  return (
    <div>
      <PageHeader
        title="Live transcription"
        subtitle="Speak Tamil, Hindi and English freely. Every word stays in its own script: transcribed, never translated."
      />

      {/* Recorder */}
      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[1fr_auto]">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Spoken language</div>
                <div className="mt-2 inline-flex flex-wrap rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Spoken language">
                  {LANGS.map((l) => (
                    <button
                      key={l.value}
                      role="radio"
                      aria-checked={lang === l.value}
                      disabled={!canPickLang}
                      title={l.hint}
                      onClick={() => {
                        setLang(l.value);
                        try {
                          localStorage.setItem("scribe_live_lang", l.value);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${
                        lang === l.value ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
                      } ${!canPickLang && lang !== l.value ? "opacity-40" : ""}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Duration</div>
                <div className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${recording ? "text-slate-900" : "text-slate-300"}`}>{mmss}</div>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-6">
              <div className="relative shrink-0">
                {recording && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-rose-500/40 animate-ring" />
                    <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ring [animation-delay:0.9s]" />
                  </>
                )}
                <button
                  onClick={recording ? stop : start}
                  disabled={busy}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                  className={`relative grid h-20 w-20 place-items-center rounded-full text-white shadow-lg transition focus-visible:outline-4 focus-visible:outline-offset-4 disabled:cursor-wait ${
                    recording
                      ? "bg-rose-600 shadow-rose-600/30 hover:bg-rose-500 focus-visible:outline-rose-200"
                      : busy
                        ? "bg-slate-300 shadow-none"
                        : "bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-600/30 hover:scale-105 focus-visible:outline-indigo-200"
                  }`}
                >
                  {busy ? (
                    <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
                  ) : (
                    <Icon name={recording ? "stop" : "mic"} className="h-8 w-8" strokeWidth={recording ? 2.4 : 1.8} />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <canvas ref={canvasRef} className="h-16 w-full" />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  {recording && <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />}
                  <span className={recording ? "font-medium text-slate-800" : "text-slate-500"}>{statusLine}</span>
                  {phase === "done" && savedId && (
                    <Link to="/history" className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500">
                      · Saved to History <Icon name="arrow" className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {error && <div className="mt-5"><ErrorNote>{error}</ErrorNote></div>}
          </div>

          {/* pipeline steps */}
          <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-6 lg:w-64 lg:border-l lg:border-t-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pipeline</div>
            <ol className="mt-4 space-y-4">
              {STEPS.map((s, i) => {
                const done = si > i;
                const active = si === i;
                return (
                  <li key={s.t} className="flex items-center gap-3">
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition ${
                        done ? "bg-emerald-500 text-white" : active ? "bg-indigo-600 text-white ring-4 ring-indigo-100" : "bg-white text-slate-400 ring-1 ring-slate-200"
                      }`}
                    >
                      {done ? <Icon name="check" className="w-4 h-4" strokeWidth={2.6} /> : i + 1}
                    </span>
                    <div>
                      <div className={`text-sm font-medium ${done || active ? "text-slate-800" : "text-slate-400"}`}>{s.t}</div>
                      <div className="text-[11px] text-slate-400">{s.d}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </Card>

      {/* Live transcript */}
      {showTranscript && !raw && (
        <Card className="mt-6 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-slate-800">Live transcript</h3>
              {recording && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-800" />Confirmed</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" />Still listening</span>
            </div>
          </div>
          <div ref={transcriptRef} className="scroll-thin max-h-80 min-h-36 overflow-y-auto px-5 py-4 font-script text-[19px] leading-9">
            {finalText || partial ? (
              <>
                <span className="text-slate-900">{finalText}</span> <span className="text-slate-400">{partial}</span>
                {recording && <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-indigo-500 animate-caret" />}
              </>
            ) : (
              <span className="text-slate-300">Your words will appear here as you speak…</span>
            )}
          </div>
        </Card>
      )}

      {/* Result */}
      {(raw !== "" || phase === "correcting" || phase === "done") && (
        <div className="mt-6">
          <ResultPanels raw={raw} corrected={corrected} status={status} correcting={phase === "correcting"} />
        </div>
      )}

      {phase === "done" && (corrected || raw) && (
        <div className="mt-6">
          <ClinicalCodes key={raw} text={corrected || raw} raw={raw} transcriptionId={savedId} auto />
        </div>
      )}

      {phase === "idle" && !finalText && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: "globe" as const, t: "Code-mixed by design", d: "Tamil, Hindi and English in one sentence, each kept in its own script." },
            { icon: "wave" as const, t: "Real-time", d: "Words appear within about a second, confirmed as you keep talking." },
            { icon: "sparkles" as const, t: "AI correction", d: "A fine-tuned Gemma model fixes recognition errors after you stop." },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-dashed border-slate-200 p-5">
              <Icon name={f.icon} className="w-5 h-5 text-indigo-500" />
              <div className="mt-3 text-sm font-semibold text-slate-800">{f.t}</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{f.d}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
