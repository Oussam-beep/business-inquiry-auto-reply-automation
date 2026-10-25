const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(root, 'business-inquiry-auto-reply.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'inquiries.json'), 'utf8'));
for (const [caseName, payload] of Object.entries(fixtures)) {
  assert.ok(payload && typeof payload === 'object', `${caseName} fixture is an object`);
  for (const field of ['name', 'email', 'phone', 'message']) assert.ok(Object.hasOwn(payload, field), `${caseName} fixture has ${field}`);
  assert.equal(typeof payload.email, 'string', `${caseName} email is a string`);
}
const byName = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
const node = name => {
  assert.ok(byName[name], `node exists: ${name}`);
  return byName[name];
};
const mainOutputs = name => (wf.connections[name]?.main || []);
const outputTargets = (name, output = 0) => (mainOutputs(name)[output] || []).map(c => c.node);
const lead = {
  name: 'Test Customer', email: 'customer@example.com', phone: '555-0100',
  message: 'I would like information about your service.',
  timestamp: '2026-10-25T18:00:00.000Z'
};

function runCodeNode(nodeName, inputJson, refs = {}) {
  const code = node(nodeName).parameters.jsCode;
  const inputItems = Array.isArray(inputJson) ? inputJson.map(json => ({ json })) : [{ json: inputJson }];
  const $input = {
    all: () => inputItems,
    first: () => inputItems[0] || { json: {} },
    item: inputItems[0] || { json: {} },
  };
  const $ = name => ({
    first: () => ({ json: refs[name] || {} }),
    all: () => [{ json: refs[name] || {} }],
  });
  return new Function('$input', '$', '$now', code)($input, $, { toISO: () => '2026-10-25T18:00:00.000Z' });
}
function anthropicResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

// Check normalization expressions against both webhook and original-form input structures.
const assignments = Object.fromEntries(node('Normalize Lead').parameters.assignments.assignments.map(a => [a.name, a.value]));
const evalExpression = (s, json) => {
  assert.ok(s.startsWith('={{') && s.endsWith('}}'), `expression wrapper: ${s}`);
  return new Function('$json', '$now', '$input', '$', 'return (' + s.slice(3, -2).trim() + ');')(json, { toISO: () => '2026-10-25T18:00:00.000Z' }, {}, () => ({}));
};
const webhook = { body: { name: '  Alice Doe  ', email: '  ALICE@EXAMPLE.COM ', phone: ' 555 ', message: '  Need pricing. ' } };
assert.equal(evalExpression(assignments.name, webhook), 'Alice Doe');
assert.equal(evalExpression(assignments.email, webhook), 'alice@example.com');
assert.equal(evalExpression(assignments.phone, webhook), '555');
assert.equal(evalExpression(assignments.message, webhook), 'Need pricing.');
const formPayload = { Name: 'Bob', Email: ' BOB@EXAMPLE.COM ', Phone: '', 'What do you need?': 'Need help' };
assert.equal(evalExpression(assignments.name, formPayload), 'Bob');
assert.equal(evalExpression(assignments.email, formPayload), 'bob@example.com');
// A blank high-precedence source must not mask a usable lower-precedence field.
assert.equal(evalExpression(assignments.name, { Name: ' ', body: { name: 'Fallback Name' } }), 'Fallback Name');

// All allowed intents are parsed with numeric scores, and malformed results fail closed.
const allowedIntents = ['sales', 'pricing', 'support', 'general', 'spam'];
for (const intent of allowedIntents) {
  const parsed = runCodeNode('Parse Qualification', anthropicResponse({
    score: 8, category: 'hot', intent, summary: 'Relevant customer inquiry.', reason: 'Clear intent.'
  }), { 'Normalize Lead': lead })[0].json;
  assert.equal(parsed.intent, intent);
  assert.equal(parsed.qualification_valid, true);
  assert.equal(parsed.score, 8);
}
for (const bad of [
  { content: [{ text: 'this is not JSON' }] },
  anthropicResponse({ score: 8, category: 'hot', intent: 'urgent', summary: 'x', reason: 'y' }),
  anthropicResponse({ score: '8', category: 'hot', intent: 'sales', summary: 'x', reason: 'y' }),
  anthropicResponse({ score: 11, category: 'hot', intent: 'sales', summary: 'x', reason: 'y' }),
  anthropicResponse({ score: 8, category: 'invalid', intent: 'sales', summary: 'x', reason: 'y' }),
]) {
  const parsed = runCodeNode('Parse Qualification', bad, { 'Normalize Lead': lead })[0].json;
  assert.equal(parsed.intent, 'unknown');
  assert.equal(parsed.qualification_valid, false);
  assert.equal(parsed.score, 0);
}

// Valid reply output can pass the gate; malformed output cannot.
const qualifiedLead = { ...lead, score: 8, category: 'hot', intent: 'sales', qualification_valid: true, summary: 'Wants service info.' };
const validReply = runCodeNode('Parse Reply', anthropicResponse({ subject: 'Thanks for your inquiry', body: 'Thank you for reaching out.' }), { 'Parse Qualification': qualifiedLead })[0].json;
assert.equal(validReply.reply_valid, true);
assert.equal(validReply.reply_subject, 'Thanks for your inquiry');
assert.equal(validReply.reply_body, 'Thank you for reaching out.');
const invalidReply = runCodeNode('Parse Reply', { content: [{ text: 'not JSON' }] }, { 'Parse Qualification': qualifiedLead })[0].json;
assert.equal(invalidReply.reply_valid, false);
assert.equal(invalidReply.reply_body, '');

// Explicit external-service error handlers return reviewable records, never auto-send.
const qualificationErr = runCodeNode('Handle Qualification Error', { error: { message: 'mock failure' } }, { 'Normalize Lead': lead })[0].json;
assert.equal(qualificationErr.intent, 'unknown');
assert.equal(qualificationErr.processing_status_override, 'manual_review_ai_error');
const replyErr = runCodeNode('Handle Reply Generation Error', { error: { message: 'mock failure' } }, { 'Parse Qualification': qualifiedLead })[0].json;
assert.equal(replyErr.reply_valid, false);
assert.equal(replyErr.processing_status_override, 'manual_review_reply_error');
const emailErr = runCodeNode('Handle Email Delivery Error', { error: { message: 'mock failure' } }, { 'Parse Reply': validReply })[0].json;
assert.equal(emailErr.processing_status_override, 'email_delivery_failed');

// Routing graph checks: only the three supported intent types use qualification; support/spam/fallback are review/suppressed.
for (const i of [0, 1, 2]) assert.ok(outputTargets('Route by Intent', i).includes('Qualified?'));
assert.deepEqual(outputTargets('Route by Intent', 3), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Route by Intent', 4), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Route by Intent', 5), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Qualified?', 0), ['Draft Reply (Claude)']);
assert.deepEqual(outputTargets('Qualified?', 1), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Reply JSON Valid?', 0), ['Send Reply (Gmail)']);
assert.deepEqual(outputTargets('Reply JSON Valid?', 1), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Duplicate?', 0), ['Log Duplicate — suppressed']);
assert.deepEqual(outputTargets('Duplicate?', 1), ['Restore Lead']);
assert.deepEqual(outputTargets('Valid Inquiry?', 0), ['Dupe Check (Airtable)']);
assert.deepEqual(outputTargets('Valid Inquiry?', 1), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Qualify Lead (Claude)', 1), ['Handle Qualification Error']);
assert.deepEqual(outputTargets('Draft Reply (Claude)', 1), ['Handle Reply Generation Error']);
assert.deepEqual(outputTargets('Send Reply (Gmail)', 1), ['Handle Email Delivery Error']);
assert.deepEqual(outputTargets('Handle Qualification Error', 0), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Handle Reply Generation Error', 0), ['Log Lead — manual review']);
assert.deepEqual(outputTargets('Handle Email Delivery Error', 0), ['Log Lead — manual review']);

// Original intake paths remain available; webhook returns an asynchronous-acceptance status.
assert.deepEqual(outputTargets('Lead Form', 0), ['Normalize Lead']);
assert.deepEqual(outputTargets('Email Lead (optional)', 0), ['Email → Lead shape']);
assert.deepEqual(outputTargets('Email → Lead shape', 0), ['Normalize Lead']);
assert.deepEqual(outputTargets('Business Inquiry Webhook', 0), ['Normalize Lead']);
assert.equal(node('Business Inquiry Webhook').parameters.httpMethod, 'POST');
assert.equal(node('Business Inquiry Webhook').parameters.path, 'business-inquiry');
assert.equal(node('Business Inquiry Webhook').parameters.options.responseCode, 202);
assert.equal(node('Dupe Check (Airtable)').alwaysOutputData, true);
assert.match(node('Dupe Check (Airtable)').parameters.filterByFormula, /DATEADD\(NOW\(\), -1, 'days'\)/);
assert.match(node('Dupe Check (Airtable)').parameters.filterByFormula, /LOWER\(\{email\}\)/);
assert.equal(node('Send Reply (Gmail)').onError, 'continueErrorOutput');
assert.equal(node('Send Reply (Gmail)').retryOnFail, undefined, 'Gmail is deliberately not retried to avoid uncertain duplicate sends');

// Confirm no demo booking link or fictional sample business identity remains.
const workflowText = JSON.stringify(wf);
assert.ok(!workflowText.includes('your-handle'));
assert.ok(!workflowText.includes('Atlas Home Services'));
assert.ok(!workflowText.includes('Book a call:'));

console.log('PASS: webhook/form field normalization and lower-case email');
console.log('PASS: five allowed intents; malformed/unknown/invalid scores fail closed');
console.log('PASS: valid/malformed reply JSON gate');
console.log('PASS: qualification, reply-generation, and email-delivery errors route to manual logging');
console.log('PASS: intent/score/reply/duplicate connections and original intake regression');
console.log('PASS: HTTP 202 webhook, Airtable 24-hour duplicate formula, and no fake booking/business placeholders');
console.log('NOTE: tests are local mocks/static checks; no provider APIs or real emails are invoked.');
