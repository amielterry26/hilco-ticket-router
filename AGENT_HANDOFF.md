# AGENT_HANDOFF.md
## Jira Ticket Roulette 👻 — Full Context for Continuing Agent

> **Read this first.** This document captures the full picture of the project — what it is, why it exists, every decision made, the current state of the code, known issues, and what to do next. If you are a new agent or starting a new session, treat this as your source of truth before touching anything.
>
> You have permission to ask questions before making changes and to do a full logic pass if you see something off.

---

## 1. What This App Is

**Jira Ticket Roulette 👻** is a lightweight internal routing tool built by **Desert IT Solutions (DIT)** for managing inbound Jira tickets from the **Hilsinger / Hilco** client account. It is a static frontend-only web app (no backend, no framework, no build step) hosted on AWS S3 + CloudFront.

The tool helps DIT technicians quickly answer: *"Who handles this ticket?"* — DIT works it, assign to a specific Hilco contact, deny/cancel, or escalate.

**Live URL:** https://dop3itp44ubc6.cloudfront.net
**GitHub:** https://github.com/amielterry26/hilco-ticket-router
**Active branch:** `dev` (working branch) — `master` is stable

---

## 2. The Mood / Intent

- **Fast and practical.** Technicians are mid-queue. Answer the routing question in under 10 seconds.
- **Not overbuilt.** No React, no backend, no database. Static files only.
- **Warning-forward.** Two rules impossible to miss:
  1. Ping **Ryan Creasia** internally before assigning any of his tickets.
  2. DIT does **not** have Hilco/Hilsinger M365 admin credentials.
- **Process-enforcing.** Escalation flow shown everywhere so no one skips steps.
- **Light mode default, dark mode available.** GitHub-inspired aesthetic.

---

## 3. File Structure

```
hilco-ticket-router/
├── index.html          # All markup
├── app.js              # All logic — search, render, admin CRUD, event wiring
├── styles.css          # All styles — light + dark mode, animations, responsive
├── routing-data.json   # Source of truth for routing rules (~89 rules)
└── AGENT_HANDOFF.md    # This file
```

No package.json. No node_modules. No build pipeline.

---

## 4. Infrastructure

| Thing | Detail |
|---|---|
| Hosting | AWS S3 static website, bucket: `hilco-ticket-router` |
| CDN | AWS CloudFront, Distribution ID: `EPOWN92QGYXLJ`, domain: `dop3itp44ubc6.cloudfront.net` |
| Deploy command | `aws s3 sync . s3://hilco-ticket-router --exclude ".git/*" --exclude "*.DS_Store"` |
| Invalidate cache | `aws cloudfront create-invalidation --distribution-id EPOWN92QGYXLJ --paths "/*"` |
| GitHub account | `amielterry26` (gh CLI authenticated) |
| Active branch | `dev` — push all changes here, merge to `master` when stable |

After any change: **sync → invalidate → wait ~60s → hard refresh** (`Cmd+Shift+R`).

---

## 5. Architecture Deep Dive

### Data Model

Each routing rule in `routing-data.json`:
```json
{
  "id": "slugified-category-name",
  "category": "Human-readable ticket type",
  "actionType": "assign | dit | deny | escalate | external | reference | ask",
  "assignTo": "Person's name",
  "backup": "Backup person",
  "participants": ["comma", "separated"],
  "keywords": ["search", "terms", "synonyms"],
  "notes": "Free text instructions",
  "warnings": ["ASK RYAN FIRST", "DENY / CANCEL", etc.],
  "links": ["https://...", "mailto:..."],
  "source": "Hilco routing chart"
}
```

**Ryan Creasia detection:** `assignTo` contains "ryan creasia" (case-insensitive) OR `warnings` contains "ASK RYAN FIRST". Both conditions must be checked.

### ActionType → Badge Labels
| actionType | Badge Label |
|---|---|
| assign | ASSIGN |
| dit | DIT HANDLES |
| deny | DENY / CANCEL |
| escalate | ESCALATE |
| external | EXTERNAL CONTACT |
| reference | REFERENCE ITG DOC |
| ask | ASK / CONFIRM FIRST |

