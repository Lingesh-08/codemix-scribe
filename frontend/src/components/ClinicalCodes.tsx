import { useEffect, useRef, useState } from "react";
import { api, type ClinicalItem, type ClinicalResult } from "../api";
import Icon from "./Icon";
import { Badge, btn, Card, CopyButton } from "./ui";

interface Props {
  text: string;
  /** Raw Whisper text, sent along so a wrong correction can't hide a symptom. */
  raw?: string;
  /** Saved transcript id: the result is stored with it (and shown again in History). */
  transcriptionId?: number | null;
  /** Result already stored for this transcript. */
  saved?: ClinicalResult | null;
  /** Run automatically when there is no saved result. */
  auto?: boolean;
  onSaved?: (r: ClinicalResult) => void;
}

const ORDER: ClinicalItem["category"][] = ["Diagnosis", "Symptom", "Vital sign", "Lab test", "Procedure"];
const CAT_STYLE: Record<ClinicalItem["category"], string> = {
  Diagnosis: "bg-violet-50 text-violet-700",
  Symptom: "bg-rose-50 text-rose-700",
  "Vital sign": "bg-sky-50 text-sky-700",
  "Lab test": "bg-amber-50 text-amber-800",
  Procedure: "bg-teal-50 text-teal-700",
};

/** Clinical terms from the transcript, coded to SNOMED CT / LOINC, and SNOMED CT -> ICD-10. */
export default function ClinicalCodes({ text, raw, transcriptionId, saved, auto, onSaved }: Props) {
  const [result, setResult] = useState<ClinicalResult | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const storedFor = useRef<number | null>(saved ? transcriptionId ?? null : null);
  const started = useRef(false);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await api.clinicalCodes(text, raw));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (auto && !saved && text.trim() && !started.current) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, saved, text]);

  // store a successful result once the transcript id is known (live: the id can arrive a moment later)
  useEffect(() => {
    if (result?.status === "OK" && transcriptionId && storedFor.current !== transcriptionId) {
      storedFor.current = transcriptionId;
      api.saveClinicalCodes(transcriptionId, result).then(() => onSaved?.(result)).catch(() => (storedFor.current = null));
    }
  }, [result, transcriptionId, onSaved]);

  const items = result?.items ?? [];
  const grouped = ORDER.map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length);
  const coded = items.filter((i) => i.code).length;
  const icd = items.filter((i) => i.icd10).length;

  return (
    <Card className="overflow-hidden animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <Icon name="file" className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Clinical coding</h3>
            <p className="text-xs text-slate-500">SNOMED CT · LOINC · ICD-10, from the corrected transcript</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result?.status === "OK" && (
            <>
              <Badge tone="indigo">{coded} coded</Badge>
              <Badge tone="violet">{icd} ICD-10</Badge>
              <CopyButton text={JSON.stringify(result, null, 2)} label="JSON" />
            </>
          )}
          {!busy && (
            <button onClick={run} disabled={!text.trim()} className={result ? btn.ghost : btn.primary}>
              <Icon name={result ? "refresh" : "sparkles"} className="w-4 h-4" />
              {result ? "Re-run" : "Extract clinical codes"}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        {busy && (
          <div className="flex items-center gap-3 py-2 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
            Finding clinical terms with Gemini and looking up codes…
          </div>
        )}

        {!busy && error && <p className="text-sm text-rose-600">{error}</p>}

        {!busy && !result && !error && (
          <p className="text-sm text-slate-500">Pick out symptoms, vitals, tests, procedures and diagnoses, and code them.</p>
        )}

        {!busy && result?.status === "NO_KEY" && (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <div className="font-semibold">Gemini API key needed</div>
            <p className="mt-1">
              Get a free key at <span className="font-mono">aistudio.google.com/apikey</span>, put it in{" "}
              <span className="font-mono">ai-service\.env</span> as <span className="font-mono">GEMINI_API_KEY=…</span> and restart the ai-service.
            </p>
          </div>
        )}

        {!busy && result?.status === "LLM_ERROR" && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{result.warnings.join(" ")}</p>
        )}

        {!busy && result?.status === "OK" && items.length === 0 && <p className="text-sm text-slate-500">No clinical terms found in this transcript.</p>}

        {!busy && result?.status === "OK" && items.length > 0 && (
          <div className="scroll-thin -mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-5 pb-2">Term</th>
                  <th className="px-3 pb-2">Code</th>
                  <th className="px-3 pb-2">ICD-10</th>
                  <th className="px-5 pb-2">Heard as</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([cat, list]) => (
                  <Group key={cat} cat={cat} list={list} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!busy && result?.status === "OK" && result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {result.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-xs text-amber-700">
                <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      {result?.status === "OK" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[11px] text-slate-500">
          <span>Terms: Gemini ({result.model})</span>
          <span>Codes: FHIR terminology server</span>
          <span>ICD-10: {result.icd10Source ? `local map (${result.icd10Source})` : "no local map configured"}</span>
          <span className="ml-auto font-medium text-slate-600">Suggestions only. A clinician must verify.</span>
        </div>
      )}
    </Card>
  );
}

function Group({ cat, list }: { cat: ClinicalItem["category"]; list: ClinicalItem[] }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="px-5 pt-3 pb-1">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${CAT_STYLE[cat]}`}>
            {cat === "Diagnosis" ? "Diagnoses" : `${cat}s`}
          </span>
        </td>
      </tr>
      {list.map((i, k) => (
        <tr key={k} className="border-t border-slate-100 align-top">
          <td className="px-5 py-2.5">
            <div className="font-medium text-slate-800">{i.term}</div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {i.value && <span className="text-xs text-slate-500">{i.value}</span>}
              {i.certainty === "suspected" && <Badge tone="amber">suspected</Badge>}
            </div>
          </td>
          <td className="px-3 py-2.5">
            {i.code ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${i.system === "LOINC" ? "bg-sky-100 text-sky-800" : "bg-indigo-100 text-indigo-800"}`}>
                    {i.system === "SNOMED CT" ? "SNOMED" : i.system}
                  </span>
                  <span className="font-mono text-[13px] text-slate-800">{i.code}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{i.display}</div>
              </div>
            ) : (
              <span className="text-xs text-slate-400">No matching concept</span>
            )}
          </td>
          <td className="px-3 py-2.5">
            {i.icd10 ? (
              <div>
                <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-violet-800">{i.icd10.code}</span>
                {i.icd10.display && <div className="mt-0.5 text-xs text-slate-500">{i.icd10.display}</div>}
                {i.icd10.conditional && <div className="mt-0.5 text-[11px] text-amber-700" title={i.icd10.rule ?? ""}>depends on patient context</div>}
              </div>
            ) : (
              <span className="text-xs text-slate-300">{i.category === "Symptom" || i.category === "Diagnosis" ? "—" : "n/a"}</span>
            )}
          </td>
          <td className="px-5 py-2.5 font-script text-[13px] text-slate-600">{i.evidence ? `“${i.evidence}”` : ""}</td>
        </tr>
      ))}
    </>
  );
}
