function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLayout(title, body) {
  return `
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="container">
          ${body}
        </div>
      </body>
    </html>
  `;
}

function renderSearchPage(event, q, results) {
  const primary = event.primary_color || '#1f3c88';
  const tertiary = event.tertiary_color || '#eef3ff';

  return renderLayout(
    event.name,
    `
    <div class="search-shell event-theme"
      style="--event-primary:${primary};--event-tertiary:${tertiary};">

      <div class="search-card">

        ${event.logo_url ? `<img src="${event.logo_url}" class="event-logo" />` : ''}

        <h1 class="search-title">${escapeHtml(event.name)}</h1>
        <p class="search-subtitle">Find your assigned table in seconds.</p>

        <form method="GET" class="search-form">
          <input name="q" value="${escapeHtml(q)}" placeholder="Search name or company" />
          <button type="submit">Search</button>
        </form>

        ${
          q
            ? results.length
              ? `<div class="result-list">${results.map(r => `
                <div class="result-card">
                  <strong>${escapeHtml(r.full_name || r.company)}</strong><br/>
                  Table: ${escapeHtml(r.table_name)}
                </div>
              `).join('')}</div>`
              : `<div class="result-empty">No matching guest found. Please try a different spelling.</div>`
            : ''
        }

      </div>
    </div>
  `);
}

module.exports = {
  escapeHtml,
  renderLayout,
  renderSearchPage
};
