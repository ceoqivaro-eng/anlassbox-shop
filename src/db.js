const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    slug  TEXT NOT NULL UNIQUE,
    sort  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    subtitle    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    images      TEXT NOT NULL DEFAULT '[]',
    badge       TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ref               TEXT NOT NULL UNIQUE,
    stripe_session_id TEXT,
    email             TEXT NOT NULL DEFAULT '',
    name              TEXT NOT NULL DEFAULT '',
    items             TEXT NOT NULL DEFAULT '[]',
    amount_cents      INTEGER NOT NULL DEFAULT 0,
    shipping_cents    INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'offen',
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---------- Einstellungen ----------

const DEFAULT_SETTINGS = {
  shop_name: 'AnlassBox',
  shipping_cents: '490',
  free_shipping_from_cents: '6000',
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  settings.shipping_cents = parseInt(settings.shipping_cents, 10) || 0;
  settings.free_shipping_from_cents = parseInt(settings.free_shipping_from_cents, 10) || 0;
  return settings;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// ---------- Kategorien ----------

function allCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort, name').all();
}

function categoriesWithActiveProducts() {
  return db.prepare(`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c
    JOIN products p ON p.category_id = c.id AND p.active = 1
    GROUP BY c.id
    ORDER BY c.sort, c.name
  `).all();
}

// ---------- Produkte ----------

function rowToProduct(row) {
  if (!row) return null;
  let images = [];
  try { images = JSON.parse(row.images); } catch { /* kaputte Daten ignorieren */ }
  return { ...row, images: Array.isArray(images) ? images : [] };
}

function activeProducts(categorySlug) {
  const baseQuery = `
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT COUNT(*) FROM product_items i WHERE i.product_id = p.id) AS item_count
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1`;
  const rows = categorySlug
    ? db.prepare(`${baseQuery} AND c.slug = ? ORDER BY p.sort, p.id`).all(categorySlug)
    : db.prepare(`${baseQuery} ORDER BY p.sort, p.id`).all();
  return rows.map(rowToProduct);
}

