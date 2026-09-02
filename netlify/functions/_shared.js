// netlify/functions/_shared.js
//
// Shared helpers for the public-facing Netlify Functions (create-booking,
// create-provider). Not a function itself (no exports.handler), so Netlify
// never treats this as its own endpoint -- just bundled in wherever it's
// required.

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function fail(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message });
}

function trimTo(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function isPlausiblePhone(p) {
  // Digits, spaces, +, -, parentheses only; 7-20 chars. Always kept as a string.
  return /^[0-9+\-\s()]{7,20}$/.test(p);
}

// ══════════════════════════════════════
// COORDINATOR NOTIFICATIONS (Telegram + email)
//
// Best-effort only. A missing/failed notification never affects whether the
// underlying save succeeds or fails. Configure via server environment
// variables (Netlify dashboard) -- never hard-code a token/key here, never
// send one to the browser.
// ══════════════════════════════════════
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO;
const NOTIFY_EMAIL_FROM = process.env.NOTIFY_EMAIL_FROM || 'HomeCare Mumbai <onboarding@resend.dev>';

async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    if (!resp.ok) console.error('notifyTelegram: Telegram API returned', resp.status);
  } catch (err) {
    console.error('notifyTelegram failed:', err && err.message);
  }
}

async function notifyEmail(subject, text) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO) return;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: NOTIFY_EMAIL_FROM, to: [NOTIFY_EMAIL_TO], subject, text }),
    });
    if (!resp.ok) console.error('notifyEmail: Resend API returned', resp.status);
  } catch (err) {
    console.error('notifyEmail failed:', err && err.message);
  }
}

async function notifyCoordinator(subject, text) {
  await Promise.allSettled([notifyTelegram(text), notifyEmail(subject, text)]);
}

function buildRequestSummary(headerLine, fields) {
  const lines = [headerLine, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  return lines.join('\n');
}

module.exports = {
  jsonResponse, fail, trimTo, isPlausiblePhone,
  notifyCoordinator, buildRequestSummary,
};
