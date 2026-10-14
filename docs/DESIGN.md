# Design — ACME Salary Management

## 1. Architecture

```
 Browser (React SPA)                 Spring Boot (one JVM, one container)              H2 (file)
 ┌────────────────────┐   /api/*    ┌──────────────────────────────────────────┐    ┌──────────┐
 │ MUI + TanStack     │ ──────────▶ │ Controller → Service → Repository / SQL  │──▶ │ Flyway-  │
 │ Query + Recharts   │   JSON/CSV  │ DTO records at the boundary              │    │ managed  │
 └────────────────────┘ ◀────────── │ Serves built SPA from /static            │    │ schema   │
                                     └──────────────────────────────────────────┘    └──────────┘
```

- This is a modular monolith packaged **by feature**. Within each feature the code is layered controller → service → repository.
- CRUD goes through **Spring Data JPA**. Analytics use **hand-written SQL through `NamedParameterJdbcTemplate`**, because aggregate queries are clearer in SQL than in JPQL. `NamedParameterJdbcTemplate` is already on the classpath via data-jpa, so this adds no dependency.
- Time comes from an injected `java.time.Clock` bean. Tests use `Clock.fixed(...)`.

## 2. Stack choices and where I'd push back

| Choice | Verdict |
|---|---|
| Java 21 / **Spring Boot 4.0** / JPA / Flyway | Brief said Boot 3, but Boot 3.5 (last 3.x) reached end of OSS support in mid-2026 and Initializr no longer offers it. Boot 4.0.x is the supported line; for this app the differences are small (explicit Flyway starter, Jackson 3, springdoc 3.x). |
| H2 for both tests and prod | **Keep for this assessment.** It's one SQL dialect everywhere and supports `PERCENTILE_CONT … WITHIN GROUP`, CTEs and window functions. Tests need no Docker. **In production I'd use PostgreSQL** with Testcontainers for durability, concurrency and real operations. The SQL is kept ANSI-standard so switching is mainly a config and driver change. |
| React + TypeScript + Vite | The brief lists ReactJS/NextJS as UI options and does not make a framework mandatory, so React was chosen (decision recorded in `docs/ai/PROMPTS.md`). It is a plain SPA; Next.js SSR isn't needed because Spring serves the app. |
| UI library choices | MUI `Table` + `TablePagination` (no `@mui/x-data-grid`), MUI `Autocomplete` for multi-select, native `<input type="date">` (no x-date-pickers), and controlled forms (no form library). |
| **Additional dependency proposed:** `react-router-dom` | Needed for the detail and insights routes, and so filters live in the URL. This is the only addition beyond the given stack. |

## 3. Data model

```sql
country      (code CHAR(2) PK, name VARCHAR, currency_code CHAR(3) NOT NULL → fx_rate)
fx_rate      (currency_code CHAR(3) PK, usd_per_unit DECIMAL(18,8) NOT NULL, as_of DATE NOT NULL)
department   (id BIGINT PK, name VARCHAR UNIQUE)
job_title    (id BIGINT PK, title VARCHAR UNIQUE)

employee (
  id                  BIGINT IDENTITY PK,
  employee_code       VARCHAR(10) UNIQUE NOT NULL,      -- e.g. E000123, shown to HR
  first_name, last_name VARCHAR(100) NOT NULL,
  email               VARCHAR(255) UNIQUE NOT NULL,
  gender              VARCHAR(16) NOT NULL,             -- FEMALE | MALE | NON_BINARY | UNDISCLOSED
  country_code        CHAR(2)  NOT NULL → country,      -- immutable after create
  department_id       BIGINT   NOT NULL → department,
  job_title_id        BIGINT   NOT NULL → job_title,
  hire_date           DATE     NOT NULL,
  current_salary      DECIMAL(15,2) NOT NULL CHECK (> 0),  -- local currency
  current_salary_usd  DECIMAL(15,2) NOT NULL,            -- denormalized, see trade-off T1
  status              VARCHAR(10) NOT NULL,              -- ACTIVE | INACTIVE
  deactivated_at      DATE NULL,
  created_at, updated_at TIMESTAMP NOT NULL
)

salary_history (
  id             BIGINT IDENTITY PK,
  employee_id    BIGINT NOT NULL → employee,
  amount         DECIMAL(15,2) NOT NULL CHECK (> 0),
  currency_code  CHAR(3) NOT NULL,                   -- captured per row; never re-derived
  effective_date DATE NOT NULL,
  reason         VARCHAR(20) NOT NULL,               -- HIRE | ANNUAL_REVIEW | PROMOTION | MARKET_ADJUSTMENT | CORRECTION
  note           VARCHAR(500),
  created_at     TIMESTAMP NOT NULL
)
```

