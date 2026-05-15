const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');

const { renderLayout, escapeHtml } = require('../render');
const { formatError } = require('../lib/formatting');
const { replaceEventSeats } = require('../lib/guestSeats');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage()
});

function requireLogin(req, res, next) {
  if (!req.session?.user) {
    return res.redirect(302, '/admin/login?error=Please sign in.');
  }

  return next();
}

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function getValue(row, aliases) {
  const wanted = aliases.map(normaliseHeader);

  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normaliseHeader(key))) {
      return String(value || '').trim();
    }
  }

  return '';
}

function parseRowsFromWorkbook(buffer) {
  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    raw: false
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const firstSheet = workbook.Sheets[firstSheetName];

  const rows = xlsx.utils.sheet_to_json(firstSheet, {
    defval: '',
    blankrows: false
  });

  const guestAliases = [
    'guest_name',
    'guest name',
    'guest',
    'name',
    'full name',
    'fullname',
    'attendee',
    'attendee name',
    'person'
  ];

  const tableAliases = [
    'table_name',
    'table name',
    'table',
    'table no',
    'table number',
    'table #',
    'seat',
    'assigned table',
    'allocation'
  ];

  return rows
    .map((row) => ({
      guestName: getValue(row, guestAliases),
      tableName: getValue(row, tableAliases)
    }))
    .filter((row) => row.guestName && row.tableName);
}

router.get('/admin/events', requireLogin, (req, res) => {
  const message = req.query.message
    ? `<div class="result-card">${escapeHtml(req.query.message)}</div>`
    : '';

  res.status(200).send(
    renderLayout(
      'Admin Events',
      `
      <section class="panel admin-upload-panel">

        <div class="admin-header">
          <div>
            <p class="eyebrow">Guest List Manager</p>
            <h1>Upload Seating List</h1>
            <p class="muted">
              Drag and drop a CSV or Excel file to upload guest seating data.
            </p>
          </div>
        </div>

        ${message}

        <form
          id="uploadForm"
          method="POST"
          action="/admin/events/upload"
          enctype="multipart/form-data"
          class="upload-form"
        >

          <label for="eventName">Event name</label>

          <input
            id="eventName"
            name="eventName"
            required
            placeholder="e.g. Gala Dinner 2026"
          />

          <label>Guest list file</label>

          <div id="dropZone" class="drop-zone" tabindex="0">

            <input
              id="guestFile"
              type="file"
              name="guestFile"
              accept=".xlsx,.xls,.csv"
              required
            />

            <div class="drop-zone-content">
              <strong>Drag and drop your file here</strong>
              <span>or click to browse</span>
              <small>Accepted: CSV, XLSX, XLS</small>
            </div>

          </div>

          <div id="fileSummary" class="file-summary" hidden></div>

          <div class="help-box">
            <strong>Supported columns</strong>

            <p>
              Guest columns:
              guest_name, guest name, guest, name, full name, attendee
            </p>

            <p>
              Table columns:
              table_name, table name, table, table number, seat
            </p>
          </div>

          <button class="button button-wide" type="submit">
            Upload Guest List
          </button>

        </form>

        <div class="admin-links">
          <a class="button secondary-button" href="/admin/users">
            View Users
          </a>

          <a class="button secondary-button" href="/auth/logout">
            Sign Out
          </a>
        </div>

      </section>

      <script>
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('guestFile');
        const fileSummary = document.getElementById('fileSummary');

        function showFile(file) {
          if (!file) {
            fileSummary.hidden = true;
            fileSummary.textContent = '';
            return;
          }

          fileSummary.hidden = false;
          fileSummary.textContent = 'Selected file: ' + file.name;
        }

        dropZone.addEventListener('click', () => {
          fileInput.click();
        });

        dropZone.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInput.click();
          }
        });

        fileInput.addEventListener('change', () => {
          showFile(fileInput.files[0]);
        });

        ['dragenter', 'dragover'].forEach((eventName) => {
          dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
          });
        });

        ['dragleave', 'drop'].forEach((eventName) => {
          dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.remove('is-dragging');
          });
        });

        dropZone.addEventListener('drop', (event) => {
          const file = event.dataTransfer.files[0];

          if (!file) {
            return;
          }

          const dataTransfer = new DataTransfer();

          dataTransfer.items.add(file);

          fileInput.files = dataTransfer.files;

          showFile(file);
        });
      </script>
      `
    )
  );
});

router.post(
  '/admin/events/upload',
  requireLogin,
  upload.single('guestFile'),
  async (req, res) => {
    try {
      const eventName = String(req.body.eventName || '').trim();

      if (!eventName) {
        return res.redirect(
          302,
          '/admin/events?message=Event%20name%20is%20required.'
        );
      }

      if (!req.file?.buffer) {
        return res.redirect(
          302,
          '/admin/events?message=Guest%20file%20is%20required.'
        );
      }

      const seats = parseRowsFromWorkbook(req.file.buffer);

      if (!seats.length) {
        return res.redirect(
          302,
          '/admin/events?message=No%20valid%20rows%20found.%20Check%20your%20column%20names.'
        );
      }

      await replaceEventSeats(eventName, seats);

      return res.redirect(
        302,
        '/admin/events?message=' +
          encodeURIComponent(
            `Uploaded ${seats.length} guests for ${eventName}.`
          )
      );
    } catch (err) {
      return res.redirect(
        302,
        '/admin/events?message=' +
          encodeURIComponent(formatError(err, 'Upload failed.'))
      );
    }
  }
);

module.exports = router;
