# AI Usage Log

Tool: Claude Code (Claude Opus) acting as a senior pair engineer. I direct the work, review every step, and approve before each commit.

---

## Step 1: Requirements and design docs
**Prompt intent:** Act as a senior pair. Write a one-page REQUIREMENTS.md and a DESIGN.md (schema, API, indexes, packages, trade-offs, performance) before any code. Wait for approval.

**What the AI flagged or got wrong:**
- It flagged a mismatch between my prompt (React) and the brief ("AngularJS for Java"). Raised as an open question rather than silently picking one.
- It flagged the local toolchain: JDK 17 installed while the target is Java 21, and Maven is not installed (plan: Maven Wrapper).

**Key decisions:**
- Denormalize `current_salary_usd` so the salary filter and sort are indexable. The FX table is static, so recomputing is a one-line migration.
- Use JPA for CRUD and plain SQL (`NamedParameterJdbcTemplate`) for analytics. Percentiles come from H2's `PERCENTILE_CONT` (same method as Excel's `PERCENTILE.INC`).
- Outliers use Tukey fences within (title, country) with n ≥ 5. Pay gap uses medians per title, shown only when each group has ≥ 5 people.
- Country is fixed after hire, and salary changes can't be future-dated or earlier than the latest change, which keeps "current = latest history" trivially true.
- **Frontend framework went React → Angular → React.** The AI recommended Angular because the role is Java/Angular and the brief mentions "AngularJS for Java". On re-reading the brief, I decided the frontend language isn't mandatory the way the backend is: the UI line lists ReactJS/NextJS as options. **Final choice: React** (+ TypeScript, Vite, MUI). The only extra dependency is `react-router-dom`.

**My correction: title grouping.** The AI's draft treated every job title as a separate peer group. I pointed out that titles like "Software Engineer" and "Software Developer" are different strings for the same kind of role at the same level. Decisions:
- Every role-based insight (distribution by title, outliers, pay gap) accepts HR-defined **title groups** (`?titleGroup=3,7&titleGroup=12,15`).
- The groups are ad hoc and live in the URL rather than being saved. This means no new table and no admin UI, and the URL is the record. Saved job families are a possible next step.
- In SQL, the groups become a parameter-bound mapping CTE producing a `role_key`. Every role query groups by `role_key` instead of `job_title_id`, so the outlier, percentile and pay-gap logic stays unchanged.
- The seed includes near-synonym titles so the feature is demonstrable.

---

## Step 2: Scaffold backend, frontend and CI
**Prompt intent:** Create runnable empty shells for both apps with tests passing, plus GitHub Actions running `mvn verify` and `npm test`.

**What came up:**
- **Spring Boot 3 is no longer offered by Spring Initializr.** Boot 3.5 reached the end of its free open-source support in mid-2026. The AI recommended Boot 4.0.x over the "Boot 3" in my original prompt, and I accepted. Consequences: springdoc moves to the 3.0.x line, Flyway needs its own explicit starter in Boot 4, and Jackson moves to version 3.
- The local machine had JDK 17 only. I installed Temurin 21. The project uses the Maven Wrapper, so nobody needs a global Maven.
- Known noise: Flyway warns that H2 2.4.240 is newer than its verified version (2.3.232). This is harmless for our SQL; revisit only if a migration misbehaves.

**Key decisions:**
- `.gitattributes` forces LF line endings, because a CRLF `mvnw` breaks Linux CI and the Docker build.
- `spring.jpa.hibernate.ddl-auto=validate`: Flyway owns the schema and Hibernate only checks that entities match it. `open-in-view=false` keeps lazy loading out of controllers.
- `spring.data.web.pageable.max-page-size=100` enforces the "never load 10k rows" rule at the framework level.
- A single `Clock` bean in UTC is the only source of "now"; tests can swap in a fixed clock.
- The H2 file location is configurable via `ACME_DATA_DIR`, for the Docker volume later.
- The frontend has strict TypeScript, Vite's dev proxy forwards `/api` to `:8080`, and a smoke test covers routing.
