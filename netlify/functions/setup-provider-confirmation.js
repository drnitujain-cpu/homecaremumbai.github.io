// netlify/functions/setup-provider-confirmation.js
//
// ONE-TIME schema addition: adds a `provider_confirmation` column to the
// existing `visits` table (not_asked/awaiting_reply/accepted/declined),
// tracked separately from the visit's main status per CLAUDE.md's
// "provider accepts OR coordinator records acceptance on provider's
// behalf" workflow.
//
// Requires the server's APPWRITE_API_KEY to temporarily have
// `columns.write` scope in addition to its normal scopes (no
// `tables.write` needed this time -- we're adding a column to an
// existing table, not creating a new one). Remove that scope again
// once this has run successfully. Delete this file once confirmed.

const { Client, TablesDB } = require('node-appwrite');

const DB_ID = 'homecare';
const TABLE_ID = 'visits';

exports.handler = async (event) => {
  if (event.queryStringParameters?.setup !== 'provider-confirmation-v1') {
    return { statusCode: 403, body: 'Missing or wrong setup token.' };
  }

  const endpoint = process.env.APPWRITE_ENDPOINT;
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    return { statusCode: 500, body: 'Missing Appwrite env vars.' };
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const tablesDB = new TablesDB(client);
  const log = [];

  try {
    const res = await tablesDB.createEnumColumn({
      databaseId: DB_ID,
      tableId: TABLE_ID,
      key: 'provider_confirmation',
      elements: ['not_asked', 'awaiting_reply', 'accepted', 'declined'],
      required: true,
      default: 'not_asked',
    });
    log.push('Created column: ' + res.key);
  } catch (err) {
    log.push('Column error: ' + (err.message || err));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log }, null, 2),
  };
};
