// Einmaliges Update: aktualisiert die "Das ist drin"-Listen der 5 Start-Boxen in der bestehenden DB.
const { db, productBySlug, replaceItems } = require('./db');

const updates = {
  'erste-wohnung-box': [
    { name: 'Dosenöffner', note: '' },
    { name: 'Mini-Werkzeugset', note: 'Für die ersten Bilder an der Wand' },
    { name: 'Sekundenkleber', note: '' },
    { name: 'Maßband', note: '' },
    { name: 'Messbecher', note: '' },
    { name: 'Mikrofasertuch', note: '' },
    { name: 'Spülbürste', note: '' },
    { name: 'Raumduft', note: '' },
    { name: 'Mehrfachsteckdose', note: '' },
    { name: 'Duschabzieher', note: '' },
  ],
  'fuehrerschein-box': [
    { name: 'Handyhalterung', note: '' },
    { name: 'Eiskratzer', note: '' },
    { name: 'Mikrofasertuch', note: '' },
    { name: 'Notfallhammer mit Gurtschneider', note: '' },
    { name: 'Parkscheibe', note: '' },
    { name: 'Auto-Duft', note: '' },
    { name: 'Einkaufswagenchip', note: '' },
    { name: 'Warnweste', note: '' },
    { name: 'Innenraum-LEDs', note: '' },
    { name: 'Scratch Remover', note: 'Lackkratzer-Entferner' },
  ],
  'baby-box': [
    { name: 'Kuscheltier', note: '' },
    { name: 'Babysocken', note: '' },
    { name: 'Eltern-Entscheidungswürfel', note: '' },
    { name: 'Feuchttücher', note: '' },
    { name: 'Hand- & Fußabdruck-Set', note: '' },
    { name: 'Windel-Glocke', note: '' },
    { name: 'Notfall-Windelset', note: '' },
    { name: 'Faltbare Wickelunterlage', note: '' },
    { name: 'Kinderwagen-Anhänger', note: '' },
  ],
  'reise-box': [
    { name: 'TSA-Kofferschloss', note: '' },
    { name: 'Universal-Reiseadapter', note: '' },
    { name: 'Flugzeug-Handyhalter', note: 'Wow-Produkt' },
    { name: 'Reisepasshülle', note: '' },
    { name: 'Vakuumbeutel für Kleidung', note: '' },
    { name: 'Mückenspray', note: 'Reisegröße' },
    { name: 'Sonnencreme', note: 'Reisegröße' },
    { name: 'Blasenpflaster', note: '' },
    { name: 'Melatonin', note: '' },
    { name: 'Schlafmaske', note: '' },
  ],
  'breakup-box': [
    { name: 'Kuschelsocken', note: '' },
    { name: 'Taschentücher', note: '' },
    { name: 'Duftkerze', note: '' },
    { name: 'Partybrille', note: '' },
    { name: 'Herzförmige Seife', note: '„Wash the past away.“' },
    { name: 'Augenpads', note: '' },
    { name: 'Heiße Schokolade', note: '' },
    { name: 'Wärmeflasche', note: '' },
    { name: 'Ewige Rose', note: 'Wow-Produkt' },
  ],
};

let updated = 0;
for (const [slug, items] of Object.entries(updates)) {
  const product = productBySlug(slug);
  if (!product) {
    console.log(`Übersprungen (nicht gefunden): ${slug}`);
    continue;
  }
  replaceItems(product.id, items);
  updated++;
  console.log(`Aktualisiert: ${slug} (${items.length} Teile)`);
}

console.log(`Fertig. ${updated} Boxen aktualisiert.`);
