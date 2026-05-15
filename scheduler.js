const { sendDiscordMessage } = require('./routes/tasks');

function startScheduler(db) {
  console.log('[Scheduler] Started — checking every 10s');
  setInterval(async () => {
    try {
      const now = new Date();
      const { rows: tasks } = await db.query(
        "SELECT t.*, tok.token_value FROM tasks t JOIN tokens tok ON t.token_id = tok.id WHERE t.is_active = true AND t.next_run_at <= $1",
        [now]
      );
      for (const task of tasks) {
        try {
          if (task.status === 'invalid') continue;
          const result = await sendDiscordMessage(task.token_value, task.channel_id, task.message, task.image_path);
          await db.query(
            "INSERT INTO logs (task_id, channel_id, status, error_message) VALUES ($1,$2,$3,$4)",
            [task.id, task.channel_id, result.success ? 'success' : 'failed', result.error || null]
          );
          const nextRun = new Date(Date.now() + task.interval_seconds * 1000);
          if (result.success) {
            await db.query(
              'UPDATE tasks SET sent_count = sent_count + 1, next_run_at = $1 WHERE id = $2',
              [nextRun, task.id]
            );
          } else {
            await db.query(
              'UPDATE tasks SET next_run_at = $1 WHERE id = $2',
              [nextRun, task.id]
            );
          }
        } catch (err) {
          console.error('[Scheduler] Task error:', err.message);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err.message);
    }
  }, 10000);
}

module.exports = { startScheduler };
