// Alert fan-out for posting failures: Slack notification + optional Devin
// session trigger. Mirrors the COG-GTM/event-driven-devin pattern. All
// credentials come from the environment and are never logged.
const axios = require('axios');

async function notifySlack(err, context) {
  const url = process.env.SLACK_INCOMING_WEBHOOK_URL;
  if (!url) {
    console.warn('[alert] SLACK_INCOMING_WEBHOOK_URL not set — skipping Slack.');
    return false;
  }
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🔴 O2C allocation posting failed' } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Journey:*\norder-to-cash` },
      { type: 'mrkdwn', text: `*Step:*\nallocation → GL posting` },
      { type: 'mrkdwn', text: `*Allocation:*\n${context.allocationId ?? 'n/a'}` },
      { type: 'mrkdwn', text: `*Error:*\n${err.name || 'Error'}` },
    ] },
    { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${err.message}\`\`\`` } },
    { type: 'context', elements: [{ type: 'mrkdwn',
      text: 'Service: `o2c-allocation` • migrated slice (Oracle→PostgreSQL) • @Devin can triage' }] },
  ];
  try {
    await axios.post(url, { text: `O2C allocation posting failed: ${err.message}`, blocks }, { timeout: 10000 });
    return true;
  } catch (e) {
    console.warn('[alert] Slack post failed:', e.message);
    return false;
  }
}

// Optional: open a Devin session to triage (DEVIN_API_KEY required). When unset,
// the Slack message itself is the trigger surface (@Devin in-channel).
async function triggerDevin(err, context) {
  const key = process.env.DEVIN_API_KEY;
  if (!key) return null;
  const prompt = [
    'Triage a failing posting in the migrated O2C allocation service',
    '(modernization/services/o2c-allocation, COG-GTM/idempiere).',
    `Error: ${err.name}: ${err.message}.`,
    `Allocation id: ${context.allocationId}.`,
    'Likely cause: the Oracle->PostgreSQL allocation posting dropped the realized',
    'FX gain/loss balancing entry. Find the root cause in src/allocation.js, fix it,',
    'make the parity test pass, and open a PR.',
  ].join(' ');
  try {
    const { data } = await axios.post('https://api.devin.ai/v1/sessions',
      { prompt, idempotent: true },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 });
    return data && (data.session_id || data.url) ? data : null;
  } catch (e) {
    console.warn('[alert] Devin trigger failed:', e.message);
    return null;
  }
}

async function raise(err, context = {}) {
  const slack = await notifySlack(err, context);
  const devin = await triggerDevin(err, context);
  return { slack, devin };
}

module.exports = { raise, notifySlack, triggerDevin };
