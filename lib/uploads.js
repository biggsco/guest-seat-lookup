const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const { normalizeCell } = require('./formatting');

const guestUpload = multer({
  storage: multer.memoryStorage()
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});

function generateUploadToken() {
  return crypto.randomBytes(12).toString('hex');
}

function parseWorkbookFromBuffer(fileBuffer, originalName) {
  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    raw: false
  });

  const sheetNames = workbook.SheetNames || [];

  if (!sheetNames.length) {
    throw new Error('No sheet found in uploaded file');
  }

  const combinedRows = [];
  const sourceSheets = [];

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      blankrows: false,
      defval: ''
    });

    if (!rows.length) continue;

    sourceSheets.push(sheetName);

    const bodyRows = rows.slice(1).filter((row) =>
      row.some((cell) => String(cell || '').trim() !== '')
    );

    if (bodyRows.length) {
      combinedRows.push(...bodyRows);
    }

    if (!combinedRows.length && rows[0]) {
      combinedRows.push(rows[0]);
    }
  }

  if (!combinedRows.length) {
    throw new Error('The uploaded file is empty');
  }

  const headerSheet = workbook.Sheets[sheetNames[0]];
  const headerRows = XLSX.utils.sheet_to_json(headerSheet, { header: 1, blankrows: false, defval: '' });
  const headerSource = headerRows[0] || [];

  const headers = headerSource.map((cell, index) => {
    const value = normalizeCell(cell);
    return value || `Column ${index + 1}`;
  });

  const dataRows = combinedRows.map(row => {
    return headers.map((_, index) => normalizeCell(row[index]));
  });

  const nonEmptyRows = dataRows.filter(row =>
    row.some(cell => String(cell).trim() !== '')
  );

  return {
    originalName,
    firstSheetName: sheetNames[0],
    sheetNames: sourceSheets,
    headers,
    rows: nonEmptyRows
  };
}

function imageBufferToDataUrl(file) {
  if (!file || !file.buffer || !file.mimetype) {
    throw new Error('Invalid image upload.');
  }

  if (!file.mimetype.startsWith('image/')) {
    throw new Error('Logo must be an image file.');
  }

  const supported = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (!supported.includes(file.mimetype)) {
    throw new Error('Logo must be PNG, JPG, WEBP, or GIF.');
  }

  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

module.exports = {
  guestUpload,
  logoUpload,
  generateUploadToken,
  parseWorkbookFromBuffer,
  imageBufferToDataUrl
};
