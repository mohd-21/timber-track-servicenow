'use strict';
const { createPlatform } = require('./platform-mock');

/**
 * A small Timber Track world:
 *   groups and their members, three vendors, and two catalog items.
 *   plank  (item-plank): 50 in stock, threshold 10, preferred vendors v1 + v2
 *   beam   (item-beam):   2 in stock, threshold 3,  preferred vendors v1 + v2 + v3
 */
function world() {
    const p = createPlatform({
        sys_user_group: [
            { sys_id: 'g-wh', name: 'Timber Warehouse' },
            { sys_id: 'g-del', name: 'Timber Delivery' },
            { sys_id: 'g-proc', name: 'Timber Procurement' },
            { sys_id: 'g-prochead', name: 'Timber Procurement Head' },
            { sys_id: 'g-finhead', name: 'Timber Finance Head' },
            { sys_id: 'g-fin', name: 'Timber Finance Team' }
        ],
        sys_user_grmember: [
            { group: 'g-wh', user: 'w1' }, { group: 'g-wh', user: 'w2' },
            { group: 'g-del', user: 'd1' }, { group: 'g-del', user: 'd2' },
            { group: 'g-proc', user: 'p1' }, { group: 'g-proc', user: 'p2' }
        ],
        u_material_inventory: [
            { sys_id: 'inv-plank', u_item: 'item-plank', stock_quantity: 50, u_threshold: 10, u_preferred_vendors: 'v1,v2' },
            { sys_id: 'inv-beam', u_item: 'item-beam', stock_quantity: 2, u_threshold: 3, u_preferred_vendors: 'v1,v2,v3' }
        ]
    });
    return p;
}

/** Create an order (REQ + one RITM per line) and a pending payment, and return their ids. */
function placeOrder(p, lines, { amount = 1000 } = {}) {
    const req = p.insert('sc_request', { state: '1', active: true, requested_for: 'customer1' });
    const ritms = lines.map(([item, quantity, price = 100]) =>
        p.insert('sc_req_item', {
            request: req, cat_item: item, quantity, price,
            requested_for: 'customer1', state: '1', active: true
        })
    );
    const paymentId = p.run(`new TimberTrackPayment().createForRequest('${req}', ${amount})`);
    return { req, ritms, paymentId };
}

/** Customer pays: the gateway integration calls markPaid. */
function pay(p, paymentId) {
    // markPaid() updates the payment; the platform then runs the u_payment Business Rule.
    return p.run(`new TimberTrackPayment().markPaid('${paymentId}')`);
}

module.exports = { world, placeOrder, pay };
