require('dotenv').config();

const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'unsicher-bitte-setzen',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  dbFile: path.join(__dirname, '..', 'data', 'shop.db'),
  uploadDir: path.join(__dirname, '..', 'public', 'uploads'),
};

config.stripeEnabled = config.stripeSecretKey.length > 0;

module.exports = config;
