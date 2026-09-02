// netlify/functions/notify-team.js
//
// Relays a short status/coordination summary from the Operations Admin
// app to the same Telegram/email channel used for new-booking alerts, so
// the receptionist/coordinator side stays coordinated and the admin/owner
// can supervise without opening the admin app themselves.
//
// No Appwrite access here at all -- this only sends notifications, it
// never touches the database. Uses the same TELEGRAM_BOT_TOKEN /
// TELEGRAM_CHAT_ID / RESEND_API_KEY env vars as create-booking.js.

const { jsonResponse, fail, trimTo, notifyCoordinator } = require('./_shared');

const MAX_BODY_BYTES = 5000;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return fail(405, 'Method not allowed.');
    }
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return fail(400, 'Invalid request.');
    }
    if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
      return fail(413, 'Request too large.');
    }

    let data;
    try {
      data = JSON.parse(event.body || '{}');
    } catch {
      return fail(400, 'Invalid request.');
    }

    const subject = trimTo(data.subject, 200) || 'HomeCare update';
    const text = trimTo(data.text, 3000);
    if (!text) return fail(400, 'Nothing to send.');

    await notifyCoordinator(subject, text);
    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error('notify-team: unexpected error:', err && err.message);
    return fail(500, 'Could not send notification.');
  }
};
