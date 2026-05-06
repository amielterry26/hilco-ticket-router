// ============================================================
// Jira Ticket Roulette — app.js
// Desert IT Solutions | Internal Tool
// ============================================================

// ------------------------------
// Constants & Config
// ------------------------------
const STORAGE_KEY     = 'hilco_routing_data_v1';
const ITG_LINK_KEY    = 'hilco_itg_link';
const DATA_FILE       = 'routing-data.json';

const JIRA_URL        = 'https://hilcovision.atlassian.net/jira/servicedesk/projects/ISD/queues/custom/5';
const DEFAULT_ITG_URL = 'https://ditlv.itglue.com/3181677/docs/16762433#version=published&documentMode=view';

// Keyword synonym map
const SEARCH_SYNONYMS = {
  'aws':            ['amazon', 'amazon web services', 'cloud', 'ec2', 's3', 'iam', 'cloudfront'],
  'email':          ['outlook', 'exchange', 'o365', 'office 365', 'microsoft 365', 'mailbox'],
  'm365':           ['o365', 'office 365', 'microsoft 365', 'outlook', 'exchange'],
  'o365':           ['m365', 'office 365', 'microsoft 365', 'outlook', 'exchange'],
  'm3':             ['infor', 'mingle', 'load sheets', 'uploads', 'pricing', 'date format', 'customer orders'],
  'customer orders':['orders', 'customer login', 'hilco website', 'ctrs', 'cst'],
  'powerbi':        ['power bi', 'report', 'reports', 'reporting', 'dashboard'],
  'birst':          ['report', 'reports', 'reporting', 'dashboard'],
  'softeon':        ['wms', 'warehouse', 'barcode', 'support account'],
  'hardware':       ['laptop', 'battery', 'desktop', 'device', 'equipment'],
  'vpn':            ['mansfield', 'remote access'],
  'cybersecurity':  ['knowbe4', 'training', 'carbon black', 'security'],
  'printer':        ['print', 'print server', 'lasec01', 'ip address'],
  'phone':          ['office phone', 'voice', 'google voice', 'attendance'],
  'dns':            ['external dns', 'domain'],
  'password':       ['reset', 'login', 'sign in', 'credentials'],
  'edi':            ['sps', 'sps commerce', 'electronic data interchange'],
  'sap':            ['m&s', 'mstech', 'lendon wilson'],
  'teams':          ['microsoft teams', 'forwarded', 'tom rammel'],
  'ryan':           ['ryan creasia', 'creasia'],
};

// Confidence scoring weights
const SCORE = {
  EXACT_CATEGORY: 50,
  KEYWORD_MATCH:  30,
  SYNONYM_MATCH:  20,
  ASSIGNEE_MATCH: 15,
  BACKUP_MATCH:    8,
  PARTICIPANTS:    8,
  NOTES_MATCH:    10,
  ACTION_MATCH:   10,
  WARNING_MATCH:  10,
  LINK_MATCH:      5,
};

// ActionType → badge label
const ACTION_LABELS = {
  assign:    'ASSIGN',
  dit:       'DIT HANDLES',
  deny:      'DENY / CANCEL',
  escalate:  'ESCALATE',
  external:  'EXTERNAL CONTACT',
  reference: 'REFERENCE ITG DOC',
  ask:       'ASK / CONFIRM FIRST',
};

// ActionType → CSS class suffix
const ACTION_CLASS = {
  assign:    'assign',
  dit:       'dit',
  deny:      'deny',
  escalate:  'escalate',
  external:  'external',
  reference: 'reference',
  ask:       'ask',
};

// ------------------------------
// Global State
// ------------------------------
let defaultData   = [];
let routingData   = [];
let usingLocal    = false;
let currentTab    = 'search';
let currentFilter = 'all';
let currentQuery  = '';
let editingId     = null;

// ------------------------------
// Data Loading
// ------------------------------

async function loadData() {
  try {
    const res = await fetch(DATA_FILE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    defaultData = await res.json();
  } catch (err) {
    console.error('Failed to load routing-data.json:', err);
    showToast('Failed to load routing data.', 'error');
    defaultData = [];
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      routingData = JSON.parse(saved);
      usingLocal  = true;
    } catch {
      routingData = defaultData;
      usingLocal  = false;
    }
  } else {
    routingData = defaultData;
    usingLocal  = false;
  }

  renderSearch();
  renderList();
}

function saveToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routingData));
  usingLocal = true;
}

// ------------------------------
// Tab Switching
// ------------------------------

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
  if (tab === 'list') renderList();
}

