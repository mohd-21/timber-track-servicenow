'use strict';
// Scenario 1: every item is in stock. Fully automated, no approvals.
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, placeOrder, pay } = require('./fixtures');

const pickPacks = (p) => p.rows('sc_task', { u_type: 'pick_pack' });
const deliveries = (p) => p.rows('sc_task', { u_type: 'delivery' });

test('payment deducts stock and creates a Pick & Pack task for the warehouse', () => {
    const p = world();
    const { ritms, paymentId } = placeOrder(p, [['item-plank', 5]]);
    assert.equal(pay(p, paymentId), true);

    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity, 45);
    const [task] = pickPacks(p);
    assert.equal(task.request_item, ritms[0]);
    assert.equal(task.assignment_group, 'g-wh');
    assert.equal(task.assigned_to, 'w1');
    assert.equal(p.rows('u_approval_request').length, 0, 'no approvals in this scenario');
    assert.equal(p.rows('sc_task', { u_type: 'procurement' }).length, 0);
});

test('an unpaid order does not touch inventory', () => {
    const p = world();
    placeOrder(p, [['item-plank', 5]]);
    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity, 50);
    assert.equal(pickPacks(p).length, 0);
});

test('Pick & Pack goes to the warehouse member with the fewest open tasks', () => {
    const p = world();
    p.insert('sc_task', { u_type: 'other', assigned_to: 'w1', active: true });
    p.insert('sc_task', { u_type: 'other', assigned_to: 'w1', active: true });
    const { paymentId } = placeOrder(p, [['item-plank', 1]]);
    pay(p, paymentId);
    assert.equal(pickPacks(p)[0].assigned_to, 'w2');
});

test('several items are spread across warehouse members', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 3], ['item-plank', 2]]);
    pay(p, paymentId);
    assert.deepEqual(pickPacks(p).map((t) => t.assigned_to), ['w1', 'w2']);
});

test('delivery is created only after ALL of a member\'s Pick & Pack tasks are closed', () => {
    const p = world();
    // w2 is busy, so both items go to w1 and form one batch.
    for (let i = 0; i < 5; i++) p.insert('sc_task', { u_type: 'other', assigned_to: 'w2', active: true });
    const { ritms, paymentId } = placeOrder(p, [['item-plank', 3], ['item-plank', 2]]);
    pay(p, paymentId);
    const [first, second] = pickPacks(p);

    p.closeTask(first.sys_id);
    assert.equal(deliveries(p).length, 0, 'second item is still being packed');

    p.closeTask(second.sys_id);
    const [delivery] = deliveries(p);
    assert.equal(deliveries(p).length, 1, 'one delivery task for the whole batch');
    assert.equal(delivery.u_ritms, ritms.join(','));
    assert.equal(delivery.assignment_group, 'g-del');
    assert.equal(delivery.assigned_to, 'd1');
    assert.equal(delivery.due_date, '2026-10-21 12:00:00', '5 day SLA');
});

test('the customer is emailed when items are packed, with the expected delivery date', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 1]]);
    pay(p, paymentId);
    p.closeTask(pickPacks(p)[0].sys_id);
    const [event] = p.eventsNamed('x_timber.items_packed');
    assert.equal(event.p1, 'customer1');
    assert.equal(event.p2, '2026-10-21 12:00:00');
});

test('the delivery rule firing twice does not create a duplicate delivery', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 1]]);
    pay(p, paymentId);
    const id = pickPacks(p)[0].sys_id;
    p.closeTask(id);
    assert.equal(p.run(`new TimberTrackFulfilment().onPickPackClosed('${id}')`), null);
    assert.equal(deliveries(p).length, 1);
});

test('the order closes only when every delivery task is complete', () => {
    const p = world();
    const { req, ritms, paymentId } = placeOrder(p, [['item-plank', 3], ['item-plank', 2]]);
    pay(p, paymentId);
    pickPacks(p).forEach((t) => p.closeTask(t.sys_id)); // w1 and w2 each pack one item
    const [d1, d2] = deliveries(p);
    assert.equal(deliveries(p).length, 2, 'one delivery task per warehouse member batch');
    assert.notEqual(d1.assigned_to, d2.assigned_to, 'deliveries are spread across the delivery team');

    p.closeTask(d1.sys_id);
    assert.equal(p.row('sc_request', { sys_id: req }).state, '1', 'still waiting for the second delivery');

    p.closeTask(d2.sys_id);
    assert.equal(p.row('sc_request', { sys_id: req }).state, '3');
    ritms.forEach((id) => assert.equal(p.row('sc_req_item', { sys_id: id }).state, '3'));
});
