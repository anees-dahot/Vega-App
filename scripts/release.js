#!/usr/bin/env node
/**
 * npm run release -- 5.4.7
 * Sets the version in app.config.js, raises versionCode by one, commits, tags
 * v5.4.7 and pushes. The Fork Release workflow then builds and publishes it.
 */
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const version = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release -- <major.minor.patch>');
  process.exit(1);
}

const run = command => execSync(command, {stdio: 'inherit'});
if (execSync('git status --porcelain').toString().trim()) {
  console.error('Commit or stash your changes first.');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'app.config.js');
let source = fs.readFileSync(file, 'utf8');
source = source.replace(/version: '\d+\.\d+\.\d+'/, `version: '${version}'`);
let versionCode = 0;
source = source.replace(/versionCode: (\d+)/, (_, code) => {
  versionCode = Number(code) + 1;
  return `versionCode: ${versionCode}`;
});
fs.writeFileSync(file, source);

run('git add app.config.js');
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
run('git push');
run(`git push origin v${version}`);
console.log(`Pushed v${version} (versionCode ${versionCode}). GitHub Actions will publish the APK.`);
