// Run by `npm version` after package.json is bumped: copies the new version
// into manifest.json and records it in versions.json.
import { readFileSync, writeFileSync } from 'fs';

const version = process.env.npm_package_version;
if (!version) throw new Error('Run this through `npm version`, not directly.');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
