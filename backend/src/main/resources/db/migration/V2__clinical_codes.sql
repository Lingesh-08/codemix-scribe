-- Clinical coding result (SNOMED CT / LOINC / ICD-10) produced by the ai-service, stored as JSON text.
ALTER TABLE transcriptions ADD COLUMN clinical_codes TEXT;
