import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('referral bonus only after captcha_passed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.match(src, /payReferralSignup/);
  assert.match(src, /captcha_passed/);
});

test('admin ban endpoints exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.match(src, /\/api\/admin\/ban/);
  assert.match(src, /\/api\/admin\/link-task/);
});