// ------------------------------
// Admin Panel Toggle
// ------------------------------

function toggleAdmin() {
  const panel = document.getElementById('adminPanel');
  const btn   = document.getElementById('adminToggle');
  const isOpen = !panel.hidden;
  panel.hidden = isOpen;
  btn.classList.toggle('active', !isOpen);
}

// ------------------------------
// Search / Matching
// ------------------------------

function expandQuery(query) {
  const base  = query.toLowerCase().trim();
  const terms = new Set([base]);

  base.split(/\s+/).forEach(w => terms.add(w));

  for (const [key, syns] of Object.entries(SEARCH_SYNONYMS)) {
    if (base.includes(key) || key.includes(base)) {
      syns.forEach(s => terms.add(s));
    }
    syns.forEach(s => {
      if (base.includes(s)) {
        terms.add(key);
        syns.forEach(s2 => terms.add(s2));
      }
    });
  }

  return [...terms].filter(t => t.length > 1);
}

function scoreRule(rule, terms) {
  let score = 0;
  const matched = new Set();
  const cat   = rule.category.toLowerCase();
  const notes = (rule.notes || '').toLowerCase();
  const action= (rule.actionType || '').toLowerCase();
  const assign= (rule.assignTo || '').toLowerCase();
  const backup= (rule.backup || '').toLowerCase();
  const warns = (rule.warnings || []).map(w => w.toLowerCase());
  const links = (rule.links || []).map(l => l.toLowerCase());
  const parts = (rule.participants || []).map(p => p.toLowerCase());
  const kws   = (rule.keywords || []).map(k => k.toLowerCase());

  for (const term of terms) {
    const t = term.toLowerCase();
    if (cat === t || cat.includes(t))                                        { score += SCORE.EXACT_CATEGORY; matched.add(t); }
    if (kws.some(k => k === t || k.includes(t) || t.includes(k)))           { score += SCORE.KEYWORD_MATCH;  matched.add(t); }
    if (assign && (assign.includes(t) || t.includes(assign.split(' ')[0]))) { score += SCORE.ASSIGNEE_MATCH; matched.add(t); }
    if (backup && backup.includes(t))                                        { score += SCORE.BACKUP_MATCH;   matched.add(t); }
    if (parts.some(p => p.includes(t)))                                      { score += SCORE.PARTICIPANTS;   matched.add(t); }
    if (notes.includes(t))                                                   { score += SCORE.NOTES_MATCH;    matched.add(t); }
    if (action.includes(t))                                                  { score += SCORE.ACTION_MATCH;   matched.add(t); }
    if (warns.some(w => w.includes(t)))                                      { score += SCORE.WARNING_MATCH;  matched.add(t); }
    if (links.some(l => l.includes(t)))                                      { score += SCORE.LINK_MATCH;     matched.add(t); }
  }

  return { score, matchedKeywords: [...matched] };
}

function searchRules(query) {
  const q     = query.trim().toLowerCase();
  const terms = q ? expandQuery(q) : [];

  let results = routingData.map(rule => {
    const { score, matchedKeywords } = q
      ? scoreRule(rule, terms)
      : { score: 1, matchedKeywords: [] };
    return { rule, score, matchedKeywords };
  });

  if (q) results = results.filter(r => r.score > 0);
  results.sort((a, b) => b.score - a.score);

  const maxScore = results.length > 0 ? results[0].score : 1;
  return results.map(r => ({
    ...r,
    pct: Math.min(100, Math.round((r.score / maxScore) * 100)),
  }));
}

function applyFilter(results, filter) {
  if (filter === 'all') return results;
  return results.filter(({ rule }) => {
    const warns = (rule.warnings || []).map(w => w.toUpperCase());
    switch (filter) {
      case 'assign':   return rule.actionType === 'assign';
      case 'dit':      return rule.actionType === 'dit';
      case 'deny':     return rule.actionType === 'deny';
      case 'escalate': return rule.actionType === 'escalate';
      case 'external': return rule.actionType === 'external';
      case 'ryan':
        return (rule.assignTo || '').toLowerCase().includes('ryan creasia')
            || warns.some(w => w.includes('ASK RYAN'));
      case 'itg':
        return (rule.links || []).some(l => l.includes('itglue.com'))
            || warns.some(w => w.includes('REFERENCE ITG'));
      default:
        return true;
    }
  });
}

// ------------------------------
// Render — Search Tab
// ------------------------------

