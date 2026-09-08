import { migrate } from '../server/agent/database.ts';

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED to the target agent database before migrating.');
try {
  await migrate(connectionString);
  console.log('Agent database migrations complete.');
} catch {
  // Database errors can contain connection details. Do not emit credentials to CI.
  console.error('Agent migration failed. Check database connectivity and schema permissions.');
  process.exitCode = 1;
}
