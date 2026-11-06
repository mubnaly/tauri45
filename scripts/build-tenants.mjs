#!/usr/bin/env node
// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Phase 6 — multi-tenant release pipeline.
 *
 * For every tenant in tenants-registry.json this rewrites the bundle identifier
 * and product name in src-tauri/tauri.conf.json, runs the Tauri build, and
 * restores the original config afterwards (even when the build fails).
 *
 * Usage:
 *   node scripts/build-tenants.mjs                     # every tenant, host platform
 *   node scripts/build-tenants.mjs --only safwa,maher  # a subset
 *   node scripts/build-tenants.mjs --platform android
 *   node scripts/build-tenants.mjs --dry-run
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'tenants-registry.json');
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');

function parseArgs(argv) {
    const args = { only: null, platform: null, dryRun: false, debug: false };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--only') {
            args.only = (argv[++index] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
        } else if (arg === '--platform') {
            args.platform = argv[++index] ?? null;
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--debug') {
            args.debug = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log('Usage: node scripts/build-tenants.mjs [--only a,b] [--platform android] [--dry-run] [--debug]');
            process.exit(0);
        }
    }

    return args;
}

/** `Al-Safwa Learning Platform` -> `Al-Safwa` */
function productNameFor(tenant) {
    const base = (tenant.description ?? tenant.id)
        .replace(/ Learning Platform$/i, '')
        .replace(/[^\p{L}\p{N} ._-]/gu, '')
        .trim();

    return base || tenant.id;
}

function bundleTarget(platform) {
    switch (platform) {
        case 'android':
            return ['--apk', '--aab'];
        case 'ios':
            return ['--ios'];
        case 'windows':
            return ['--bundles', 'msi,nsis'];
        case 'macos':
            return ['--bundles', 'app,dmg'];
        case 'linux':
            return ['--bundles', 'deb,appimage'];
        default:
            return [];
    }
}

const args = parseArgs(process.argv.slice(2));
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const tenants = registry.tenants.filter((tenant) => !args.only || args.only.includes(tenant.id));

if (!tenants.length) {
    console.error('No matching tenants. Known ids:', registry.tenants.map((tenant) => tenant.id).join(', '));
    process.exit(1);
}

const originalConfig = await readFile(configPath, 'utf8');
const baseConfig = JSON.parse(originalConfig);
const extraArgs = bundleTarget(args.platform);
const failures = [];

for (const tenant of tenants) {
    const identifier = tenant.bundle_id ?? `com.dawwar.online.allama.${tenant.id}`;
    const productName = productNameFor(tenant);

    console.log(`\n=== ${tenant.id} — ${productName} (${identifier}) ===`);

    if (args.dryRun) {
        console.log(`would run: npx tauri build ${extraArgs.join(' ')}`);
        continue;
    }

    const config = {
        ...baseConfig,
        productName,
        identifier,
        bundle: { ...baseConfig.bundle, active: true },
    };

    await writeFile(configPath, `${JSON.stringify(config, null, 4)}\n`, 'utf8');

    try {
        const result = spawnSync('npx', ['tauri', 'build', ...extraArgs], {
            cwd: root,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            env: {
                ...process.env,
                ALLAMA_TENANT: tenant.id,
                ALLAMA_SITE_URL: tenant.backend_url,
                ALLAMA_BUNDLE_ID: identifier,
            },
        });

        if (result.status !== 0) {
            failures.push(`${tenant.id} (exit ${result.status ?? 'signal'})`);
        }
    } finally {
        await writeFile(configPath, originalConfig, 'utf8');
    }
}

if (failures.length) {
    console.error(`\nBuild failed for: ${failures.join(', ')}`);
    process.exit(1);
}

console.log(`\nDone. ${args.dryRun ? 'Checked' : 'Built'} ${tenants.length} tenant(s).`);
