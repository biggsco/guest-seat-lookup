function isUploadEnabled() {
  return Boolean(process.env.UPLOADS_ENABLED === 'true');
}

module.exports = { isUploadEnabled };
