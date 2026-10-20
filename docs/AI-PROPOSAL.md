# AI-assisted enhancements — proposal (A10)

Status: **proposal for Wewin's decision; nothing here is built** beyond invoice scanning (A11), which
already exists and is off by default. Each item lists what it would use, what it would change for the
user, and the guardrails. Wewin chooses which (if any) to build; each choice becomes an OPEN-QUESTIONS
entry before work starts.

## Ground rules (apply to every item)

1. **Suggest, never post.** AI output only pre-fills a draft or shows a hint. Posting, approving,
   cancelling and paying stay human actions with the existing permission and audit rules.
2. **Opt-in, per feature.** Each feature has its own setting, off by default. Sending company data to an
   external AI service needs Wewin's written approval (Q-046); local/statistical methods are preferred
   where they are good enough.
3. **Traceable.** Every suggestion is stored with its inputs, the model/version and whether the user
   accepted, changed or rejected it — the same way scanned-invoice corrections are recorded today.
4. **Business rules stay in code.** Loss %, matching tolerance, allocation and GST limits are computed by
   the existing tested functions; AI never decides a figure that the books depend on.
5. **No new personal data.** Only business documents already in the ERP; nothing about workers.

## Candidates (ordered by value ÷ effort)

| # | Idea | Uses | What the user sees | Method | Effort |
|---|---|---|---|---|---|
| P1 | **Loss early-warning by vendor / process** | Closed outward D.C.s: final loss %, allowed %, vendor, process, item, season | "KTS knitting loss has risen 3 closes in a row (2.1 → 2.6 → 2.9 %, allowed 3 %)" on the dashboard and vendor page | Statistics (moving average, control limits) — no external AI | S |
| P2 | **Realistic return dates** | Outward → inward history per vendor / process / quantity | Expected-return date suggested on a new outward D.C. from that vendor's actual turnaround; overdue alerts become fewer and truer | Median / percentile per vendor-process; optional regression | S |
| P3 | **Ask the reports** | The report catalogue (Q-054) and its parameters | A search box: "dyeing loss over 5 % last quarter" → opens Reports › Process loss with the filters set | LLM maps text to *one catalogue report + parameters*; never writes SQL; runs with the user's own permissions | M |
| P4 | **Costing from history** | Past orders' costing sheets, fabric programs (GSM, dia, required kg), packing results | When costing a new style, suggested consumption / panel cost from the closest past styles, with the orders it was based on | Nearest-neighbour on style attributes; LLM optional for free-text descriptions | M |
| P5 | **Payables cash plan** | Posted bills, due dates, payment history per vendor | 4-week payables forecast on the accounts dashboard | Due dates + each vendor's actual payment lag (statistics) | S |
| P6 | **Master-data hygiene** | Vendors, items, learned scan wording (Q-047) | "These two items look like the same yarn (30s CC / 30S COMBED COTTON)" for an admin to merge or ignore | Fuzzy matching already used by scanning; LLM optional | S |
| P7 | **Scanning improvements** (A11 follow-up) | Scans and their recorded corrections | Fewer fields needing review per vendor layout | Learn per-vendor templates from accepted corrections (local); AI extraction stays opt-in | M |

S = up to 1 week, M = 2–3 weeks, including tests and screens.

## Recommendation

Start with **P1, P2 and P5**. They need no external service, use data the ERP already collects
correctly, and turn existing reports into early warnings. Decide on P3/P4 after three months of live
data, when there is enough history to judge their usefulness. Revisit P7 when scan correction statistics
(available in the scans module) show which vendors cost the most review time.

## Decisions needed from Wewin

1. Which candidates to pursue, and in what order.
2. Whether any company data may be sent to an external AI provider (and which provider / region), or
   whether all features must run locally.
3. Who receives the P1 warnings (owner only, or production heads as well).
