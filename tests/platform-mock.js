'use strict';
/**
 * In-memory stand-ins for the ServiceNow server APIs these scripts use
 * (Class, GlideRecord, GlideDateTime, gs), plus a "business rule runner" that
 * fires the real rule files when a record is updated, the way the platform would.
 *
 * Deliberately strict: field changes only persist on update()/insert(), so a
 * missing update() in a script makes a test fail instead of passing by accident.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const NOW = '2026-10-16 12:00:00';

const norm = (v) => (v === undefined || v === null ? '' : String(v));
const numeric = (v) => v !== '' && !Number.isNaN(Number(v));

function matches(row, { field, op, value }) {
    const a = norm(row[field]);
    const v = norm(value);
    switch (op) {
        case '=': return a === v;
        case '!=': return a !== v;
        case 'IN': return v.split(',').includes(a);
        case '<': case '<=': case '>': case '>=': {
            const [x, y] = numeric(a) && numeric(v) ? [Number(a), Number(v)] : [a, v];
            return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
        }
        default: throw new Error('unsupported operator ' + op);
    }
}

// Which rule files run after an update on each table (mirrors the Business Rule "Table" setting).
const RULES = {
    sc_task: 'src/business_rules/sc_task_router.js',
    u_approval_request: 'src/business_rules/approval_router.js',
    u_payment: 'src/business_rules/payment_paid_trigger.js'
};
const NUMBER_PREFIX = { sc_task: 'TASK', sc_req_item: 'RITM', sc_request: 'REQ', u_payment: 'PAY' };

function createPlatform(seed) {
    const db = JSON.parse(JSON.stringify(seed || {}));
    const events = [];
    const properties = {};
    let counter = 1000;

    class GlideRecord {
        constructor(table) {
            this.table = table;
            this.filters = [];
            this.limit = Infinity;
            this.results = [];
            this.index = -1;
            this.row = {};
            this.pending = {};
        }
        addQuery(field, a, b) {
            const [op, value] = b === undefined ? ['=', a] : [a, b];
            this.filters.push({ field, op, value });
        }
        addActiveQuery() { this.addQuery('active', true); }
        orderBy() {}
        setLimit(n) { this.limit = n; }
        query() {
            this.results = (db[this.table] || [])
                .filter((row) => this.filters.every((f) => matches(row, f)))
                .slice(0, this.limit);
            this.index = -1;
        }
        next() {
            this.index += 1;
            if (this.index < this.results.length) {
                this.row = this.results[this.index];
                this.pending = {};
                return true;
            }
            return false;
        }
        getRowCount() { return this.results.length; }
        get(a, b) {
            const [field, value] = b === undefined ? ['sys_id', a] : [a, b];
            const row = (db[this.table] || []).find((r) => norm(r[field]) === norm(value));
            if (!row) return false;
            this.row = row;
            this.pending = {};
            this.results = [row];
            this.index = 0;
            return true;
        }
        initialize() { this.row = {}; this.pending = {}; }
        getValue(field) {
            const v = field in this.pending ? this.pending[field] : this.row[field];
            return norm(v) === '' ? null : String(v);
        }
        getDisplayValue(field) { return this.getValue(field) || ''; }
        setValue(field, value) { this.pending[field] = value; }
        getUniqueValue() { return this.row.sys_id; }
        insert() {
            counter += 1;
            const id = 'sys' + counter;
            const row = Object.assign({}, this.pending, { sys_id: id });
            if (NUMBER_PREFIX[this.table] && !row.number) {
                row.number = NUMBER_PREFIX[this.table] + String(counter).padStart(7, '0');
            }
            (db[this.table] = db[this.table] || []).push(row);
            this.row = row;
            this.pending = {};
            return id;
        }
        update() {
            const before = Object.assign({}, this.row);
            Object.assign(this.row, this.pending);
            this.pending = {};
            if (RULES[this.table]) {
                // Like the platform, run the table's "after update" Business Rule.
                const previous = { getValue: (f) => (norm(before[f]) === '' ? null : String(before[f])) };
                context.current = this;
                context.previous = previous;
                vm.runInContext(fs.readFileSync(path.join(ROOT, RULES[this.table]), 'utf8'), context);
            }
            return this.row.sys_id;
        }
    }

    class GlideDateTime {
        constructor(value) { this.date = new Date((value || NOW).replace(' ', 'T') + 'Z'); }
        addDaysUTC(n) { this.date = new Date(this.date.getTime() + n * 86400000); }
        addSeconds(s) { this.date = new Date(this.date.getTime() + s * 1000); }
        getValue() { return this.date.toISOString().slice(0, 19).replace('T', ' '); }
    }

    const context = {
        Class: { create: () => function ctor() { if (this.initialize) this.initialize.apply(this, arguments); } },
        GlideRecord,
        GlideDateTime,
        gs: {
            info() {}, warn() {}, error() {}, addInfoMessage() {}, addErrorMessage() {},
            getProperty: (name, fallback) => (name in properties ? properties[name] : fallback),
            eventQueue(name, record, p1, p2) {
                events.push({ name, record: record.getUniqueValue(), p1: norm(p1), p2: norm(p2) });
            }
        },
        console
    };
    vm.createContext(context);

    // Load every Script Include into the shared context (on the platform they load on demand).
    const dir = path.join(ROOT, 'src', 'script_includes');
    for (const file of fs.readdirSync(dir).sort()) {
        vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
    }

    const platform = {
        db,
        events,
        properties,
        context,
        NOW,

        /** Seed a row directly. Returns its sys_id. */
        insert(table, row) {
            counter += 1;
            const id = row.sys_id || 'sys' + counter;
            const full = Object.assign({ sys_id: id }, row);
            if (NUMBER_PREFIX[table] && !full.number) full.number = NUMBER_PREFIX[table] + String(counter).padStart(7, '0');
            (db[table] = db[table] || []).push(full);
            return id;
        },

        /** Find one row. */
        row(table, where) {
            return (db[table] || []).find((r) => Object.keys(where).every((k) => norm(r[k]) === norm(where[k])));
        },
        rows(table, where) {
            return (db[table] || []).filter((r) => Object.keys(where || {}).every((k) => norm(r[k]) === norm(where[k])));
        },
        eventsNamed(name) { return events.filter((e) => e.name === name); },

        /** Update a record like a user or integration would; update() fires the Business Rule. */
        update(table, id, changes) {
            const current = new GlideRecord(table);
            if (!current.get(id)) throw new Error(`${table} ${id} not found`);
            Object.entries(changes).forEach(([k, v]) => current.setValue(k, v));
            current.update();
        },

        /** Convenience: complete a task the way its assignee does. */
        closeTask(id) { platform.update('sc_task', id, { state: '3', active: false }); },
        startTask(id) { platform.update('sc_task', id, { state: '2' }); },
        decide(approvalId, state) { platform.update('u_approval_request', approvalId, { state }); },

        /** Run a Script Include method in the sandbox: platform.run('new TimberTrackPayment().expireStale()') */
        run(code) { return vm.runInContext(code, context); }
    };
    return platform;
}

module.exports = { createPlatform, NOW, ROOT };
