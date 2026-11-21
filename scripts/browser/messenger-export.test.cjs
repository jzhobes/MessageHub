const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./messenger-export.js'), 'utf8');
const prior = (id, overrides = {}) => ({
  id,
  timestampMs: '100',
  senderId: '1',
  text: 'known body',
  isUnsent: false,
  replyTo: { messageId: 'original', senderId: '2', text: 'known quote' },
  ...overrides,
});
const checkpoint = {
  format: 'messagehub-facebook-messenger',
  version: 2,
  threadId: '123',
  messages: [prior('sparse'), prior('decode'), prior('changed'), prior('unsent')],
  participants: [{ id: '1', name: 'Tester' }],
  checkpoint: {
    range: {
      threadKey: '123',
      minTimestampMs: '100',
      maxTimestampMs: '100',
      minMessageId: 'sparse',
      maxMessageId: 'sparse',
      hasMoreBefore: false,
      hasMoreAfter: false,
    },
    rangeExternalIds: {},
  },
};
const rows = [
  { messageId: 'sparse', timestampMs: '100', senderId: '1', text: 'known body', replySourceId: 'original' },
  { messageId: 'decode', timestampMs: '100', senderId: '1', text: '1##1', replySourceId: 'original' },
  { messageId: 'changed', timestampMs: '100', senderId: '1', text: 'known body', replySourceId: 'different' },
  { messageId: 'unsent', timestampMs: '100', senderId: '1', text: 'known body', isUnsent: true },
];
const range = {
  range: {
    minTimestampMs: '100',
    maxTimestampMs: '100',
    minMessageId: 'sparse',
    maxMessageId: 'sparse',
    hasMoreBefore: false,
    hasMoreAfter: false,
    isLoadingBefore: false,
    isLoadingAfter: false,
  },
  rangeExternalIds: {},
};
const loader = {
  getOrCreateMessageRangeCoveringCursor: () => ({
    subscribe(observer) {
      observer.next(range);
      return { unsubscribe() {} };
    },
  }),
};
const db = {
  tables: {
    threads: { get: async () => ({ threadType: 16, threadName: 'Test Thread' }) },
    messages: {},
    contacts: { get: async () => ({ name: 'Tester' }) },
  },
};
const modules = {
  LSDatabaseSingleton: { LSDatabaseSingleton: Promise.resolve(db) },
  ReQL: { fromTableDescending: () => ({ getKeyRange: () => rows }), toArrayAsync: async (value) => value },
  I64: { of_string: String, to_string: String, max_int: '999' },
  LSMessagingThreadTypeUtil: { isArmadilloSecure: () => true },
  MAWMessageRangeDataSourceV2: () => loader,
  MAWVault: { unvault: () => { throw new Error('unavailable'); } },
};
let saved;
let checkpointText = JSON.stringify(checkpoint);
const window = {
  location: { pathname: '/messages/e2ee/t/123' },
  showOpenFilePicker: async () => [{ getFile: async () => ({ text: async () => checkpointText }) }],
  showSaveFilePicker: async () => ({
    createWritable: async () => ({
      write: async (value) => { saved = JSON.parse(value); },
      close: async () => {},
      abort: async () => {},
    }),
  }),
};
vm.runInNewContext(source, {
  window,
  require: (name) => modules[name],
  console: { log() {}, warn() {}, error() {} },
  performance,
  setTimeout,
  clearTimeout,
});

(async () => {
  await window.messageHubFastExporter.loadCheckpoint();
  await window.messageHubFastExporter.start();
  assert.equal(saved._messagehub.schema, 'messagehub-facebook-messenger-extended');
  assert.equal(saved._messagehub.version, 1);
  assert.equal(saved._messagehub.thread_id, '123');
  assert.equal(saved.title, 'Test Thread');
  assert.equal(saved.thread_path, 'inbox/test_thread_123');
  assert.deepEqual(saved.participants[0], {
    name: 'Tester',
    _messagehub: { participant_id: '1', name: 'Tester' },
  });
  const messages = new Map(saved.messages.map((message) => [message._messagehub.message_id, message]));
  const replyTo = (message) => {
    const reply = message._messagehub.reply_to;
    return reply
      ? { messageId: reply.message_id, senderId: reply.sender_id, text: reply.content }
      : null;
  };
  assert.deepEqual(replyTo(messages.get('sparse')), checkpoint.messages[0].replyTo);
  assert.equal(messages.get('decode').content, 'known body');
  assert.deepEqual(replyTo(messages.get('decode')), checkpoint.messages[1].replyTo);
  assert.deepEqual(replyTo(messages.get('changed')), { messageId: 'different', senderId: null, text: null });
  assert.equal('content' in messages.get('unsent'), false);
  assert.equal(replyTo(messages.get('unsent')), null);
  assert.deepEqual(saved._messagehub.export.decodeErrors, [{ id: 'decode', field: 'text' }]);
  assert.equal(saved.messages.every((message, index, values) => (
    index === 0 || values[index - 1].timestamp_ms >= message.timestamp_ms
  )), true);

  checkpointText = JSON.stringify(saved);
  window.messageHubFastExporter.reset();
  await window.messageHubFastExporter.loadCheckpoint();
  await window.messageHubFastExporter.start();
  assert.equal(saved._messagehub.schema, 'messagehub-facebook-messenger-extended');
  assert.equal(saved.messages.length, checkpoint.messages.length);
  console.log('PASS sparse metadata, decode failure, changed reply target, and unsent handling');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