function renderSearch() {
  const idle      = document.getElementById('searchIdle');
  const metaEl    = document.getElementById('searchResultsMeta');
  const container = document.getElementById('searchContainer');
  const countEl   = document.getElementById('searchResultCount');
  if (!container) return;

  const q = currentQuery.trim();

  if (!q) {
    idle.hidden      = false;
    metaEl.hidden    = true;
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  idle.hidden      = true;
  metaEl.hidden    = false;
  container.hidden = false;

  const results = searchRules(currentQuery);

  if (countEl) {
    countEl.textContent = results.length === 0
      ? 'No results'
      : `${results.length} result${results.length !== 1 ? 's' : ''}`;
  }

  if (results.length === 0) {
    container.innerHTML = buildEmptyState();
    return;
  }

  container.innerHTML =
    results.map((r, idx) =>
      buildCard(r.rule, r.pct, r.matchedKeywords, idx === 0)
    ).join('');
}

// ------------------------------
// Render — Full Routing List Tab
// ------------------------------

function renderList() {
  const container = document.getElementById('listContainer');
  const countEl   = document.getElementById('listResultCount');
  if (!container) return;

  let results = routingData.map(rule => ({ rule, score: 1, matchedKeywords: [], pct: 100 }));
  results = applyFilter(results, currentFilter);

  if (countEl) {
    countEl.textContent = `${results.length} rule${results.length !== 1 ? 's' : ''}`;
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No rules match this filter.</h3></div>';
    return;
  }

  const rows = results.map(r => buildTableRow(r.rule)).join('');
  container.innerHTML = buildProcessReminder() + `
    <table class="routing-table">
      <thead>
        <tr>
          <th class="col-category">Category</th>
          <th class="col-action">Action</th>
          <th class="col-assign">Assign To</th>
          <th class="col-notes">Notes</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ------------------------------
// Table Row Builder (browse mode)
// ------------------------------

function buildTableRow(rule) {
  const isRyan = (rule.assignTo || '').toLowerCase().includes('ryan creasia')
              || (rule.warnings || []).some(w => w.toUpperCase().includes('ASK RYAN'));
  const isDeny = rule.actionType === 'deny';

  const rowClass = [
    isRyan ? 'row-ryan' : '',
    isDeny ? 'row-deny' : '',
  ].filter(Boolean).join(' ');

  const actionLabel = ACTION_LABELS[rule.actionType] || rule.actionType.toUpperCase();
  const actionClass = ACTION_CLASS[rule.actionType]  || 'ask';

  let assignHtml = '';
  if (rule.assignTo) {
    assignHtml += `<span class="${isRyan ? 'assignee-name ryan' : 'assignee-name'}">${esc(rule.assignTo)}</span>`;
  } else if (isDeny) {
    assignHtml += `<span style="color:var(--deny-text)">Cancel / Won't Do</span>`;
  }
  if (rule.backup)
    assignHtml += `<br><span class="table-secondary">Backup: ${esc(rule.backup)}</span>`;
  if (rule.participants && rule.participants.length)
    assignHtml += `<br><span class="table-secondary">CC: ${rule.participants.map(esc).join(', ')}</span>`;
  if (isRyan)
    assignHtml += `<br><span class="badge badge-ryan" style="margin-top:4px;display:inline-block">⚠ CONFIRM WITH RYAN FIRST</span>`;

  let notesHtml = rule.notes ? esc(rule.notes) : '';
  if (rule.links && rule.links.length) {
    const linkList = rule.links.map(l => {
      const display = l.startsWith('mailto:') ? l.replace('mailto:', '') : l.length > 40 ? l.substring(0, 37) + '…' : l;
      return `<a class="table-link" href="${esc(l)}" target="_blank" rel="noopener">${esc(display)}</a>`;
    }).join('');
    notesHtml += (notesHtml ? '<br>' : '') + linkList;
  }

  return `
  <tr class="${rowClass}" data-id="${esc(rule.id)}">
    <td class="col-category">${esc(rule.category)}</td>
    <td class="col-action"><span class="badge badge-${actionClass}">${esc(actionLabel)}</span></td>
    <td class="col-assign">${assignHtml}</td>
    <td class="col-notes">${notesHtml}</td>
    <td class="col-actions">
      <div class="row-actions">
        <button class="row-action-btn" onclick="openEditModal('${esc(rule.id)}')">Edit</button>
        <button class="row-action-btn delete" onclick="deleteRule('${esc(rule.id)}')">Del</button>
      </div>
    </td>
  </tr>`;
}

// ------------------------------
// Card Builder (search results)
// ------------------------------

