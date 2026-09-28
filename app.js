(() => {
  'use strict';

  const STORAGE_KEY = 'crm-boards-v1';
  const STATUS_PALETTE = ['#00c875', '#fdab3d', '#df2f4a', '#579bfc', '#a25ddc', '#ff642e', '#0086c0', '#ff5ac4', '#9d99b9', '#037f4c'];
  const GROUP_PALETTE = ['#579bfc', '#00c875', '#a25ddc', '#fdab3d', '#df2f4a', '#0086c0', '#ff5ac4', '#037f4c'];
  const AVATAR_PALETTE = ['#e2445c', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#0086c0', '#ff642e', '#037f4c', '#bb3354'];
  const TYPE_WIDTH = { text: '170px', status: '150px', person: '90px', date: '150px', number: '130px', phone: '160px', email: '220px' };
  const NO_STATUS = '#c4c4c4';

  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = () => isoDate(new Date());
  const numberFmt = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });

  // ---------- State ----------

  let state = load() || seed();
  const ui = { search: '', person: '', drawerItemId: null, dragItemId: null, popoverPick: null };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.boards) ? parsed : null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable (private mode); the app still works for this session.
    }
  }

  function board() {
    return state.boards.find((b) => b.id === state.activeBoardId) || state.boards[0] || null;
  }

  function findItem(itemId) {
    for (const b of state.boards) {
      for (const g of b.groups) {
        const index = g.items.findIndex((i) => i.id === itemId);
        if (index !== -1) return { board: b, group: g, item: g.items[index], index };
      }
    }
    return null;
  }

  function allPeople() {
    const names = new Set(state.people || []);
    for (const b of state.boards) {
      const personCols = b.columns.filter((c) => c.type === 'person').map((c) => c.id);
      for (const g of b.groups) for (const i of g.items) for (const c of personCols) if (i.values[c]) names.add(i.values[c]);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function makeColumn(title, type, extra = {}) {
    return { id: uid(), title, type, ...extra };
  }

  function makeOptions(pairs) {
    return pairs.map(([label, color], i) => ({ label, color: color || STATUS_PALETTE[i % STATUS_PALETTE.length] }));
  }

  function makeItem(name, values = {}) {
    return { id: uid(), name, values, updates: [], createdAt: new Date().toISOString() };
  }

  // ---------- Sample data ----------

  function seed() {
    const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return isoDate(t); };
    const build = (cols, rows) => rows.map(([name, ...vals]) => makeItem(name, Object.fromEntries(cols.map((c, i) => [c.id, vals[i] ?? '']))));
    const note = (item, text, daysAgo, author) => {
      const t = new Date(); t.setDate(t.getDate() - daysAgo);
      item.updates.push({ id: uid(), text, author, at: t.toISOString() });
      return item;
    };

    const leadCols = [
      makeColumn('Agent', 'person'),
      makeColumn('Status', 'status', { options: makeOptions([['New lead', '#579bfc'], ['Contacted', '#fdab3d'], ['Inspecting', '#a25ddc'], ['Offer made', '#ff642e'], ['Purchased', '#00c875'], ['Lost', '#df2f4a']]) }),
      makeColumn('Budget', 'number', { currency: true }),
      makeColumn('Suburbs', 'text'),
      makeColumn('Phone', 'phone'),
      makeColumn('Email', 'email'),
      makeColumn('Next follow-up', 'date', { deadline: true }),
      makeColumn('Source', 'status', { options: makeOptions([['Portal', '#0086c0'], ['Open home', '#a25ddc'], ['Referral', '#00c875'], ['Website', '#579bfc'], ['Walk-in', '#9d99b9']]) }),
    ];
    const hot = build(leadCols, [
      ['Priya & Dev Sharma', 'Alex Morgan', 'Inspecting', 1250000, 'Epping, Carlingford', '0400 000 101', 'sharma.family@example.com', d(1), 'Portal'],
      ['Tom Nguyen', 'Sam Taylor', 'Offer made', 890000, 'Parramatta', '0400 000 102', 'tom.nguyen@example.com', d(0), 'Open home'],
      ['Grace Whitfield', 'Jordan Lee', 'Contacted', 1600000, 'Castle Hill', '0400 000 103', 'grace.w@example.com', d(-2), 'Referral'],
    ]);
    note(hot[0], 'Loved the 4-bed in Epping. Wants a second inspection with parents on Saturday.', 1, 'Alex Morgan');
    note(hot[1], 'Offer of $870k submitted. Vendor considering, expect answer tomorrow.', 0, 'Sam Taylor');

    const leadBoard = {
      id: uid(),
      name: 'Buyer Leads',
      columns: leadCols,
      groups: [
        { id: uid(), name: 'Hot leads', color: '#df2f4a', collapsed: false, items: hot },
        { id: uid(), name: 'Nurture', color: '#579bfc', collapsed: false, items: build(leadCols, [
          ["Liam O'Connor", 'Alex Morgan', 'New lead', 750000, 'Westmead', '0400 000 104', 'liam.oc@example.com', d(3), 'Website'],
          ['Mei Chen', 'Sam Taylor', 'Contacted', 1100000, 'Eastwood', '0400 000 105', 'mei.chen@example.com', d(7), 'Portal'],
          ['Oliver & Ruby Hart', 'Jordan Lee', 'New lead', 950000, 'Baulkham Hills', '0400 000 106', 'hart.family@example.com', d(2), 'Walk-in'],
        ]) },
        { id: uid(), name: 'Closed', color: '#00c875', collapsed: false, items: build(leadCols, [
          ['Hannah Brooks', 'Alex Morgan', 'Purchased', 1320000, 'Epping', '0400 000 107', 'hannah.b@example.com', '', 'Referral'],
          ['Marcus Webb', 'Sam Taylor', 'Lost', 680000, 'Rydalmere', '0400 000 108', 'marcus.webb@example.com', '', 'Portal'],
        ]) },
      ],
    };

    const listingCols = [
      makeColumn('Agent', 'person'),
      makeColumn('Stage', 'status', { options: makeOptions([['Appraisal', '#9d99b9'], ['Presentation', '#579bfc'], ['Listed', '#fdab3d'], ['Under offer', '#a25ddc'], ['Sold', '#00c875'], ['Withdrawn', '#df2f4a']]) }),
      makeColumn('Vendor', 'text'),
      makeColumn('Price guide', 'number', { currency: true }),
      makeColumn('Beds', 'number'),
      makeColumn('Listed', 'date'),
      makeColumn('Auction / close', 'date', { deadline: true }),
      makeColumn('Vendor phone', 'phone'),
    ];
    const active = build(listingCols, [
      ['12 Wattle Street, Epping', 'Alex Morgan', 'Listed', 'R. & K. Patel', 1450000, 4, d(-10), d(18), '0400 000 201'],
      ['3/48 Station Road, Parramatta', 'Sam Taylor', 'Under offer', 'J. Morrison', 720000, 2, d(-21), d(5), '0400 000 202'],
      ['7 Banksia Close, Castle Hill', 'Jordan Lee', 'Listed', 'S. Alvarez', 1980000, 5, d(-4), d(24), '0400 000 203'],
    ]);
    note(active[0], '34 groups through the first open home. 3 strong buyers flagged.', 3, 'Alex Morgan');

    const appraisals = build(listingCols, [
      ['22 Gum Tree Avenue, Carlingford', 'Alex Morgan', 'Appraisal', 'D. Kim', 1300000, 3, '', '', '0400 000 204'],
      ['9 Harbour View Lane, Eastwood', 'Jordan Lee', 'Presentation', 'L. Fraser', 1700000, 4, '', d(3), '0400 000 205'],
    ]);
    const sold = build(listingCols, [
      ['5 Jacaranda Place, Baulkham Hills', 'Sam Taylor', 'Sold', 'P. Ellis', 1210000, 4, d(-45), d(-12), '0400 000 206'],
    ]);

    const listingBoard = {
      id: uid(),
      name: 'Listings',
      columns: listingCols,
      groups: [
        { id: uid(), name: 'Active campaigns', color: '#fdab3d', collapsed: false, items: active },
        { id: uid(), name: 'Appraisal pipeline', color: '#579bfc', collapsed: false, items: appraisals },
        { id: uid(), name: 'Sold', color: '#00c875', collapsed: false, items: sold },
      ],
    };

    const taskCols = [
      makeColumn('Owner', 'person'),
      makeColumn('Status', 'status', { options: makeOptions([['Working on it', '#fdab3d'], ['Stuck', '#df2f4a'], ['Done', '#00c875']]) }),
      makeColumn('Priority', 'status', { options: makeOptions([['Critical', '#333333'], ['High', '#401694'], ['Medium', '#5559df'], ['Low', '#579bfc']]) }),
      makeColumn('Due date', 'date', { deadline: true }),
      makeColumn('Notes', 'text'),
    ];
    const taskBoard = {
      id: uid(),
      name: 'Team Tasks',
      columns: taskCols,
      groups: [
        { id: uid(), name: 'This week', color: '#a25ddc', collapsed: false, items: build(taskCols, [
          ['Call back weekend open-home attendees', 'Alex Morgan', 'Working on it', 'High', d(0), '12 contacts from Saturday'],
          ['Order photography for 7 Banksia Close', 'Jordan Lee', 'Done', 'Medium', d(-3), ''],
          ['Prepare CMA for 22 Gum Tree Avenue', 'Alex Morgan', 'Working on it', 'High', d(2), ''],
          ["Send contract to buyer's solicitor", 'Sam Taylor', 'Stuck', 'Critical', d(-1), 'Waiting on vendor signature'],
        ]) },
        { id: uid(), name: 'Later', color: '#9d99b9', collapsed: false, items: build(taskCols, [
          ['Quarterly database clean-up', 'Jordan Lee', '', 'Low', d(21), ''],
        ]) },
      ],
    };

    return {
      version: 1,
      boards: [leadBoard, listingBoard, taskBoard],
      activeBoardId: leadBoard.id,
      view: 'table',
      people: ['Alex Morgan', 'Sam Taylor', 'Jordan Lee'],
      kanbanColumn: {},
    };
  }

  // ---------- Formatting helpers ----------

  function hashColor(name, palette) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  function avatar(name, size = 26) {
    if (!name) return `<span class="avatar empty" style="width:${size}px;height:${size}px">+</span>`;
    return `<span class="avatar" title="${esc(name)}" style="background:${hashColor(name, AVATAR_PALETTE)};width:${size}px;height:${size}px">${esc(initials(name))}</span>`;
  }

  function formatNumber(value, col) {
    if (value === '' || value === null || value === undefined || Number.isNaN(Number(value))) return '';
    const text = numberFmt.format(Number(value));
    return col.currency ? `$${text}` : text;
  }

  function parseNumber(text) {
    const cleaned = String(text).replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return '';
    const n = Number(cleaned);
    return Number.isNaN(n) ? '' : n;
  }

  function formatDateShort(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  function statusColor(col, label) {
    const opt = (col.options || []).find((o) => o.label === label);
    return opt ? opt.color : NO_STATUS;
  }

  function isOverdue(col, value, item, b) {
    if (!col.deadline || !value || value >= todayIso()) return false;
    // A deadline on a finished item isn't overdue.
    const doneWords = /^(done|purchased|sold|lost|withdrawn)$/i;
    return !b.columns.some((c) => c.type === 'status' && doneWords.test(item.values[c.id] || ''));
  }

  // ---------- Filtering ----------

  function matches(item, b) {
    if (ui.search) {
      const q = ui.search.toLowerCase();
      const haystack = [item.name, ...b.columns.map((c) => item.values[c.id] ?? '')].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (ui.person) {
      const personCols = b.columns.filter((c) => c.type === 'person');
      if (!personCols.some((c) => item.values[c.id] === ui.person)) return false;
    }
    return true;
  }

  const filtering = () => Boolean(ui.search || ui.person);

  // ---------- Rendering ----------

  const els = {
    sidebar: $('#sidebar'),
    boardList: $('#boardList'),
    boardTitle: $('#boardTitle'),
    boardView: $('#boardView'),
    personFilter: $('#personFilter'),
    search: $('#searchInput'),
    popover: $('#popover'),
    drawer: $('#drawer'),
    scrim: $('#scrim'),
  };

  function render() {
    renderSidebar();
    const b = board();
    els.boardTitle.textContent = b ? b.name : 'No boards';
    els.boardTitle.contentEditable = b ? 'true' : 'false';
    document.title = b ? `${b.name} · CRM Boards` : 'CRM Boards';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
    renderPersonFilter();
    renderBoardView();
    if (ui.drawerItemId) renderDrawer();
  }

  function renderSidebar() {
    const b = board();
    els.boardList.innerHTML = state.boards
      .map((x) => `<button class="board-link ${b && x.id === b.id ? 'active' : ''}" data-board="${x.id}">${esc(x.name)}</button>`)
      .join('');
  }

  function renderPersonFilter() {
    const people = allPeople();
    if (ui.person && !people.includes(ui.person)) ui.person = '';
    els.personFilter.innerHTML = `<option value="">Everyone</option>` +
      people.map((p) => `<option value="${esc(p)}" ${p === ui.person ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  function renderBoardView() {
    const b = board();
    if (!b) {
      els.boardView.innerHTML = `<div class="empty-state">No boards yet. Use ＋ in the sidebar to create one.</div>`;
      return;
    }
    els.boardView.innerHTML = state.view === 'kanban' ? kanbanHtml(b) : tableHtml(b);
  }

  function gridTemplate(b) {
    return ['minmax(260px, 340px)', ...b.columns.map((c) => TYPE_WIDTH[c.type] || '160px'), '44px'].join(' ');
  }

  function tableHtml(b) {
    const template = gridTemplate(b);
    const groupsHtml = b.groups.map((g) => {
      const items = g.items.filter((i) => matches(i, b));
      if (filtering() && items.length === 0) return '';
      return `
        <div class="group ${g.collapsed ? 'collapsed' : ''}" data-group="${g.id}" style="--group-color:${g.color}">
          <div class="group-header">
            <button class="group-toggle" data-action="toggle-group" style="color:${g.color}" title="Collapse / expand">▼</button>
            <span class="group-name" contenteditable="true" spellcheck="false" style="color:${g.color}" data-edit="group-name">${esc(g.name)}</span>
            <span class="group-count">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
            <button class="icon-btn" data-action="group-color" title="Change colour">●</button>
            <button class="icon-btn" data-action="delete-group" title="Delete group">🗑</button>
          </div>
          <div class="table" style="grid-template-columns:${template}">
            <div class="row head">
              <div class="cell name-cell">Item</div>
              ${b.columns.map((c) => `
                <div class="cell" data-col="${c.id}">
                  <div class="col-head"><span title="${esc(c.title)}">${esc(c.title)}</span>
                  <button class="icon-btn" data-action="column-menu" title="Column options">⋯</button></div>
                </div>`).join('')}
              <div class="cell"><button class="icon-btn" data-action="add-column" title="Add column">＋</button></div>
            </div>
            <div class="table-body row">${items.map((i) => rowHtml(i, g, b)).join('')}</div>
            <div class="row add-row" data-group="${g.id}">
              <div class="cell name-cell"><input data-action="add-item" placeholder="+ Add item"></div>
              ${b.columns.map(() => '<div class="cell"></div>').join('')}<div class="cell"></div>
            </div>
            <div class="row table-footer" data-footer="${g.id}">${footerCells(items, b)}</div>
          </div>
        </div>`;
    }).join('');

    const noResults = filtering() && !groupsHtml.trim() ? '<div class="empty-state">No items match your filters.</div>' : '';
    return groupsHtml + noResults + `<button class="btn subtle add-group-btn" data-action="add-group">＋ Add new group</button>`;
  }

  function rowHtml(item, g, b) {
    const updates = item.updates?.length ? `<span class="update-badge" title="Updates">${item.updates.length}</span>` : '';
    return `
      <div class="row item" data-item="${item.id}" data-group="${g.id}">
        <div class="cell name-cell">
          <span class="drag-handle" draggable="true" title="Drag to move">⠿</span>
          <span class="item-name" contenteditable="true" spellcheck="false" data-edit="item-name">${esc(item.name)}</span>
          ${updates}
          <button class="icon-btn open-btn" data-action="open-item" title="Open">⤢</button>
        </div>
        ${b.columns.map((c) => cellHtml(item, c, b)).join('')}
        <div class="cell"><button class="icon-btn open-btn" data-action="delete-item" title="Delete item">✕</button></div>
      </div>`;
  }

  function cellHtml(item, col, b) {
    const v = item.values[col.id] ?? '';
    switch (col.type) {
      case 'status':
        return `<div class="cell status-cell ${v ? '' : 'empty'}" data-col="${col.id}" data-action="pick-status" style="background:${v ? statusColor(col, v) : 'transparent'}">${esc(v)}</div>`;
      case 'person':
        return `<div class="cell person-cell" data-col="${col.id}" data-action="pick-person">${avatar(v)}</div>`;
      case 'date':
        return `<div class="cell"><input type="date" class="cell-input ${isOverdue(col, v, item, b) ? 'overdue' : ''}" data-col="${col.id}" value="${esc(v)}"></div>`;
      case 'number':
        return `<div class="cell"><input class="cell-input" inputmode="decimal" data-col="${col.id}" data-number value="${esc(formatNumber(v, col))}"></div>`;
      case 'phone':
        return `<div class="cell"><input type="tel" class="cell-input" data-col="${col.id}" value="${esc(v)}" title="${esc(v)}">${v ? `<a class="cell-link" href="tel:${esc(String(v).replace(/\s+/g, ''))}" title="Call">☎</a>` : ''}</div>`;
      case 'email':
        return `<div class="cell"><input type="email" class="cell-input" data-col="${col.id}" value="${esc(v)}" title="${esc(v)}">${v ? `<a class="cell-link" href="mailto:${esc(v)}" title="Email">✉</a>` : ''}</div>`;
      default:
        return `<div class="cell"><input class="cell-input" data-col="${col.id}" value="${esc(v)}" title="${esc(v)}"></div>`;
    }
  }

  function footerCells(items, b) {
    const cells = b.columns.map((c) => {
      if (c.type === 'status') {
        if (!items.length) return '<div class="cell"></div>';
        const counts = new Map();
        for (const i of items) {
          const label = i.values[c.id] || '';
          counts.set(label, (counts.get(label) || 0) + 1);
        }
        const segs = [...counts.entries()].map(([label, n]) =>
          `<span style="width:${(n / items.length) * 100}%;background:${label ? statusColor(c, label) : NO_STATUS}" title="${esc(label || 'No status')}: ${n}"></span>`).join('');
        return `<div class="cell"><div class="status-bar">${segs}</div></div>`;
      }
      if (c.type === 'number') {
        const nums = items.map((i) => i.values[c.id]).filter((v) => v !== '' && v !== undefined && !Number.isNaN(Number(v)));
        const sum = nums.reduce((a, v) => a + Number(v), 0);
        return `<div class="cell" title="Sum">${nums.length ? formatNumber(sum, c) : ''}</div>`;
      }
      return '<div class="cell"></div>';
    });
    return `<div class="cell name-cell"></div>${cells.join('')}<div class="cell"></div>`;
  }

  function refreshFooter(groupId) {
    const b = board();
    const g = b?.groups.find((x) => x.id === groupId);
    const el = els.boardView.querySelector(`[data-footer="${groupId}"]`);
    if (g && el) el.innerHTML = footerCells(g.items.filter((i) => matches(i, b)), b);
  }

  function kanbanHtml(b) {
    const statusCols = b.columns.filter((c) => c.type === 'status');
    if (!statusCols.length) return `<div class="empty-state">Add a Status column to use the Kanban view.</div>`;
    state.kanbanColumn = state.kanbanColumn || {};
    const col = statusCols.find((c) => c.id === state.kanbanColumn[b.id]) || statusCols[0];
    const labels = new Set(col.options.map((o) => o.label));
    const lanes = [...col.options, { label: '', color: NO_STATUS }];
    const entries = b.groups.flatMap((g) => g.items.filter((i) => matches(i, b)).map((i) => ({ i, g })));
    const personCol = b.columns.find((c) => c.type === 'person');
    const dateCol = b.columns.find((c) => c.type === 'date');
    const numberCol = b.columns.find((c) => c.type === 'number');

    const picker = statusCols.length > 1
      ? `<div style="margin-bottom:12px">Group cards by <select class="select" data-action="kanban-column">${statusCols.map((c) => `<option value="${c.id}" ${c.id === col.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div>`
      : '';

    const lanesHtml = lanes.map((lane) => {
      const cards = entries.filter(({ i }) => {
        const v = i.values[col.id] || '';
        return lane.label ? v === lane.label : !labels.has(v);
      });
      return `
        <div class="lane" data-lane="${esc(lane.label)}" data-col="${col.id}">
          <div class="lane-header" style="background:${lane.color}"><span>${esc(lane.label || 'No status')}</span><span>${cards.length}</span></div>
          <div class="lane-body">
            ${cards.map(({ i, g }) => {
              const dateVal = dateCol ? i.values[dateCol.id] : '';
              return `
              <div class="card" draggable="true" data-item="${i.id}">
                <span class="card-group" style="background:${g.color}">${esc(g.name)}</span>
                <div class="card-title">${esc(i.name)}</div>
                <div class="card-meta">
                  ${personCol && i.values[personCol.id] ? avatar(i.values[personCol.id], 22) : ''}
                  ${dateVal ? `<span class="${isOverdue(dateCol, dateVal, i, b) ? 'overdue' : ''}">📅 ${esc(formatDateShort(dateVal))}</span>` : ''}
                  ${numberCol && i.values[numberCol.id] !== '' && i.values[numberCol.id] !== undefined ? `<span>${esc(formatNumber(i.values[numberCol.id], numberCol))}</span>` : ''}
                  ${i.updates?.length ? `<span>💬 ${i.updates.length}</span>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');

    return picker + `<div class="kanban">${lanesHtml}</div>`;
  }

  // ---------- Drawer ----------

  function openDrawer(itemId) {
    ui.drawerItemId = itemId;
    renderDrawer();
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.scrim.classList.add('open');
  }

  function closeDrawer() {
    ui.drawerItemId = null;
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.scrim.classList.remove('open');
  }

  function renderDrawer() {
    const found = findItem(ui.drawerItemId);
    if (!found) { closeDrawer(); return; }
    const { board: b, group: g, item } = found;
    $('#drawerTitle').value = item.name;
    const people = allPeople();

    const fields = [`
      <label for="f-group">Group</label>
      <select id="f-group" data-field="group">${b.groups.map((x) => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`];

    for (const c of b.columns) {
      const v = item.values[c.id] ?? '';
      const id = `f-${c.id}`;
      let input;
      if (c.type === 'status') {
        input = `<select id="${id}" data-col="${c.id}"><option value="">—</option>${c.options.map((o) => `<option ${o.label === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (c.type === 'person') {
        input = `<input id="${id}" data-col="${c.id}" list="people-list" value="${esc(v)}">`;
      } else if (c.type === 'date') {
        input = `<input id="${id}" type="date" data-col="${c.id}" value="${esc(v)}">`;
      } else if (c.type === 'number') {
        input = `<input id="${id}" type="number" step="any" data-col="${c.id}" value="${esc(v)}">`;
      } else if (c.type === 'email') {
        input = `<input id="${id}" type="email" data-col="${c.id}" value="${esc(v)}">`;
      } else if (c.type === 'phone') {
        input = `<input id="${id}" type="tel" data-col="${c.id}" value="${esc(v)}">`;
      } else {
        input = `<input id="${id}" data-col="${c.id}" value="${esc(v)}">`;
      }
      fields.push(`<label for="${id}">${esc(c.title)}</label>${input}`);
    }
    fields.push(`<datalist id="people-list">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`);
    $('#drawerFields').innerHTML = fields.join('');

    const updates = [...(item.updates || [])].sort((a, z) => z.at.localeCompare(a.at));
    $('#updateList').innerHTML = updates.length
      ? updates.map((u) => `
          <li>
            <div class="update-meta"><strong>${esc(u.author || 'You')}</strong><span>${esc(new Date(u.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
            ${esc(u.text)}
          </li>`).join('')
      : '<li class="update-meta" style="border:0;padding:0">No updates yet.</li>';
  }

  // ---------- Mutations ----------

  function setValue(itemId, colId, value) {
    const found = findItem(itemId);
    if (!found) return;
    found.item.values[colId] = value;
    save();
  }

  function addItem(groupId, name, { top = false } = {}) {
    const b = board();
    const g = b.groups.find((x) => x.id === groupId);
    if (!g) return null;
    const item = makeItem(name || 'New item');
    top ? g.items.unshift(item) : g.items.push(item);
    save();
    return item;
  }

  function deleteItem(itemId) {
    const found = findItem(itemId);
    if (!found) return;
    if (!confirm(`Delete "${found.item.name}"?`)) return;
    found.group.items.splice(found.index, 1);
    if (ui.drawerItemId === itemId) closeDrawer();
    save();
    render();
  }

  function moveItem(itemId, targetGroupId, beforeItemId) {
    const found = findItem(itemId);
    const b = board();
    const target = b?.groups.find((g) => g.id === targetGroupId);
    if (!found || !target || itemId === beforeItemId) return;
    found.group.items.splice(found.index, 1);
    const idx = beforeItemId ? target.items.findIndex((i) => i.id === beforeItemId) : -1;
    idx === -1 ? target.items.push(found.item) : target.items.splice(idx, 0, found.item);
    save();
    render();
  }

  function addGroup() {
    const b = board();
    if (!b) return;
    const g = { id: uid(), name: 'New group', color: GROUP_PALETTE[b.groups.length % GROUP_PALETTE.length], collapsed: false, items: [] };
    b.groups.unshift(g);
    save();
    render();
    const nameEl = els.boardView.querySelector(`[data-group="${g.id}"] .group-name`);
    if (nameEl) focusEditable(nameEl);
  }

  function addBoard() {
    const name = prompt('Board name', 'New board');
    if (!name || !name.trim()) return;
    const b = {
      id: uid(),
      name: name.trim(),
      columns: [
        makeColumn('Owner', 'person'),
        makeColumn('Status', 'status', { options: makeOptions([['Working on it', '#fdab3d'], ['Stuck', '#df2f4a'], ['Done', '#00c875']]) }),
        makeColumn('Date', 'date', { deadline: true }),
      ],
      groups: [{ id: uid(), name: 'Group 1', color: GROUP_PALETTE[0], collapsed: false, items: [] }],
    };
    state.boards.push(b);
    state.activeBoardId = b.id;
    save();
    render();
  }

  function focusEditable(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- Popover ----------

  function openPopover(anchor, html, onPick) {
    const pop = els.popover;
    pop.innerHTML = html;
    pop.classList.add('open');
    ui.popoverPick = onPick;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    const input = pop.querySelector('input');
    if (input) input.focus();
  }

  function closePopover() {
    els.popover.classList.remove('open');
    ui.popoverPick = null;
  }

  function statusPopover(anchor, itemId, col) {
    const html = col.options.map((o) => `<button class="status-option" data-pick="${esc(o.label)}" style="background:${o.color}">${esc(o.label)}</button>`).join('') +
      `<button class="status-option clear" data-pick="">Clear</button>`;
    openPopover(anchor, html, (label) => { setValue(itemId, col.id, label); render(); });
  }

  function personPopover(anchor, itemId, col) {
    const people = allPeople();
    const html = `<input placeholder="Type a name, press Enter" data-person-input>` +
      people.map((p) => `<button class="person-option" data-pick="${esc(p)}">${avatar(p, 22)}<span>${esc(p)}</span></button>`).join('') +
      `<button class="menu-option" data-pick="">Unassign</button>`;
    openPopover(anchor, html, (name) => {
      const clean = name.trim();
      if (clean && !(state.people || []).includes(clean)) state.people = [...(state.people || []), clean];
      setValue(itemId, col.id, clean);
      render();
    });
  }

  function columnMenu(anchor, colId) {
    const b = board();
    const col = b.columns.find((c) => c.id === colId);
    const idx = b.columns.indexOf(col);
    const html = [
      `<button class="menu-option" data-pick="rename">Rename</button>`,
      col.type === 'status' ? `<button class="menu-option" data-pick="labels">Edit labels</button>` : '',
      col.type === 'date' ? `<button class="menu-option" data-pick="deadline">${col.deadline ? 'Stop highlighting overdue' : 'Highlight overdue dates'}</button>` : '',
      col.type === 'number' ? `<button class="menu-option" data-pick="currency">${col.currency ? 'Show as plain number' : 'Show as currency ($)'}</button>` : '',
      idx > 0 ? `<button class="menu-option" data-pick="left">Move left</button>` : '',
      idx < b.columns.length - 1 ? `<button class="menu-option" data-pick="right">Move right</button>` : '',
      `<button class="menu-option danger" data-pick="delete">Delete column</button>`,
    ].join('');
    openPopover(anchor, html, (action) => {
      if (action === 'rename') {
        const title = prompt('Column title', col.title);
        if (title && title.trim()) col.title = title.trim();
      } else if (action === 'labels') {
        editStatusLabels(b, col);
      } else if (action === 'deadline') {
        col.deadline = !col.deadline;
      } else if (action === 'currency') {
        col.currency = !col.currency;
      } else if (action === 'left' || action === 'right') {
        const to = action === 'left' ? idx - 1 : idx + 1;
        b.columns.splice(idx, 1);
        b.columns.splice(to, 0, col);
      } else if (action === 'delete') {
        if (!confirm(`Delete column "${col.title}" and its data?`)) return;
        b.columns.splice(idx, 1);
        for (const g of b.groups) for (const i of g.items) delete i.values[col.id];
      }
      save();
      render();
    });
  }

  function editStatusLabels(b, col) {
    const current = col.options.map((o) => o.label).join(', ');
    const input = prompt('Status labels, comma separated (order sets the colours; renaming keeps position)', current);
    if (input === null) return;
    const labels = input.split(',').map((s) => s.trim()).filter(Boolean);
    if (!labels.length) return;
    const renames = new Map();
    col.options.forEach((o, i) => { if (labels[i] && labels[i] !== o.label) renames.set(o.label, labels[i]); });
    col.options = labels.map((label, i) => ({ label, color: col.options[i]?.color || STATUS_PALETTE[i % STATUS_PALETTE.length] }));
    for (const g of b.groups) for (const i of g.items) {
      const v = i.values[col.id];
      if (renames.has(v)) i.values[col.id] = renames.get(v);
    }
  }

  // ---------- Import / export ----------

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCsv() {
    const b = board();
    if (!b) return;
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Group', 'Name', ...b.columns.map((c) => c.title), 'Latest update'].map(q).join(',')];
    for (const g of b.groups) {
      for (const i of g.items) {
        if (!matches(i, b)) continue;
        const latest = [...(i.updates || [])].sort((a, z) => z.at.localeCompare(a.at))[0];
        lines.push([g.name, i.name, ...b.columns.map((c) => i.values[c.id] ?? ''), latest ? latest.text : ''].map(q).join(','));
      }
    }
    download(`${b.name.replace(/[^\w-]+/g, '_')}_${todayIso()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------- Event wiring ----------

  els.boardList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-board]');
    if (!btn) return;
    state.activeBoardId = btn.dataset.board;
    ui.search = '';
    els.search.value = '';
    save();
    closeDrawer();
    els.sidebar.classList.remove('open');
    render();
  });

  $('#addBoardBtn').addEventListener('click', addBoard);
  $('#menuBtn').addEventListener('click', () => els.sidebar.classList.toggle('open'));

  $('#deleteBoardBtn').addEventListener('click', () => {
    const b = board();
    if (!b || !confirm(`Delete board "${b.name}" and everything on it?`)) return;
    state.boards = state.boards.filter((x) => x.id !== b.id);
    state.activeBoardId = state.boards[0]?.id || null;
    save();
    render();
  });

  els.boardTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  els.boardTitle.addEventListener('blur', () => {
    const b = board();
    const name = els.boardTitle.textContent.trim();
    if (b && name && name !== b.name) { b.name = name; save(); }
    render();
  });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    save();
    render();
  }));

  els.search.addEventListener('input', () => { ui.search = els.search.value.trim(); renderBoardView(); });
  els.personFilter.addEventListener('change', () => { ui.person = els.personFilter.value; renderBoardView(); });

  $('#addGroupBtn').addEventListener('click', addGroup);
  $('#exportCsvBtn').addEventListener('click', exportCsv);

  $('#newItemBtn').addEventListener('click', () => {
    const b = board();
    if (!b) return;
    if (!b.groups.length) b.groups.push({ id: uid(), name: 'Group 1', color: GROUP_PALETTE[0], collapsed: false, items: [] });
    const item = addItem(b.groups[0].id, 'New item', { top: true });
    render();
    openDrawer(item.id);
    const title = $('#drawerTitle');
    title.focus();
    title.select();
  });

  // Column dialog
  const columnDialog = $('#columnDialog');
  const columnForm = $('#columnForm');
  const syncStatusField = () => {
    $('.status-options-field', columnForm).style.display = columnForm.type.value === 'status' ? '' : 'none';
  };
  columnForm.type.addEventListener('change', syncStatusField);
  function openColumnDialog() {
    if (!board()) return;
    columnForm.reset();
    syncStatusField();
    columnDialog.showModal();
  }
  $('#addColumnBtn').addEventListener('click', openColumnDialog);
  columnDialog.addEventListener('close', () => {
    if (columnDialog.returnValue !== 'ok') return;
    const b = board();
    const title = columnForm.title.value.trim();
    const type = columnForm.type.value;
    if (!b || !title) return;
    const extra = {};
    if (type === 'status') {
      const labels = columnForm.options.value.split(',').map((s) => s.trim()).filter(Boolean);
      extra.options = makeOptions((labels.length ? labels : ['To do', 'Working on it', 'Done']).map((l) => [l]));
    }
    b.columns.push(makeColumn(title, type, extra));
    save();
    render();
  });

  // Board view: clicks
  els.boardView.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    const card = e.target.closest('.card');
    if (!actionEl) {
      if (card) openDrawer(card.dataset.item);
      return;
    }
    const action = actionEl.dataset.action;
    const groupEl = actionEl.closest('[data-group]');
    const rowEl = actionEl.closest('.row.item');
    const b = board();
    const group = groupEl && b.groups.find((g) => g.id === groupEl.dataset.group);

    switch (action) {
      case 'toggle-group':
        group.collapsed = !group.collapsed;
        save();
        renderBoardView();
        break;
      case 'group-color': {
        const i = GROUP_PALETTE.indexOf(group.color);
        group.color = GROUP_PALETTE[(i + 1) % GROUP_PALETTE.length];
        save();
        renderBoardView();
        break;
      }
      case 'delete-group':
        if (group.items.length && !confirm(`Delete group "${group.name}" and its ${group.items.length} items?`)) return;
        b.groups = b.groups.filter((g) => g !== group);
        save();
        render();
        break;
      case 'add-group':
        addGroup();
        break;
      case 'add-column':
        openColumnDialog();
        break;
      case 'column-menu':
        columnMenu(actionEl, actionEl.closest('[data-col]').dataset.col);
        break;
      case 'open-item':
        openDrawer(rowEl.dataset.item);
        break;
      case 'delete-item':
        deleteItem(rowEl.dataset.item);
        break;
      case 'pick-status':
        statusPopover(actionEl, rowEl.dataset.item, b.columns.find((c) => c.id === actionEl.dataset.col));
        break;
      case 'pick-person':
        personPopover(actionEl, rowEl.dataset.item, b.columns.find((c) => c.id === actionEl.dataset.col));
        break;
      default:
        break;
    }
  });

  // Board view: inline edits
  els.boardView.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.action === 'kanban-column') {
      state.kanbanColumn = { ...(state.kanbanColumn || {}), [board().id]: t.value };
      save();
      renderBoardView();
      return;
    }
    if (!t.classList.contains('cell-input')) return;
    const row = t.closest('.row.item');
    const col = board().columns.find((c) => c.id === t.dataset.col);
    if (!row || !col) return;
    let value = t.value.trim();
    if (col.type === 'number') value = parseNumber(value);
    setValue(row.dataset.item, col.id, value);
    if (col.type === 'number') refreshFooter(row.dataset.group);
    if (col.type === 'date') {
      const found = findItem(row.dataset.item);
      t.classList.toggle('overdue', isOverdue(col, value, found.item, board()));
    }
    if (col.type === 'email' || col.type === 'phone') {
      // Re-render the cell so the call / email link reflects the new value.
      const cell = t.closest('.cell');
      const found = findItem(row.dataset.item);
      cell.outerHTML = cellHtml(found.item, col, board());
    }
  });

  els.boardView.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.matches('input[data-number]')) {
      const row = t.closest('.row.item');
      const found = row && findItem(row.dataset.item);
      if (found) t.value = found.item.values[t.dataset.col] ?? '';
    }
  });

  els.boardView.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.matches('input[data-number]')) {
      const row = t.closest('.row.item');
      const found = row && findItem(row.dataset.item);
      const col = board().columns.find((c) => c.id === t.dataset.col);
      if (found && col) t.value = formatNumber(found.item.values[col.id], col);
      return;
    }
    const edit = t.dataset?.edit;
    if (edit === 'item-name') {
      const found = findItem(t.closest('.row.item').dataset.item);
      const name = t.textContent.trim();
      if (found && name && name !== found.item.name) { found.item.name = name; save(); }
      else if (found) t.textContent = found.item.name;
    } else if (edit === 'group-name') {
      const g = board().groups.find((x) => x.id === t.closest('[data-group]').dataset.group);
      const name = t.textContent.trim();
      if (g && name && name !== g.name) { g.name = name; save(); }
      else if (g) t.textContent = g.name;
    }
  });

  els.boardView.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t.dataset.edit) { e.preventDefault(); t.blur(); return; }
    if (e.key === 'Enter' && t.classList.contains('cell-input')) { t.blur(); return; }
    if (e.key === 'Enter' && t.dataset.action === 'add-item') {
      const name = t.value.trim();
      if (!name) return;
      const groupId = t.closest('[data-group]').dataset.group;
      addItem(groupId, name);
      render();
      const again = els.boardView.querySelector(`.add-row[data-group="${groupId}"] input`);
      if (again) again.focus();
    }
  });

  // Drag and drop (table rows and kanban cards)
  els.boardView.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.drag-handle, .card');
    if (!handle) return;
    const itemEl = handle.closest('[data-item]');
    ui.dragItemId = itemEl.dataset.item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ui.dragItemId);
    itemEl.classList.add('dragging');
  });

  els.boardView.addEventListener('dragend', () => {
    ui.dragItemId = null;
    els.boardView.querySelectorAll('.dragging, .drop-target, .drop-hover').forEach((el) => el.classList.remove('dragging', 'drop-target', 'drop-hover'));
  });

  els.boardView.addEventListener('dragover', (e) => {
    if (!ui.dragItemId) return;
    const target = e.target.closest('.row.item, .row.add-row, .lane');
    if (!target) return;
    e.preventDefault();
    const cls = target.classList.contains('lane') ? 'drop-hover' : 'drop-target';
    els.boardView.querySelectorAll('.drop-target, .drop-hover').forEach((el) => { if (el !== target) el.classList.remove('drop-target', 'drop-hover'); });
    target.classList.add(cls);
  });

  els.boardView.addEventListener('drop', (e) => {
    if (!ui.dragItemId) return;
    const target = e.target.closest('.row.item, .row.add-row, .lane');
    if (!target) return;
    e.preventDefault();
    const itemId = ui.dragItemId;
    ui.dragItemId = null;
    if (target.classList.contains('lane')) {
      setValue(itemId, target.dataset.col, target.dataset.lane);
      render();
    } else if (target.classList.contains('add-row')) {
      moveItem(itemId, target.dataset.group, null);
    } else {
      moveItem(itemId, target.dataset.group, target.dataset.item);
    }
  });

  // Popover
  els.popover.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn || !ui.popoverPick) return;
    const pick = ui.popoverPick;
    closePopover();
    pick(btn.dataset.pick);
  });
  els.popover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-person-input]') && e.target.value.trim() && ui.popoverPick) {
      const pick = ui.popoverPick;
      closePopover();
      pick(e.target.value);
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (els.popover.classList.contains('open') && !els.popover.contains(e.target)) closePopover();
  });
  els.boardView.addEventListener('scroll', closePopover);
  window.addEventListener('resize', closePopover);

  // Drawer
  $('#closeDrawerBtn').addEventListener('click', closeDrawer);
  els.scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.popover.classList.contains('open')) closePopover();
    else if (ui.drawerItemId) closeDrawer();
  });

  $('#drawerTitle').addEventListener('change', (e) => {
    const found = findItem(ui.drawerItemId);
    const name = e.target.value.trim();
    if (found && name) { found.item.name = name; save(); renderBoardView(); }
  });
  $('#drawerTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $('#drawerFields').addEventListener('change', (e) => {
    const t = e.target;
    const found = findItem(ui.drawerItemId);
    if (!found) return;
    if (t.dataset.field === 'group') {
      moveItem(found.item.id, t.value, null);
      return;
    }
    const col = found.board.columns.find((c) => c.id === t.dataset.col);
    if (!col) return;
    let value = t.value.trim();
    if (col.type === 'number') value = parseNumber(value);
    if (col.type === 'person' && value && !(state.people || []).includes(value)) state.people = [...(state.people || []), value];
    setValue(found.item.id, col.id, value);
    renderBoardView();
    renderPersonFilter();
  });

  $('#updateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#updateText').value.trim();
    const found = findItem(ui.drawerItemId);
    if (!text || !found) return;
    found.item.updates = found.item.updates || [];
    found.item.updates.push({ id: uid(), text, author: 'You', at: new Date().toISOString() });
    $('#updateText').value = '';
    save();
    render();
  });

  $('#deleteItemBtn').addEventListener('click', () => { if (ui.drawerItemId) deleteItem(ui.drawerItemId); });

  // Backup / restore / reset
  $('#exportJsonBtn').addEventListener('click', () => download(`crm-backup_${todayIso()}.json`, JSON.stringify(state, null, 2), 'application/json'));

  $('#importJsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.boards)) throw new Error('missing boards');
        if (!confirm('Replace all current boards with this backup?')) return;
        state = parsed;
        save();
        closeDrawer();
        render();
      } catch {
        alert('That file is not a valid CRM backup.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Replace all boards with the sample data? Your changes will be lost.')) return;
    state = seed();
    save();
    closeDrawer();
    render();
  });

  render();
})();
