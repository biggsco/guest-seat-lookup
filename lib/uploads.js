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

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('No sheet found in uploaded file');
  }

  const worksheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: ''
  });

  if (!rows.length) {
    throw new Error('The uploaded file is empty');
  }

  const headers = rows[0].map((cell, index) => {
    const value = normalizeCell(cell);
    return value || `Column ${index + 1}`;
  });

  const dataRows = rows.slice(1).map(row => {
    return headers.map((_, index) => normalizeCell(row[index]));
  });

  const nonEmptyRows = dataRows.filter(row =>
    row.some(cell => String(cell).trim() !== '')
  );

  return {
    originalName,
    firstSheetName,
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