function buildCard(rule, pct, matchedKeywords, isTopMatch) {
  const isRyan = (rule.assignTo || '').toLowerCase().includes('ryan creasia')
              || (rule.warnings || []).some(w => w.toUpperCase().includes('ASK RYAN'));
  const isDeny = rule.actionType === 'deny';
  const hasQuery = currentQuery.trim().length > 0;

  const cardClass = ['card',
    isRyan ? 'ryan-card' : '',
    isDeny ? 'deny-card' : '',
  ].filter(Boolean).join(' ');

  const actionLabel = ACTION_LABELS[rule.actionType] || rule.actionType.toUpperCase();
  const actionClass = ACTION_CLASS[rule.actionType]  || 'ask';
  const primaryBadge = `<span class="badge badge-${actionClass}">${esc(actionLabel)}</span>`;

  const ryanBadge = isRyan
    ? `<span class="badge badge-ryan">⚠ CONFIRM WITH RYAN FIRST</span>`
    : '';

  const extraWarnings = (rule.warnings || [])
    .filter(w => !w.toUpperCase().includes('ASK RYAN'))
    .map(w => `<span class="badge badge-warn">${esc(w)}</span>`)
    .join('');

  let assigneeRow = '';
  if (rule.assignTo) {
    const nameClass = isRyan ? 'assignee-name ryan' : 'assignee-name';
    assigneeRow += `<span class="assignee-label">→</span>
      <span class="${nameClass}">${esc(rule.assignTo)}</span>`;
  } else if (isDeny) {
    assigneeRow += `<span class="assignee-name" style="color:var(--deny-text)">Cancel / Won't Do</span>`;
  }
  if (rule.backup)
    assigneeRow += `<span class="backup-text">· Backup: ${esc(rule.backup)}</span>`;
  if (rule.participants && rule.participants.length)
    assigneeRow += `<span class="participants-text">· CC: ${rule.participants.map(esc).join(', ')}</span>`;

  let linksHtml = '';
  if (rule.links && rule.links.length) {
    linksHtml = `<div class="card-links">` +
      rule.links.map(l => {
        const display = l.startsWith('mailto:')
          ? l.replace('mailto:', '')
          : l.length > 55 ? l.substring(0, 52) + '…' : l;
        return `<a class="card-link-btn" href="${esc(l)}" target="_blank" rel="noopener">${esc(display)}</a>`;
      }).join('') + `</div>`;
  }

  let keywordHtml = '';
  if (rule.keywords && rule.keywords.length) {
    keywordHtml = rule.keywords.slice(0, 8).map(k => {
      const isMatched = hasQuery && matchedKeywords.some(m =>
        m.includes(k.toLowerCase()) || k.toLowerCase().includes(m)
      );
      return `<span class="keyword-tag ${isMatched ? 'matched' : ''}">${esc(k)}</span>`;
    }).join('');
  }

  let confBadge = '';
  if (hasQuery) {
    const level = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
    const label = isTopMatch ? `Top · ${pct}%` : `${pct}%`;
    confBadge = `<span class="confidence-badge confidence-${level}">${label}</span>`;
  }

  return `
  <div class="${cardClass}" data-id="${esc(rule.id)}">
    <div class="card-actions">
      <button class="card-action-btn" onclick="openEditModal('${esc(rule.id)}')">Edit</button>
      <button class="card-action-btn delete" onclick="deleteRule('${esc(rule.id)}')">Delete</button>
    </div>

    <div class="card-header">
      <div class="card-category">${esc(rule.category)}</div>
      <div class="card-badges">
        ${primaryBadge}
        ${ryanBadge}
        ${extraWarnings}
      </div>
    </div>

    ${assigneeRow ? `<div class="card-assignee-row">${assigneeRow}</div>` : ''}
    ${rule.notes  ? `<div class="card-notes">${esc(rule.notes)}</div>` : ''}
    ${linksHtml}

    <div class="card-footer">
      <div class="card-keywords">${keywordHtml}</div>
      ${confBadge}
    </div>
  </div>`;
}

/**
 * Compact process reminder shown above search results and routing table.
 */
function buildProcessReminder() {
  return `
  <div class="process-reminder">
    <span class="pr-step"><span class="pr-num">1</span> Escalate &amp; get approval</span>
    <span class="pr-arrow">→</span>
    <span class="pr-step"><span class="pr-num">2</span> Assign in Jira</span>
    <span class="pr-arrow">→</span>
    <span class="pr-step"><span class="pr-num">3</span> Internal note + initials in Jira</span>
    <span class="pr-arrow">→</span>
    <span class="pr-step"><span class="pr-num">4</span> Complete in CW</span>
  </div>`;
}

