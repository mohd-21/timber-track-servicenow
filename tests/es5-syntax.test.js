'use strict';
// ServiceNow server scripts should stay ES5-compatible (safe on every release and scope).
// This parses every file under src/ as ES5 and fails on let/const, arrow functions, template strings, etc.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? jsFiles(full) : entry.name.endsWith('.js') ? [full] : [];
    });
}

const files = jsFiles(path.join(__dirname, '..', 'src'));

test('there are scripts to check', () => assert.ok(files.length >= 10));

for (const file of files) {
    test(`ES5 syntax: ${path.relative(path.join(__dirname, '..'), file)}`, () => {
        assert.doesNotThrow(() => acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 5 }));
    });
}
