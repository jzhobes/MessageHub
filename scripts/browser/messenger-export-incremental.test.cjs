const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./messenger-export-incremental.js'), 'utf8');
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
  format: 'messagehub-messenger-investigation',
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
    threads: { get: async () => ({ threadType: 16 }) },
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
const window = {
  location: { pathname: '/messages/e2ee/t/123' },
  showOpenFilePicker: async () => [{ getFile: async () => ({ text: async () => JSON.stringify(checkpoint) }) }],
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
  const messages = new Map(saved.messages.map((message) => [message.id, message]));
  assert.deepEqual(messages.get('sparse').replyTo, checkpoint.messages[0].replyTo);
  assert.equal(messages.get('decode').text, 'known body');
  assert.deepEqual(messages.get('decode').replyTo, checkpoint.messages[1].replyTo);
  assert.deepEqual(messages.get('changed').replyTo, { messageId: 'different', senderId: null, text: null });
  assert.equal(messages.get('unsent').text, null);
  assert.equal(messages.get('unsent').replyTo, null);
  assert.deepEqual(saved.decodeErrors, [{ id: 'decode', field: 'text' }]);
  console.log('PASS sparse metadata, decode failure, changed reply target, and unsent handling');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