### Search / Confidence Scoring

- `expandQuery(query)` — expands terms using `SEARCH_SYNONYMS` map
- `scoreRule(rule, terms)` — scores each rule against expanded terms:
  - Exact category match: 50 pts
  - Keyword match: 30 pts, Synonym match: 20 pts
  - Assignee: 15 pts, Notes: 10 pts, Action/warning: 10 pts
  - Backup: 8 pts, Participants: 8 pts, Link: 5 pts
- Confidence badge: ≥70% green, 40–69% yellow, <40% grey

### localStorage Keys
- `hilco_routing_data_v1` — user-edited rules (overrides JSON)
- `hilco_itg_link` — updated IT Glue URL
- `hilco_dark_mode` — `'1'` or `'0'`

### Key JS Functions
| Function | What it does |
|---|---|
| `loadData()` | Fetches JSON, falls back to localStorage |
| `switchTab(tab)` | Shows/hides tab panels |
| `toggleAdmin()` | Toggles admin panel + gear btn active state |
| `renderSearch()` | Shows idle chips or search result cards |
| `renderList()` | Renders routing table with process reminder above |
| `buildCard(rule, pct, matched, isTop)` | Search result card HTML |
| `buildTableRow(rule)` | Table row HTML |
| `buildProcessReminder()` | Blue "① Escalate → ② Assign → ③ Note → ④ CW" bar (used in list tab only) |
| `applyDark(on)` | Toggles `body.dark`, saves to localStorage |
| `showToast(msg, type)` | Bottom-right toast notification |

### Critical Bugs Fixed — DO NOT UNDO

1. **`[hidden] { display: none !important; }`** in CSS — prevents `.results-meta { display: flex }` from overriding the HTML `hidden` attribute and showing "19 results" in idle state.
2. **Clear button uses `mousedown` + `e.preventDefault()`** — not `click`. Blur fires before click; mousedown fires before blur, preventDefault stops it.
3. **Table row-actions use `visibility: hidden/visible`** — not `display: none/flex`. Prevents layout shift on hover.
4. **`.routing-table td.col-notes` / `.routing-table td.col-actions`** — Must use this specificity level (element+class) to beat `.routing-table td { display: block }` in mobile CSS.
5. **`.warn-bullets li` must use `position: relative; padding-left: 20px`** with `::before { position: absolute }` — NOT `display: flex`. Flex on li makes text nodes + `<strong>` tags into separate flex items, which stack word-by-word on mobile.

---

## 6. UI Structure (index.html layout order)

```
app-wrapper
├── app-header
│   ├── .home-btn (button wrapping h1 + subtitle — clicks → switchTab('search') + focus input)
│   └── .header-links
│       ├── 🌙 darkToggle (gear-btn style)
│       └── ⚙ adminToggle (gear-btn)
│       (↗ Jira Board and ↗ IT Glue Doc links were removed — security concern)
├── .warning-banner (cream/gold, pulsing, expandable)
│   ├── ⚠ icon
│   ├── .warn-content (headline + 2 bullets: Ryan + no M365)
│   └── "More/Less" toggle button
├── .warning-banner-extra (hidden by default)
├── .process-banner (blue, 4 numbered steps, approvers, example note)
├── .tab-nav [Search | Full Routing List]
├── #tab-search (tab-panel)
│   ├── .search-section (input + clear button)
│   ├── .process-reminder (STATIC HTML — always visible, not JS-rendered)
│   ├── #searchIdle (chips + link to Full Routing List)
│   ├── #searchResultsMeta (hidden until search)
│   └── #searchContainer (hidden until search)
├── #tab-list (tab-panel, hidden)
│   ├── .filters-row (All / Assign / DIT / Deny / Escalate / Ask Ryan / ITG Ref / External)
│   ├── .results-meta
│   └── #listContainer (process-reminder + routing table — JS-rendered)
└── #adminPanel (hidden, toggled by gear)
```

**Note:** `buildProcessReminder()` in JS is called only by `renderList()`. The search tab has a static HTML copy in `index.html`. Both are intentional — do not merge them.

