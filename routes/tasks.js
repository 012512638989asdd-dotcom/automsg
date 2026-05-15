const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

async function sendDiscordMessage(tokenValue, channelId, message, imagePath) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const headers = { Authorization: tokenValue };

  try {
    // Send image + text together
    if (imagePath) {
      let fileBuffer = null;
      let fileName = 'image.png';
      let mimeType = 'image/png';

      if (imagePath.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', imagePath);
        if (fs.existsSync(filePath)) {
          fileBuffer = fs.readFileSync(filePath);
          fileName = path.basename(filePath);
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const mimes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
          mimeType = mimes[ext] || 'application/octet-stream';
        }
      } else if (imagePath.startsWith('http')) {
        // Remote URL — embed via embed object
        const r = await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message,
            embeds: [{ image: { url: imagePath } }]
          })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          return { success: false, error: e.message || `HTTP ${r.status}` };
        }
        return { success: true };
      }

      if (fileBuffer) {
        // Node.js 18+ has global FormData and Blob
        const fd = new FormData();
        fd.append('files[0]', new Blob([fileBuffer], { type: mimeType }), fileName);
        fd.append('payload_json', JSON.stringify({ content: message }));
        const r = await fetch(url, { method: 'POST', headers, body: fd });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          return { success: false, error: e.message || `HTTP ${r.status}` };
        }
        return { success: true };
      }
    }

    // Text-only
    const r = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return { success: false, error: e.message || `HTTP ${r.status}` };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = (db) => {
  router.get('/api/tasks', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'SELECT t.*, tok.label as token_label FROM tasks t LEFT JOIN tokens tok ON t.token_id = tok.id WHERE t.user_id = $1 ORDER BY t.created_at DESC',
      [req.session.userId]
    );
    res.json(rows.map(t => ({
      id: t.id, userId: t.user_id, tokenId: t.token_id, tokenLabel: t.token_label,
      serverId: t.server_id, channelId: t.channel_id, message: t.message,
      imagePath: t.image_path, intervalSeconds: t.interval_seconds,
      isActive: t.is_active, sentCount: t.sent_count, nextRunAt: t.next_run_at, createdAt: t.created_at
    })));
  });

  router.post('/api/tasks', requireAuth, async (req, res) => {
    const { tokenId, channelId, message, serverId, imagePath, intervalSeconds } = req.body;
    if (!tokenId || !channelId || !message) return res.status(400).json({ message: 'tokenId وchannelId والرسالة مطلوبة' });
    const secs = parseInt(intervalSeconds) || 300;
    const nextRun = new Date(Date.now() + secs * 1000);
    const { rows } = await db.query(
      `INSERT INTO tasks (user_id, token_id, channel_id, message, server_id, image_path, interval_seconds, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.userId, tokenId, channelId, message, serverId || null, imagePath || null, secs, nextRun]
    );
    const t = rows[0];
    res.status(201).json({ id: t.id, userId: t.user_id, tokenId: t.token_id, channelId: t.channel_id, message: t.message, imagePath: t.image_path, intervalSeconds: t.interval_seconds, isActive: t.is_active, sentCount: t.sent_count, nextRunAt: t.next_run_at, createdAt: t.created_at });
  });

  router.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    await db.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.json({ message: 'تم الحذف' });
  });

  router.post('/api/tasks/:id/toggle', requireAuth, async (req, res) => {
    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    if (!rows.length) return res.status(404).json({ message: 'المهمة غير موجودة' });
    const task = rows[0];
    const newActive = !task.is_active;
    const nextRun = newActive ? new Date(Date.now() + task.interval_seconds * 1000) : task.next_run_at;
    const { rows: updated } = await db.query(
      'UPDATE tasks SET is_active = $1, next_run_at = $2 WHERE id = $3 RETURNING id, is_active, next_run_at',
      [newActive, nextRun, task.id]
    );
    res.json({ id: updated[0].id, isActive: updated[0].is_active, nextRunAt: updated[0].next_run_at });
  });

  router.post('/api/tasks/:id/send', requireAuth, async (req, res) => {
    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    if (!rows.length) return res.json({ success: false, message: 'المهمة غير موجودة' });
    const task = rows[0];
    const { rows: tRows } = await db.query('SELECT * FROM tokens WHERE id = $1', [task.token_id]);
    if (!tRows.length) return res.json({ success: false, message: 'التوكن غير موجود' });
    const token = tRows[0];
    const result = await sendDiscordMessage(token.token_value, task.channel_id, task.message, task.image_path);
    await db.query(
      "INSERT INTO logs (task_id, channel_id, status, error_message) VALUES ($1,$2,$3,$4)",
      [task.id, task.channel_id, result.success ? 'success' : 'failed', result.error || null]
    );
    if (result.success) {
      await db.query('UPDATE tasks SET sent_count = sent_count + 1 WHERE id = $1', [task.id]);
    }
    res.json({ success: result.success, message: result.success ? 'تم الإرسال بنجاح ✓' : (result.error || 'فشل الإرسال') });
  });

  module.exports.sendDiscordMessage = sendDiscordMessage;
  return router;
};

module.exports.sendDiscordMessage = sendDiscordMessage;
