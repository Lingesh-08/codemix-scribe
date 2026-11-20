import { useState, type FormEvent, type ReactNode } from "react";
import { api, type User } from "../api";
import Icon, { Logo } from "../components/Icon";
import { btn, ErrorNote, inputCls } from "../components/ui";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const u = mode === "login" ? await api.login(email, password) : await api.register(email, password, name);
      onLogin(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-violet-600/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <Logo className="w-9 h-9" />
          <span className="text-lg font-bold tracking-tight">CodeMix Scribe</span>
        </div>

        <div className="relative my-auto max-w-lg">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Speech to text for the way India <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">actually talks.</span>
          </h1>
          <p className="mt-4 text-slate-400">
            Live transcription of Tamil, Hindi and English, even mixed in one sentence. Every word stays in its own script, then a fine-tuned Gemma
            model cleans up the result.
          </p>

          <div className="mt-10 rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" /> Live transcript
            </div>
            <p className="mt-3 font-script text-lg leading-relaxed text-slate-100">
              Doctor, எனக்கு <span className="text-indigo-300">two weeks</span>-ஆ <span className="text-indigo-300">cough</span> இருக்கு.
            </p>
            <p className="mt-1 font-script text-lg leading-relaxed text-slate-100">
              मुझे कल रात से <span className="text-indigo-300">fever</span> है और <span className="text-indigo-300">body ache</span> भी।
            </p>
          </div>
        </div>

        <div className="relative flex gap-6 text-xs text-slate-500">
          <span>Whisper large-v3-turbo</span>
          <span>Gemma 4 · LoRA</span>
          <span>Transcribe, never translate</span>
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="w-9 h-9" />
            <span className="text-lg font-bold">CodeMix Scribe</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === "login" ? "Sign in to start transcribing." : "It takes ten seconds. No credit card, no email check."}
          </p>

          <div className="mt-8 space-y-4">
            {mode === "register" && (
              <Field label="Full name">
                <input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <input className={inputCls} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password">
              <input
                className={inputCls}
                type="password"
                placeholder={mode === "register" ? "At least 6 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "register" ? 6 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button disabled={busy} className={`${btn.primary} w-full py-3`}>
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
              {mode === "login" ? "Sign in" : "Create account"}
              {!busy && <Icon name="arrow" className="w-4 h-4" />}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            {mode === "login" ? "New to CodeMix Scribe? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
