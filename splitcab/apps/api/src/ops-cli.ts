// Support commands. Run with the API's environment variables:
//   npm run ops -w @splitcab/api -- reports                         open safety reports, newest first
//   npm run ops -w @splitcab/api -- suspend +353871234567 "reason"   pause an account while you look into it
//   npm run ops -w @splitcab/api -- unsuspend +353871234567          lift the pause; their open reports are marked dealt with
//   npm run ops -w @splitcab/api -- export +353871234567 > their-data.json
//   npm run ops -w @splitcab/api -- delete +353871234567 --yes
// In the container: node dist/ops-cli.js <command> ...
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { deleteUser, exportUser, openReports, suspendUser, unsuspendUser } from './ops';

const USAGE = 'Usage: ops-cli reports | suspend <phone> [reason] | unsuspend <phone> | export <phone> | delete <phone> --yes';
const [command, phone, ...rest] = process.argv.slice(2);
const needsPhone = ['suspend', 'unsuspend', 'export', 'delete'];
if (!command || !(command === 'reports' || needsPhone.includes(command)) || (needsPhone.includes(command) && !phone)) {
  console.error(USAGE);
  process.exit(1);
}
if (command === 'delete' && rest[0] !== '--yes') {
  console.error('Deleting an account cannot be undone. Add --yes to confirm.');
  process.exit(1);
}

const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const db = createPool({ ...config, DATABASE_POOL_MAX: 2 });
const built = await buildApp({ config, db });
try {
  if (command === 'reports') {
    const reports = await openReports(built);
    console.log(reports.length ? JSON.stringify(reports, null, 2) : 'No open reports.');
  } else if (command === 'suspend') {
    await suspendUser(built, phone!, rest.join(' '));
    console.error('Account paused. Their open trips are cancelled; the API job worker releases or refunds the fees.');
  } else if (command === 'unsuspend') {
    await unsuspendUser(built, phone!);
    console.error('Pause lifted, and their open reports are marked as dealt with.');
  } else if (command === 'export') {
    console.log(JSON.stringify(await exportUser(built, phone!), null, 2));
  } else {
    await deleteUser(built, phone!);
    console.error('Account deleted. The API job worker releases any holds and removes the Stripe customer.');
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await built.app.close();
  await db.end();
}
