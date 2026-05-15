const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

module.exports = (db) => {
  router.get('/api/logs', requireAuth, async (req, res) => {
    const { rows: tasks } = await db.query('SELECT id FROM tasks WHERE user_id = $1', [req.session.userId]);
    if (!tasks.length) return res.json([]);
    const ids = tasks.map(t => t.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `SELECT l.*, t.channel_id as task_channel FROM logs l
       LEFT JOIN tasks t ON l.task_id = t.id
       WHERE l.task_id IN (${placeholders})
       ORDER BY l.sent_at DESC LIMIT 300`,
      ids
    );
    res.json(rows.map(l => ({
      id: l.id, taskId: l.task_id, channelId: l.channel_id,
      status: l.status, errorMessage: l.error_message, sentAt: l.sent_at
    })));
  });

  router.delete('/api/logs', requireAuth, async (req, res) => {
    const { rows: tasks } = await db.query('SELECT id FROM tasks WHERE user_id = $1', [req.session.userId]);
    if (tasks.length) {
      const ids = tasks.map(t => t.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await db.query(`DELETE FROM logs WHERE task_id IN (${placeholders})`, ids);
    }
    res.json({ message: 'تم مسح السجلات' });
  });

  return router;
};
