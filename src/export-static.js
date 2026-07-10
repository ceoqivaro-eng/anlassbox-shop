// Erzeugt eine statische Präsentations-Version des Shops für GitHub Pages.
// Rendert die EJS-Seiten zu HTML in den Ordner /docs, kopiert alle Assets und
// schreibt die Produktdaten als JSON. Aufruf:  npm run build:static
//
// Basispfad = Repo-Name, weil GitHub-Project-Pages unter
// https://<user>.github.io/<repo>/ liegen (nicht im Wurzelverzeichnis).

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const {
  activeProducts,
  productBySlug,
  categoriesWithActiveProducts,
  getSettings,
  seedIfEmpty,
} = require('./db');
const { formatEuro } = require('./util');

const BASE = (process.env.STATIC_BASE || '/anlassbox-shop').replace(/\/+$/, '');
const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'docs');

seedIfEmpty();
const settings = getSettings();

function baseLocals(extra) {
  return {
    settings,
    formatEuro,
    isAdmin: false,
    stripeEnabled: false,
    currentPath: '/',
    ...extra,
  };
}

/** Root-absolute URLs mit dem Basispfad versehen und den Static-Schalter injizieren. */
function postProcess(html) {
  html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
  html = html.replace(
    '</head>',
    `<script>window.ANLASSBOX_STATIC=${JSON.stringify(BASE)}</script>\n</head>`
  );
  return html;
}

async function renderPage(view, data, outPath) {
  const html = await ejs.renderFile(path.join(VIEWS, view), baseLocals(data));
  const full = path.join(OUT, outPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, postProcess(html), 'utf8');
  return outPath;
}

async function main() {
  // Alten Build entfernen und Assets frisch kopieren
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.cpSync(PUBLIC, OUT, { recursive: true });

  // Jekyll aushebeln (sonst ignoriert GitHub Pages Dateien mit führendem _)
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  const products = activeProducts();
  const categories = categoriesWithActiveProducts();
  const built = [];

  // Startseite
  built.push(await renderPage('index.ejs', {
    title: null, products, categories, activeCategory: null,
  }, 'index.html'));

  // Kategorie-gefilterte Startseiten (damit die Filter-Links funktionieren)
  for (const category of categories) {
    const filtered = products.filter((p) => p.category_slug === category.slug);
    built.push(await renderPage('index.ejs', {
      title: category.name, products: filtered, categories, activeCategory: category,
    }, `kategorie/${category.slug}/index.html`));
  }

  // Box-Detailseiten
  for (const listItem of products) {
    const product = productBySlug(listItem.slug);
    const related = products.filter((p) => p.id !== product.id).slice(0, 3);
    built.push(await renderPage('product.ejs', {
      title: product.name, product, related,
    }, `box/${product.slug}/index.html`));
  }

  // Warenkorb
  built.push(await renderPage('cart.ejs', { title: 'Warenkorb' }, 'warenkorb/index.html'));

  // Rechtsseiten
  const legal = { impressum: 'Impressum', datenschutz: 'Datenschutzerklärung', agb: 'Allgemeine Geschäftsbedingungen', widerruf: 'Widerrufsbelehrung' };
  for (const [slug, heading] of Object.entries(legal)) {
    built.push(await renderPage(`legal/${slug}.ejs`, { title: heading, heading }, `${slug}/index.html`));
  }

  // 404-Seite (GitHub Pages nutzt /404.html)
  built.push(await renderPage('404.ejs', { title: 'Seite nicht gefunden' }, '404.html'));

  // Produktdaten für den Warenkorb (statt der Server-API)
  const productsJson = {
    products: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      subtitle: p.subtitle,
      price_cents: p.price_cents,
      image: BASE + (p.images[0] || '/img/boxes/platzhalter.svg'),
    })),
  };
  fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'api', 'products.json'), JSON.stringify(productsJson), 'utf8');

  // url(/…) in CSS ebenfalls anpassen (falls je vorhanden)
  for (const cssFile of fs.readdirSync(path.join(OUT, 'css'))) {
    const p = path.join(OUT, 'css', cssFile);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/url\(\/(?!\/)/g, `url(${BASE}/`), 'utf8');
  }

  console.log(`Statische Präsentation erstellt in /docs (Basispfad ${BASE}):`);
  console.log(`  ${built.length} Seiten, ${products.length} Boxen, ${categories.length} Kategorien.`);
}

main().catch((err) => {
  console.error('Export fehlgeschlagen:', err);
  process.exit(1);
});
