const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

module.exports = (db) => {
  router.get('/api/tokens', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'SELECT * FROM tokens WHERE user_id = $1 ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.json(rows.map(t => ({
      id: t.id, userId: t.user_id, tokenValue: t.token_value,
      label: t.label, status: t.status, createdAt: t.created_at
    })));
  });

  router.post('/api/tokens', requireAuth, async (req, res) => {
    const { tokenValue, label } = req.body;
    if (!tokenValue) return res.status(400).json({ message: 'قيمة التوكن مطلوبة' });
    const { rows } = await db.query(
      'INSERT INTO tokens (user_id, token_value, label) VALUES ($1, $2, $3) RETURNING *',
      [req.session.userId, tokenValue, label || null]
    );
    const t = rows[0];
    res.status(201).json({ id: t.id, userId: t.user_id, tokenValue: t.token_value, label: t.label, status: t.status, createdAt: t.created_at });
  });

  router.delete('/api/tokens/:id', requireAuth, async (req, res) => {
    await db.query('DELETE FROM tokens WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.json({ message: 'تم الحذف' });
  });

  router.post('/api/tokens/:id/test', requireAuth, async (req, res) => {
    const { rows } = await db.query('SELECT * FROM tokens WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    if (!rows.length) return res.status(404).json({ valid: false, message: 'التوكن غير موجود' });
    const token = rows[0];
    try {
      const r = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: token.token_value }
      });
      if (r.ok) {
        const data = await r.json();
        await db.query("UPDATE tokens SET status = 'active' WHERE id = $1", [token.id]);
        return res.json({ valid: true, message: `صالح — @${data.username}` });
      }
      await db.query("UPDATE tokens SET status = 'invalid' WHERE id = $1", [token.id]);
      res.json({ valid: false, message: 'التوكن غير صالح' });
    } catch (e) {
      res.json({ valid: false, message: 'فشل الاتصال بـ Discord' });
    }
  });

  return router;
};
