// A stand-in for the parts of Supabase and Stripe the server functions call,
// for tests/functions_test.sh. Records every request at /__log.
const http = require('http');
const log = [];
const send = (res, code, body, headers = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(body === undefined ? '' : JSON.stringify(body)); };
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    const u = req.url;
    if (u === '/__log') { res.end(log.join('\n')); return; }
    log.push(req.method + ' ' + u + ' ' + body);
    // Supabase
    if (u === '/auth/v1/user') return req.headers.authorization === 'Bearer good' ? send(res, 200, { id: 'u1', email: 'owner@example.com' }) : send(res, 401, { msg: 'bad jwt' });
    if (u.startsWith('/rest/v1/team_members?select=team_id')) return send(res, 200, [{ team_id: 't1', role: 'owner' }]);
    if (u.startsWith('/rest/v1/teams?select=*')) return send(res, 200, [{ id: 't1', name: 'Harbour Realty', trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), stripe_customer_id: log.some((l) => l.includes('"stripe_customer_id":"cus_1"')) ? 'cus_1' : null, subscription_status: null, stripe_subscription_id: null, plan: 'per_user' }]);
    if (u.startsWith('/rest/v1/teams?select=id')) return send(res, 200, [{ id: 't1', stripe_subscription_id: null, subscription_status: 'trialing' }]);
    if (u.startsWith('/rest/v1/team_members?select=*') || u.startsWith('/rest/v1/invites?select=*')) return send(res, 200, [], { 'Content-Range': '0-0/1' });
    if (req.method === 'PATCH' && u.startsWith('/rest/v1/teams?')) return send(res, 204);
    // Stripe
    if (u === '/stripe/v1/customers') return send(res, 200, { id: 'cus_1' });
    if (u.startsWith('/stripe/v1/subscriptions?')) return send(res, 200, { data: [] });
    if (u.startsWith('/stripe/v1/checkout/sessions?')) return send(res, 200, { data: [] });
    if (u === '/stripe/v1/checkout/sessions') return send(res, 200, { id: 'cs_1', url: 'https://checkout.example/cs_1' });
    if (u === '/stripe/v1/billing_portal/sessions') return send(res, 200, { url: 'https://portal.example/bps_1' });
    if (u === '/stripe/v1/subscriptions/sub_1') return send(res, 200, { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { team_id: 't1' }, cancel_at_period_end: false, items: { data: [{ quantity: 3, current_period_end: 1800000000, price: { id: 'price_user' } }] } });
    send(res, 404, { error: { message: 'no route ' + u } });
  });
}).listen(Number(process.argv[2] || 9911));
