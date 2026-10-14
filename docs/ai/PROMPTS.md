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
