# AGENT_HANDOFF.md
## Jira Ticket Roulette 👻 — Full Context for Continuing Agent

> **Read this first.** This document captures the full picture of the project — what it is, why it exists, every decision made, the current state of the code, known issues, and what to do next. If you are a new agent or starting a new session, treat this as your source of truth before touching anything.

---

## 1. What This App Is

**Jira Ticket Roulette 👻** is a lightweight internal routing tool built by **Desert IT Solutions (DIT)** for managing inbound Jira tickets from the **Hilsinger / Hilco** client account. It is a static frontend-only web app (no backend, no framework, no build step) hosted on AWS S3 + CloudFront.

The tool helps DIT technicians quickly answer the question: *"Who handles this ticket?"* — either DIT works it directly, it gets assigned to a specific Hilco internal contact, it gets denied/cancelled, or it needs escalation.

**Live URL:** https://dop3itp44ubc6.cloudfront.net

**Jira Board:** https://hilcovision.atlassian.net/jira/servicedesk/projects/ISD/queues/custom/5

**IT Glue Routing Doc:** https://ditlv.itglue.com/3181677/docs/16762433#version=published&documentMode=view

---

## 2. The Mood / Intent

- **Fast and practical.** No fluff. Technicians are in the middle of ticket queues; this tool should answer the question in under 10 seconds.
- **Not overbuilt.** No React, no backend, no database. Static files only. Easy to edit, easy to redeploy.
- **Warning-forward.** Two hard rules must be impossible to miss:
  1. Ping **Ryan Creasia** internally before assigning any of his tickets.
  2. DIT does **not** have Hilco/Hilsinger M365 admin credentials — flag any ticket that requires tenant-level admin actions for escalation.
- **Process-enforcing.** There's an escalation flow that everyone must follow when routing tickets. The app displays it everywhere so no one skips steps.
- **Light mode default, dark mode available.** Clean GitHub-inspired aesthetic. Not a loud design.

---

## 3. File Structure

```
hilco-ticket-router/
├── index.html          # All markup — header, banners, tabs, modal, toast container
├── app.js              # All logic — search, render, admin CRUD, event wiring
├── styles.css          # All styles — light + dark mode, animations, responsive
├── routing-data.json   # Source of truth for routing rules (~89 rules)
└── AGENT_HANDOFF.md    # This file
```

**No package.json. No node_modules. No build pipeline.** Open `index.html` in a browser or serve via any static host. Deploy with `aws s3 sync`.

---

## 4. Infrastructure

| Thing | Detail |
|---|---|
| Hosting | AWS S3 static website, bucket: `hilco-ticket-router` |
| CDN | AWS CloudFront, Distribution ID: `EPOWN92QGYXLJ`, domain: `dop3itp44ubc6.cloudfront.net` |
| Deploy command | `aws s3 sync . s3://hilco-ticket-router --exclude ".git/*" --exclude "*.DS_Store"` |
| Invalidate cache | `aws cloudfront create-invalidation --distribution-id EPOWN92QGYXLJ --paths "/*"` |
| GitHub account | `amielterry26` (gh CLI authenticated) |

After any file change: **sync → invalidate → wait ~60 seconds → hard refresh** (`Cmd+Shift+R`).

---

## 5. Architecture Deep Dive

### Data Model

Each routing rule in `routing-data.json` has:
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

**Ryan Creasia detection:** A rule is flagged as "Ryan's ticket" if `assignTo` contains "ryan creasia" (case-insensitive) OR if `warnings` contains "ASK RYAN FIRST". These get a red badge and special card/row styling.

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

- `expandQuery(query)` — expands the user's search term using a synonym map (`SEARCH_SYNONYMS`). E.g., "email" expands to include "outlook, exchange, o365, office 365" etc.
- `scoreRule(rule, terms)` — scores each rule against expanded terms. Scoring weights:
  - Exact category match: 50 pts
  - Keyword match: 30 pts
  - Synonym match: 20 pts
  - Assignee match: 15 pts
  - Notes match: 10 pts
  - Action/warning match: 10 pts
  - Backup match: 8 pts
  - Participants: 8 pts
  - Link match: 5 pts