---

## 7. The Escalation Process Flow (never remove or change without user confirmation)

1. **Escalate first.** Get approval. Approvers: Taylor Wanamaker · Andrew Minear · John Tuley · Thomas Traver · Kyle
2. **Assign in Jira** once approved.
3. **Leave an internal note** — what you saw in IT Glue, who you assigned to, your initials. Example: *"Item pricing - passing to Paula -KS"*
4. **Complete in ConnectWise.**

Compact version (reminder bar): ① Escalate & get approval → ② Assign in Jira → ③ Internal note + initials in Jira → ④ Complete in CW

---

## 8. Design System

### Font sizes (14px body base)
- Title h1: 26px (20px mobile), Body: 14px, Warning headline: 15px
- Warning bullets: 13px, Process title: 14px, Process note/step body: 13px
- Search input: **16px** (must stay 16px — iOS zooms on anything smaller)
- Tab buttons: 13px, Card category: 15px (14px mobile), Assignee name: 14px

### Key mobile rules (≤768px)
- Wrapper padding: 16px (not 32px)
- Filter buttons: horizontal scroll row, no wrap
- Routing table: `thead` hidden, `tbody tr` becomes CSS Grid (category top-left, badge top-right, assign below)
- Modal: bottom-sheet style (`align-items: flex-end`, rounded top corners only)
- All inputs must be **16px** or iOS zooms the page on focus
- On search focus: `scrollIntoView({ behavior: 'smooth', block: 'start' })` with 300ms delay (keyboard animation)
- `.card-badges { flex-shrink: 1; max-width: 100% }` — prevents badge overflow off card edge

### Colors
- Light: bg `#f6f8fa`, surface `#fff`, accent `#0969da`
- Warning banner: `#fdfcf5` bg, `#c9a84c` border, pulse animation
- Process banner: `#f0f7ff` bg, `#93c5fd` border
- Dark: `body.dark` class — GitHub dark palette (`#0d1117` base, `#161b22` surface)

### Animations
- Ghost emoji: `ghost-float` keyframes — float + rotate, 3.5s loop
- Warning banner: `banner-pulse` — subtle gold glow, 3.5s loop

---

## 9. ⚠ SECURITY CONCERN — Action Required

**Raised by: Casey Knopp (DIT coworker), May 6, 2026**

The app is currently **publicly accessible** with no authentication. Casey identified:

- **Staff names + roles** are exposed (Ryan Creasia, Tom Rammel, Paula, etc.) — OSINT risk
- **Internal policies** are visible (who owns what, escalation chains)
- **Direct links to IT Glue and Jira board** — anyone could attempt to access internal systems
- *"Looking at that with no context I would know Ryan's a good target"* — social engineering risk

**What the user confirmed they'd do:**
1. Remove the direct ↗ Jira Board and ↗ IT Glue Doc quick links from the header
2. Explore putting the app behind authentication or internal hosting

**Options to discuss/implement (ask user which direction):**

| Option | Effort | Notes |
|---|---|---|
| Remove header links | 5 min | Quick win. Links still in routing cards but header exposure reduced |
| CloudFront + IP allowlist | Low | Restrict to company IP range in CloudFront geo/IP rules |
| Lambda@Edge basic auth | Medium | Username/password gate in front of CloudFront. No backend needed |
| AWS Cognito + CloudFront | Medium-High | Full login page. SSO possible |
| Move to internal DIT hosting | Unknown | Casey mentioned DIT has internal hosting resources |

