const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.session.userId}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (!allowed.includes(path.extname(file.originalname).toLowerCase()))
      return cb(new Error('نوع الملف غير مدعوم'));
    cb(null, true);
  }
});

module.exports = (db) => {

  // ── Get profile ──────────────────────────────────────
  router.get('/api/profile', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT id, username, is_admin, avatar_path, created_at FROM users WHERE id = $1',
        [req.session.userId]
      );
      if (!rows.length) return res.status(404).json({ message: 'المستخدم غير موجود' });
      const u = rows[0];
      res.json({ id: u.id, username: u.username, isAdmin: u.is_admin, avatarPath: u.avatar_path, createdAt: u.created_at });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Change own password ──────────────────────────────
  router.post('/api/profile/password', requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword)
        return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
      if (newPassword.length < 6)
        return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
      const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
      if (!rows.length) return res.status(404).json({ message: 'المستخدم غير موجود' });
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
      const hash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.userId]);
      res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Upload avatar ────────────────────────────────────
  router.post('/api/profile/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'لم يتم رفع صورة' });
      const avatarPath = `/uploads/avatars/${req.file.filename}`;
      const { rows: oldRows } = await db.query('SELECT avatar_path FROM users WHERE id = $1', [req.session.userId]);
      if (oldRows[0]?.avatar_path) {
        const oldFile = path.join(__dirname, '..', oldRows[0].avatar_path);
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      await db.query('UPDATE users SET avatar_path = $1 WHERE id = $2', [avatarPath, req.session.userId]);
      res.json({ avatarPath, message: 'تم رفع الصورة بنجاح' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Get user notifications ───────────────────────────
  router.get('/api/notifications', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT n.id, n.message, n.created_at, un.is_read, u.username as sender_name
         FROM user_notifications un
         JOIN notifications n ON un.notification_id = n.id
         LEFT JOIN users u ON n.sender_id = u.id
         WHERE un.user_id = $1 ORDER BY n.created_at DESC LIMIT 30`,
        [req.session.userId]
      );
      res.json(rows.map(n => ({
        id: n.id, message: n.message, isRead: n.is_read,
        senderName: n.sender_name, createdAt: n.created_at
      })));
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Mark notifications as read ───────────────────────
  router.post('/api/notifications/read', requireAuth, async (req, res) => {
    try {
      await db.query(
        'UPDATE user_notifications SET is_read = true WHERE user_id = $1',
        [req.session.userId]
      );
      res.json({ message: 'تم التحديث' });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  // ── Unread count ─────────────────────────────────────
  router.get('/api/notifications/unread', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT COUNT(*) as count FROM user_notifications WHERE user_id = $1 AND is_read = false',
        [req.session.userId]
      );
      res.json({ count: parseInt(rows[0].count) });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  return router;
};