- Results are sorted by score, converted to a percentage, and only results with score > 0 are shown.
- Confidence badge: ≥70% = green "High", 40–69% = yellow "Medium", <40% = grey "Low"

### localStorage Usage
- `hilco_routing_data_v1` — stores user-edited routing rules (overrides the JSON file)
- `hilco_itg_link` — stores updated IT Glue URL if changed via admin panel
- `hilco_dark_mode` — `'1'` or `'0'` for dark mode preference

### Key JS Functions
| Function | What it does |
|---|---|
| `loadData()` | Fetches routing-data.json, falls back to localStorage, calls renderSearch + renderList |
| `switchTab(tab)` | Shows/hides tab panels, triggers renderList when switching to list tab |
| `toggleAdmin()` | Toggles #adminPanel visibility + gear btn .active class |
| `renderSearch()` | Shows idle state (chips) or search result cards |
| `renderList()` | Renders full routing table with process reminder above it |
| `buildCard(rule, pct, matched, isTop)` | Builds a search result card with badges, assignee, notes, keywords |
| `buildTableRow(rule)` | Builds a `<tr>` for the routing table |
| `buildProcessReminder()` | Builds the compact blue "① Escalate → ② Assign → ③ Note → ④ CW" bar |
| `buildEmptyState()` | No results state with links to Jira + IT Glue |
| `openEditModal(id)` / `openAddModal()` | Opens the edit/add modal |
| `saveRule()` | Validates and saves a rule to routingData + localStorage |
| `deleteRule(id)` | Confirms and deletes a rule |
| `exportJSON()` / `handleImport()` | Exports/imports routing rules as JSON |
| `showToast(msg, type)` | Displays a temporary bottom-right toast notification |
| `applyDark(on)` | Toggles `body.dark` class, updates icon, saves to localStorage |

### Critical Bug Fixes (don't undo these)
1. **`[hidden] { display: none !important; }`** — Must stay in CSS. Without it, `.results-meta { display: flex }` overrides the HTML `hidden` attribute and shows the results count ("19 results") in idle state.
2. **Clear button uses `mousedown` + `e.preventDefault()`** — Not `click`. The input blur fires before click, causing the clear button click to be missed. mousedown fires before blur, preventDefault stops the blur, then the clear logic runs.
3. **Table row edit/delete use `visibility: hidden/visible`** — Not `display: none/flex`. Using display caused layout shift (column width change on hover). visibility keeps the column width stable.

---

## 6. UI Structure (index.html layout order)

```
app-wrapper
├── app-header
│   ├── .home-btn (button wrapping h1 + subtitle — clicks → switchTab('search'))
│   └── .header-links
│       ├── ↗ Jira Board (resource-link primary)
│       ├── ↗ IT Glue Doc (resource-link itg-link)
│       ├── 🌙 darkToggle (gear-btn style)
│       └── ⚙ adminToggle (gear-btn)
├── .warning-banner (cream/gold, pulsing, expandable)
│   ├── ⚠ icon
│   ├── .warn-content (headline + 2 bullets: Ryan + no M365)
│   └── "More/Less" toggle button
├── .warning-banner-extra (hidden by default, expands with More)
├── .process-banner (blue, numbered steps 1–4, approvers list, example note)
├── .tab-nav
│   ├── [Search] tab-btn
│   └── [Full Routing List] tab-btn
├── #tab-search (tab-panel)
│   ├── .search-section (input + clear button)
│   ├── .process-reminder (always visible — static HTML, not rendered by JS)
│   ├── #searchIdle (chips + link to Full Routing List)
│   ├── #searchResultsMeta (hidden until search)
│   └── #searchContainer (hidden until search)
├── #tab-list (tab-panel, hidden)
│   ├── .filters-row (All / Assign / DIT Handles / Deny / Escalate / Ask Ryan First / Has IT Glue Ref / External Contact)
│   ├── .results-meta
│   └── #listContainer (process-reminder + routing table rendered by JS)
└── #adminPanel (hidden, toggled by gear)
    ├── IT Glue link config
    └── Add Rule / Export JSON / Import JSON
```

---

## 7. The Escalation Process Flow

