// Befüllt die Datenbank einmalig mit den fünf Start-Boxen: npm run seed
const { seedIfEmpty } = require('./db');

if (seedIfEmpty()) {
  console.log('Datenbank wurde mit den 5 Start-Boxen befüllt.');
} else {
  console.log('Datenbank enthält bereits Produkte – nichts zu tun.');
}
