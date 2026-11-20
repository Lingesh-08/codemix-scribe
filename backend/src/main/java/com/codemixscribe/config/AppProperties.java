package com.codemixscribe.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String jwtSecret,
        int jwtExpiryHours,
        String serviceSecret,
        String aiServiceUrl,
        String corsOrigin) {
}
