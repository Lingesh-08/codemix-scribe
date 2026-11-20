package com.codemixscribe.transcription;

import com.codemixscribe.config.AppProperties;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;

/** Forwards uploaded audio to the Python ai-service POST /transcribe. */
@Component
public class AiServiceClient {

    public record AiResult(String raw, String corrected, String language, Double duration, String correctionStatus) {}

    private final RestClient client;
    private final String serviceSecret;

    public AiServiceClient(AppProperties props) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(10));
        factory.setReadTimeout(Duration.ofMinutes(15)); // long audio + Gemma correction
        this.client = RestClient.builder().baseUrl(props.aiServiceUrl()).requestFactory(factory).build();
        this.serviceSecret = props.serviceSecret();
    }

    public AiResult transcribe(MultipartFile file) throws IOException {
        String filename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "audio.bin";
        var resource = new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() { return filename; }
        };
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", resource);
        return client.post()
                .uri("/transcribe")
                .header("X-Service-Secret", serviceSecret)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body)
                .retrieve()
                .body(AiResult.class);
    }
}
