package com.acme.salary.common;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Single source of "now". Production uses the system UTC clock; tests replace it with a fixed clock
 * so that date rules (e.g. no future-dated salary changes) are deterministic.
 */
@Configuration(proxyBeanMethods = false)
public class ClockConfig {

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}
}
