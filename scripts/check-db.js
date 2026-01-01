/* eslint-disable no-console */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import chalk from 'chalk';
import semver from 'semver';
import { PrismaClient } from '../generated/prisma/client.js';

const MIN_VERSION = '9.4.0';

if (process.env.SKIP_DB_CHECK) {
  console.log('Skipping database check.');
  process.exit(0);
}

const url = new URL(process.env.DATABASE_URL);

function getSslOptions(connectionUrl) {
  const ssl = connectionUrl.searchParams.get('ssl');
  const sslmode = connectionUrl.searchParams.get('sslmode');
  const envSsl = process.env.DATABASE_SSL;
  const envRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  const envCa = process.env.DATABASE_SSL_CA;
  const envCaBase64 = process.env.DATABASE_SSL_CA_BASE64;
  const debugSsl = process.env.DATABASE_SSL_DEBUG;

  const enabled =
    envSsl === '1' ||
    envSsl === 'true' ||
    ssl === '1' ||
    ssl === 'true' ||
    (sslmode && sslmode !== 'disable');

  if (!enabled) return undefined;

  // Match common Postgres semantics:
  // - sslmode=require: encrypt but do not verify (rejectUnauthorized=false)
  // - sslmode=verify-ca/verify-full: verify (rejectUnauthorized=true)
  // If DATABASE_SSL_REJECT_UNAUTHORIZED is set, it always wins.
  const envRejectUnauthorizedIsSet = envRejectUnauthorized !== undefined;

  const rejectUnauthorized = envRejectUnauthorizedIsSet
    ? !(envRejectUnauthorized === '0' || envRejectUnauthorized === 'false')
    : sslmode === 'require' || sslmode === 'prefer'
      ? false
      : true;

  let ca = envCa;

  if (!ca && envCaBase64) {
    try {
      const cleaned = envCaBase64.replace(/\s+/g, '');
      ca = Buffer.from(cleaned, 'base64').toString('utf8');
    } catch {
      // ignore
    }
  }

  if (debugSsl) {
    console.log('DB SSL debug:', {
      enabled,
      rejectUnauthorized,
      sslmode,
      hasCa: !!ca,
      caLooksLikePem: typeof ca === 'string' && ca.includes('BEGIN CERTIFICATE'),
    });
  }

  return { rejectUnauthorized, ...(ca ? { ca } : {}) };
}

const sslOptions = getSslOptions(url);

const adapter = new PrismaPg(
  { connectionString: url.toString(), ...(sslOptions ? { ssl: sslOptions } : {}) },
  { schema: url.searchParams.get('schema') },
);

const prisma = new PrismaClient({ adapter });

function success(msg) {
  console.log(chalk.greenBright(`✓ ${msg}`));
}

function error(msg) {
  console.log(chalk.redBright(`✗ ${msg}`));
}

async function checkEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined.');
  } else {
    success('DATABASE_URL is defined.');
  }

  if (process.env.REDIS_URL) {
    success('REDIS_URL is defined.');
  }
}

async function checkConnection() {
  try {
    await prisma.$connect();

    success('Database connection successful.');
  } catch (e) {
    throw new Error('Unable to connect to the database: ' + e.message);
  }
}

async function checkDatabaseVersion() {
  const query = await prisma.$queryRaw`select version() as version`;
  const version = semver.valid(semver.coerce(query[0].version));

  if (semver.lt(version, MIN_VERSION)) {
    throw new Error(
      `Database version is not compatible. Please upgrade to ${MIN_VERSION} or greater.`,
    );
  }

  success('Database version check successful.');
}

async function applyMigration() {
  if (!process.env.SKIP_DB_MIGRATION) {
    console.log(execSync('prisma migrate deploy').toString());

    success('Database is up to date.');
  }
}

(async () => {
  let err = false;
  for (const fn of [checkEnv, checkConnection, checkDatabaseVersion, applyMigration]) {
    try {
      await fn();
    } catch (e) {
      error(e.message);
      err = true;
    } finally {
      if (err) {
        process.exit(1);
      }
    }
  }
})();
