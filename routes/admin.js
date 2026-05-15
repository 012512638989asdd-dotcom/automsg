const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');

module.exports = (db) => {

  // ── List all users ───────────────────────────────────
  router.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT u.id, u.username, u.is_admin, u.avatar_path, u.created_at,
          (SELECT COUNT(*) FROM tokens WHERE user_id = u.id) AS token_count,
          (SELECT COUNT(*) FROM tasks  WHERE user_id = u.id) AS task_count,
          (SELECT COUNT(*) FROM tasks  WHERE user_id = u.id AND is_active = true) AS active_tasks,
          (SELECT COALESCE(SUM(sent_count),0) FROM tasks WHERE user_id = u.id) AS total_sent
        FROM users u ORDER BY u.created_at DESC
      `);
      res.json(rows.map(u => ({
        id: u.id, username: u.username, isAdmin: u.is_admin,
        avatarPath: u.avatar_path, createdAt: u.created_at,
        tokenCount: parseInt(u.token_count), taskCount: parseInt(u.task_count),
        activeTasks: parseInt(u.active_tasks), totalSent: parseInt(u.total_sent)
      })));
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Get single user detail ───────────────────────────
  router.get('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT id, username, is_admin, avatar_path, created_at FROM users WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ message: 'المستخدم غير موجود' });
      const u = rows[0];
      res.json({ id: u.id, username: u.username, isAdmin: u.is_admin, avatarPath: u.avatar_path, createdAt: u.created_at });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Change user password ─────────────────────────────
  router.post('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6)
        return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
      const hash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
      res.json({ message: 'تم تغيير كلمة المرور' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Toggle admin flag ────────────────────────────────
  router.post('/api/admin/users/:id/toggle-admin', requireAuth, requireAdmin, async (req, res) => {
    try {
      if (parseInt(req.params.id) === req.session.userId)
        return res.status(400).json({ message: 'لا يمكنك تغيير صلاحياتك الخاصة' });
      const { rows } = await db.query(
        'UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING is_admin',
        [req.params.id]
      );
      res.json({ isAdmin: rows[0].is_admin });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Delete user ──────────────────────────────────────
  router.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      if (parseInt(req.params.id) === req.session.userId)
        return res.status(400).json({ message: 'لا يمكنك حذف حسابك الخاص' });
      await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
      res.json({ message: 'تم حذف المستخدم' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Get user tokens ──────────────────────────────────
  router.get('/api/admin/users/:id/tokens', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT * FROM tokens WHERE user_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );
      res.json(rows.map(t => ({
        id: t.id, userId: t.user_id, tokenValue: t.token_value,
        label: t.label, status: t.status, createdAt: t.created_at
      })));
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Get user tasks ───────────────────────────────────
  router.get('/api/admin/users/:id/tasks', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT t.*, tok.label as token_label FROM tasks t
         LEFT JOIN tokens tok ON t.token_id = tok.id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
        [req.params.id]
      );
      res.json(rows.map(t => ({
        id: t.id, userId: t.user_id, tokenId: t.token_id, tokenLabel: t.token_label,
        channelId: t.channel_id, serverId: t.server_id, message: t.message,
        imagePath: t.image_path, intervalSeconds: t.interval_seconds,
        isActive: t.is_active, sentCount: t.sent_count, nextRunAt: t.next_run_at, createdAt: t.created_at
      })));
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Edit task (admin) ────────────────────────────────
  router.put('/api/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { channelId, message, intervalSeconds, isActive } = req.body;
      const { rows } = await db.query(
        `UPDATE tasks SET
          channel_id = COALESCE($1, channel_id),
          message = COALESCE($2, message),
          interval_seconds = COALESCE($3, interval_seconds),
          is_active = COALESCE($4, is_active)
         WHERE id = $5 RETURNING *`,
        [channelId || null, message || null, intervalSeconds ? parseInt(intervalSeconds) : null, isActive !== undefined ? isActive : null, req.params.id]
      );
      if (!rows.length) return res.status(404).json({ message: 'المهمة غير موجودة' });
      const t = rows[0];
      res.json({ id: t.id, channelId: t.channel_id, message: t.message, intervalSeconds: t.interval_seconds, isActive: t.is_active });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Toggle task (admin) ──────────────────────────────
  router.post('/api/admin/tasks/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ message: 'المهمة غير موجودة' });
      const task = rows[0];
      const newActive = !task.is_active;
      const nextRun = newActive ? new Date(Date.now() + task.interval_seconds * 1000) : task.next_run_at;
      await db.query('UPDATE tasks SET is_active = $1, next_run_at = $2 WHERE id = $3', [newActive, nextRun, task.id]);
      res.json({ isActive: newActive });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Delete task (admin) ──────────────────────────────
  router.delete('/api/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
      res.json({ message: 'تم الحذف' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Delete token (admin) ─────────────────────────────
  router.delete('/api/admin/tokens/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      await db.query('DELETE FROM tokens WHERE id = $1', [req.params.id]);
      res.json({ message: 'تم الحذف' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Send broadcast notification ──────────────────────
  router.post('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: 'نص الإشعار مطلوب' });
      const { rows: notifRows } = await db.query(
        'INSERT INTO notifications (sender_id, message) VALUES ($1, $2) RETURNING id',
        [req.session.userId, message.trim()]
      );
      const notifId = notifRows[0].id;
      const { rows: users } = await db.query('SELECT id FROM users');
      if (users.length) {
        const vals = users.map((u, i) => `($1, $${i + 2})`).join(', ');
        await db.query(
          `INSERT INTO user_notifications (notification_id, user_id) VALUES ${vals}`,
          [notifId, ...users.map(u => u.id)]
        );
      }
      res.json({ message: 'تم إرسال الإشعار لجميع المستخدمين', count: users.length });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Get notifications list (admin) ───────────────────
  router.get('/api/admin/notifications', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT n.*, u.username as sender_name,
          (SELECT COUNT(*) FROM user_notifications WHERE notification_id = n.id) as recipient_count
         FROM notifications n LEFT JOIN users u ON n.sender_id = u.id
         ORDER BY n.created_at DESC LIMIT 20`
      );
      res.json(rows.map(n => ({
        id: n.id, message: n.message, senderName: n.sender_name,
        recipientCount: parseInt(n.recipient_count), createdAt: n.created_at
      })));
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Global stats (admin) ─────────────────────────────
  router.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
    try {
      const [users, tasks, tokens, logs] = await Promise.all([
        db.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_admin) as admins FROM users'),
        db.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active, COALESCE(SUM(sent_count),0) as sent FROM tasks'),
        db.query('SELECT COUNT(*) as total FROM tokens'),
        db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='success') as success FROM logs")
      ]);
      res.json({
        totalUsers: parseInt(users.rows[0].total),
        adminCount: parseInt(users.rows[0].admins),
        totalTasks: parseInt(tasks.rows[0].total),
        activeTasks: parseInt(tasks.rows[0].active),
        totalSent: parseInt(tasks.rows[0].sent),
        totalTokens: parseInt(tokens.rows[0].total),
        totalLogs: parseInt(logs.rows[0].total),
        successLogs: parseInt(logs.rows[0].success)
      });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  return router;
};
