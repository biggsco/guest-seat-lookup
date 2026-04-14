app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  let results = [];

  if (q.trim()) {
    try {
      const dbResult = await pool.query(
        `
        SELECT full_name, company, table_name, seat
        FROM guests
        WHERE full_name ILIKE $1
           OR company ILIKE $1
        ORDER BY full_name ASC
        LIMIT 20
        `,
        [`%${q}%`]
      );

      results = dbResult.rows;
    } catch (err) {
      return res.status(500).send(`
        <html>
          <head><title>Search Error</title></head>
          <body>
            <h1>Search Error</h1>
            <p>${err.message}</p>
            <p><a href="/search">Back to search</a></p>
          </body>
        </html>
      `);
    }
  }

  const resultsHtml = q.trim()
    ? results.length > 0
      ? `
        <h2>Results for "${q}"</h2>
        <ul>
          ${results.map(row => `
            <li>
              <strong>${row.full_name || 'No name'}</strong><br />
              Company: ${row.company || 'N/A'}<br />
              Table: ${row.table_name || 'N/A'}<br />
              Seat: ${row.seat || 'N/A'}
            </li>
          `).join('')}
        </ul>
      `
      : `
        <h2>Results for "${q}"</h2>
        <p>No matches found.</p>
      `
    : `
      <p>Search by guest name or company.</p>
    `;

  res.send(`
    <html>
      <head><title>Search</title></head>
      <body>
        <h1>Public Search Page VERSION 2</h1>

        <form method="GET" action="/search">
          <input
            type="text"
            name="q"
            placeholder="Enter name or company"
            value="${q.replace(/"/g, '&quot;')}"
          />
          <button type="submit">Search</button>
        </form>

        ${resultsHtml}

        <p><a href="/">Back to home</a></p>
      </body>
    </html>
  `);
});
