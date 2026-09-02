// netlify/functions/setup-providers-table.js
//
// ONE-TIME schema setup. Creates the `providers` table (per CLAUDE.md's
// data model) in the `homecare` database, with the same table-level
// "Users" role permissions as patients/visits.
//
// Requires the server's APPWRITE_API_KEY to temporarily have
// `tables.write` and `columns.write` scopes in addition to its normal
// rows.write/databases.read/tables.read scopes. Remove those two
// schema-write scopes from the key again once this has run successfully
// -- the production booking function never needs them.
//
// Delete this file once the table is confirmed created. It is not linked
// from anywhere and does nothing destructive (it only creates things that
// don't already exist), but it has no business staying in the deployed
// function set permanently.

const { Client, TablesDB, Permission, Role } = require('node-appwrite');

const DB_ID = 'homecare';
const TABLE_ID = 'providers';

exports.handler = async (event) => {
  if (event.queryStringParameters?.setup !== 'providers-v1') {
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
    await tablesDB.createTable({
      databaseId: DB_ID,
      tableId: TABLE_ID,
      name: 'Providers',
      permissions: [
        Permission.read(Role.users()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
      ],
      rowSecurity: false,
    });
    log.push('Created table: providers');
  } catch (err) {
    log.push('Table create: ' + (err.message || err));
  }

  const columns = [
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'full_name', size: 150, required: true }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'phone', size: 20, required: true }),
    () => tablesDB.createEnumColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'provider_type', elements: ['nurse', 'doctor', 'physiotherapist', 'wound_stoma_specialist', 'other'], required: true }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'skills', size: 60, required: false, default: null, array: true }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'service_areas', size: 60, required: false, default: null, array: true }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'availability_note', size: 300, required: false }),
    () => tablesDB.createEnumColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'active_status', elements: ['active', 'inactive', 'pending_verification'], required: true, default: 'pending_verification' }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'payout_rate_note', size: 150, required: false }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'preferred_by_patients', size: 300, required: false }),
  ];

  for (const create of columns) {
    try {
      const res = await create();
      log.push('Created column: ' + res.key);
    } catch (err) {
      log.push('Column error: ' + (err.message || err));
    }
    // Small delay -- Appwrite processes attribute creation asynchronously
    // and can reject rapid-fire concurrent schema writes on the same table.
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log }, null, 2),
  };
};
