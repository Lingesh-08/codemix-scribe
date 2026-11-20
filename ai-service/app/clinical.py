"""Clinical coding: transcript -> clinical terms -> SNOMED CT / LOINC -> ICD-10.

1. Gemini (free API key) reads the corrected transcript and lists the clinical terms that
   are explicitly mentioned, in standard English, each with a short quote as evidence.
2. A FHIR terminology server (Ontoserver, ValueSet/$expand) returns up to 8 real candidate
   concepts per term. Gemini then picks the best candidate. It can only choose codes the
   server returned, never invent one. Without a key, a simple word-overlap ranker picks.
3. SNOMED CT findings (symptoms, diagnoses) are mapped to ICD-10 with the user's LOCAL map
   file (ICD10_MAP_PATH). That file never leaves the laptop.

Nothing here raises: every failure becomes a status/warning in the result.
"""
import asyncio
import csv
import json
import logging
import re
import time
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("scribe.clinical")

SNOMED = "http://snomed.info/sct"
LOINC = "http://loinc.org"
CLINICAL_FINDING_VS = "http://snomed.info/sct?fhir_vs=isa/404684003"
PROCEDURE_VS = "http://snomed.info/sct?fhir_vs=isa/71388002"
LOINC_VS = "http://loinc.org/vs"

# bucket -> (label, value set url, map to ICD-10?)
BUCKETS = {
    "symptoms": ("Symptom", CLINICAL_FINDING_VS, True),
    "diagnoses": ("Diagnosis", CLINICAL_FINDING_VS, True),
    "vital_signs": ("Vital sign", LOINC_VS, False),
    "lab_tests": ("Lab test", LOINC_VS, False),
    "procedures": ("Procedure", PROCEDURE_VS, False),
}

EXTRACT_PROMPT = """You are a clinical documentation assistant.
The text below is an automatic transcript of a doctor-patient conversation. It mixes English with
Tamil and/or Hindi (in their own scripts) and may contain speech-recognition errors.

List the clinical concepts that are EXPLICITLY mentioned. Rules:
- Write every "term" as the plain, commonly used English clinical term, the way SNOMED CT or LOINC names it
  (e.g. "Fever", "Excessive thirst", "Body temperature", "Hemoglobin A1c", "Electrocardiogram").
- "alt" = up to 2 other standard names for the SAME concept, used as extra search terms: synonyms
  ("Dyspnea" for "Shortness of breath"), full forms of abbreviations ("Complete blood count" for "CBC"),
  and LOINC-style names for tests ("Hemoglobin A1c/Hemoglobin.total in Blood", "Troponin I.cardiac").
- "evidence" = the exact words from the transcript (original script, max 12 words) that mention it.
- symptoms: complaints the patient reports or the doctor asks about AND the patient confirms.
  Do not list symptoms the patient denies.
- vital_signs: measured vitals, with the spoken value in "value" (e.g. "101.8 °F", "98%").
- lab_tests: tests ordered or reported.  procedures: procedures/imaging ordered or done.
- diagnoses: only conditions the doctor states or clearly suspects; "certainty" = "confirmed" or "suspected".
- Never invent anything that is not in the transcript. Empty lists are fine.

Return JSON only, exactly this shape:
{"symptoms":[{"term":"","alt":[],"evidence":""}],
 "vital_signs":[{"term":"","alt":[],"value":"","evidence":""}],
 "lab_tests":[{"term":"","alt":[],"evidence":""}],
 "procedures":[{"term":"","alt":[],"evidence":""}],
 "diagnoses":[{"term":"","alt":[],"certainty":"confirmed","evidence":""}]}

TRANSCRIPT:
"""

CHOOSE_PROMPT = """For each clinical term below, choose the candidate concept from the terminology
server that means the same thing. Prefer the candidate that matches the term exactly; do not pick a
more specific concept than the term says (e.g. "Type 2 diabetes mellitus" -> "Type 2 diabetes", not
"Uncontrolled type 2 diabetes"). For lab tests and vitals choose an observation code (a measurement in
blood/serum or of the body), not a device, panel part or document. A panel code IS correct for tests
that are panels: "CBC"/"Complete blood count" -> a "CBC panel - Blood" code, "Blood pressure" -> "Blood
pressure panel". A plain-language candidate is fine for a formal term and vice versa ("Throat irritation"
for "Pharyngeal irritation", "Myalgia" for "Body ache"). Use null only if no candidate has the same meaning.

Return JSON only: {"choices":[{"id":0,"index":2}, ...]}  (index = position in that term's candidate list, or null)

TERMS:
"""


