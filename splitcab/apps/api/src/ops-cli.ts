// Support commands for data requests made by email. Run with the API's environment variables:
//   npm run ops -w @splitcab/api -- export +353871234567 > their-data.json
//   npm run ops -w @splitcab/api -- delete +353871234567 --yes
// In the container: node dist/ops-cli.js export +353871234567
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { deleteUser, exportUser } from './ops';

const [command, phone, flag] = process.argv.slice(2);
if (!phone || (command !== 'export' && command !== 'delete')) {
  console.error('Usage: ops-cli export <phone> | ops-cli delete <phone> --yes');
  process.exit(1);
}
if (command === 'delete' && flag !== '--yes') {
  console.error('Deleting an account cannot be undone. Add --yes to confirm.');
  process.exit(1);
}

const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const db = createPool({ ...config, DATABASE_POOL_MAX: 2 });
const built = await buildApp({ config, db });
try {
  if (command === 'export') {
    console.log(JSON.stringify(await exportUser(built, phone), null, 2));
  } else {
    await deleteUser(built, phone);
    console.error('Account deleted. The API job worker releases any holds and removes the Stripe customer.');
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await built.app.close();
  await db.end();
}
