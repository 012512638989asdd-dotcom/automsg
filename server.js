require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('[ERROR] DATABASE_URL is required in .env file');
  process.exit(1);
}

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      avatar_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_value TEXT NOT NULL,
      label VARCHAR(200),
      status VARCHAR(20) DEFAULT 'unknown',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_id INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      server_id VARCHAR(100),
      channel_id VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      image_path TEXT,
      interval_seconds INTEGER DEFAULT 300,
      is_active BOOLEAN DEFAULT true,
      sent_count INTEGER DEFAULT 0,
      next_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      channel_id VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL,
      error_message TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_notifications (
      id SERIAL PRIMARY KEY,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Add columns if missing (safe for existing DBs)
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;
  `).catch(() => {});
  console.log('[DB] Tables ready');
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'alwinsh-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(require('./routes/auth')(db));
app.use(require('./routes/tokens')(db));
app.use(require('./routes/tasks')(db));
app.use(require('./routes/logs')(db));
app.use(require('./routes/stats')(db));
app.use(require('./routes/upload')(db));
app.use(require('./routes/admin')(db));
app.use(require('./routes/profile')(db));

const { requireAuth, requireAdmin } = require('./middleware/auth');

app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/tokens',   requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'tokens.html')));
app.get('/tasks',    requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'tasks.html')));
app.get('/logs',     requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'logs.html')));
app.get('/profile',  requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/admin',    requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

initDB().then(() => {
  startScheduler(db);
  app.listen(PORT, () => console.log(`[Server] Running → http://localhost:${PORT}`));
}).catch(err => {
  console.error('[DB] Connection failed:', err.message);
  process.exit(1);
});
