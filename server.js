const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./src/config');
const { getSettings, seedIfEmpty } = require('./src/db');
const { formatEuro, formatDateTime } = require('./src/util');
const shopRoutes = require('./src/routes/shop');
const adminRoutes = require('./src/routes/admin');
const { router: checkoutRoutes, stripeWebhookHandler } = require('./src/routes/checkout');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Beim ersten Start automatisch mit den 5 Boxen befüllen
if (seedIfEmpty()) console.log('Datenbank mit den 5 Start-Boxen befüllt.');

// Stripe-Webhook braucht den rohen Body – deshalb VOR den Body-Parsern.
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Hinter einem HTTPS-Proxy (Railway, Render, nginx …) muss Express dem X-Forwarded-Proto
// vertrauen, damit secure-Cookies korrekt gesetzt werden.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // In Produktion nur über HTTPS übertragen; lokal (http://localhost) bleibt es aus.
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 Stunden angemeldet bleiben
  },
}));

// Daten, die jede Seite braucht (Shopname, Preisformat, Admin-Status)
app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.formatEuro = formatEuro;
  res.locals.formatDateTime = formatDateTime;
  res.locals.isAdmin = Boolean(req.session && req.session.isAdmin);
  res.locals.stripeEnabled = config.stripeEnabled;
  res.locals.currentPath = req.path;
  next();
});

app.use('/', shopRoutes);
app.use('/', checkoutRoutes);
app.use('/admin', adminRoutes);

// 404 für alles Übrige
app.use((req, res) => {
  res.status(404).render('404', { title: 'Seite nicht gefunden' });
});

// Zentrale Fehlerbehandlung: nichts Rohes an Besucher durchreichen
app.use((err, req, res, next) => {
  console.error('Unerwarteter Fehler:', err);
  if (res.headersSent) return next(err);
  // Locals absichern: bei Body-Parser-Fehlern lief die Locals-Middleware noch nicht,
  // sonst scheitert das Template selbst (settings/formatEuro fehlen).
  res.locals.settings = res.locals.settings || getSettings();
  res.locals.formatEuro = res.locals.formatEuro || formatEuro;
  res.locals.isAdmin = res.locals.isAdmin || false;
  res.locals.stripeEnabled = res.locals.stripeEnabled ?? config.stripeEnabled;
  res.locals.currentPath = res.locals.currentPath || req.path;
  res.status(500).render('500', { title: 'Etwas ist schiefgelaufen' });
});

app.listen(config.port, () => {
  console.log(`AnlassBox läuft: http://localhost:${config.port}`);
  console.log(`Admin-Bereich:   http://localhost:${config.port}/admin`);
  if (!config.stripeEnabled) {
    console.log('Hinweis: Kein Stripe-Schlüssel gesetzt – Checkout läuft im Demo-Modus.');
  }
});