function buildEmptyState() {
  const itgUrl = localStorage.getItem(ITG_LINK_KEY) || DEFAULT_ITG_URL;
  return `
  <div class="empty-state">
    <h3>No routing match found.</h3>
    <p>• Check the IT Glue routing document.</p>
    <p>• Ask escalations.</p>
    <p>• If Ryan may own it, ping him internally before assigning.</p>
    <div class="empty-links">
      <a class="resource-link primary" href="${JIRA_URL}" target="_blank" rel="noopener">Open Jira Board</a>
      <a class="resource-link" href="${itgUrl}" target="_blank" rel="noopener">IT Glue Routing Doc</a>
    </div>
  </div>`;
}

// ------------------------------
// Filters
// ------------------------------

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });
}

// ------------------------------
// Edit / Add / Delete
// ------------------------------

function openEditModal(id) {
  const rule = routingData.find(r => r.id === id);
  if (!rule) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = 'Edit Routing Rule';
  populateForm(rule);
  document.getElementById('editModal').classList.add('open');
}

function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add New Routing Rule';
  clearForm();
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
  editingId = null;
}

function populateForm(rule) {
  document.getElementById('fCategory').value     = rule.category      || '';
  document.getElementById('fActionType').value   = rule.actionType    || 'assign';
  document.getElementById('fAssignTo').value     = rule.assignTo      || '';
  document.getElementById('fBackup').value       = rule.backup        || '';
  document.getElementById('fParticipants').value = (rule.participants || []).join(', ');
  document.getElementById('fKeywords').value     = (rule.keywords     || []).join(', ');
  document.getElementById('fNotes').value        = rule.notes         || '';
  document.getElementById('fWarnings').value     = (rule.warnings     || []).join(', ');
  document.getElementById('fLinks').value        = (rule.links        || []).join(', ');
  document.getElementById('fSource').value       = rule.source        || 'Hilco routing chart';
}

function clearForm() {
  ['fCategory','fAssignTo','fBackup','fParticipants','fKeywords',
   'fNotes','fWarnings','fLinks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fActionType').value = 'assign';
  document.getElementById('fSource').value     = 'Hilco routing chart';
}

function saveRule() {
  const category = document.getElementById('fCategory').value.trim();
  if (!category) { showToast('Category is required.', 'error'); return; }

  const rule = {
    id:           editingId || slugify(category),
    category,
    actionType:   document.getElementById('fActionType').value,
    assignTo:     document.getElementById('fAssignTo').value.trim(),
    backup:       document.getElementById('fBackup').value.trim(),
    participants: splitCSV(document.getElementById('fParticipants').value),
    keywords:     splitCSV(document.getElementById('fKeywords').value),
    notes:        document.getElementById('fNotes').value.trim(),
    warnings:     splitCSV(document.getElementById('fWarnings').value),
    links:        splitCSV(document.getElementById('fLinks').value),
    source:       document.getElementById('fSource').value.trim() || 'Hilco routing chart',
  };

  if (editingId) {
    const idx = routingData.findIndex(r => r.id === editingId);
    if (idx !== -1) routingData[idx] = rule;
    showToast('Rule updated.', 'success');
  } else {
    if (routingData.some(r => r.id === rule.id)) rule.id += '-' + Date.now();
    routingData.push(rule);
    showToast('Rule added.', 'success');
  }

  saveToLocalStorage();
  closeModal();
  renderSearch();
  renderList();
}

function deleteRule(id) {
  const rule = routingData.find(r => r.id === id);
  if (!rule) return;
  if (!confirm(`Delete "${rule.category}"? This cannot be undone.`)) return;

  routingData = routingData.filter(r => r.id !== id);
  saveToLocalStorage();
  showToast('Rule deleted.', 'info');
  renderSearch();
  renderList();
}

// ------------------------------
// Import / Export
// ------------------------------

