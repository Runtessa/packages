const registerErrorHandler = (app) => {
  app.use((err, _req, res, _next) => {
    console.error('[monitoring] unhandled error:', err instanceof Error ? err.message : String(err));
    if (res.headersSent) return;
    const statusCode =
      Number(err?.statusCode || err?.status || 500) >= 400 &&
      Number(err?.statusCode || err?.status || 500) < 600
        ? Number(err?.statusCode || err?.status || 500)
        : 500;
    const message = statusCode >= 500 ? 'Internal Server Error' : String(err?.message || 'Request failed');
    res.status(statusCode).json({ error: message });
  });
};

module.exports = {
  registerErrorHandler,
};
