'use strict';
// Scenario 2: stock is available but falls to or below the threshold after the order.
// Background replenishment: fixed quantity, NO approvals.
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, placeOrder, pay } = require('./fixtures');

const procurement = (p) => p.rows('sc_task', { u_type: 'procurement' });
const plankStock = (p) => Number(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity);

/** Order enough planks to drop below the threshold (50 - 41 = 9, threshold 10). */
function dropBelowThreshold(p, qty = 41) {
    const { paymentId } = placeOrder(p, [['item-plank', qty]]);
    pay(p, paymentId);
}

test('dropping to the threshold creates a procurement task with a fixed quantity of 100', () => {
    const p = world();
    dropBelowThreshold(p);
    const [task] = procurement(p);
    assert.equal(task.u_mode, 'threshold');
    assert.equal(task.u_quantity, 100);
    assert.equal(task.u_item, 'inv-plank');
    assert.equal(task.assigned_to, 'p1');
    assert.equal(task.u_stage, 'new');
    assert.equal(p.rows('u_approval_request').length, 0, 'no approval gates');
});

test('stock exactly at the threshold also triggers replenishment', () => {
    const p = world();
    dropBelowThreshold(p, 40); // 50 - 40 = 10
    assert.equal(procurement(p).length, 1);
});

test('stock above the threshold does not trigger replenishment', () => {
    const p = world();
    dropBelowThreshold(p, 39); // 11 left
    assert.equal(procurement(p).length, 0);
});

test('only one open replenishment per item, however many orders follow', () => {
    const p = world();
    dropBelowThreshold(p, 41);
    dropBelowThreshold(p, 1);
    assert.equal(procurement(p).length, 1);
});

test('the reorder quantity comes from a system property', () => {
    const p = world();
    p.properties['x_timber.reorder_qty'] = '250';
    dropBelowThreshold(p);
    assert.equal(procurement(p)[0].u_quantity, 250);
});

test('Work in Progress emails every preferred vendor and creates a quotation record for each', () => {
    const p = world();
    p.properties['x_timber.vendor_form_url'] = 'https://forms.example/quote';
    dropBelowThreshold(p);
    const task = procurement(p)[0];

    p.startTask(task.sys_id);

    assert.equal(p.rows('u_vendor_quotation', { u_task: task.sys_id }).length, 2);
    const rfqs = p.eventsNamed('x_timber.rfq');
    assert.equal(rfqs.length, 2);
    assert.equal(rfqs[0].p1, '100', 'quantity');
    assert.equal(rfqs[0].p2, 'https://forms.example/quote', 'form link');
    assert.equal(p.row('sc_task', { sys_id: task.sys_id }).u_stage, 'rfq_sent');
});

test('vendors are not emailed twice for the same task', () => {
    const p = world();
    dropBelowThreshold(p);
    const id = procurement(p)[0].sys_id;
    p.startTask(id);
    assert.equal(p.run(`new TimberTrackProcurement().onWorkInProgress('${id}')`), 0);
    assert.equal(p.eventsNamed('x_timber.rfq').length, 2);
});

test('selecting the lowest quotation sends the PO immediately and creates the warehouse task', () => {
    const p = world();
    dropBelowThreshold(p);
    const task = procurement(p)[0];
    p.startTask(task.sys_id);
    const [q1, q2] = p.rows('u_vendor_quotation', { u_task: task.sys_id });

    p.run(`new TimberTrackProcurement().onQuotationSubmitted('${q1.sys_id}', 500, '2026-10-25')`);
    p.run(`new TimberTrackProcurement().onQuotationSubmitted('${q2.sys_id}', 450, '2026-10-27')`);
    assert.equal(p.row('sc_task', { sys_id: task.sys_id }).u_stage, 'quotes_in');

    const chosen = p.run(`new TimberTrackProcurement().selectLowest('${task.sys_id}')`);

    assert.equal(chosen, q2.sys_id, 'the 450 quotation is the lowest');
    assert.equal(p.row('u_vendor_quotation', { sys_id: q2.sys_id }).u_state, 'selected');
    assert.equal(p.eventsNamed('x_timber.purchase_order')[0].p1, 'v2');
    assert.equal(p.row('sc_task', { sys_id: task.sys_id }).u_stage, 'po_sent');
    assert.equal(p.rows('u_approval_request').length, 0, 'no head or finance approval');
    const [receipt] = p.rows('sc_task', { u_type: 'warehouse_receipt' });
    assert.equal(receipt.u_parent_task, task.sys_id);
    assert.equal(receipt.assignment_group, 'g-wh');
});

test('nothing is selected until a vendor has submitted a quotation', () => {
    const p = world();
    dropBelowThreshold(p);
    const id = procurement(p)[0].sys_id;
    p.startTask(id);
    assert.equal(p.run(`new TimberTrackProcurement().selectLowest('${id}')`), null);
});

test('closing the warehouse task adds the 100 units to inventory and ends the replenishment', () => {
    const p = world();
    dropBelowThreshold(p);
    const task = procurement(p)[0];
    p.startTask(task.sys_id);
    const [q1] = p.rows('u_vendor_quotation', { u_task: task.sys_id });
    p.run(`new TimberTrackProcurement().onQuotationSubmitted('${q1.sys_id}', 500, '2026-10-25')`);
    p.run(`new TimberTrackProcurement().selectLowest('${task.sys_id}')`);
    assert.equal(plankStock(p), 9);

    p.closeTask(p.rows('sc_task', { u_type: 'warehouse_receipt' })[0].sys_id);

    assert.equal(plankStock(p), 109);
    assert.equal(p.row('sc_task', { sys_id: task.sys_id }).state, '3');
    assert.equal(p.rows('sc_task', { u_type: 'delivery' }).length, 0, 'independent of the customer order');
});
