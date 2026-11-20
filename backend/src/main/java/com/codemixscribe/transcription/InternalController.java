package com.codemixscribe.transcription;

import com.codemixscribe.config.AppProperties;
import com.codemixscribe.transcription.Transcription.Source;
import com.codemixscribe.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Called by the ai-service when a live session finishes. Guarded by X-Service-Secret. */
@RestController
@RequestMapping("/api/internal")
public class InternalController {

    public record LiveTranscriptionRequest(@NotNull Long userId, String title, @NotNull String rawText,
                                           String correctedText, String language, Double durationSec,
                                           String correctionStatus) {}

    private final TranscriptionRepository repo;
    private final UserRepository users;
    private final byte[] secret;

    public InternalController(TranscriptionRepository repo, UserRepository users, AppProperties props) {
        this.repo = repo;
        this.users = users;
        this.secret = props.serviceSecret().getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/transcriptions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Long> save(@RequestHeader(value = "X-Service-Secret", required = false) String header,
                                  @Valid @RequestBody LiveTranscriptionRequest req) {
        if (header == null || !MessageDigest.isEqual(secret, header.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Bad service secret");
        }
        var user = users.findById(req.userId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        var t = repo.save(new Transcription(user,
                req.title() == null || req.title().isBlank() ? "Live recording" : req.title(),
                req.rawText(), req.correctedText(), req.language(), req.durationSec(), Source.LIVE,
                TranscriptionController.parseStatus(req.correctionStatus())));
        return Map.of("id", t.getId());
    }
}
