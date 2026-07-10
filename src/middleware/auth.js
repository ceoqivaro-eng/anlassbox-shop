// Schützt alle Admin-Seiten: ohne Login geht es zur Anmeldemaske.
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };
