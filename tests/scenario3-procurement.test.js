'use strict';
// Scenario 3: the item is not available. Two approval gates: procurement head, then finance head.
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, placeOrder, pay } = require('./fixtures');

const approvals = (p, purpose) => p.rows('u_approval_request', { u_purpose: purpose });
const procurement = (p) => p.rows('sc_task', { u_type: 'procurement' });

/** An order for 5 beams (only 2 in stock), paid. */
function unavailableOrder(p) {
    const order = placeOrder(p, [['item-beam', 5]]);
    pay(p, order.paymentId);
    return order;
}

/** Get a procurement task to the point where all three vendors have quoted. */
function quotesIn(p, amounts) {
    const task = procurement(p)[0];
    p.startTask(task.sys_id);
    p.rows('u_vendor_quotation', { u_task: task.sys_id }).forEach((q, i) => {
        p.run(`new TimberTrackProcurement().onQuotationSubmitted('${q.sys_id}', ${amounts[i]}, '2026-10-30')`);
    });
    return task.sys_id;
}

test('an unavailable item asks the procurement head for approval and leaves stock untouched', () => {
    const p = world();
    const { ritms } = unavailableOrder(p);
    const [approval] = approvals(p, 'procurement_head');
    assert.equal(approval.u_ref, ritms[0]);
    assert.equal(approval.u_group, 'g-prochead');
    assert.equal(approval.state, 'requested');
    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-beam' }).stock_quantity, 2);
    assert.equal(p.rows('sc_task', { u_type: 'pick_pack' }).length, 0);
});

test('head rejects: the customer is emailed, the item closes incomplete and the flow ends', () => {
    const p = world();
    const { req, ritms } = unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'rejected');

    assert.equal(p.row('sc_req_item', { sys_id: ritms[0] }).state, '4');
    assert.equal(p.eventsNamed('x_timber.unable_to_fulfil')[0].p1, 'customer1');
    assert.equal(procurement(p).length, 0);
    assert.equal(p.row('sc_request', { sys_id: req }).state, '4', 'nothing could be fulfilled');
});

test('head approves: a procurement task is created with the quantity the customer ordered', () => {
    const p = world();
    unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');

    const [task] = procurement(p);
    assert.equal(task.u_mode, 'customer');
    assert.equal(task.u_quantity, 5, 'dynamic quantity, not the fixed 100');
    assert.equal(task.assigned_to, 'p1');
});

test('Work in Progress sends the order quantity to all preferred vendors', () => {
    const p = world();
    unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');
    p.startTask(procurement(p)[0].sys_id);
    const rfqs = p.eventsNamed('x_timber.rfq');
    assert.equal(rfqs.length, 3);
    assert.ok(rfqs.every((e) => e.p1 === '5'));
});

test('selecting the lowest quotation needs finance head approval before any PO is sent', () => {
    const p = world();
    unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');
    const taskId = quotesIn(p, [300, 280, 350]);

    p.run(`new TimberTrackProcurement().selectLowest('${taskId}')`);

    assert.equal(p.row('sc_task', { sys_id: taskId }).u_stage, 'finance_pending');
    assert.equal(approvals(p, 'finance_po')[0].u_group, 'g-finhead');
    assert.equal(p.eventsNamed('x_timber.purchase_order').length, 0, 'no PO before approval');
});

