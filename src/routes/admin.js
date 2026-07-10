const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const {
  db,
  getSettings,
  setSetting,
  allCategories,
  allProductsAdmin,
  productById,
  replaceItems,
} = require('../db');
const { parseEuroToCents, slugify } = require('../util');

const router = express.Router();

// ---------- Bild-Upload ----------

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Erlaubte Dateiendung ermitteln – über den MIME-Typ oder den Dateinamen. */
function imageExtension(file) {
  if (ALLOWED_IMAGE_TYPES[file.mimetype]) return ALLOWED_IMAGE_TYPES[file.mimetype];
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${imageExtension(file) || '.jpg'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (imageExtension(file)) return cb(null, true);
    cb(new Error('Nur JPG, PNG oder WebP-Bilder sind erlaubt.'));
  },
});

/** Multer-Fehler (zu groß, falscher Typ) sauber als Formular-Fehler anzeigen. */
function uploadImages(req, res, next) {
  upload.array('images', 8)(req, res, (err) => {
    if (err) {
      req.uploadError =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Ein Bild ist größer als 5 MB. Bitte verkleinern und erneut versuchen.'
          : err.message;
    }
    next();
  });
}

// ---------- Login ----------

// Einfacher Schutz gegen Passwort-Raten: nach 5 Fehlversuchen 15 Minuten Pause.
const loginAttempts = new Map();

function loginBlocked(ip) {
  const entry = loginAttempts.get(ip);
  return entry && entry.count >= 5 && Date.now() < entry.blockedUntil;
}

function registerFailedLogin(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) entry.blockedUntil = Date.now() + 15 * 60 * 1000;
  loginAttempts.set(ip, entry);
}

function passwordMatches(given) {
  if (!config.adminPassword) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/produkte');
  res.render('admin/login', { title: 'Anmelden', error: null, noPassword: !config.adminPassword });
});

router.post('/login', (req, res) => {
  const ip = req.ip || 'unbekannt';
  if (loginBlocked(ip)) {
    return res.render('admin/login', {
      title: 'Anmelden',
      error: 'Zu viele Fehlversuche. Bitte warte 15 Minuten.',
      noPassword: !config.adminPassword,
    });
  }
  if (passwordMatches(req.body.password)) {
    loginAttempts.delete(ip);
    req.session.isAdmin = true;
    return res.redirect('/admin/produkte');
  }
  registerFailedLogin(ip);
  res.render('admin/login', {
    title: 'Anmelden',
    error: 'Das Passwort stimmt nicht.',
    noPassword: !config.adminPassword,
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Ab hier ist alles geschützt.
router.use(requireAdmin);

router.get('/', (req, res) => res.redirect('/admin/produkte'));

// ---------- Formular-Hilfen ----------

/** Ein Feld, das einfach oder mehrfach vorkommen kann, immer als Array liefern. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Unterartikel-Zeilen aus dem Formular einsammeln (leere Zeilen überspringen). */
function itemsFromForm(body) {
  const names = asArray(body.item_name);
  const notes = asArray(body.item_note);
  const items = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || '').trim();
    if (!name) continue;
    items.push({ name, note: String(notes[i] || '').trim() });
  }
  return items;
}

/** Eindeutigen Slug finden: bei Kollision wird -2, -3 … angehängt. */
function uniqueSlug(base, excludeId) {
  const candidateBase = slugify(base) || 'box';
  let candidate = candidateBase;
  let n = 2;
  const query = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?');
  while (query.get(candidate, excludeId ?? -1)) {
    candidate = `${candidateBase}-${n++}`;
  }
  return candidate;
}

/** Gemeinsame Verarbeitung für "Box anlegen" und "Box bearbeiten". */
function productFromForm(req, existing) {
  const body = req.body;
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);

  const name = String(body.name || '').trim();
  if (!name) errors.push('Bitte gib der Box einen Namen.');

  const priceCents = parseEuroToCents(body.price);
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    errors.push('Bitte gib einen gültigen Preis an, z. B. 49,90.');
  }

  // Kategorie: bestehende wählen oder direkt eine neue anlegen
  let categoryId = parseInt(body.category_id, 10) || null;
  const newCategory = String(body.new_category || '').trim();
  if (newCategory) {
    const catSlug = slugify(newCategory);
    const existingCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(catSlug);
    categoryId = existingCat
      ? existingCat.id
      : Number(db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, 99)').run(newCategory, catSlug).lastInsertRowid);
  }

  // Bilder: bestehende minus gelöschte, plus neu hochgeladene
  const keptImages = (existing ? existing.images : []).filter(
    (img) => !asArray(body.delete_images).includes(img)
  );
  const newImages = (req.files || []).map((f) => `/uploads/${f.filename}`);
  const images = [...keptImages, ...newImages];

  const items = itemsFromForm(body);
  if (items.length === 0) {
    errors.push('Bitte trage mindestens einen Unterartikel ein („Das ist drin“).');
  }

  return {
    errors,
    newImages, // frisch hochgeladene Pfade – für Aufräumen im Fehlerfall
    data: {
      name,
      slug: uniqueSlug(body.slug || name, existing ? existing.id : null),
      subtitle: String(body.subtitle || '').trim(),
      description: String(body.description || '').trim(),
      price_cents: Number.isFinite(priceCents) ? priceCents : 0,
      category_id: categoryId,
      badge: String(body.badge || '').trim(),
      active: body.active ? 1 : 0,
      sort: parseInt(body.sort, 10) || 0,
      images: JSON.stringify(images),
    },
    items,
  };
}

