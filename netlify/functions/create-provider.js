// netlify/functions/create-provider.js
//
// Server-side provider-onboarding endpoint. Same safe pattern as
// create-booking.js: the public form never talks to Appwrite directly,
// this function validates input and writes with server-held credentials
// only. New providers always land as active_status='pending_verification'
// -- a coordinator must manually verify and activate them in the
// Operations Admin app before they can be assigned any bookings.

const { Client, TablesDB, ID } = require('node-appwrite');
const { jsonResponse, fail, trimTo, isPlausiblePhone, notifyCoordinator, buildRequestSummary } = require('./_shared');

const DB_ID = 'homecare';
const PROVIDERS_TABLE = 'providers';

const LIMITS = {
  full_name: 150,
  phone: 20,
  availability_note: 300,
  payout_rate_note: 150,
};
const VALID_PROVIDER_TYPES = ['nurse', 'doctor', 'physiotherapist', 'wound_stoma_specialist', 'other'];
const MAX_BODY_BYTES = 20000;
const MAX_TAGS = 10;
const TAG_MAX_LEN = 60;

function splitTags(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_TAGS).map(s => s.slice(0, TAG_MAX_LEN));
}

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
    if (!data || typeof data !== 'object') {
      return fail(400, 'Invalid request.');
    }

    // Honeypot: real users never see or fill this field.
    if (trimTo(data.website, 200)) {
      return fail(400, 'Request rejected.');
    }

    const full_name = trimTo(data.name, LIMITS.full_name);
    const phone = trimTo(data.phone, LIMITS.phone);
    const provider_type = trimTo(data.providerType, 40);

    if (!full_name) return fail(400, 'Please enter your name.');
    if (!phone || !isPlausiblePhone(phone)) return fail(400, 'Please enter a valid mobile number.');
    if (!VALID_PROVIDER_TYPES.includes(provider_type)) return fail(400, 'Please select a valid provider type.');

    const skills = splitTags(data.skills);
    const service_areas = splitTags(data.areas);
    const availability_note = trimTo(data.availability, LIMITS.availability_note) || undefined;
    const payout_rate_note = trimTo(data.rate, LIMITS.payout_rate_note) || undefined;

    const endpoint = process.env.APPWRITE_ENDPOINT;
    const projectId = process.env.APPWRITE_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;
    if (!endpoint || !projectId || !apiKey) {
      console.error('create-provider: missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY env var(s)');
      return fail(500, 'Onboarding is temporarily unavailable. Please contact us on WhatsApp instead.');
    }

    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const tablesDB = new TablesDB(client);

    try {
      const providerData = {
        full_name, phone, provider_type,
        active_status: 'pending_verification',
      };
      if (skills.length) providerData.skills = skills;
      if (service_areas.length) providerData.service_areas = service_areas;
      if (availability_note) providerData.availability_note = availability_note;
      if (payout_rate_note) providerData.payout_rate_note = payout_rate_note;

      await tablesDB.createRow(DB_ID, PROVIDERS_TABLE, ID.unique(), providerData);
    } catch (err) {
      console.error('create-provider: row creation failed:', err && err.message);
      return fail(502, 'We could not submit your details right now. Please contact us on WhatsApp instead.');
    }

    // Best-effort — never blocks the response.
    await notifyCoordinator(
      `🧑‍⚕️ New provider signup: ${full_name}`,
      buildRequestSummary(`🧑‍⚕️ New provider onboarding submission — please verify before activating`, [
        ['Name', full_name], ['Phone', phone], ['Type', provider_type],
        ['Skills', skills.join(', ')], ['Areas', service_areas.join(', ')],
        ['Availability', availability_note], ['Rate expectation', payout_rate_note],
      ])
    );

    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error('create-provider: unexpected error:', err && err.message);
    return fail(500, 'Something went wrong. Please contact us on WhatsApp instead.');
  }
};
