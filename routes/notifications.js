const express = require('express');
const router = express.Router();
const db = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/notifications
router.get('/', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const list = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(userId);
  const unread = db.prepare(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0'
  ).get(userId)?.c || 0;
  res.json({ notifications: list, unread_count: unread });
});

// POST /api/notifications/read-all  (harus sebelum /:id/read)
router.post('/read-all', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.session.user.id);
  res.json({ success: true });
});

// POST /api/notifications/:id/read
router.post('/:id/read', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?')
    .run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

module.exports = router;
