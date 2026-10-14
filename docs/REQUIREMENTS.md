# Requirements — ACME Salary Management

## Goal
ACME's HR team manages salaries for ~10,000 employees in several countries using Excel workbooks. The goal is a web app the HR Manager can use to **maintain salary data safely** and **answer "how do we pay people?" in seconds**.

**Persona:** the HR Manager, a single user with full access. They are fluent in Excel, not technical, and want answers they can trust and export.

## Questions the product must answer
| # | Question | Where in the app |
|---|----------|------------------|
| 1 | What are the min / p25 / median / avg / p75 / max salaries by country, department and job title? | Insights → Distribution |
| 2 | Who is paid unusually high or low compared with peers (same job title, or title group, and country)? | Insights → Outliers |
| 3 | What are the total payroll and headcount by country and by department? | Insights → Payroll |
| 4 | How has one person's salary changed over time? | Employee detail → Salary history |
| 5 | How does pay compare between genders within the same job title (or title group)? | Insights → Pay gap |

## In scope
- **Employee directory:** server-side search (name, email, employee code), filters (country, department, job title, salary range, status), sorting and pagination (≤100 rows per page). The browser never loads all 10k rows.
- **Maintain employees:** create, edit, and deactivate (soft delete; history is kept).
- **Salary changes** are stored as history rows (amount, effective date, reason, note). The employee's current salary is updated in the same transaction.
- **Multi-currency:** salaries are stored in local currency and shown alongside a normalized USD value from a static FX table.
- **Insights dashboard** covering questions 1, 2, 3 and 5.
- **Title grouping in insights.** Real job titles are messy: "Software Engineer" and "Software Developer" are the same kind of role at the same level. Wherever an insight is broken down by role (distribution by job title, outliers, pay gap), HR can select several titles to be treated as one group. One or more groups can be defined.
- **CSV export** of the current filtered list, streamed.
- **Deterministic seed** of 10,000 realistic employees with salary history.
- Deployed as a single container, plus a demo video.

## Assumptions (one line each)
- "Salary" means **annual base salary**, in the currency of the employee's country. Each country has one currency.
- FX rates are **static** and stamped with an "as of" date. Comparisons and totals across countries use USD.
- Outliers are judged against peers in the **same title and country**, so peers share one currency.
- A salary change **cannot be future-dated** and **cannot be dated before the latest existing change**. This means the current salary always equals the latest history row.
- An employee's **country is fixed after hire**. Relocation changes the currency and is out of scope.
- Insights count **active employees only**. The directory shows active employees by default and can include inactive ones.
- **Outlier rule:** a salary below p25 − 1.5·IQR or above p75 + 1.5·IQR of its peer group (Tukey fences). Peer groups with fewer than 5 people are not evaluated.
- **Pay gap formula:** (male median − female median) / male median, per job title, in USD, with an optional country filter. It is shown only when each group has ≥5 people, which limits statistical noise and protects anonymity. Non-binary and undisclosed employees count toward headcount but are not part of this two-way comparison.
- **Title groups are ad hoc and stored in the URL** rather than saved. They are bookmarkable and shareable, and the same groups apply to all role-based panels. A title belongs to at most one group, each group has ≥2 titles, and there are at most 10 groups. Saved "job families" are a possible next step.
- When titles are grouped, **peers become same title group + same country**. This lets small, similar titles reach the minimum group size together.
- Countries, departments, job titles and FX rates are **reference data** managed through migrations. There is no admin UI for them.

## Deliberately out of scope
| Excluded | Why |
|----------|-----|
| Payroll run and tax | Rules differ by jurisdiction, are regulated, and belong to a separate system of record. This app answers questions about pay *policy*; it does not pay anyone. |
| Bonuses and equity | These need a different data model (variable pay, vesting). Base salary answers all five questions. A `compensation_component` table can be added later without breaking anything. |
| Approval workflows | There is one user. Approvals would need roles, states and notifications, which is a project of its own. |
| Auth / RBAC | There is one persona and limited time. **Known risk:** salary data is highly sensitive. The deployed demo contains only synthetic data. Before real data goes in, it needs SSO, role-based access and an audit log. |
| Live FX | Live rates add an external dependency and make numbers non-reproducible. A static table keeps reports stable and tests deterministic. |
| Excel import UI | Column mapping, validation and error reporting together are a separate feature. The seeder already proves bulk loading, and CSV export covers getting data out. |
| Future-dated raises, relocations, editing reference data | Leaving these out keeps the core invariant ("current = latest history") trivially true. |

## Success criteria
- Each of questions 1–5 can be answered in ≤3 clicks from the home page.
- Dashboard endpoints respond well under 500 ms locally with 10k employees (measured and recorded).
- Seeding 10k employees takes seconds, and the same seed always produces identical data.
- The test suite is fast and deterministic, with no network and no wall-clock time.
