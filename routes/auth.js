const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

module.exports = (db) => {
  router.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
      const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.is_admin;
      res.json({ id: user.id, username: user.username, isAdmin: user.is_admin, avatarPath: user.avatar_path });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
      if (username.length < 3) return res.status(400).json({ message: 'اسم المستخدم 3 أحرف على الأقل' });
      if (password.length < 6) return res.status(400).json({ message: 'كلمة المرور 6 أحرف على الأقل' });
      const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.rows.length > 0) return res.status(400).json({ message: 'اسم المستخدم موجود بالفعل' });
      const hash = await bcrypt.hash(password, 10);
      // First user becomes admin automatically
      const countRes = await db.query('SELECT COUNT(*) as c FROM users');
      const isFirstUser = parseInt(countRes.rows[0].c) === 0;
      const { rows } = await db.query(
        'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin',
        [username, hash, isFirstUser]
      );
      const user = rows[0];
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.is_admin;
      res.status(201).json({ id: user.id, username: user.username, isAdmin: user.is_admin });
    } catch (e) { res.status(500).json({ message: e.message }); }
  });

  router.get('/api/auth/me', (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'غير مصرح' });
    res.json({
      id: req.session.userId,
      username: req.session.username,
      isAdmin: req.session.isAdmin || false
    });
  });

  router.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {});
    res.json({ message: 'تم تسجيل الخروج' });
  });

  return router;
};