This is burned into the app permanently and must never be removed. It's the core workflow:

**Full version (process-banner):**
1. **Escalate first.** Put the ticket in escalations and get approval before doing anything. Approvers: Taylor Wanamaker · Andrew Minear · John Tuley · Thomas Traver · Kyle
2. **Assign in Jira** once you have approval.
3. **Leave an internal note in the Jira ticket.** Write what you saw in IT Glue that made you route it, who you assigned it to, and your initials. Example: *"Item pricing - passing to Paula -KS"*
4. **Complete the ticket in ConnectWise.**

**Compact version (process-reminder bar, shown in both tabs):**
① Escalate & get approval → ② Assign in Jira → ③ Internal note + initials in Jira → ④ Complete in CW

---

## 8. Design System

### Colors (light mode)
- Background: `#f6f8fa` (base), `#ffffff` (surface/cards)
- Text: `#1f2328` (primary), `#656d76` (secondary), `#9198a1` (muted)
- Accent: `#0969da`
- Warning banner: `background: #fdfcf5`, `border: 1.5px solid #c9a84c` (muted gold), animated pulse
- Process banner: `background: #f0f7ff`, `border: 1.5px solid #93c5fd` (light blue)

### Colors (dark mode — `body.dark`)
- Background: `#0d1117` (base), `#161b22` (surface) — GitHub dark theme inspired
- All badge/banner colors are shifted to dark equivalents
- `applyDark(on)` toggles `body.dark` class

### Font Sizes (post-fix, 14px base)
- Body base: **14px**
- Title h1: **26px**
- Warning headline: **15px**
- Warning bullets: **13px**
- Process banner title: **14px**
- Process note / step body: **13px**
- Search input: **15px**
- Tab buttons: **13px**
- Card category: **15px**
- Assignee name: **14px**

### Animations
- **Ghost emoji** (`ghost-float`): floating + rotating on a 3.5s loop, applied to `.ghost-emoji` span wrapping the 👻 in the h1
- **Warning banner** (`banner-pulse`): subtle gold glow pulse on a 3.5s loop

---

## 9. Development History (what we built and why)

| Phase | What happened |
|---|---|
| Initial build | App created from scratch: search + routing table, JSON data, confidence scoring |
| UX pass | Renamed to "Jira Ticket Roulette 👻", ghost animation, 3-tab layout |
| Readability pass | Warning banner → grey → light yellow → soft cream. Font bump to 16px (115%). Fixed clear button (mousedown). Fixed edit/delete layout shift (visibility). Removed Reset Defaults. Removed Data Status. Moved admin to gear icon. |
| Warning content | Added Ryan Creasia ping rule + no M365 admin credentials note |
| Width pass | max-width bumped from 840px → 1040px to fill the screen better |
| Escalation flow | Added full Kyle-style process banner with numbered steps, approver list, and example note |
| Tab restructure | Went through several iterations (3 tabs → no tabs → 2 tabs). Final: Search tab + Full Routing List tab + gear for admin |
| Font rollback | User asked to go back to 100% zoom from 115%. Used sed which caused chaining damage (16→14→13→12px). Body fixed to 14px. Other elements manually repaired with Edit tool. |
| Process reminder | Added static process-reminder bar to search tab HTML so it's always visible (not just when results show) |
| Header + dark mode | Title made clickable (home button → switchTab search). Title bumped to 26px. Dark mode toggle (🌙/☀️) added. Full dark mode CSS with GitHub dark palette. Preference saved to localStorage. |

---

## 10. Where We Stopped / Current State

**The app is fully functional and deployed.** Last deploy was May 5, 2026.

What was just completed in the last session:
- ✅ Process reminder bar added to search tab (always visible)
- ✅ Title made clickable (back to home/search)
- ✅ Title size increased to 26px
- ✅ Dark mode toggle (🌙 ↔ ☀️) with full dark palette
- ✅ Font sizes repaired after sed chaining disaster
- ✅ All changes deployed to CloudFront

---

## 11. Known Issues / Future Fixes