function renderProductForm(res, { product, items, errors, isNew }) {
  res.render('admin/product-form', {
    title: isNew ? 'Neue Box' : `Box bearbeiten: ${product.name || ''}`,
    product,
    items,
    errors: errors || [],
    isNew,
    categories: allCategories(),
  });
}

// ---------- Produkte ----------

router.get('/produkte', (req, res) => {
  res.render('admin/products', {
    title: 'Boxen verwalten',
    products: allProductsAdmin(),
    saved: req.query.ok === '1',
  });
});

router.get('/produkte/neu', (req, res) => {
  renderProductForm(res, {
    product: { name: '', slug: '', subtitle: '', description: '', price_cents: 0, category_id: null, badge: '', active: 1, sort: 0, images: [] },
    items: [{ name: '', note: '' }],
    isNew: true,
  });
});

router.post('/produkte/neu', uploadImages, (req, res) => {
  const { errors, data, items, newImages } = productFromForm(req, null);
  if (errors.length) {
    // Frische Uploads wären beim Korrektur-Submit ohnehin weg (noch nicht in der DB) –
    // deshalb entfernen wir sie gleich und weisen den Admin auf den erneuten Upload hin.
    if (newImages.length) {
      deleteUploadedFiles(newImages);
      errors.push('Bitte lade die Bilder nach dem Korrigieren erneut hoch.');
    }
    const shownImages = JSON.parse(data.images).filter((img) => !newImages.includes(img));
    return renderProductForm(res, {
      product: { ...data, images: shownImages },
      items: items.length ? items : [{ name: '', note: '' }],
      errors,
      isNew: true,
    });
  }
  const result = db.prepare(`
    INSERT INTO products (slug, name, subtitle, description, price_cents, category_id, images, badge, active, sort)
    VALUES (@slug, @name, @subtitle, @description, @price_cents, @category_id, @images, @badge, @active, @sort)
  `).run(data);
  replaceItems(Number(result.lastInsertRowid), items);
  res.redirect('/admin/produkte?ok=1');
});

router.get('/produkte/:id', (req, res) => {
  const product = productById(req.params.id);
  if (!product) return res.status(404).render('404', { title: 'Nicht gefunden' });
  renderProductForm(res, {
    product,
    items: product.items.length ? product.items : [{ name: '', note: '' }],
    isNew: false,
  });
});

router.post('/produkte/:id', uploadImages, (req, res) => {
  const product = productById(req.params.id);
  if (!product) return res.status(404).render('404', { title: 'Nicht gefunden' });

  const { errors, data, items, newImages } = productFromForm(req, product);
  if (errors.length) {
    if (newImages.length) {
      deleteUploadedFiles(newImages);
      errors.push('Bitte lade die Bilder nach dem Korrigieren erneut hoch.');
    }
    const shownImages = JSON.parse(data.images).filter((img) => !newImages.includes(img));
    return renderProductForm(res, {
      product: { ...product, ...data, images: shownImages },
      items: items.length ? items : [{ name: '', note: '' }],
      errors,
      isNew: false,
    });
  }

  db.prepare(`
    UPDATE products SET
      slug = @slug, name = @name, subtitle = @subtitle, description = @description,
      price_cents = @price_cents, category_id = @category_id, images = @images,
      badge = @badge, active = @active, sort = @sort
    WHERE id = @id
  `).run({ ...data, id: product.id });
  replaceItems(product.id, items);

  // Vom Formular abgewählte Upload-Bilder auch von der Festplatte entfernen
  deleteUploadedFiles(asArray(req.body.delete_images));

  res.redirect('/admin/produkte?ok=1');
});

