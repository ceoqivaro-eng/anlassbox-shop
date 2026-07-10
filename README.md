# AnlassBox – Webshop für Geschenkboxen

Ein kompletter Webshop für Geschenkboxen zu jedem Anlass: Shop mit Warenkorb und
Stripe-Kasse, plus Admin-Bereich zum Pflegen von Boxen, Kategorien und Bestellungen –
ganz ohne Code anzufassen.

## Starten

```bash
npm install
npm start
```

- Shop: http://localhost:3000
- Admin: http://localhost:3000/admin

Beim ersten Start wird die Datenbank automatisch mit den 5 Start-Boxen befüllt
(Erste Wohnung, Führerschein, Baby, Reise, Breakup).

## Admin-Zugang

Das Passwort steht in der Datei `.env` unter `ADMIN_PASSWORD`
(aktuell: `anlassbox-admin` – **bitte ändern!**). Nach einer Änderung den Server
neu starten (Strg+C, dann wieder `npm start`).

## Neue Box anlegen

1. Im Admin auf **Boxen → + Neue Box**.
2. Name, Preis und Beschreibung eintragen, Kategorie wählen (oder direkt eine neue
   anlegen – z. B. „Feiertage“, „Hobbys“, „Events“).
3. Unter **Das ist drin** die Unterartikel zeilenweise eintragen – beliebig viele,
   das System bleibt immer gleich strukturiert.
4. Bilder hochladen (das erste Bild ist das Titelbild) und speichern.

Jede Box erscheint sofort im Shop und bekommt automatisch ihre eigene Seite.

## Echte Zahlungen freischalten (Stripe)

Ohne Stripe-Schlüssel läuft die Kasse im **Demo-Modus**: Bestellungen werden
gespeichert, aber es fließt kein Geld. So schaltest du echte Zahlungen frei:

1. Kostenloses Konto auf [stripe.com](https://stripe.com) anlegen.
2. Im Stripe-Dashboard unter **Entwickler → API-Schlüssel** den *geheimen Schlüssel*
   (`sk_live_…` bzw. zum Testen `sk_test_…`) kopieren.
3. In `.env` eintragen: `STRIPE_SECRET_KEY=sk_…`
4. Für die automatische „bezahlt“-Markierung: im Stripe-Dashboard einen Webhook auf
   `https://deine-domain.de/webhook/stripe` anlegen (Ereignisse
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`) und das Webhook-Geheimnis als
   `STRIPE_WEBHOOK_SECRET=whsec_…` eintragen. **Ohne dieses Secret werden Zahlungen aus
   Sicherheitsgründen nicht automatisch bestätigt** – du setzt den Status dann von Hand
   im Admin unter „Bestellungen“.
5. Server neu starten.

## Vor dem Livegang

- [ ] `ADMIN_PASSWORD` und `SESSION_SECRET` in `.env` ändern
- [ ] Impressum, Datenschutz, AGB und Widerruf befüllen (Platzhalter unter `views/legal/`)
      – am besten rechtlich prüfen lassen
- [ ] Echte Produktfotos im Admin hochladen
- [ ] Stripe-Schlüssel eintragen und eine Testbestellung machen
- [ ] Hosting mit HTTPS (z. B. Railway, Render, Hetzner) und `BASE_URL` in `.env` anpassen
- [ ] `NODE_ENV=production` setzen (aktiviert sichere Cookies) und Stripe-Webhook einrichten

## Technik

- Node.js + Express, EJS-Templates, SQLite (Datei `data/shop.db`)
- Bilder-Uploads liegen in `public/uploads/`
- Produktdaten: Tabellen `products` (Box) und `product_items` (Unterartikel) –
  flexibel in der Menge, konsistent in der Struktur
