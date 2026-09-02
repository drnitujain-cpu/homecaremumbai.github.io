// netlify/functions/setup-issues-table.js
//
// ONE-TIME schema setup. Creates the `issues` table (per CLAUDE.md's
// data model) in the `homecare` database: one lightweight table for any
// concern type, many rows allowed per visit.
//
// Requires the server's APPWRITE_API_KEY to temporarily have
// `tables.write` and `columns.write` scopes in addition to its normal
// scopes. Remove those two schema-write scopes from the key again once
// this has run successfully.
//
// Delete this file once the table is confirmed created.

const { Client, TablesDB, Permission, Role } = require('node-appwrite');

const DB_ID = 'homecare';
const TABLE_ID = 'issues';

exports.handler = async (event) => {
  if (event.queryStringParameters?.setup !== 'issues-v1') {
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
      name: 'Issues',
      permissions: [
        Permission.read(Role.users()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
      ],
      rowSecurity: false,
    });
    log.push('Created table: issues');
  } catch (err) {
    log.push('Table create: ' + (err.message || err));
  }

  const columns = [
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'visit_id', size: 60, required: true }),
    () => tablesDB.createEnumColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'issue_type', elements: ['clinical_concern', 'service_complaint', 'late_or_no_show', 'payment_issue', 'other'], required: true }),
    () => tablesDB.createStringColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'description', size: 500, required: false }),
    () => tablesDB.createEnumColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'status', elements: ['open', 'resolved'], required: true, default: 'open' }),
    () => tablesDB.createEnumColumn({ databaseId: DB_ID, tableId: TABLE_ID, key: 'raised_by', elements: ['patient', 'provider', 'coordinator'], required: true, default: 'coordinator' }),
  ];

  for (const create of columns) {
    try {
      const res = await create();
      log.push('Created column: ' + res.key);
    } catch (err) {
      log.push('Column error: ' + (err.message || err));
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ log }, null, 2),
  };
};
