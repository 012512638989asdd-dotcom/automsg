const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

module.exports = (db) => {
  router.get('/api/stats', requireAuth, async (req, res) => {
    const uid = req.session.userId;
    const [tRes, tkRes, taskRows] = await Promise.all([
      db.query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM tokens WHERE user_id=$1`, [uid]),
      db.query(`SELECT COUNT(*) as total, SUM(CASE WHEN is_active=true THEN 1 ELSE 0 END) as active, COALESCE(SUM(sent_count),0) as sent FROM tasks WHERE user_id=$1`, [uid]),
      db.query('SELECT id FROM tasks WHERE user_id=$1', [uid])
    ]);
    const totalTokens = parseInt(tRes.rows[0].total) || 0;
    const activeTokens = parseInt(tRes.rows[0].active) || 0;
    const totalTasks = parseInt(tkRes.rows[0].total) || 0;
    const activeTasks = parseInt(tkRes.rows[0].active) || 0;
    const totalSent = parseInt(tkRes.rows[0].sent) || 0;
    let successRate = 0;
    if (taskRows.rows.length) {
      const ids = taskRows.rows.map(t => t.id);
      const ph = ids.map((_,i)=>`$${i+1}`).join(',');
      const lRes = await db.query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success FROM logs WHERE task_id IN (${ph})`, ids);
      const total = parseInt(lRes.rows[0].total) || 0;
      const success = parseInt(lRes.rows[0].success) || 0;
      successRate = total > 0 ? Math.round(success / total * 100) : 0;
    }
    res.json({ totalTokens, activeTokens, totalTasks, activeTasks, totalSent, successRate });
  });

  return router;
};