function productBySlug(slug) {
  const row = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ?
  `).get(slug);
  const product = rowToProduct(row);
  if (product) product.items = productItems(product.id);
  return product;
}

function productById(id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const product = rowToProduct(row);
  if (product) product.items = productItems(product.id);
  return product;
}

function allProductsAdmin() {
  return db.prepare(`
    SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM product_items i WHERE i.product_id = p.id) AS item_count
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.sort, p.id
  `).all().map(rowToProduct);
}

function productItems(productId) {
  return db.prepare('SELECT * FROM product_items WHERE product_id = ? ORDER BY sort, id').all(productId);
}

/** Unterartikel eines Produkts komplett ersetzen (einfach & konsistent). */
const replaceItems = db.transaction((productId, items) => {
  db.prepare('DELETE FROM product_items WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT INTO product_items (product_id, name, note, sort) VALUES (?, ?, ?, ?)');
  items.forEach((item, index) => insert.run(productId, item.name, item.note || '', index));
});

// ---------- Seed: die ersten fünf Boxen ----------

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) return false;

  const insertCategory = db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)');
  const insertProduct = db.prepare(`
    INSERT INTO products (slug, name, subtitle, description, price_cents, category_id, images, badge, active, sort)
    VALUES (@slug, @name, @subtitle, @description, @price_cents, @category_id, @images, @badge, 1, @sort)
  `);

  const seed = db.transaction(() => {
    const meilensteine = insertCategory.run('Meilensteine', 'meilensteine', 0).lastInsertRowid;
    insertCategory.run('Feiertage', 'feiertage', 1);
    insertCategory.run('Hobbys', 'hobbys', 2);
    insertCategory.run('Events', 'events', 3);

    const boxes = [
      {
        slug: 'erste-wohnung-box',
        name: 'Erste-Wohnung-Box',
        subtitle: 'Alles für den Start in den eigenen vier Wänden',
        description:
          'Der Umzugskarton ist ausgepackt, der Schlüssel steckt – und jetzt? Diese Box feiert den großen Schritt in die erste eigene Wohnung. Zehn liebevoll ausgewählte Teile, die den Einzug leichter, gemütlicher und ein bisschen festlicher machen. Das perfekte Geschenk zur Einweihungsparty oder als Überraschung vor der ersten Nacht im neuen Zuhause.',
        price_cents: 4990,
        badge: 'Bestseller',
        sort: 0,
        items: [
          { name: 'Salz & Brot im Geschenksäckchen', note: 'Die klassische Einzugstradition – für Wohlstand und Sesshaftigkeit' },
          { name: 'Duftkerze „Neues Zuhause“', note: 'Warmer Vanille-Sandelholz-Duft für den ersten gemütlichen Abend' },
          { name: 'Mini-Werkzeugset', note: 'Hammer, Schraubendreher & Zollstock für die ersten Bilder an der Wand' },
          { name: 'Erste-Hilfe-Kit', note: 'Weil beim Möbelaufbau schon mal ein Pflaster fällig wird' },
          { name: 'Schlüsselanhänger „Home“', note: 'Damit der wichtigste Schlüssel sofort erkennbar ist' },
          { name: 'Türstopper aus Filz', note: 'Praktisch beim Kistenschleppen, hübsch danach' },
          { name: 'Rezeptkarten „Schnelle Küche“', note: '10 Gerichte, die auch ohne volle Küchenausstattung gelingen' },
          { name: 'Kräutersamen fürs Fensterbrett', note: 'Basilikum & Schnittlauch – der erste eigene „Garten“' },
          { name: 'Korkuntersetzer-Set', note: 'Schützt die neuen Möbel von Tag eins' },
          { name: 'Wunderkerzen für die Einweihung', note: 'Für den Moment, in dem angestoßen wird' },
        ],
      },
      {
        slug: 'fuehrerschein-box',
        name: 'Führerschein-Box',
        subtitle: 'Für den ersten Kilometer Freiheit',
        description:
          'Bestanden! Der Führerschein ist in der Tasche und die Welt plötzlich ein ganzes Stück größer. Diese Box gratuliert mit zehn Teilen, die im ersten eigenen Auto sofort gebraucht werden – vom Eiskratzer bis zum Glücksbringer für den Rückspiegel.',
        price_cents: 3990,
        badge: '',
        sort: 1,
        items: [
          { name: 'Parkscheibe', note: 'Pflicht in jeder Innenstadt – und ständig verlegt' },
          { name: 'Eiskratzer mit Handschuh', note: 'Für den ersten Winter hinterm Steuer' },
          { name: 'Auto-Duftanhänger', note: 'Neuwagen-Duft, auch wenn das erste Auto keiner ist' },
          { name: 'Glücksbringer für den Rückspiegel', note: 'Ein kleiner Schutzengel fährt immer mit' },
          { name: 'Handyhalterung fürs Auto', note: 'Navi nutzen, ohne Punkte zu riskieren' },
          { name: 'Erste-Hilfe-Täschchen', note: 'Kompakte Ergänzung fürs Handschuhfach' },
          { name: 'Mikrofasertuch', note: 'Für klare Sicht und saubere Scheiben' },
          { name: 'Snack-Paket „Erste Fahrt“', note: 'Traubenzucker & Riegel gegen Prüfungs-Nachbeben' },
          { name: 'Schlüsselanhänger „Endlich!“', note: 'Für den ersten eigenen Autoschlüssel' },
          { name: 'Fahranfänger-Magnet', note: 'Mit Humor: „Ich übe noch“ – abnehmbar, versprochen' },
        ],
      },
      {
        slug: 'baby-box',
        name: 'Baby-Box',
        subtitle: 'Willkommen, kleiner Mensch',
        description:
          'Ein neuer Erdenbürger ist da – und mit ihm die Frage: Was schenkt man frischen Eltern, das wirklich gebraucht wird? Diese Box antwortet mit zehn durchdachten Teilen für die ersten Wochen: praktisch, weich und zum Verlieben.',
        price_cents: 4490,
        badge: 'Beliebt',
        sort: 2,
        items: [
          { name: 'Baby-Body Gr. 56', note: 'Aus Bio-Baumwolle, unisex in Naturweiß' },
          { name: 'Musselin-Tuch', note: 'Der Allrounder: Spucktuch, Decke, Sonnenschutz' },
          { name: 'Lätzchen mit Druckknopf', note: 'Für die ersten Milch-Abenteuer' },
          { name: 'Babysocken im Doppelpack', note: 'Winzig, warm und immer zu klein gekauft' },
          { name: 'Beißring aus Naturkautschuk', note: 'Für später – die Zähnchen kommen schneller als gedacht' },
          { name: 'Windel-Notfall-Täschchen', note: 'Für unterwegs, wenn es schnell gehen muss' },
          { name: 'Meilenstein-Karten „Erstes Jahr“', note: '12 Karten für Fotos vom ersten Lächeln bis zum ersten Schritt' },
          { name: 'Badethermometer', note: 'Damit das erste Bad genau richtig warm ist' },
          { name: 'Schnullerkette aus Holz', note: 'Handgefertigt, schadstofffrei' },
          { name: 'Karte „Ihr schafft das!“', note: 'Ein paar ehrliche Worte für übermüdete Eltern' },
        ],
      },
      {
        slug: 'reise-box',
        name: 'Reise-Box',
        subtitle: 'Für alle, die endlich losziehen',
        description:
          'Sabbatical, Weltreise, erster großer Trip – egal wohin es geht: Diese Box packt zehn Reisebegleiter ein, die im Rucksack und Koffer den Unterschied machen. Das ideale Abschiedsgeschenk für alle, die man schon jetzt vermisst.',
        price_cents: 4290,
        badge: '',
        sort: 3,
        items: [
          { name: 'Aufblasbares Nackenkissen', note: 'Klein gepackt, groß im Langstreckenflug' },
          { name: 'Schlafmaske', note: 'Für Nachtflüge und Hostels mit dünnen Vorhängen' },
          { name: 'Ohrstöpsel im Etui', note: 'Ruhe auf Knopfdruck, wo auch immer' },
          { name: 'Kofferanhänger', note: 'Damit der Rucksack am Gepäckband sofort auffällt' },
          { name: 'Packwürfel 3er-Set', note: 'Ordnung im Chaos – der Geheimtipp aller Vielreisenden' },
          { name: 'Universal-Reiseadapter', note: 'Passt in über 150 Länder' },
          { name: 'Reisetagebuch', note: 'Für Gedanken, Tickets und Servietten-Notizen' },
          { name: 'Mini-Kulturset', note: 'Handgepäcktaugliche Reisegrößen zum Nachfüllen' },
          { name: 'Desinfektionsgel', note: 'Der unglamouröse Held jeder Reise' },
          { name: 'Rubbel-Weltkarte (A4)', note: 'Jedes bereiste Land wird freigerubbelt' },
        ],
      },
      {
        slug: 'breakup-box',
        name: 'Breakup-Box',
        subtitle: 'Erste Hilfe für gebrochene Herzen',
        description:
          'Manchmal braucht es keine Ratschläge, sondern eine Umarmung in Kartonform. Die Breakup-Box ist das Geschenk für die beste Freundin oder den besten Freund mit Liebeskummer: zehn Teile zum Auffangen, Aufpäppeln und langsam wieder Nach-vorne-schauen.',
        price_cents: 3490,
        badge: 'Mit Herz',
        sort: 4,
        items: [
          { name: 'Taschentücher „Für den Anfang“', note: 'Weil erst mal alles raus muss' },
          { name: 'Schokolade in Herzform', note: 'Zartbitter – wie die Lage, aber süßer' },
          { name: 'Tee „Seelenwärmer“', note: 'Kräutermischung für lange Abende auf dem Sofa' },
          { name: 'Duftkerze „Neuanfang“', note: 'Frischer Zitrus-Duft gegen trübe Gedanken' },
          { name: 'Gesichtsmaske', note: 'Selfcare-Abend statt Ex-Profil stalken' },
          { name: 'Anti-Stress-Knetball', note: 'Für Momente, in denen man etwas drücken muss' },
          { name: 'Playlist-Karte „Heartbreak to Happy“', note: 'QR-Code: von Adele bis Tanzlaune in 40 Songs' },
          { name: 'Badesalz „Abtauchen“', note: 'Lavendel für die verdiente Auszeit' },
          { name: 'Notizbuch „Kapitel Neu“', note: 'Für alles, was jetzt kommt' },
          { name: 'Motivationskarten', note: '10 Karten mit ehrlichen Aufmunterungen – null Kitsch' },
        ],
      },
    ];

    for (const box of boxes) {
      const { items, ...productData } = box;
      const productId = insertProduct.run({
        ...productData,
        category_id: meilensteine,
        images: JSON.stringify([`/img/boxes/${box.slug}.svg`]),
      }).lastInsertRowid;
      replaceItems(productId, items);
    }
  });

  seed();
  return true;
}

module.exports = {
  db,
  getSettings,
  setSetting,
  allCategories,
  categoriesWithActiveProducts,
  activeProducts,
  productBySlug,
  productById,
  allProductsAdmin,
  productItems,
  replaceItems,
  seedIfEmpty,
};
