#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const [, , output, ...inputs] = process.argv;
if (!output || inputs.length < 2) {
  throw new Error('Usage: node scripts/reconcile_messenger_exports.js OUTPUT INPUT INPUT [...]');
}

const documents = inputs
  .map((path) => ({ path, value: JSON.parse(fs.readFileSync(path, 'utf8')) }))
  .sort((a, b) => String(a.value.updatedAt).localeCompare(String(b.value.updatedAt)));
const threadId = documents[0].value.threadId;
if (documents.some(({ value }) => value.threadId !== threadId)) throw new Error('Exports belong to different threads.');

function mergeMessage(previous, incoming) {
  if (!previous) return incoming;
  const merged = { ...previous, ...incoming };
  if (incoming.isUnsent) merged.text = null;
  else if (incoming.text == null && previous.text != null) merged.text = previous.text;
  if (incoming.replyTo == null && previous.replyTo != null) merged.replyTo = previous.replyTo;
  if (incoming.replyTo?.messageId && previous.replyTo?.messageId === incoming.replyTo.messageId) {
    merged.replyTo = {
      messageId: incoming.replyTo.messageId,
      senderId: incoming.replyTo.senderId ?? previous.replyTo.senderId ?? null,
      text: incoming.replyTo.text ?? previous.replyTo.text ?? null,
    };
  }
  return merged;
}

const messages = new Map();
const participants = new Map();
for (const { value } of documents) {
  for (const message of value.messages) messages.set(message.id, mergeMessage(messages.get(message.id), message));
  for (const participant of value.participants ?? []) {
    const previous = participants.get(participant.id);
    participants.set(participant.id, { ...previous, ...participant, name: participant.name ?? previous?.name ?? null });
  }
}

const equivalenceBuckets = new Map();
for (const message of messages.values()) {
  const key = JSON.stringify([message.senderId, message.text, message.replyTo]);
  const bucket = equivalenceBuckets.get(key) ?? [];
  bucket.push(message);
  equivalenceBuckets.set(key, bucket);
}
const possibleEquivalentIds = [];
for (const bucket of equivalenceBuckets.values()) {
  bucket.sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));
  for (let index = 1; index < bucket.length; index++) {
    const previous = bucket[index - 1];
    const current = bucket[index];
    const deltaMs = Number(current.timestampMs) - Number(previous.timestampMs);
    const oneTemporaryId = /^\d+$/.test(current.id) !== /^\d+$/.test(previous.id);
    if (deltaMs >= 0 && deltaMs <= 1000 && current.id !== previous.id && oneTemporaryId) {
      possibleEquivalentIds.push({ ids: [previous.id, current.id], deltaMs });
    }
  }
}

const latest = documents.at(-1).value;
const result = {
  ...latest,
  messages: [...messages.values()],
  participants: [...participants.values()],
  reconciliation: {
    createdAt: new Date().toISOString(),
    sources: documents.map(({ path, value }) => ({ path, updatedAt: value.updatedAt, messages: value.messages.length })),
    possibleEquivalentIds,
    note: 'Possible equivalent IDs are retained as separate records pending direct evidence.',
  },
};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, messages: result.messages.length, possibleEquivalentIds: possibleEquivalentIds.length }));