- **Money** is stored as `BigDecimal` / `DECIMAL(15,2)`. USD conversion is `amount × usd_per_unit`, rounded `HALF_UP` to 2 decimal places, in a single place (`FxService`).
- **Invariant:** `employee.current_salary` equals the `amount` of the history row with the latest `effective_date`. It is enforced in `SalaryService` (see assumptions in REQUIREMENTS) and covered by tests.
- **Migrations:** `V1__schema.sql`, `V2__reference_data.sql` (8 countries with 7 currencies, 10 departments, about 20 titles, FX rates). Employees are not loaded through a migration; the seeder loads them (§7).
  - The title list deliberately includes **near-synonyms** such as Software Engineer / Software Developer, Data Analyst / Business Analyst, and HR Generalist / People Partner. This mirrors real Excel data and gives title grouping (§6) something to demonstrate.

## 4. Indexes (and why)

| Index | Serves | Justification |
|---|---|---|
| `employee(country_code, job_title_id)` | Country filter; peer groups for outliers and pay gap; group by country | The leading column covers the country-only filter. The pair is exactly the outlier peer key, and it still helps when titles are grouped because grouping is a mapping over `job_title_id`. |
| `employee(job_title_id)` | Job title filter; group by title | The composite above can't serve title-only filters. |
| `employee(department_id)` | Department filter; payroll by department | The most common directory filter. |
| `employee(current_salary_usd)` | Salary range filter; sort by salary | Range scan and ordered access. This is the reason for denormalizing (T1). |
| `employee(last_name, first_name)` | Default sort | Lets the default first page read in index order. |
| `salary_history(employee_id, effective_date)` | Salary timeline; "latest change" check | Every history read is by employee and ordered by date. |
| UNIQUE `employee(email)`, `employee(employee_code)` | Duplicate checks, lookups | Integrity; the index comes free. |

These are deliberately **not** indexed:
- `status`: only two values and ~95% ACTIVE, so an index wouldn't be selective.
- Free-text search: `LIKE '%q%'` can't use a B-tree. A scan of 10k rows takes a few milliseconds. At larger scale this becomes a full-text index (§9).

At 10k rows several aggregates scan the whole table anyway. That's fine; the indexes matter mostly for filtered pages and FK joins.

## 5. API (`/api`, JSON; errors as RFC 7807 `ProblemDetail`)

| Method | Path | Notes |
|---|---|---|
| GET | `/reference` | Countries (with currency and FX rate), departments, job titles. Used for dropdowns. |
| GET | `/employees?q&country&departmentId&jobTitleId&minSalaryUsd&maxSalaryUsd&status&sort&page&size` | Paged list. `size` ≤100 (`spring.data.web.pageable.max-page-size`). `sort` is allowlisted to `lastName, hireDate, salaryUsd, country, jobTitle, department`. Default status is ACTIVE. |
| GET | `/employees/export.csv?<same filters>` | Streamed with `StreamingResponseBody` and a forward-only JDBC cursor (fetch size 500). Never builds all 10k rows in memory. |
| GET | `/employees/{id}` | Detail, with salary shown in both local currency and USD. |
| POST | `/employees` | Create. Includes the initial salary and writes a `HIRE` history row in the same transaction. Returns 201 with a Location header. |
| PUT | `/employees/{id}` | Edits name, email, gender, department and title. **Salary and country are not editable here.** |
| POST | `/employees/{id}/deactivate` | Soft delete. Idempotent. |
| GET | `/employees/{id}/salary-history` | Ordered by effective_date. |
| POST | `/employees/{id}/salary-changes` | `{amount, effectiveDate, reason, note}`. Writes history and updates current and USD salary **atomically**. |
| GET | `/insights/salary-stats?groupBy=COUNTRY\|DEPARTMENT\|JOB_TITLE&titleGroup…` | Per group: count, min, p25, median, avg, p75, max (USD). `titleGroup` applies when `groupBy=JOB_TITLE`. |
| GET | `/insights/payroll?groupBy=COUNTRY\|DEPARTMENT` | Per group: headcount and total payroll in USD, plus an overall total. |
| GET | `/insights/outliers?country&jobTitleId&titleGroup…&page&size` | Each flagged employee with peer group label, peer p25, median and p75, direction (HIGH or LOW), and % from the peer median. |
| GET | `/insights/pay-gap?country&titleGroup…` | Per title (or title group): female and male count and median (USD), gap %. Rows below the minimum group size are flagged `insufficientData`. |