function exportJSON() {
  const blob = new Blob([JSON.stringify(routingData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'hilco-routing-data-updated.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported hilco-routing-data-updated.json', 'success');
}

function triggerImport() {
  document.getElementById('importFileInput').click();
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      validateImport(parsed);
      routingData = parsed;
      saveToLocalStorage();
      showToast(`Imported ${parsed.length} rules.`, 'success');
      renderSearch();
      renderList();
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function validateImport(data) {
  if (!Array.isArray(data)) throw new Error('Must be a JSON array.');
  const required = ['id', 'category', 'actionType', 'keywords', 'notes'];
  for (const [i, rule] of data.entries()) {
    for (const field of required) {
      if (!(field in rule))
        throw new Error(`Rule at index ${i} is missing required field: "${field}".`);
    }
  }
}

// ------------------------------
// IT Glue Link Config
// ------------------------------

function saveItgLink() {
  const input = document.getElementById('itgLinkInput');
  if (!input) return;
  const url = input.value.trim();
  if (url) {
    localStorage.setItem(ITG_LINK_KEY, url);
    document.querySelectorAll('.itg-link').forEach(el => { el.href = url; });
    showToast('IT Glue link saved.', 'success');
  }
}

function initItgLink() {
  const saved = localStorage.getItem(ITG_LINK_KEY) || DEFAULT_ITG_URL;
  const input = document.getElementById('itgLinkInput');
  if (input) input.value = saved;
  document.querySelectorAll('.itg-link').forEach(el => { el.href = saved; });
}

// ------------------------------
// Utilities
// ------------------------------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function splitCSV(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className   = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity    = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ------------------------------
// Event Wiring & Init
// ------------------------------

document.addEventListener('DOMContentLoaded', () => {

  // ── Tab switching ──────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Home button (title → back to search tab) ───────────────
  document.getElementById('homeBtn').addEventListener('click', () => {
    switchTab('search');
    document.getElementById('searchInput').focus();
  });

  // ── Dark mode toggle ───────────────────────────────────────
  const darkToggle = document.getElementById('darkToggle');
  const applyDark  = (on) => {
    document.body.classList.toggle('dark', on);
    darkToggle.textContent = on ? '☀️' : '🌙';
    localStorage.setItem('hilco_dark_mode', on ? '1' : '0');
  };
  applyDark(localStorage.getItem('hilco_dark_mode') === '1');
  darkToggle.addEventListener('click', () => applyDark(!document.body.classList.contains('dark')));

  // ── Admin gear toggle ──────────────────────────────────────
  document.getElementById('adminToggle').addEventListener('click', toggleAdmin);

  // ── Warning banner toggle ─────────────────────────────────
  const warnToggle = document.getElementById('warnToggle');
  const warnExtra  = document.getElementById('warnExtra');
  warnToggle.addEventListener('click', () => {
    const expanded = !warnExtra.hidden;
    warnExtra.hidden        = expanded;
    warnToggle.textContent  = expanded ? 'More' : 'Less';
    warnToggle.setAttribute('aria-expanded', String(!expanded));
  });

  // ── Search input ──────────────────────────────────────────
  const searchInput = document.getElementById('searchInput');
  const clearBtn    = document.getElementById('searchClear');

  searchInput.addEventListener('input', () => {
    currentQuery = searchInput.value;
    clearBtn.classList.toggle('visible', currentQuery.length > 0);
    renderSearch();
  });

  // mousedown + preventDefault keeps focus in the input so the click registers reliably
  clearBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    searchInput.value = '';
    currentQuery      = '';
    clearBtn.classList.remove('visible');
    searchInput.focus();
    renderSearch();
  });

  // ── Example chips ─────────────────────────────────────────
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.query;
      searchInput.value = q;
      currentQuery      = q;
      clearBtn.classList.add('visible');
      searchInput.focus();
      renderSearch();
    });
  });

  // ── "Full Routing List" link in idle hint ─────────────────
  document.querySelectorAll('.link-btn[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goto));
  });

  // ── Filter buttons ─────────────────────────────────────────
  initFilters();

  // ── Admin panel buttons ───────────────────────────────────
  document.getElementById('btnAdd').addEventListener('click', openAddModal);
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  document.getElementById('btnImport').addEventListener('click', triggerImport);
  document.getElementById('importFileInput').addEventListener('change', handleImport);
  document.getElementById('itgSaveBtn').addEventListener('click', saveItgLink);

  // ── Modal ──────────────────────────────────────────────────
  document.getElementById('modalSave').addEventListener('click', saveRule);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalCloseX').addEventListener('click', closeModal);
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editModal')) closeModal();
  });

  // ── Keyboard shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      switchTab('search');
      searchInput.focus();
    }
  });

  // ── Init ───────────────────────────────────────────────────
  initItgLink();
  loadData();
});

// Expose for inline onclick handlers on dynamically rendered cards/rows
window.openEditModal = openEditModal;
window.deleteRule    = deleteRule;