router.post('/produkte/:id/aktiv', (req, res) => {
  db.prepare('UPDATE products SET active = 1 - active WHERE id = ?').run(req.params.id);
  res.redirect('/admin/produkte');
});

router.post('/produkte/:id/loeschen', (req, res) => {
  const product = productById(req.params.id);
  if (product) {
    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    deleteUploadedFiles(product.images);
  }
  res.redirect('/admin/produkte');
});

/** Hochgeladene Bilddateien löschen – ausschließlich innerhalb des Upload-Ordners. */
function deleteUploadedFiles(imagePaths) {
  for (const imagePath of imagePaths) {
    if (!String(imagePath).startsWith('/uploads/')) continue; // Seed-Grafiken behalten
    const filename = path.basename(imagePath);
    const fullPath = path.join(config.uploadDir, filename);
    fs.unlink(fullPath, () => { /* fehlende Datei ist ok */ });
  }
}

// ---------- Kategorien ----------

router.get('/kategorien', (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY c.sort, c.name
  `).all();
  res.render('admin/categories', { title: 'Kategorien', categories, error: req.query.fehler || null });
});

router.post('/kategorien', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) {
    const slug = slugify(name);
    const exists = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (!exists) {
      const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM categories').get().s;
      db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)').run(name, slug, maxSort + 1);
    }
  }
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/:id', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) {
    const slug = slugify(name) || `kategorie-${req.params.id}`;
    // Kollision vermeiden: eine andere Kategorie darf denselben Slug nicht schon belegen
    const clash = db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(slug, req.params.id);
    if (clash) {
      return res.redirect('/admin/kategorien?fehler=' + encodeURIComponent(
        'Eine andere Kategorie heißt schon so ähnlich. Bitte einen anderen Namen wählen.'
      ));
    }
    db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?')
      .run(name, slug, req.params.id);
  }
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/:id/loeschen', (req, res) => {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(req.params.id).n;
  if (inUse > 0) {
    return res.redirect('/admin/kategorien?fehler=' + encodeURIComponent(
      'Diese Kategorie enthält noch Boxen. Bitte ordne sie zuerst um.'
    ));
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/kategorien');
});

// ---------- Bestellungen ----------

router.get('/bestellungen', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all()
    .map((order) => {
      let items = [];
      try { items = JSON.parse(order.items); } catch { /* alte/kaputte Daten */ }
      return { ...order, items };
    });
  res.render('admin/orders', { title: 'Bestellungen', orders, stripeEnabled: config.stripeEnabled });
});

// Bestellstatus von Hand setzen (z. B. nach Zahlungseingang oder Versand)
const ORDER_STATES = ['offen', 'bezahlt', 'versendet', 'storniert'];
router.post('/bestellungen/:id/status', (req, res) => {
  const status = String(req.body.status || '');
  if (ORDER_STATES.includes(status)) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  res.redirect('/admin/bestellungen');
});

// ---------- Einstellungen ----------

router.get('/einstellungen', (req, res) => {
  res.render('admin/settings', {
    title: 'Einstellungen',
    settings: getSettings(),
    stripeEnabled: config.stripeEnabled,
    saved: req.query.ok === '1',
    errors: [],
  });
});

router.post('/einstellungen', (req, res) => {
  const errors = [];
  const shopName = String(req.body.shop_name || '').trim();
  if (!shopName) errors.push('Bitte gib einen Shopnamen an.');

  const shipping = parseEuroToCents(req.body.shipping);
  if (!Number.isFinite(shipping)) errors.push('Die Versandkosten sind keine gültige Zahl (z. B. 4,90).');

  const freeFrom = parseEuroToCents(req.body.free_shipping_from);
  if (!Number.isFinite(freeFrom)) errors.push('„Kostenloser Versand ab“ ist keine gültige Zahl (0 = nie).');

  if (errors.length) {
    // Eingegebene Werte beibehalten, damit nichts doppelt getippt werden muss
    return res.render('admin/settings', {
      title: 'Einstellungen',
      settings: {
        ...getSettings(),
        shop_name: shopName || getSettings().shop_name,
      },
      rawInput: req.body,
      stripeEnabled: config.stripeEnabled,
      saved: false,
      errors,
    });
  }

  setSetting('shop_name', shopName);
  setSetting('shipping_cents', shipping);
  setSetting('free_shipping_from_cents', freeFrom);
  res.redirect('/admin/einstellungen?ok=1');
});

module.exports = router;