test('finance rejects: back to vendor selection, the next-cheapest quotation is used, customer not emailed', () => {
    const p = world();
    unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');
    const taskId = quotesIn(p, [300, 280, 350]); // v1 300, v2 280, v3 350
    p.run(`new TimberTrackProcurement().selectLowest('${taskId}')`); // v2 (280)

    p.decide(approvals(p, 'finance_po')[0].sys_id, 'rejected');

    assert.equal(p.row('u_vendor_quotation', { u_vendor: 'v2' }).u_state, 'rejected');
    assert.equal(p.row('sc_task', { sys_id: taskId }).u_stage, 'quotes_in');
    assert.equal(p.eventsNamed('x_timber.finance_rejected_po')[0].p1, 'p1', 'procurement member is told');
    assert.equal(p.eventsNamed('x_timber.unable_to_fulfil').length, 0, 'the customer is not emailed');

    p.run(`new TimberTrackProcurement().selectLowest('${taskId}')`);
    assert.equal(p.row('u_vendor_quotation', { u_vendor: 'v1' }).u_state, 'selected', 'next lowest is 300');
    assert.equal(approvals(p, 'finance_po').length, 2, 'a fresh approval is requested');
});

test('finance approves: PO is sent, then warehouse receipt, then delivery of the ordered item', () => {
    const p = world();
    const { req, ritms } = unavailableOrder(p);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');
    const taskId = quotesIn(p, [300, 280, 350]);
    p.run(`new TimberTrackProcurement().selectLowest('${taskId}')`);

    p.decide(approvals(p, 'finance_po')[0].sys_id, 'approved');

    assert.equal(p.eventsNamed('x_timber.purchase_order')[0].p1, 'v2');
    const [receipt] = p.rows('sc_task', { u_type: 'warehouse_receipt' });
    assert.equal(receipt.u_parent_task, taskId);

    p.closeTask(receipt.sys_id);

    const [delivery] = p.rows('sc_task', { u_type: 'delivery' });
    assert.equal(delivery.u_ritms, ritms[0], 'delivery for the originally ordered item');
    assert.equal(delivery.due_date, '2026-10-21 12:00:00');
    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-beam' }).stock_quantity, 2, 'goods go straight to the customer, not into stock');

    p.closeTask(delivery.sys_id);
    assert.equal(p.row('sc_req_item', { sys_id: ritms[0] }).state, '3');
    assert.equal(p.row('sc_request', { sys_id: req }).state, '3');
});

test('a mixed order stays open until the procured item is delivered too', () => {
    const p = world();
    const { req, ritms, paymentId } = placeOrder(p, [['item-plank', 2], ['item-beam', 5]]);
    pay(p, paymentId);

    // The plank ships from stock and is delivered first.
    p.closeTask(p.rows('sc_task', { u_type: 'pick_pack' })[0].sys_id);
    p.closeTask(p.rows('sc_task', { u_type: 'delivery' })[0].sys_id);
    assert.equal(p.row('sc_request', { sys_id: req }).state, '1', 'the beam has not been delivered');

    // The beam goes through procurement and is delivered later.
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'approved');
    const taskId = quotesIn(p, [300, 280, 350]);
    p.run(`new TimberTrackProcurement().selectLowest('${taskId}')`);
    p.decide(approvals(p, 'finance_po')[0].sys_id, 'approved');
    p.closeTask(p.rows('sc_task', { u_type: 'warehouse_receipt' })[0].sys_id);
    const beamDelivery = p.rows('sc_task', { u_type: 'delivery' }).find((t) => t.u_ritms === ritms[1]);
    p.closeTask(beamDelivery.sys_id);

    assert.equal(p.row('sc_request', { sys_id: req }).state, '3');
});

test('when only some items are rejected the rest of the order still completes', () => {
    const p = world();
    const { req, ritms, paymentId } = placeOrder(p, [['item-plank', 2], ['item-beam', 5]]);
    pay(p, paymentId);
    p.decide(approvals(p, 'procurement_head')[0].sys_id, 'rejected'); // the beam
    p.closeTask(p.rows('sc_task', { u_type: 'pick_pack' })[0].sys_id);
    p.closeTask(p.rows('sc_task', { u_type: 'delivery' })[0].sys_id);

    assert.equal(p.row('sc_req_item', { sys_id: ritms[0] }).state, '3');
    assert.equal(p.row('sc_req_item', { sys_id: ritms[1] }).state, '4');
    assert.equal(p.row('sc_request', { sys_id: req }).state, '3');
});