**Recommended immediate action:** Remove the IT Glue and Jira header links first (low risk, fast). Then decide on auth strategy with the team (talk to Robert per Casey's suggestion).

---

## 10. Development History

| Phase | What happened |
|---|---|
| Initial build | App created: search, routing table, JSON data, confidence scoring |
| UX pass | Renamed "Jira Ticket Roulette 👻", ghost animation, tab layout |
| Readability pass | Warning banner color iterations (red→grey→cream). Font bump to 16px then back to 14px. Fixed clear button (mousedown). Fixed edit/delete layout shift (visibility). Removed Reset Defaults. Admin moved to gear icon. |
| Warning content | Ryan Creasia ping rule + no M365 admin credentials note added |
| Width pass | max-width 840px → 1040px |
| Escalation flow | Full Kyle-style process banner: 4 steps, approvers, example note |
| Tab restructure | Final: Search tab + Full Routing List tab + gear for admin |
| Process reminder | Static HTML bar added to search tab (always visible, not just on results) |
| Header + dark mode | Title clickable (home button, 26px). Dark mode toggle 🌙/☀️. Full dark palette. |
| Mobile pass 1 | Full responsive overhaul: iOS zoom fix (16px inputs), wrapper padding, filter scroll row, table→card layout, modal bottom-sheet, scroll-to-search on focus |
| Mobile pass 2 | Fixed warn bullets word-stacking (flex→position:absolute). Fixed col-category word-break. Fixed badge overflow (flex-shrink). Fixed col-notes/col-actions specificity. |
| Git + GitHub | Repo created: `amielterry26/hilco-ticket-router`. Dev branch added. Working branch is `dev`. |

---

## 11. Where We Stopped (as of May 6, 2026)

- ✅ Both mobile passes complete and deployed
- ✅ `dev` branch created and pushed
- ✅ AGENT_HANDOFF.md updated
- ✅ **Header links removed** — ↗ Jira Board and ↗ IT Glue Doc removed from header (security)
- ⏳ **Auth layer not yet implemented** — talk to Robert about direction. See §9 for options.

---

## 12. Known Issues / Future Work

### Immediate (security)
- ✅ ↗ Jira Board and ↗ IT Glue Doc removed from header
- ⏳ Decide on auth strategy (talk to Robert) — see §9 options

### High
- Dark mode QA pass on mobile — some elements may not be perfect in dark + small screen combo
- `admin-input` min-width forces layout break on very small phones — needs more testing

### Medium
- Fuzzy/typo-tolerant search — current matching is exact substring + synonyms
- Routing table mobile: assign column shows `table-secondary` (Backup/CC) which can be long — consider truncating
- Import validation UX — just a toast on failure; a more descriptive inline error would be better

### Low / Nice to Have
- Keyboard navigation through search results
- Rule count badge on Full Routing List tab
- `@media print` stylesheet for printed reference
- Version check between localStorage and JSON (users with local overrides miss new rules)

---

## 13. Constraints — Never Break These

1. `[hidden] { display: none !important; }` — must stay in CSS
2. Clear button: `mousedown` + `e.preventDefault()` — not `click`
3. Table row-actions: `visibility: hidden/visible` — not `display: none/flex`
4. Process reminder on search tab is **static HTML**, not JS-rendered
5. `buildProcessReminder()` in JS is called by `renderList()` only — both copies are intentional
6. Ryan detection checks BOTH `assignTo` AND `warnings`
7. Dark mode uses explicit `body.dark` class toggle — not `prefers-color-scheme`
8. All inputs must be **≥16px** font-size — iOS Safari zooms on anything smaller
9. `.warn-bullets li` must use `position: relative/absolute` pattern — not `display: flex`
10. `col-notes`/`col-actions` display:none must use `.routing-table td.col-X` specificity

---

## 14. Quickstart for New Agent

```bash
# Navigate to project
cd /Users/amielterry40/Desktop/Coding/git/apps/jira-madness/hilco-ticket-router

# Read files in this order:
# 1. index.html   — structure
# 2. styles.css   — design system + responsive
# 3. app.js       — all logic
# 4. routing-data.json — the data

# Always work on dev branch
git checkout dev

# Deploy after changes:
aws s3 sync . s3://hilco-ticket-router --exclude ".git/*" --exclude "*.DS_Store"
aws cloudfront create-invalidation --distribution-id EPOWN92QGYXLJ --paths "/*"

# Push changes:
git add <files> && git commit -m "..." && git push
# (pushes to dev by default)

# Live URL: https://dop3itp44ubc6.cloudfront.net
```

---

*Last updated: May 6, 2026 — Claude Sonnet 4.6 / Desert IT Solutions*
