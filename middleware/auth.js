function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.path.startsWith('/api')) {
      return res.status(401).json({ message: 'غير مصرح' });
    }
    return res.redirect('/');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    if (req.xhr || req.path.startsWith('/api')) {
      return res.status(403).json({ message: 'صلاحيات المشرف مطلوبة' });
    }
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
