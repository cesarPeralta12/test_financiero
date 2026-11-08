'use strict';
// Correos del sistema (verificación y recuperación de acceso). Se registran en la
// tabla emails y se envían desde la cola. Sin SMTP configurado quedan en la
// bandeja local de desarrollo (visible en el panel administrativo fuera de producción).
const db = require('../db');
const config = require('../config');
const queue = require('./queue');

let transporter = null;
function smtp() {
  if (!config.mail.smtpHost) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: config.mail.smtpSecure,
      auth: config.mail.smtpUser ? { user: config.mail.smtpUser, pass: config.mail.smtpPass } : undefined,
    });
  }
  return transporter;
}

function send({ userId = null, to, subject, text, purpose }) {
  const r = db.run(
    `INSERT INTO emails (user_id, to_email, subject, body_text, purpose, status, created_at) VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`,
    userId,
    to,
    subject,
    text,
    purpose,
    db.now()
  );
  queue.enqueue('enviar_correo', { emailId: r.lastId }, { maxAttempts: 5 });
  return r.lastId;
}

async function deliver({ emailId }) {
  const email = db.one('SELECT * FROM emails WHERE id = ?', emailId);
  if (!email || email.status === 'enviado') return;
  const t = smtp();
  try {
    if (t) {
      await t.sendMail({ from: config.mail.from, to: email.to_email, subject: email.subject, text: email.body_text });
    }
    db.run("UPDATE emails SET status = 'enviado', transport = ?, sent_at = ?, error = NULL WHERE id = ?", t ? 'smtp' : 'bandeja_local', db.now(), emailId);
  } catch (e) {
    db.run("UPDATE emails SET status = 'fallido', error = ? WHERE id = ?", String(e.message).slice(0, 300), emailId);
    throw e;
  }
}

queue.register('enviar_correo', deliver);

module.exports = { send };
