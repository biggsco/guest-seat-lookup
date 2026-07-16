const cron = require('node-cron');
const { pool } = require('../db');

function startRetentionJob() {
  const days = parseInt(process.env.DATA_RETENTION_DAYS || '2', 10);

  // Runs at 2am every day
  cron.schedule('0 2 * * *', async () => {
    try {
      const result = await pool.query(
        `DELETE FROM events
         WHERE event_date IS NOT NULL
           AND event_date < NOW() - ($1 || ' days')::INTERVAL
         RETURNING id, name, event_date`,
        [days]
      );
      if (result.rowCount > 0) {
        console.log(`[retention] Deleted ${result.rowCount} event(s) older than ${days} day(s) past their date:`,
          result.rows.map((r) => `"${r.name}" (${r.event_date})`).join(', '));
      }
    } catch (err) {
      console.error('[retention] Error running retention job:', err.message);
    }
  });

  console.log(`[retention] Nightly job scheduled — deletes events ${days} day(s) after event_date`);
}

module.exports = { startRetentionJob };
