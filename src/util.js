// Kleine Helfer, die Shop und Admin gemeinsam nutzen.

/** Cent-Betrag als deutschen Euro-Preis formatieren, z. B. 4990 -> "49,90 €" */
function formatEuro(cents) {
  return (cents / 100).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

/** Deutsche Preiseingabe ("49,90", "49.90", "50") in Cent umwandeln. NaN bei Unsinn. */
function parseEuroToCents(input) {
  const cleaned = String(input ?? '').trim().replace(/€/g, '').replace(/\s/g, '');
  if (!cleaned) return NaN;
  let normalized;
  if (cleaned.includes(',')) {
    // Deutsches Format mit Dezimalkomma: "1.234,56" -> "1234.56", "49,90" -> "49.90"
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // Nur Tausenderpunkte ohne Komma: "1.234" -> "1234"
    normalized = cleaned.replace(/\./g, '');
  } else {
    // "49.90" oder "50" – Punkt als Dezimaltrenner belassen
    normalized = cleaned;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return Math.round(value * 100);
}

/** URL-taugliche Kennung aus einem Namen erzeugen ("Erste-Wohnung-Box" -> "erste-wohnung-box") */
function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Kurze, lesbare Bestellnummer, z. B. "AB-K7F3QX" */
function orderRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'AB-';
  const bytes = require('crypto').randomBytes(6);
  for (const b of bytes) ref += chars[b % chars.length];
  return ref;
}

/** SQLite-UTC-Zeitstempel ("2026-07-10 13:05:22") als deutsche Lokalzeit anzeigen. */
function formatDateTime(sqliteUtc) {
  if (!sqliteUtc) return '';
  // SQLite speichert ohne Zeitzone; das "Z" markiert den Wert als UTC.
  const date = new Date(String(sqliteUtc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return String(sqliteUtc);
  return date.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

module.exports = { formatEuro, parseEuroToCents, slugify, orderRef, formatDateTime };
