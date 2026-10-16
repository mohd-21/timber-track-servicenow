'use strict';
// Scenario 4: the customer returns a delivered item.
// Gate 1: delivery team quality check. Gate 2: finance refund approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, placeOrder, pay } = require('./fixtures');

const approvals = (p, purpose) => p.rows('u_approval_request', { u_purpose: purpose });
const plankStock = (p) => Number(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity);
// JSON round-trip: objects made inside the vm sandbox have a different Object.prototype,
// which strict deepEqual would otherwise reject.
const requestReturn = (p, ritm) =>
    JSON.parse(JSON.stringify(p.run(`new TimberTrackReturns().requestReturn('${ritm}')`)));

/** Order 2 planks (price 100 each), pay, pack and deliver. Stock goes 50 -> 48. */
function deliveredOrder(p) {
    const order = placeOrder(p, [['item-plank', 2, 100]]);
    pay(p, order.paymentId);
    p.closeTask(p.rows('sc_task', { u_type: 'pick_pack' })[0].sys_id);
    p.closeTask(p.rows('sc_task', { u_type: 'delivery' })[0].sys_id);
    return order;
}

test('a return can only be requested after delivery is closed', () => {
    const p = world();
    const { ritms, paymentId } = placeOrder(p, [['item-plank', 2]]);
    pay(p, paymentId);
    assert.deepEqual(requestReturn(p, ritms[0]), { ok: false, reason: 'not_delivered' });
});

test('a return request creates a new item, a Refund Pending payment and a quality-check approval', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const result = requestReturn(p, ritms[0]);

    assert.equal(result.ok, true);
    const ret = p.row('sc_req_item', { sys_id: result.ritm });
    assert.equal(ret.u_return_of, ritms[0]);
    assert.equal(ret.quantity, 2);

    const payment = p.row('u_payment', { u_ritm: result.ritm });
    assert.equal(payment.u_status, 'refund_pending');
    assert.equal(payment.u_amount, 200, 'price x quantity');

    const [approval] = approvals(p, 'delivery_quality');
    assert.equal(approval.u_ref, result.ritm);
    assert.equal(approval.u_group, 'g-del');
});

test('the same delivered item cannot be returned twice while a return is active', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    requestReturn(p, ritms[0]);
    assert.deepEqual(requestReturn(p, ritms[0]), { ok: false, reason: 'already_requested' });
});

test('a return item cannot itself be returned', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);
    assert.equal(requestReturn(p, ritm).reason, 'cannot_return_a_return');
});

test('quality check rejected: no refund, item goes back to the customer, stock unchanged', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);

    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'rejected');

    assert.equal(p.row('sc_req_item', { sys_id: ritm }).state, '4');
    assert.equal(p.row('u_payment', { u_ritm: ritm }).u_status, 'refund_rejected');
    assert.equal(p.eventsNamed('x_timber.return_rejected')[0].p1, 'customer1');
    assert.equal(p.rows('sc_task', { u_type: 'return_item' }).length, 0);
    assert.equal(plankStock(p), 48);
    assert.equal(p.rows('u_approval_request', { u_purpose: 'finance_refund' }).length, 0, 'finance is never asked');
});

test('after a rejected return the customer may try again', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    requestReturn(p, ritms[0]);
    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'rejected');
    assert.equal(requestReturn(p, ritms[0]).ok, true);
});

test('quality check approved: a return task is created for the delivery team', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);

    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'approved');

    const [task] = p.rows('sc_task', { u_type: 'return_item' });
    assert.equal(task.request_item, ritm);
    assert.equal(task.assignment_group, 'g-del');
});

test('closing the return task restocks the item and asks finance to authorise the refund', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);
    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'approved');

    p.closeTask(p.rows('sc_task', { u_type: 'return_item' })[0].sys_id);

    assert.equal(plankStock(p), 50, '48 + 2 returned');
    const [refund] = approvals(p, 'finance_refund');
    assert.equal(refund.u_ref, ritm);
    assert.equal(refund.u_group, 'g-fin');
    assert.equal(p.row('u_payment', { u_ritm: ritm }).u_status, 'refund_pending', 'not paid before finance approves');
});

test('finance approves: payment becomes Refund Paid and the customer gets a confirmation', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);
    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'approved');
    p.closeTask(p.rows('sc_task', { u_type: 'return_item' })[0].sys_id);

    p.decide(approvals(p, 'finance_refund')[0].sys_id, 'approved');

    assert.equal(p.row('u_payment', { u_ritm: ritm }).u_status, 'refund_paid');
    assert.equal(p.row('sc_req_item', { sys_id: ritm }).state, '3');
    assert.equal(p.eventsNamed('x_timber.refund_confirmation')[0].p1, 'customer1');
});

test('finance rejects: the refund is not paid and the customer is told', () => {
    const p = world();
    const { ritms } = deliveredOrder(p);
    const { ritm } = requestReturn(p, ritms[0]);
    p.decide(approvals(p, 'delivery_quality')[0].sys_id, 'approved');
    p.closeTask(p.rows('sc_task', { u_type: 'return_item' })[0].sys_id);

    p.decide(approvals(p, 'finance_refund')[0].sys_id, 'rejected');

    assert.equal(p.row('u_payment', { u_ritm: ritm }).u_status, 'refund_rejected');
    assert.equal(p.eventsNamed('x_timber.refund_confirmation').length, 0);
    assert.equal(p.eventsNamed('x_timber.refund_rejected').length, 1);
});
