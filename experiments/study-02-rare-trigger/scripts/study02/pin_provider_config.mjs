#!/usr/bin/env node
/**
 * Write the key-free evidence pin for the authorized provider configuration.
 * Reads the Pi configuration, validates the exactly-authorized model, and writes
 * design/provider-config-pin.json WITHOUT any credential value.
 *
 * No network, no model calls. Run:
 *   pnpm exec tsx scripts/study02/pin_provider_config.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProviderConfig, publicSnapshot } from './provider_config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.resolve(HERE, '../..');
const OUT = path.join(STUDY, 'design', 'provider-config-pin.json');

const config = loadProviderConfig();
const snapshot = publicSnapshot(config);
const pin = {
  pin_version: 'study02-provider-config-pin-1.0',
  status: 'offline configuration evidence; key-free; no API call; not a preregistration freeze',
  observed_at: new Date().toISOString(),
  authorized_model: true,
  only_authorized_model: true,
  ...snapshot,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(pin, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`provider=${pin.provider} model=${pin.modelId} context=${pin.contextWindow} maxTokens=${pin.maxTokens}`);
console.log(`credential source=${pin.credential.source} fingerprint=${pin.credential.fingerprintSha256_16} (value not printed)`);
