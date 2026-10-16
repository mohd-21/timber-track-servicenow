'use strict';
// Entry of the whole flow: payment link, payment confirmation, plus assignment edge cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, placeOrder, pay } = require('./fixtures');

test('a payment is created as pending with a link that expires in one day', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 1]], { amount: 750 });
    const payment = p.row('u_payment', { sys_id: paymentId });
    assert.equal(payment.u_status, 'pending');
    assert.equal(payment.u_amount, 750);
    assert.equal(payment.u_link_expires, '2026-10-17 12:00:00');
    assert.equal(p.eventsNamed('x_timber.payment_link')[0].p1, '2026-10-17 12:00:00');
});

test('paying twice does not run the inventory check twice', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 5]]);
    assert.equal(pay(p, paymentId), true);
    assert.equal(pay(p, paymentId), false);
    assert.equal(p.rows('sc_task', { u_type: 'pick_pack' }).length, 1);
    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity, 45);
});

test('an expired link cannot be paid and moves the payment to expired', () => {
    const p = world();
    const { paymentId } = placeOrder(p, [['item-plank', 5]]);
    p.row('u_payment', { sys_id: paymentId }).u_link_expires = '2026-10-15 12:00:00';

    assert.equal(pay(p, paymentId), false);
    assert.equal(p.row('u_payment', { sys_id: paymentId }).u_status, 'expired');
    assert.equal(p.rows('sc_task', { u_type: 'pick_pack' }).length, 0);
    assert.equal(p.row('u_material_inventory', { sys_id: 'inv-plank' }).stock_quantity, 50);
});

test('the scheduled job expires only pending payments past their link date', () => {
    const p = world();
    p.insert('u_payment', { u_status: 'pending', u_link_expires: '2026-10-15 00:00:00' });
    p.insert('u_payment', { u_status: 'pending', u_link_expires: '2026-10-16 11:59:59' });
    p.insert('u_payment', { u_status: 'pending', u_link_expires: '2026-10-20 00:00:00' });
    p.insert('u_payment', { u_status: 'paid', u_link_expires: '2026-10-01 00:00:00' });

    assert.equal(p.run('new TimberTrackPayment().expireStale()'), 2);
    assert.equal(p.rows('u_payment', { u_status: 'expired' }).length, 2);
    assert.equal(p.rows('u_payment', { u_status: 'paid' }).length, 1, 'paid payments are untouched');
});

test('an empty team still gets a task, left unassigned instead of failing', () => {
    const p = world();
    p.db.sys_user_grmember = p.db.sys_user_grmember.filter((m) => m.group !== 'g-wh');
    const { paymentId } = placeOrder(p, [['item-plank', 1]]);
    pay(p, paymentId);
    const [task] = p.rows('sc_task', { u_type: 'pick_pack' });
    assert.equal(task.assigned_to, undefined);
    assert.equal(task.assignment_group, 'g-wh');
});

test('closed tasks do not count towards how busy a member is', () => {
    const p = world();
    p.insert('sc_task', { u_type: 'other', assigned_to: 'w1', active: false });
    p.insert('sc_task', { u_type: 'other', assigned_to: 'w1', active: false });
    p.insert('sc_task', { u_type: 'other', assigned_to: 'w2', active: true });
    assert.equal(p.run("new TimberTrackTasks().leastBusyMember('Timber Warehouse')"), 'w1');
});
