// netlify/functions/create-booking.js
//
// Server-side booking endpoint for the HomeCare Mumbai public site.
// This is the ONLY place in the whole app that talks to Appwrite.
// It reads Appwrite credentials from server environment variables only
// (never hard-coded, never sent to the browser, never logged).
//
// Flow: validate + normalize input -> create patients row -> create
// visits row -> if the visits row fails, delete the just-created
// patients row (no orphan) -> return only {success, reference_code}.

const { Client, TablesDB, ID } = require('node-appwrite');
const { jsonResponse, fail, trimTo, isPlausiblePhone, notifyCoordinator, buildRequestSummary } = require('./_shared');

const DB_ID = 'homecare';
const PATIENTS_TABLE = 'patients';
const VISITS_TABLE = 'visits';

// Matches the column sizes created in Appwrite (see backend setup report).
const LIMITS = {
  full_name: 150,
  phone: 20,
  alternate_phone: 20,
  address: 500,
  area: 100,
  brief_condition: 500,
  service_type: 100,
  requested_time_slot: 50,
  duration_or_frequency: 100,
  request_notes: 1000,
};

const MAX_BODY_BYTES = 20000; // generous for a form with no file payload

function genReferenceCode() {
  // Unambiguous alphabet (no 0/O, 1/I) - good enough randomness for this
  // small pilot; not used as a security token, just a human-friendly ID.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return 'HC-' + out;
}

function parseRequestedDate(raw) {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
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

    // ---- Validate & normalize required fields ----
    const full_name = trimTo(data.name, LIMITS.full_name);
    const phone = trimTo(data.phone, LIMITS.phone);
    const service_type = trimTo(data.service, LIMITS.service_type);
    const area = trimTo(data.area, LIMITS.area);
    const address = trimTo(data.address, LIMITS.address);

    if (!full_name) return fail(400, 'Please enter the patient name.');
    if (!phone || !isPlausiblePhone(phone)) return fail(400, 'Please enter a valid phone number.');
    if (!service_type) return fail(400, 'Please select a service.');
    if (!area) return fail(400, 'Please select your area.');
    if (!address) return fail(400, 'Please enter the home address.');

    // ---- Optional fields ----
    const alternate_phone_raw = trimTo(data.alternatePhone, LIMITS.alternate_phone);
    const alternate_phone = alternate_phone_raw && isPlausiblePhone(alternate_phone_raw) ? alternate_phone_raw : undefined;

    const requested_date = parseRequestedDate(data.date);
    const requested_time_slot = trimTo(data.time, LIMITS.requested_time_slot) || undefined;
    const duration_or_frequency = trimTo(data.duration, LIMITS.duration_or_frequency) || undefined;

    // The form's "Brief Condition / Notes" field feeds both the patient's
    // brief_condition and the visit's request_notes (it is literally the
    // same field in the UI), each truncated to its own column size.
    const rawNotes = trimTo(data.notes, 2000);
    const brief_condition = rawNotes ? trimTo(rawNotes, LIMITS.brief_condition) : undefined;
    const request_notes = rawNotes ? trimTo(rawNotes, LIMITS.request_notes) : undefined;

    // ---- Appwrite server credentials (server env vars only) ----
    const endpoint = process.env.APPWRITE_ENDPOINT;
    const projectId = process.env.APPWRITE_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;

    if (!endpoint || !projectId || !apiKey) {
      console.error('create-booking: missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY env var(s)');
      return fail(500, 'Booking service is temporarily unavailable. Please use WhatsApp or call us.');
    }

    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const tablesDB = new TablesDB(client);

    // ---- 1. Create patient row ----
    let patientId;
    try {
      const patientData = { full_name, phone, address, area };
      if (alternate_phone) patientData.alternate_phone = alternate_phone;
      if (brief_condition) patientData.brief_condition = brief_condition;

      const patientRow = await tablesDB.createRow(DB_ID, PATIENTS_TABLE, ID.unique(), patientData);
      patientId = patientRow.$id;
    } catch (err) {
      console.error('create-booking: patient row creation failed:', err && err.message);
      await notifyCoordinator(
        '⚠️ HomeCare: online booking FAILED to save',
        buildRequestSummary('⚠️ A website booking could not be saved (patient step failed) — check WhatsApp/phone for this patient.', [
          ['Patient', full_name], ['Phone', phone], ['Service', service_type],
          ['Area', area], ['Address', address],
        ])
      );
      return fail(502, 'We could not save your request right now. Please use WhatsApp or call us.');
    }

    // ---- 2. Create visit row, linked to the patient row ----
    const reference_code = genReferenceCode();
    try {
      const visitData = {
        reference_code,
        patient_id: patientId,
        service_type,
        request_source: 'website',
        area,
        address,
        clinical_review_required: false,
        status: 'new_request',
        concern_flag: false,
        provider_confirmation: 'not_asked',
      };
      if (requested_date) visitData.requested_date = requested_date;
      if (requested_time_slot) visitData.requested_time_slot = requested_time_slot;
      if (duration_or_frequency) visitData.duration_or_frequency = duration_or_frequency;
      if (request_notes) visitData.request_notes = request_notes;

      await tablesDB.createRow(DB_ID, VISITS_TABLE, ID.unique(), visitData);
    } catch (err) {
      console.error('create-booking: visit row creation failed:', err && err.message);
      // Compensate: do not leave an orphan patient row.
      try {
        await tablesDB.deleteRow(DB_ID, PATIENTS_TABLE, patientId);
      } catch (cleanupErr) {
        console.error('create-booking: FAILED to clean up orphan patient row', patientId, '-', cleanupErr && cleanupErr.message);
      }
      await notifyCoordinator(
        '⚠️ HomeCare: online booking FAILED to save',
        buildRequestSummary('⚠️ A website booking could not be saved (visit step failed) — check WhatsApp/phone for this patient.', [
          ['Patient', full_name], ['Phone', phone], ['Service', service_type],
          ['Area', area], ['Address', address],
        ])
      );
      return fail(502, 'We could not save your request right now. Please use WhatsApp or call us.');
    }

    // ---- Notify coordinator (best-effort — never blocks the response) ----
    await notifyCoordinator(
      `🆕 HomeCare booking ${reference_code}`,
      buildRequestSummary(`🆕 New HomeCare booking request — Ref ${reference_code}`, [
        ['Patient', full_name], ['Phone', phone], ['Service', service_type],
        ['Area', area], ['Address', address],
        ['Date', requested_date ? requested_date.slice(0, 10) : undefined],
        ['Time', requested_time_slot],
        ['Duration', duration_or_frequency],
        ['Notes', request_notes],
      ])
    );

    // ---- Success: return only safe, minimal info ----
    return jsonResponse(200, { success: true, reference_code });
  } catch (err) {
    console.error('create-booking: unexpected error:', err && err.message);
    return fail(500, 'Something went wrong. Please use WhatsApp or call us.');
  }
};