### High Priority
- **Font size consistency audit** — The sed chaining disaster may have left some elements at unexpected sizes. A full pass comparing all font-size declarations against the intended design scale would be worthwhile. Specifically check: `.admin-panel-header`, `.modal-title`, `.process-steps li::before`, and any form labels.
- **Dark mode fine-tuning** — The dark mode variable swap is solid but some specific elements (e.g., `.warn-toggle` button, `.chip` hover states, modal overlay tint) may not be perfectly polished in dark mode. A visual QA pass in dark mode is recommended.

### Medium Priority
- **Mobile responsiveness** — The routing table hides the Notes column on mobile (`@media max-width: 640px { .col-notes { display: none } }`), but the overall table may still be cramped on phones. No mobile testing has been done.
- **Search input placeholder contrast** — On dark mode, `::placeholder` color may inherit from light mode variables. Verify it's readable.
- **Import validation UX** — The import JSON validation (`validateImport`) checks for required fields but the error message is just a toast. Consider a more descriptive modal error for bad imports.

### Low Priority / Nice to Have
- **Keyboard navigation** — Only `/` shortcut exists. Could add arrow key navigation through search results, Enter to expand a card, etc.
- **Fuzzy search** — Current search is term-expansion + substring. A fuzzy match (e.g., Fuse.js) would handle typos. Keep it lightweight if added.
- **Print/export view** — Some technicians may want a printed reference. A `@media print` stylesheet or PDF export of the routing table could be useful.
- **Rule count badge on tabs** — Show the number of rules in the "Full Routing List" tab label so techs know how many rules exist at a glance.
- **Collapsible categories in routing table** — If the rule count grows, grouping by actionType with collapsible sections would improve scannability.
- **Sync routing-data.json with localStorage** — Currently if the source JSON is updated and redeployed, users with localStorage overrides won't see the new rules. Add a "Reset to latest" button or version check.

---

## 12. Key Constraints / Things To Never Break

1. **`[hidden] { display: none !important; }`** — Do not remove. Prevents ghost result count in idle state.
2. **Clear button must use `mousedown` + `e.preventDefault()`** — Do not switch back to `click`.
3. **Table row-actions must use `visibility: hidden/visible`** — Do not switch to `display: none/flex` (causes layout shift).
4. **Process reminder bar in search tab is static HTML** — Do not move it into `renderSearch()` JS (it would disappear in idle state).
5. **`buildProcessReminder()`** is still called by `renderList()` in JS — both copies (static HTML for search, dynamic JS for list) are intentional and correct.
6. **Ryan Creasia warning logic** — Two-pronged: checks `assignTo` AND `warnings` for Ryan detection. Both conditions must be checked.
7. **Dark mode is toggled via `body.dark` class** — All dark overrides are scoped to `body.dark {...}` in CSS. Never use `prefers-color-scheme` media query — the toggle is manual/explicit.

---

## 13. Permissions for the Continuing Agent

- You are authorized to do a full logic and code quality pass if you see issues.
- You are authorized to ask the user questions before making changes — especially for anything that affects the routing data or the escalation flow copy, since those are based on real internal policies.
- Do not change the escalation flow steps or the approvers list without confirming with the user first.
- Do not remove any of the warning banner content — it's there for compliance/process reasons.
- Deployments should always be: `aws s3 sync` → `aws cloudfront create-invalidation --distribution-id EPOWN92QGYXLJ --paths "/*"`.
- The GitHub account is `amielterry26` and gh CLI is authenticated.

---

## 14. Quickstart for New Agent

```bash
# Navigate to project
cd /Users/amielterry40/Desktop/Coding/git/apps/jira-madness/hilco-ticket-router

# Read the four main files in this order:
# 1. index.html  — understand the structure
# 2. styles.css  — understand the design system
# 3. app.js      — understand the logic
# 4. routing-data.json — understand the data

# Deploy after any change:
aws s3 sync . s3://hilco-ticket-router --exclude ".git/*" --exclude "*.DS_Store"
aws cloudfront create-invalidation --distribution-id EPOWN92QGYXLJ --paths "/*"

# Live URL:
# https://dop3itp44ubc6.cloudfront.net
```

---

*Document written May 5, 2026 by Claude (Sonnet 4.6) at the end of the build session with Amiel Terry / Desert IT Solutions.*
