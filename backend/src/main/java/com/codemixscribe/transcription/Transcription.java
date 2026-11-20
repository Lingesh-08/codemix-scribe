package com.codemixscribe.transcription;

import com.codemixscribe.user.User;
import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "transcriptions")
public class Transcription {

    public enum Source { LIVE, UPLOAD }

    public enum CorrectionStatus { CORRECTED, UNAVAILABLE, SKIPPED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false)
    private String title;

    @Column(name = "raw_text", nullable = false, columnDefinition = "text")
    private String rawText;

    @Column(name = "corrected_text", columnDefinition = "text")
    private String correctedText;

    private String language;

    @Column(name = "duration_sec")
    private Double durationSec;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Source source;

    @Enumerated(EnumType.STRING)
    @Column(name = "correction_status", nullable = false)
    private CorrectionStatus correctionStatus;

    @Column(name = "clinical_codes", columnDefinition = "text")
    private String clinicalCodes;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Transcription() {
    }

    public Transcription(User user, String title, String rawText, String correctedText, String language,
                         Double durationSec, Source source, CorrectionStatus correctionStatus) {
        this.user = user;
        this.title = title;
        this.rawText = rawText;
        this.correctedText = correctedText;
        this.language = language;
        this.durationSec = durationSec;
        this.source = source;
        this.correctionStatus = correctionStatus;
    }

    public Long getId() { return id; }
    public User getUser() { return user; }
    public String getTitle() { return title; }
    public String getRawText() { return rawText; }
    public String getCorrectedText() { return correctedText; }
    public String getLanguage() { return language; }
    public Double getDurationSec() { return durationSec; }
    public Source getSource() { return source; }
    public CorrectionStatus getCorrectionStatus() { return correctionStatus; }
    public Instant getCreatedAt() { return createdAt; }
    public String getClinicalCodes() { return clinicalCodes; }
    public void setClinicalCodes(String clinicalCodes) { this.clinicalCodes = clinicalCodes; }
}
