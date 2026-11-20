package com.codemixscribe.transcription;

import com.codemixscribe.transcription.Transcription.CorrectionStatus;
import com.codemixscribe.transcription.Transcription.Source;
import com.codemixscribe.user.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/transcriptions")
public class TranscriptionController {

    private final TranscriptionRepository repo;
    private final UserRepository users;
    private final AiServiceClient ai;

    public TranscriptionController(TranscriptionRepository repo, UserRepository users, AiServiceClient ai) {
        this.repo = repo;
        this.users = users;
        this.ai = ai;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<TranscriptionDto> list(@AuthenticationPrincipal Long userId) {
        return repo.findByUserIdOrderByCreatedAtDesc(userId).stream().map(TranscriptionDto::of).toList();
    }

    @GetMapping("/{id}")
    @Transactional(readOnly = true)
    public TranscriptionDto get(@AuthenticationPrincipal Long userId, @PathVariable Long id) {
        return TranscriptionDto.of(find(userId, id));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@AuthenticationPrincipal Long userId, @PathVariable Long id) {
        repo.delete(find(userId, id));
    }

    /** Stores the clinical coding JSON (from the ai-service /clinical/codes) for one transcript. */
    @PutMapping(value = "/{id}/clinical-codes", consumes = "application/json")
    @Transactional
    public TranscriptionDto saveClinicalCodes(@AuthenticationPrincipal Long userId, @PathVariable Long id,
                                              @RequestBody com.fasterxml.jackson.databind.JsonNode body) {
        if (!body.isObject()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a JSON object");
        }
        var t = find(userId, id);
        t.setClinicalCodes(body.toString());
        return TranscriptionDto.of(t);
    }

    @PostMapping("/upload")
    @ResponseStatus(HttpStatus.CREATED)
    public TranscriptionDto upload(@AuthenticationPrincipal Long userId,
                                   @RequestParam("file") MultipartFile file,
                                   @RequestParam(value = "title", required = false) String title) throws IOException {
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Empty file");
        }
        AiServiceClient.AiResult r;
        try {
            r = ai.transcribe(file);
        } catch (RestClientException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "ai-service error: " + e.getMessage());
        }
        String t = (title != null && !title.isBlank()) ? title : file.getOriginalFilename();
        var saved = repo.save(new Transcription(users.getReferenceById(userId), t == null ? "Upload" : t,
                r.raw(), r.corrected(), r.language(), r.duration(), Source.UPLOAD,
                parseStatus(r.correctionStatus())));
        return TranscriptionDto.of(saved);
    }

    static CorrectionStatus parseStatus(String s) {
        try {
            return CorrectionStatus.valueOf(s);
        } catch (Exception e) {
            return CorrectionStatus.UNAVAILABLE;
        }
    }

    private Transcription find(Long userId, Long id) {
        return repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Not found"));
    }
}
