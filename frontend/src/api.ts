export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
export const AI_URL = import.meta.env.VITE_AI_URL ?? "http://localhost:8001";

export interface User {
  token: string;
  userId: number;
  email: string;
  name: string;
}

export interface Transcription {
  id: number;
  title: string;
  rawText: string;
  correctedText: string | null;
  language: string | null;
  durationSec: number | null;
  source: "LIVE" | "UPLOAD";
  correctionStatus: "CORRECTED" | "UNAVAILABLE" | "SKIPPED";
  createdAt: string;
  clinicalCodes?: ClinicalResult | null;
}

export interface ClinicalItem {
  category: "Symptom" | "Diagnosis" | "Vital sign" | "Lab test" | "Procedure";
  term: string;
  value: string | null;
  evidence: string | null;
  certainty: string | null;
  system: string | null;
  code: string | null;
  display: string | null;
  icd10: { code: string; conditional: boolean; rule: string | null; display?: string } | null;
  matchedBy: string;
}

export interface ClinicalResult {
  status: "OK" | "NO_KEY" | "LLM_ERROR" | "EMPTY";
  model: string;
  terminologyServer: string;
  icd10Source: string | null;
  items: ClinicalItem[];
  warnings: string[];
}

export interface Health {
  modelLoaded: boolean;
  gpu: string | null;
  computeType: string | null;
  asrLanguage: string;
  gemma: { url: string | null; reachable: boolean };
  clinical?: { geminiKey: boolean; geminiModel: string; icd10Map: string | null };
}

const KEY = "scribe_user";

export function getUser(): User | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as User) : null;
  } catch {
    return null;
  }
}

export function setUser(u: User | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const user = getUser();
  if (user && base === API_URL) headers.set("Authorization", `Bearer ${user.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers });
  } catch {
    throw new Error(`Cannot reach ${base}. Is it running?`);
  }
  if (res.status === 401 && base === API_URL && user) {
    setUser(null);
    window.location.href = "/login";
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j.message ?? j.detail ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  register: (email: string, password: string, name: string) =>
    request<User>(API_URL, "/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request<User>(API_URL, "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  list: () => request<Transcription[]>(API_URL, "/api/transcriptions"),
  get: (id: number) => request<Transcription>(API_URL, `/api/transcriptions/${id}`),
  remove: (id: number) => request<void>(API_URL, `/api/transcriptions/${id}`, { method: "DELETE" }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Transcription>(API_URL, "/api/transcriptions/upload", { method: "POST", body: fd });
  },
  health: () => request<Health>(AI_URL, "/health"),
  clinicalCodes: (text: string, raw?: string) =>
    request<ClinicalResult>(AI_URL, "/clinical/codes", { method: "POST", body: JSON.stringify({ text, raw }) }),
  saveClinicalCodes: (id: number, result: ClinicalResult) =>
    request<Transcription>(API_URL, `/api/transcriptions/${id}/clinical-codes`, { method: "PUT", body: JSON.stringify(result) }),
  getGemmaUrl: () => request<{ url: string }>(AI_URL, "/config/gemma-url"),
  setGemmaUrl: (url: string) =>
    request<{ url: string; reachable: boolean }>(AI_URL, "/config/gemma-url", {
      method: "PUT",
      body: JSON.stringify({ url }),
    }),
};

export type LiveLanguage = "ta" | "hi" | "auto";

export function liveSocketUrl(token: string, lang: LiveLanguage) {
  return AI_URL.replace(/^http/, "ws") + `/ws/live?token=${encodeURIComponent(token)}&lang=${lang}`;
}