**Title groups parameter.** `titleGroup` may be repeated. Each value is a comma-separated list of job title ids, for example `?titleGroup=3,7&titleGroup=12,15`. It is parsed explicitly from the raw parameter values so Spring's comma-splitting can't merge separate groups. The rules:
- Each group has ≥2 distinct, existing title ids.
- A title may appear in at most one group.
- There are at most 10 groups.

Breaking a rule returns 400 with a field error. Responses include `groupLabel` (e.g. "Software Developer / Software Engineer") and the member `jobTitleIds`.

**Error shape** (from `@RestControllerAdvice`): `{type, title, status, detail, instance, errors:[{field, message}]}`.
- 400: validation failure
- 404: unknown id
- 409: duplicate email
- 422: salary-change rule violated (future date, or earlier than the latest change)

## 6. Key computations
- **Percentiles:** `PERCENTILE_CONT(p) WITHIN GROUP (ORDER BY current_salary_usd)` with linear interpolation (the same method as Excel's `PERCENTILE.INC`, which matters to an Excel user). Computed in SQL with `GROUP BY`.
- **Title grouping (role key):** every role-based insight groups by a **role key** instead of the raw `job_title_id`.
  - A `TitleGrouping` value object is built from the validated `titleGroup` params and the reference data. It maps each grouped title id to a group key and a label. Labels come from reference titles, never from user text.
  - In SQL this becomes a parameter-bound mapping CTE: `WITH title_map(job_title_id, role_key) AS (VALUES (:t0, :k0), (:t1, :k1), …)`, `LEFT JOIN`ed to `employee`. The role key is `COALESCE(tm.role_key, 'T' || e.job_title_id)`.
  - Ungrouped titles behave exactly as before. With no groups, the CTE is omitted.
  - Only ids and keys are bound, and the generated SQL contains only placeholders, so there is no injection surface.
- **Outliers:** a single CTE. `peer` computes n, p25, p50 and p75 per **`(role_key, country_code)`** over active employees. The CTE joins back to `employee` and keeps rows outside the fences where n ≥ 5, ordered by |deviation from the median| descending. Local currency is used, since peers share a country. Grouping titles matters most here: two similar titles that are each too small (n < 5) to evaluate can form a valid peer group together.
- **Pay gap:** SQL computes `GROUP BY role_key, gender` with count and median. Java then pivots the small aggregated result (at most about 20 role keys × 2 rows) into one row per role. Java never loops over employees.
- The thresholds (`1.5`, min peer size `5`, min gender group `5`, max `10` title groups) are named constants with tests.

## 7. Seeding
- `EmployeeGenerator(seed, clock)` is a pure, deterministic generator using `SplittableRandom(seed)`. Its parameters:
  - Country weights (e.g. US 30%, IN 25%, GB 12%, …)
  - Department → title mix
  - A USD median per title × a country pay factor (near-synonym titles get similar medians)
  - Log-normal noise (σ≈0.12)
  - Hire dates in the last 10 years relative to the clock, with 1–5 history rows of realistic raises
  - Planted signal so the dashboard has something to show: about 1% planted outliers and a small synthetic gender gap in some titles. This is **documented as synthetic**.
- `DatabaseSeeder` runs only if `employee` is empty and `acme.seed.enabled=true`. It does `JdbcTemplate.batchUpdate` in batches of 1,000 inside one transaction: about 10k employees and about 30k history rows. Seed time is logged.
- Tests check: exactly N employees; the same seed gives identical output; a different seed gives different output; each employee's current salary equals its latest history row; values fall within the expected bands.

## 8. Package layout

```
backend/src/main/java/com/acme/salary/
  common/      ClockConfig, GlobalExceptionHandler, PageResponse, SpaForwardController
  reference/   Country, Department, JobTitle, FxRate entities, repos, ReferenceController, FxService
  employee/    Employee entity, EmployeeRepository, EmployeeSpecifications, EmployeeService,
               EmployeeController, CsvExportService, dto/ (records)
  salary/      SalaryHistory entity, repo, SalaryService, SalaryController, dto/
  insights/    InsightsRepository (SQL), InsightsService, InsightsController,
               TitleGrouping (parse + validate + label), dto/
  seed/        EmployeeGenerator, DatabaseSeeder, SeedProperties
frontend/src/
  api/         client.ts (fetch + ProblemDetail errors), types.ts, employees.ts, insights.ts
  features/employees/  ListPage, Filters, Table, useEmployeeFilters (URL-synced), DetailPage,
                       EmployeeForm, SalaryChangeDialog, SalaryHistoryChart
  features/insights/   InsightsPage, DistributionPanel, PayrollPanel, OutliersPanel, PayGapPanel,
                       TitleGroupsControl, useTitleGroups (URL-synced)
  components/  LoadingState, ErrorState, EmptyState, Money
  lib/         format.ts, useDebouncedValue.ts
```
Routes are `/employees`, `/employees/new`, `/employees/:id` and `/insights`.
- All filter state lives in `useSearchParams`. Search is debounced (300 ms), and TanStack Query's `placeholderData` keeps the previous page on screen while paging.
- **Title groups UI:** `TitleGroupsControl` sits above the Distribution (by job title), Outliers and Pay-gap panels.
  - HR clicks "Group similar titles" and picks ≥2 titles in an MUI multi-select `Autocomplete`. Titles already in another group are disabled.
  - Each group appears as a removable chip.
  - The groups are stored in the URL (`?titleGroup=3,7`) and shared by all three panels, so a grouped view is bookmarkable and shareable.

## 9. Trade-offs
- **T1: denormalized `current_salary_usd`.** It makes the salary range filter and sort indexable and keeps analytics SQL simple. The cost is that an FX rate change requires a recompute. Because rates are static reference data changed only by migration, that migration includes a one-statement `UPDATE … SET current_salary_usd = current_salary * rate`.
- **T2: JPA for CRUD, JDBC SQL for analytics.** Each tool is used where it reads best.
- **T3: country fixed after hire, no future-dated changes.** This keeps the invariant simple. The cost is that relocations and scheduled raises aren't supported (documented).
- **T4: no optimistic locking.** With a single user the risk is minimal. With multiple users I'd add `@Version` and return 409.
- **T5: USD-only stats.** Cross-group comparisons need one currency. Per-employee views show both local currency and USD.
- **T6: H2 file DB in the container.** Data lives on the container disk and is reseeded on a fresh start. This is fine for a demo with synthetic data, but not production.
- **T7: ad-hoc title groups, held in the URL rather than saved.** There's no new table, no admin UI and no stale saved groupings. Groupings are reproducible because the URL is the record. The cost is that HR re-creates or bookmarks a grouping instead of picking a saved one. The natural next step is a persisted `job_family` reference table, with the same SQL role-key mechanism reading from it.
- **Scale beyond 10k:** materialized aggregates or read replicas for insights, full-text search, a keyset-paginated export.

## 10. Performance plan
- Dashboard: measure each insights endpoint with `curl -w %{time_total}` after warm-up, take the median of 10 runs on the 10k seed, and record it in the README. Do this both with and without title groups. Target ≪500 ms.
- Seeding: log the time. Target a few seconds.
- List: one `count` + one page query. Joins are fetched in the page query to avoid N+1, which will be verified with SQL logging.

## 11. Testing strategy

| Layer | Tool | Examples |
|---|---|---|
| Pure logic | JUnit + AssertJ | Generator determinism, FX rounding, pay-gap pivot, `TitleGrouping` parsing and validation (overlap, size <2, unknown id, >10 groups, labels) |
| SQL math | `@DataJpaTest` / `@JdbcTest` on in-memory H2 with tiny hand-built datasets | p25/median/p75 on {10,20,30,40,50}; outlier fences; payroll totals; **two titles each with n=3 are not evaluated separately but are evaluated once grouped (n=6)**; grouped stats equal stats over the union |
| Services | `@DataJpaTest` + `@Import` | Salary change writes history and updates current; rollback when a step fails; rule violations |
| Web | `@WebMvcTest` + `@MockitoBean` service | Validation → 400 shape, 404, page size cap, sort allowlist, repeated `titleGroup` params bound as separate groups |
| UI | Vitest + RTL, API module mocked with `vi.mock` | Filters ↔ URL, debounce (fake timers), loading/empty/error states, form validation, title groups ↔ URL and passed to all role panels |

CI (GitHub Actions) runs `./mvnw -B verify` and `npm ci && npm test && npm run build` as two parallel jobs.

## 12. Deployment
A single multi-stage `Dockerfile`:
1. `node:24` builds `frontend/dist`.
2. `maven + temurin-21` copies `dist` into `src/main/resources/static` and packages the jar.
3. `temurin-21-jre` runs it with H2 at `/data`.

The DB is seeded on first start. The target host is Render (free Docker web service) unless you prefer another.
