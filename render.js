function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLayout(title, body, options = {}) {
  const pageTitle = escapeHtml(title || 'Event Seating');
  const fullWidth = options.fullWidth ? 'container wide' : 'container';

  return `
    <html>
      <head>
        <title>${pageTitle}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="${fullWidth}">
          ${body}
        </div>
      </body>
    </html>
  `;
}

function renderTopNav(links = []) {
  return `
    <div class="top-nav">
      ${links.map(link => `
        <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
      `).join('')}
    </div>
  `;
}

function renderPreviewTable(headers, rows, maxRows = 10) {
  const previewRows = rows.slice(0, maxRows);

  return `
    <table>
      <thead>
        <tr>
          ${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${previewRows.map(row => `
          <tr>
            ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMappingSelect(name, headers, defaultValue) {
  return `
    <select name="${name}">
      <option value="">-- Ignore --</option>
      ${headers.map((header, index) => `
        <option value="${index}" ${String(defaultValue) === String(index) ? 'selected' : ''}>
          ${escapeHtml(header)}
        </option>
      `).join('')}
    </select>
  `;
}

function renderSearchPage(event, q, results) {
  const primaryColor = escapeHtml(event.primary_color || '#1f3c88');
  const tertiaryColor = escapeHtml(event.tertiary_color || '#eef3ff');
  const logoHtml = event.logo_url
    ? `
      <div class="event-logo-wrap">
        <img
          src="${escapeHtml(event.logo_url)}"
          alt="${escapeHtml(event.name)} logo"
          class="event-logo"
        />
      </div>
    `
    : '';

  const resultsHtml = q
    ? results.length > 0
      ? `
        <div class="results-list">
          ${results.map(row => {
            const name = escapeHtml(row.full_name || '');
            const company = escapeHtml(row.company || '');
            const table = escapeHtml(row.table_name || 'Not assigned');
            const title = name || company || 'Guest';
            const subtitle = name && company
              ? company
              : (!name && company ? 'Company listing' : '');

            return `
              <div class="result-card">
                <h3>${title}</h3>
                ${subtitle ? `<div class="muted">${subtitle}</div>` : ''}
                <div style="margin-top: 10px;"><strong>Table:</strong> ${table}</div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : `
        <div class="empty-state" style="margin-top: 18px;">
          No results found for <strong>${escapeHtml(q)}</strong>.
        </div>
      `
    : `
      <div class="notice info" style="margin-top: 18px;">
        Search by guest name or company.
      </div>
    `;

  return renderLayout(
    event.name,
    `
      <div
        class="search-shell event-theme"
        style="--event-primary: ${primaryColor}; --event-tertiary: ${tertiaryColor};"
      >
        <div class="search-card">
          ${logoHtml}
          <div class="muted small" style="margin-bottom: 8px;">Guest seating lookup</div>
          <h1>${escapeHtml(event.name)}</h1>
          <p class="muted" style="margin: 0 0 8px;">
            Search your name or company to find your assigned table.
          </p>

          <form method="GET" action="/e/${encodeURIComponent(event.public_token)}" class="search-form">
            <input
              type="text"
              name="q"
              placeholder="Enter guest name or company"
              value="${escapeHtml(q)}"
              autofocus
            />
            <button type="submit">Search</button>
          </form>

          ${resultsHtml}
        </div>
      </div>
    `
  );
}

module.exports = {
  escapeHtml,
  renderLayout,
  renderTopNav,
  renderSearchPage,
  renderPreviewTable,
  renderMappingSelect
};
