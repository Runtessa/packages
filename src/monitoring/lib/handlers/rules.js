const { readRules, createRule, updateRule, deleteRule } = require('../redisStore');
const { serializeRule, normalizeRulePayload } = require('../rules');
const { str } = require('../utils');

const rulesListHandler = async (req, res) => {
  if (req.method === 'GET') {
    const rules = await readRules();
    rules.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    res.status(200).json({ rules: rules.map(serializeRule) });
    return;
  }

  if (req.method === 'POST') {
    const payload = normalizeRulePayload(req.body || {});
    const created = await createRule(payload);
    res.status(201).json({ rule: serializeRule(created) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
};

const ruleByIdHandler = async (req, res) => {
  const id = str(req.params?.id).trim();
  if (!id) {
    res.status(400).json({ error: 'Rule id is required' });
    return;
  }

  const rules = await readRules();
  const existing = rules.find((rule) => rule.id === id);
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  if (req.method === 'PUT') {
    const payload = normalizeRulePayload(req.body || {});
    const updated = await updateRule(id, payload);
    if (!updated) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ rule: serializeRule(updated) });
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = await deleteRule(id);
    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  res.status(405).end();
};

module.exports = {
  rulesListHandler,
  ruleByIdHandler,
};
