const express = require('express');
const {
  activeProducts,
  productBySlug,
  categoriesWithActiveProducts,
} = require('../db');

const router = express.Router();

// Startseite mit allen Boxen, optional nach Kategorie gefiltert (?kategorie=slug)
router.get('/', (req, res) => {
  const categories = categoriesWithActiveProducts();
  const requested = String(req.query.kategorie || '');
  const activeCategory = categories.find((c) => c.slug === requested) || null;
  const products = activeProducts(activeCategory ? activeCategory.slug : undefined);

  res.render('index', {
    title: null, // Startseite nutzt den Shop-Namen allein
    products,
    categories,
    activeCategory,
  });
});

// Detailseite einer Box
router.get('/box/:slug', (req, res) => {
  const product = productBySlug(req.params.slug);
  if (!product || !product.active) {
    return res.status(404).render('404', { title: 'Nicht gefunden' });
  }
  const related = activeProducts()
    .filter((p) => p.id !== product.id)
    .slice(0, 3);
  res.render('product', { title: product.name, product, related });
});

// Warenkorb (Inhalte kommen per JavaScript aus dem localStorage)
router.get('/warenkorb', (req, res) => {
  res.render('cart', { title: 'Warenkorb' });
});

// Produktdaten für den Warenkorb (Preise kommen immer frisch vom Server)
router.get('/api/products', (req, res) => {
  const products = activeProducts().map((p) => ({
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    price_cents: p.price_cents,
    image: p.images[0] || '/img/boxes/platzhalter.svg',
    item_count: undefined,
  }));
  res.json({ products });
});

// Rechtliche Pflichtseiten (Platzhalter-Inhalte, bitte befüllen)
const legalPages = {
  impressum: 'Impressum',
  datenschutz: 'Datenschutzerklärung',
  agb: 'Allgemeine Geschäftsbedingungen',
  widerruf: 'Widerrufsbelehrung',
};

for (const [slug, heading] of Object.entries(legalPages)) {
  router.get(`/${slug}`, (req, res) => {
    res.render(`legal/${slug}`, { title: heading, heading });
  });
}

module.exports = router;