# ---------------------------------------------------------------- ICD-10 local map
class Icd10Map:
    """SNOMED CT concept id -> ICD-10 code, loaded from a local file.

    Supported formats:
    - SNOMED CT RF2 extended map, e.g. der2_iisssccRefset_ExtendedMapSnapshot_*.txt
      (tab-separated, columns referencedComponentId, mapGroup, mapPriority, mapRule, mapTarget ...)
    - CSV with a header; first column SNOMED code, second ICD-10 code, optional third ICD-10 name.
    """

    ICD10_REFSET = "447562003"

    def __init__(self):
        self.map: dict[str, dict] = {}
        self.source = None

    def load(self, path: str):
        p = Path(path)
        if not p.exists():
            log.warning("ICD10_MAP_PATH %s does not exist; ICD-10 mapping disabled", p)
            return
        with p.open(encoding="utf-8-sig", newline="") as f:
            head = f.readline()
            f.seek(0)
            if "referencedComponentId" in head and "mapTarget" in head:
                self._load_rf2(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
                kind = "RF2 extended map"
            else:
                self._load_csv(csv.reader(f, delimiter="\t" if "\t" in head else ","))
                kind = "CSV"
        self.source = f"{kind} · {len(self.map):,} concepts"
        log.info("ICD-10 map loaded from %s (%s)", p.name, self.source)

    def _load_rf2(self, rows):
        best: dict[str, tuple] = {}
        for r in rows:
            if r.get("active") != "1" or not r.get("mapTarget"):
                continue
            if r.get("refsetId") and r["refsetId"] != self.ICD10_REFSET:
                continue
            if r.get("mapGroup", "1") != "1":
                continue
            rule = (r.get("mapRule") or "TRUE").strip()
            unconditional = rule in ("TRUE", "OTHERWISE TRUE")
            # rank: unconditional rules first, then by priority
            key = (0 if unconditional else 1, int(r.get("mapPriority") or 1))
            cid = r["referencedComponentId"]
            if cid not in best or key < best[cid][0]:
                best[cid] = (key, {"code": r["mapTarget"].strip(), "conditional": not unconditional,
                                   "rule": None if unconditional else rule})
        self.map = {cid: v for cid, (_, v) in best.items()}

    def _load_csv(self, rows):
        next(rows, None)  # header
        for r in rows:
            if len(r) >= 2 and r[0].strip() and r[1].strip():
                self.map.setdefault(r[0].strip(), {"code": r[1].strip(), "conditional": False, "rule": None,
                                                   **({"display": r[2].strip()} if len(r) > 2 and r[2].strip() else {})})

    def get(self, snomed_code: str) -> dict | None:
        return self.map.get(snomed_code)


icd10_map = Icd10Map()


# ---------------------------------------------------------------- Gemini
class GeminiError(Exception):
    pass


_skip_until: dict[str, float] = {}  # model -> time until which it is skipped (overloaded/slow)
SKIP_FAILED_MODEL_S = 60           # free-tier limits are per minute, so don't bench a model for longer
last_model_used: str | None = None


def _models() -> list[str]:
    seen, out = set(), []
    for m in [config.GEMINI_MODEL, *config.GEMINI_FALLBACK_MODELS]:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


async def _gemini_json(client: httpx.AsyncClient, prompt: str) -> dict:
    """Call Gemini and parse its JSON answer. If a model is overloaded (429/503), retired (404) or
    too slow, try the next model in GEMINI_FALLBACK_MODELS and skip the failed one for a minute."""
    global last_model_used
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    models = _models()
    errors = []
    for round_no in range(2):  # if every model fails, wait a moment and try them all once more
        if round_no:
            log.warning("All Gemini models failed, retrying in 5 s: %s", "; ".join(errors))
            await asyncio.sleep(5)
            ordered = models
        else:
            now = time.time()
            ordered = [m for m in models if _skip_until.get(m, 0) <= now] or models
        for model in ordered:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            try:
                r = await client.post(url, json=body, headers={"x-goog-api-key": config.GEMINI_API_KEY},
                                      timeout=httpx.Timeout(config.GEMINI_TIMEOUT_S, connect=15))
            except httpx.HTTPError as e:
                errors.append(f"{model}: {type(e).__name__}")
                _skip_until[model] = time.time() + SKIP_FAILED_MODEL_S
                continue
            if r.status_code != 200:
                try:
                    msg = r.json()["error"]["message"]
                except Exception:
                    msg = r.text[:200]
                if r.status_code in (400, 401, 403):  # bad key / request: other models won't help
                    raise GeminiError(f"Gemini HTTP {r.status_code}: {msg}")
                errors.append(f"{model}: HTTP {r.status_code} {msg[:80]}")
                _skip_until[model] = time.time() + SKIP_FAILED_MODEL_S
                continue
            parts = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            try:
                data = json.loads(text)
            except ValueError:
                m = re.search(r"\{.*\}", text, re.S)
                if not m:
                    errors.append(f"{model}: no JSON in answer")
                    continue
                data = json.loads(m.group(0))
            if model != config.GEMINI_MODEL:
                log.info("Gemini fallback model used: %s", model)
            last_model_used = model
            return data
    raise GeminiError("All Gemini models failed: " + "; ".join(errors))


# ---------------------------------------------------------------- terminology server
_cache: dict[tuple[str, str], list[dict]] = {}
_LOINC_CODE = re.compile(r"^\d{1,7}-\d$")  # observation codes only (no LP parts / LA answers)


async def _candidates(client: httpx.AsyncClient, sem: asyncio.Semaphore, vs_url: str, term: str) -> list[dict]:
    key = (vs_url, term.lower())
    if key in _cache:
        return _cache[key]
    params = {"url": vs_url, "filter": term, "count": 25 if vs_url == LOINC_VS else 8}
    async with sem:
        r = await client.get(f"{config.FHIR_TERMINOLOGY_URL}/ValueSet/$expand", params=params, timeout=20)
    r.raise_for_status()
    found = [{"code": c["code"], "display": c.get("display", ""), "system": c.get("system")}
             for c in r.json().get("expansion", {}).get("contains", [])]
    if vs_url == LOINC_VS:
        found = [c for c in found if _LOINC_CODE.match(c["code"])][:8]
    _cache[key] = found
    return found


_STOP = {"of", "the", "in", "by", "a", "an", "and", "or", "to", "with", "level", "test", "measurement"}


def _us(s: str) -> str:
    """British -> American spelling for matching (SNOMED uses "dyspnoea", "haemoglobin")."""
    return s.lower().replace("oe", "e").replace("ae", "e").strip()


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", _us(s)) if w not in _STOP}


def _rank(queries: list[str], cands: list[dict]) -> int | None:
    """Fallback without Gemini. Deliberately strict: a wrong code is worse than no code.
    1) exact match with the term or one of its alternative names;
    2) else a candidate whose words ALL appear in one of the names (no extra concepts such as
       "Pressure *injury* of head" for "Head pressure"), covering at least 60% of that name."""
    names = [_us(q) for q in queries]
    for q in names:  # term first, then alternatives
        for i, c in enumerate(cands):
            if _us(c["display"]) == q:
                return i
    best, best_cov = None, 0.6
    for q in queries:
        qw = _words(q)
        for i, c in enumerate(cands):
            d = _words(c["display"])
            if qw and d and d <= qw:
                cov = len(d) / len(qw)
                if cov > best_cov or (cov == best_cov and best is None):
                    best, best_cov = i, cov
    return best


# ---------------------------------------------------------------- main entry
def _transcript_block(text: str, raw: str | None) -> str:
    """Corrected text plus, when it differs, the raw ASR text. The correction model can
    occasionally rewrite a word into something wrong, so Gemini gets to see both."""
    if not raw or raw.strip() == text.strip():
        return text
    return (text + "\n\nORIGINAL SPEECH-RECOGNITION OUTPUT (before automatic correction; use it too. "
            "If the two versions disagree, trust the reading that makes clinical sense in the "
            "conversation; quote evidence from either version):\n" + raw)


async def code_transcript(text: str, raw: str | None = None) -> dict:
    result = {
        "status": "OK",
        "model": None,
        "terminologyServer": config.FHIR_TERMINOLOGY_URL,
        "icd10Source": icd10_map.source,
        "items": [],
        "warnings": [],
    }
    if not text.strip():
        result["status"] = "EMPTY"
        return result
    if not config.GEMINI_API_KEY:
        result["status"] = "NO_KEY"
        result["warnings"].append("Set GEMINI_API_KEY in ai-service/.env (free key from aistudio.google.com).")
        return result

    async with httpx.AsyncClient(headers={"Accept": "application/fhir+json", "User-Agent": "codemix-scribe/1.0"}) as client:
        # 1) extract terms
        try:
            extracted = await _gemini_json(client, EXTRACT_PROMPT + _transcript_block(text, raw))
        except GeminiError as e:
            result["status"] = "LLM_ERROR"
            result["warnings"].append(str(e))
            return result

        terms = []
        for bucket, (label, vs_url, to_icd) in BUCKETS.items():
            seen = set()
            for e in extracted.get(bucket) or []:
                term = (e.get("term") or "").strip() if isinstance(e, dict) else str(e).strip()
                if not term or term.lower() in seen:
                    continue
                seen.add(term.lower())
                alts = e.get("alt") if isinstance(e, dict) and isinstance(e.get("alt"), list) else []
                searches = [term] + [a.strip() for a in alts if isinstance(a, str) and a.strip()][:2]
                terms.append({"bucket": bucket, "label": label, "vs": vs_url, "toIcd": to_icd, "term": term,
                              "searches": searches,
                              "value": e.get("value") if isinstance(e, dict) else None,
                              "evidence": e.get("evidence") if isinstance(e, dict) else None,
                              "certainty": e.get("certainty") if isinstance(e, dict) else None})

        # 2) candidates from the terminology server
        sem = asyncio.Semaphore(4)
        jobs = [(ti, q) for ti, t in enumerate(terms) for q in t["searches"]]
        got = await asyncio.gather(*(_candidates(client, sem, terms[ti]["vs"], q) for ti, q in jobs), return_exceptions=True)
        server_errors = 0
        for t in terms:
            t["cands"] = []
        for (ti, _q), g in zip(jobs, got):
            if isinstance(g, Exception):
                server_errors += 1
                continue
            have = {c["code"] for c in terms[ti]["cands"]}
            terms[ti]["cands"] += [c for c in g if c["code"] not in have]
        for t in terms:
            t["cands"] = t["cands"][:12]
        if server_errors:
            result["warnings"].append(f"Terminology server failed for {server_errors} term(s).")

        # 3) choose the best candidate (Gemini, fallback: word overlap)
        choices: dict[int, int | None] = {}
        listing = [{"id": i, "category": t["label"], "term": t["term"],
                    "candidates": [f"{j}: {c['display']}" for j, c in enumerate(t["cands"])]}
                   for i, t in enumerate(terms) if t["cands"]]
        matched_by = "gemini"
        if listing:
            try:
                picked = await _gemini_json(client, CHOOSE_PROMPT + json.dumps(listing, ensure_ascii=False))
                for c in picked.get("choices", []):
                    if isinstance(c, dict) and isinstance(c.get("id"), int):
                        choices[c["id"]] = c.get("index") if isinstance(c.get("index"), int) else None
            except GeminiError as e:
                matched_by = "text-match"
                result["warnings"].append(f"Candidate choice fell back to text matching ({e}).")

    for i, t in enumerate(terms):
        idx = choices.get(i) if matched_by == "gemini" and i in choices else _rank(t["searches"], t["cands"])
        concept = t["cands"][idx] if idx is not None and 0 <= idx < len(t["cands"]) else None
        item = {
            "category": t["label"],
            "term": t["term"],
            "value": t["value"] or None,
            "evidence": t["evidence"] or None,
            "certainty": t["certainty"] or None,
            "system": None,
            "code": None,
            "display": None,
            "icd10": None,
            "matchedBy": matched_by if i in choices else "text-match",
        }
        if concept:
            item.update(system="SNOMED CT" if concept["system"] == SNOMED else "LOINC" if concept["system"] == LOINC else concept["system"],
                        code=concept["code"], display=concept["display"])
            if t["toIcd"] and concept["system"] == SNOMED:
                item["icd10"] = icd10_map.get(concept["code"])
        result["items"].append(item)

    result["model"] = last_model_used
    if icd10_map.source is None and any(t["toIcd"] for t in terms):
        result["warnings"].append("ICD-10 codes need your local SNOMED→ICD-10 map file (ICD10_MAP_PATH in .env).")
    return result
