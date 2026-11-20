package com.codemixscribe.transcription;

import java.time.Instant;

public record TranscriptionDto(Long id, String title, String rawText, String correctedText, String language,
                               Double durationSec, String source, String correctionStatus, Instant createdAt,
                               @com.fasterxml.jackson.annotation.JsonRawValue String clinicalCodes) {

    public static TranscriptionDto of(Transcription t) {
        return new TranscriptionDto(t.getId(), t.getTitle(), t.getRawText(), t.getCorrectedText(), t.getLanguage(),
                t.getDurationSec(), t.getSource().name(), t.getCorrectionStatus().name(), t.getCreatedAt(),
                t.getClinicalCodes());
    }
}
