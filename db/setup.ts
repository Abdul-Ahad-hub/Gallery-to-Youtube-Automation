import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

async function setupDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is not set. Add your Neon PostgreSQL connection string to .env.');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf-8');

  const statements = schemaSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);

  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log('GoalCast AI Neon PostgreSQL schema initialized successfully.');
}

setupDatabase().catch((err) => {
  console.error('Failed to initialize Neon PostgreSQL schema:', err);
  process.exit(1);
});
