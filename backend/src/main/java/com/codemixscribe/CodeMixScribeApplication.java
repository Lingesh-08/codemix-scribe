package com.codemixscribe;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class CodeMixScribeApplication {
    public static void main(String[] args) {
        // Windows reports India's zone as the legacy "Asia/Calcutta", which the
        // Postgres 16 image rejects. Timestamps are stored as instants, so UTC is safe.
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        SpringApplication.run(CodeMixScribeApplication.class, args);
    }
}
