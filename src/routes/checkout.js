const express = require('express');
const config = require('../config');
const { db, productBySlug, getSettings } = require('../db');
const { orderRef } = require('../util');

const stripe = config.stripeEnabled ? require('stripe')(config.stripeSecretKey) : null;

const router = express.Router();

/** Warenkorb-Eingabe prüfen und mit frischen Preisen aus der Datenbank anreichern. */
function buildOrderLines(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return null;
  const lines = [];
  for (const entry of items) {
    const qty = Math.floor(Number(entry && entry.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return null;
    const product = productBySlug(String(entry.slug || ''));
    if (!product || !product.active) return null;
    lines.push({
      slug: product.slug,
      name: product.name,
      price_cents: product.price_cents,
      qty,
    });
  }
  return lines;
}

function shippingFor(subtotalCents, settings) {
  if (settings.free_shipping_from_cents > 0 && subtotalCents >= settings.free_shipping_from_cents) {
    return 0;
  }
  return settings.shipping_cents;
}

const insertOrder = db.prepare(`
  INSERT INTO orders (ref, stripe_session_id, items, amount_cents, shipping_cents, status)
  VALUES (@ref, @stripe_session_id, @items, @amount_cents, @shipping_cents, @status)
`);

// Kasse: legt die Bestellung an und liefert die Weiterleitungs-URL zurück
router.post('/api/checkout', async (req, res) => {
  try {
    const lines = buildOrderLines(req.body && req.body.items);
    if (!lines) {
      return res.status(400).json({ error: 'Der Warenkorb ist leer oder enthält ungültige Artikel.' });
    }

    const settings = getSettings();
    const subtotal = lines.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
    const shipping = shippingFor(subtotal, settings);
    const ref = orderRef();

    if (!config.stripeEnabled) {
      // Demo-Modus: Bestellung wird gespeichert, aber nicht bezahlt.
      insertOrder.run({
        ref,
        stripe_session_id: null,
        items: JSON.stringify(lines),
        amount_cents: subtotal + shipping,
        shipping_cents: shipping,
        status: 'demo',
      });
      return res.json({ url: `/erfolg?ref=${encodeURIComponent(ref)}&demo=1` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'de',
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: 'eur',
          unit_amount: l.price_cents,
          product_data: { name: l.name },
        },
      })),
      shipping_address_collection: { allowed_countries: ['DE', 'AT'] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: shipping === 0 ? 'Kostenloser Versand' : 'Standardversand',
            fixed_amount: { amount: shipping, currency: 'eur' },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],
      metadata: { order_ref: ref },
      success_url: `${config.baseUrl}/erfolg?ref=${encodeURIComponent(ref)}`,
      cancel_url: `${config.baseUrl}/warenkorb`,
    });

    insertOrder.run({
      ref,
      stripe_session_id: session.id,
      items: JSON.stringify(lines),
      amount_cents: subtotal + shipping,
      shipping_cents: shipping,
      status: 'offen',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout fehlgeschlagen:', err);
    res.status(500).json({ error: 'Die Kasse ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
});

// Danke-Seite nach der Bestellung
router.get('/erfolg', (req, res) => {
  const ref = String(req.query.ref || '');
  const demo = req.query.demo === '1';
  const order = ref ? db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref) : null;
  res.render('success', { title: 'Danke für deine Bestellung', order, demo });
});

// Stripe-Webhook: markiert Bestellungen nach Zahlung als "bezahlt".
// Wichtig: braucht den ROHEN Request-Body, wird deshalb in server.js VOR dem
// JSON-Parser registriert.
function stripeWebhookHandler(req, res) {
  if (!config.stripeEnabled) return res.status(400).send('Stripe ist nicht konfiguriert.');

  // Ohne Webhook-Secret KEINE Verarbeitung: ein ungeprüfter JSON-Body ließe sich
  // sonst fälschen, um Bestellungen ohne Zahlung auf "bezahlt" zu setzen.
  if (!config.stripeWebhookSecret) {
    console.error('Webhook abgelehnt: STRIPE_WEBHOOK_SECRET ist nicht gesetzt.');
    return res.status(400).send('Webhook nicht konfiguriert.');
  }

  let event = null;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
  } catch (err) {
    console.error('Webhook abgelehnt:', err.message);
    return res.status(400).send('Ungültige Signatur.');
  }

  // Bestellung als bezahlt markieren – aber nur, wenn Stripe die Zahlung wirklich
  // bestätigt hat. Bei verzögerten Methoden (SEPA, Sofort) kommt "completed" schon
  // mit payment_status "unpaid"; der echte Eingang folgt erst mit async_payment_succeeded.
  const paidEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (paidEvents.includes(event.type)) {
    const session = event.data.object;
    const ref = session.metadata && session.metadata.order_ref;
    if (ref && session.payment_status === 'paid') {
      db.prepare(`
        UPDATE orders
        SET status = 'bezahlt',
            email = COALESCE(?, email),
            name = COALESCE(?, name)
        WHERE ref = ?
      `).run(
        session.customer_details ? session.customer_details.email : null,
        session.customer_details ? session.customer_details.name : null,
        ref
      );
    }
  } else if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const ref = session.metadata && session.metadata.order_ref;
    if (ref) {
      db.prepare("UPDATE orders SET status = 'zahlung fehlgeschlagen' WHERE ref = ?").run(ref);
    }
  }

  res.json({ received: true });
}

module.exports = { router, stripeWebhookHandler };
