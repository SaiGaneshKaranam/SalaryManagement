package com.acme.salary;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

@SpringBootTest
@AutoConfigureMockMvc
class SalaryApplicationTests {

	@Autowired
	Clock clock;

	@Autowired
	MockMvcTester mvc;

	@Test
	void contextLoadsWithUtcClock() {
		assertThat(clock.getZone().getId()).isEqualTo("Z");
	}

	@Test
	void exposesOpenApiDocument() {
		assertThat(mvc.get().uri("/api/openapi")).hasStatusOk();
	}
}
