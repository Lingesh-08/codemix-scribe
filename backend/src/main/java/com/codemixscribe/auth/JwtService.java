package com.codemixscribe.auth;

import com.codemixscribe.config.AppProperties;
import com.codemixscribe.user.User;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

/** HS256 tokens. The ai-service validates the same tokens with the same JWT_SECRET. */
@Service
public class JwtService {
    private final SecretKey key;
    private final Duration expiry;

    public JwtService(AppProperties props) {
        this.key = Keys.hmacShaKeyFor(props.jwtSecret().getBytes(StandardCharsets.UTF_8));
        this.expiry = Duration.ofHours(props.jwtExpiryHours());
    }

    public String issue(User user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(user.getId()))
                .claim("email", user.getEmail())
                .claim("name", user.getName())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiry)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** Returns the user id, or throws if the token is invalid/expired. */
    public long parseUserId(String token) {
        String sub = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject();
        return Long.parseLong(sub);
    }
}
