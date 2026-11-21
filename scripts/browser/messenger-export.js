/* Paste this file into DevTools on the Messenger conversation to export.
 * See docs/messenger-export-investigation.md for usage and verified limitations.
 */
(() => {
  'use strict';

  if (window.messageHubExporter?.status().running || window.messageHubExporter?.status().pendingRequest) {
    throw new Error('Stop the running export before installing the script again.');
  }

  const FORMAT = 'messagehub-messenger-investigation';
  const INTEGER = /^\d+$/;
  let document = null;
  let running = false;
  let stopping = false;
  let inFlight = null;
  let lastError = null;

  function activeThreadId() {
    const match = window.location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/);
    if (!match) throw new Error('Open a Messenger conversation first.');
    return match[1];
  }

  function validateCheckpoint(value) {
    if (
      value?.format !== FORMAT ||
      ![1, 2].includes(value.version) ||
      !INTEGER.test(value.threadId) ||
      !Array.isArray(value.messages) ||
      !value.checkpoint?.range
    ) {
      throw new Error('Unsupported Messenger checkpoint.');
    }
    const range = value.checkpoint.range;
    for (const timestamp of [range.minTimestampMs, range.maxTimestampMs]) {
      if (typeof timestamp !== 'string' || !INTEGER.test(timestamp)) {
        throw new Error('Checkpoint timestamps must be decimal strings.');
      }
    }
    if (range.threadKey !== value.threadId || BigInt(range.minTimestampMs) > BigInt(range.maxTimestampMs)) {
      throw new Error('Invalid checkpoint range.');
    }
    const ids = new Set();
    for (const message of value.messages) {
      if (
        typeof message.id !== 'string' ||
        !message.id ||
        ids.has(message.id) ||
        typeof message.timestampMs !== 'string' ||
        !INTEGER.test(message.timestampMs) ||
        typeof message.senderId !== 'string' ||
        !INTEGER.test(message.senderId) ||
        (message.text !== null && typeof message.text !== 'string') ||
        (message.replyTo != null && typeof message.replyTo.messageId !== 'string')
      ) {
        throw new Error('Invalid or duplicate checkpoint message.');
      }
      ids.add(message.id);
    }
    return value;
  }

  function status() {
    return {
      running,
      pendingRequest: inFlight !== null,
      status: document?.status ?? 'ready',
      threadId: document?.threadId ?? null,
      messages: document?.messages.length ?? 0,
      batches: document?.batches ?? 0,
      oldestRangeTimestampMs: document?.checkpoint?.range.minTimestampMs ?? null,
      availableHistoryComplete: document?.coverage?.availableHistoryComplete ?? false,
      unresolvedReplies: document?.coverage?.unresolvedReplies ?? 0,
      lastError,
    };
  }

  async function bounded(promise, timeoutMs, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out. The last checkpoint remains resumable.`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function rangeAt(loader, cursor, timeoutMs) {
    let subscription;
    try {
      return await bounded(
        new Promise((resolve, reject) => {
          subscription = loader.getOrCreateMessageRangeCoveringCursor(cursor).subscribe({
            next(value) {
              if (!value.range.isLoadingBefore && !value.range.isLoadingAfter) resolve(value);
            },
            error: reject,
          });
        }),
        timeoutMs,
        'Reading the message range',
      );
    } finally {
      subscription?.unsubscribe();
    }
  }

  async function writeCheckpoint(handle) {
    document.updatedAt = new Date().toISOString();
    const stream = await handle.createWritable();
    try {
      await stream.write(JSON.stringify(document, null, 2) + '\n');
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }

  async function loadCheckpoint() {
    if (running || inFlight) throw new Error('Wait for the current request to finish.');
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Messenger checkpoint', accept: { 'application/json': ['.json'] } }],
    });
    const checkpoint = validateCheckpoint(JSON.parse(await (await handle.getFile()).text()));
    if (checkpoint.threadId !== activeThreadId())
      throw new Error('Open the conversation belonging to this checkpoint.');
    document = checkpoint;
    lastError = null;
    console.log('MessageHub checkpoint loaded', status());
    return status();
  }

  async function start({ maxBatches = 50, batchSize = 20, timeoutMs = 30000 } = {}) {
    if (running || inFlight) throw new Error('A history request is already running.');
    for (const [name, value] of Object.entries({ maxBatches, batchSize, timeoutMs })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    }
    if (batchSize > 100) throw new Error('Use a batch size of 100 or fewer.');
    const threadId = activeThreadId();
    if (document && document.threadId !== threadId)
      throw new Error('Load the checkpoint for this conversation or reset.');
    running = true;
    stopping = false;
    lastError = null;
    let handle;
    try {
      // Choose the destination while the Console command still has user activation.
      handle = await window.showSaveFilePicker({
        suggestedName: `messenger-${threadId}.json`,
        types: [{ description: 'Messenger export and checkpoint', accept: { 'application/json': ['.json'] } }],
      });
      const db = await bounded(require('LSDatabaseSingleton').LSDatabaseSingleton, timeoutMs, 'Opening Messenger');
      const q = require('ReQL');
      const i64 = require('I64');
      const threadKey = i64.of_string(threadId);
      const thread = await db.tables.threads.get(threadKey);
      if (!thread) throw new Error('The active conversation is unavailable.');
      const encrypted = require('LSMessagingThreadTypeUtil').isArmadilloSecure(thread.threadType);
      const loader = encrypted
        ? require('MAWMessageRangeDataSourceV2')(db)
        : new (require('MWPMessageRangeDataSource').MSYSMessageRangeDataSource)(db);
      let unvault;
      try {
        unvault = require('MAWVault').unvault;
      } catch (_) {
        // Plain text can still be exported on builds without the vault module.
      }

      const decodeErrors = new Map(
        (document?.decodeErrors ?? []).map((error) => [`${error.id}:${error.field}`, error]),
      );
      function decode(value, id, field) {
        const errorKey = `${id}:${field}`;
        decodeErrors.delete(errorKey);
        if (value == null) return null;
        try {
          if (typeof value !== 'string') throw new Error('Expected a string.');
          if (!/\d+##\d+/.test(value)) return value;
          const text = unvault?.(value);
          if (typeof text !== 'string' || /\d+##\d+/.test(text)) throw new Error('Vault decoding unavailable.');
          return text;
        } catch (_) {
          decodeErrors.set(errorKey, { id, field });
          return null;
        }
      }

      const messages = new Map((document?.messages ?? []).map((message) => [message.id, message]));
      const participants = new Map((document?.participants ?? []).map((person) => [person.id, person]));
      const startCursor = document?.checkpoint
        ? {
            threadKey,
            timestampMs: i64.of_string(document.checkpoint.range.minTimestampMs),
            messageId: document.checkpoint.range.minMessageId || undefined,
            externalId: document.checkpoint.rangeExternalIds?.minExternalId,
          }
        : { threadKey, timestampMs: i64.max_int };
      let current = await rangeAt(loader, startCursor, timeoutMs);
      const initialMaximum = [...messages.values()].reduce(
        (maximum, message) => (BigInt(message.timestampMs) > BigInt(maximum) ? message.timestampMs : maximum),
        document?.coverage?.throughTimestampMs ?? i64.to_string(current.range.maxTimestampMs),
      );
      document = {
        ...document,
        format: FORMAT,
        version: 2,
        threadId,
        encrypted,
        createdAt: document?.createdAt ?? new Date().toISOString(),
        scope: 'Message text and reply metadata from the selected Messenger history segment',
        batches: document?.batches ?? 0,
        partial: true,
        status: 'running',
        lastError: null,
        messages: [...messages.values()],
        participants: [...participants.values()],
      };

      function checkConversation() {
        if (activeThreadId() !== threadId) throw new Error('Conversation changed. Resume in the original chat.');
      }

      async function collect() {
        checkConversation();
        // Read all locally stored rows for this thread. A fixed take limit would silently lose history.
        const rows = await bounded(
          q.toArrayAsync(q.fromTableDescending(db.tables.messages).getKeyRange(threadKey)),
          timeoutMs,
          'Reading stored messages',
        );
        for (const row of rows) {
          if (typeof row.messageId !== 'string' || !row.messageId) throw new Error('Message has no platform ID.');
          const senderId = i64.to_string(row.senderId);
          messages.set(row.messageId, {
            id: row.messageId,
            timestampMs: i64.to_string(row.timestampMs),
            senderId,
            text: row.isUnsent ? null : decode(row.text, row.messageId, 'text'),
            isUnsent: row.isUnsent === true,
            replyTo: row.replySourceId
              ? {
                  messageId: row.replySourceId,
                  senderId: row.replyToUserId ? i64.to_string(row.replyToUserId) : null,
                  text: decode(row.replyMessageText ?? row.replySnippet, row.messageId, 'quote'),
                }
              : null,
          });
          if (!participants.has(senderId)) {
            const contact = await db.tables.contacts.get(row.senderId);
            participants.set(senderId, { id: senderId, name: decode(contact?.name, senderId, 'name') });
          }
        }
        document.messages = [...messages.values()].sort((a, b) => {
          const difference = Number(b.timestampMs) - Number(a.timestampMs);
          return difference || a.id.localeCompare(b.id);
        });
        document.participants = [...participants.values()];
        document.decodeErrors = [...decodeErrors.values()];
      }

      function checkpoint() {
        const range = current.range;
        document.checkpoint = {
          range: {
            threadKey: threadId,
            minTimestampMs: i64.to_string(range.minTimestampMs),
            maxTimestampMs: i64.to_string(range.maxTimestampMs),
            minMessageId: range.minMessageId,
            maxMessageId: range.maxMessageId,
            hasMoreBefore: range.hasMoreBefore,
            hasMoreAfter: range.hasMoreAfter,
            isLoadingBefore: false,
            isLoadingAfter: false,
          },
          rangeExternalIds: current.rangeExternalIds,
        };
        const unresolvedReplies = [...messages.values()].filter(
          (message) => message.replyTo && !messages.has(message.replyTo.messageId),
        ).length;
        document.coverage = {
          fromTimestampMs: i64.to_string(range.minTimestampMs),
          throughTimestampMs: initialMaximum,
          availableHistoryComplete: range.hasMoreBefore === false,
          accountHistoryComplete: false,
          unresolvedReplies,
        };
        document.partial = range.hasMoreBefore !== false || decodeErrors.size > 0;
      }

      await collect();
      checkpoint();
      await writeCheckpoint(handle);
      for (let batch = 0; batch < maxBatches && !stopping && current.range.hasMoreBefore; batch++) {
        checkConversation();
        const before = document.checkpoint.range;
        const cursor = {
          threadKey,
          timestampMs: i64.of_string(before.minTimestampMs),
          messageId: before.minMessageId || undefined,
          externalId: current.rangeExternalIds?.minExternalId,
        };
        const request = loader.extendRange(current.range, current.rangeExternalIds, 'desc', batchSize);
        inFlight = request;
        request.then(
          () => {
            inFlight = null;
          },
          () => {
            inFlight = null;
          },
        );
        await bounded(request, timeoutMs, 'Fetching older messages');
        current = await rangeAt(loader, cursor, timeoutMs);
        checkConversation();
        const afterMinimum = i64.to_string(current.range.minTimestampMs);
        if (BigInt(afterMinimum) > BigInt(before.minTimestampMs)) throw new Error('History boundary moved forward.');
        await collect();
        document.batches++;
        checkpoint();
        const unchanged = afterMinimum === before.minTimestampMs && current.range.minMessageId === before.minMessageId;
        if (unchanged && current.range.hasMoreBefore) document.status = 'stalled';
        await writeCheckpoint(handle);
        console.log('MessageHub export progress', status());
        if (document.status === 'stalled') break;
      }
      if (document.status !== 'stalled') {
        document.status = stopping ? 'stopped' : current.range.hasMoreBefore ? 'batch-limit' : 'history-end';
      }
      await writeCheckpoint(handle);
    } catch (error) {
      lastError = String(error);
      if (document && handle) {
        document.status = 'error';
        document.partial = true;
        document.lastError = lastError;
        try {
          await writeCheckpoint(handle);
        } catch (saveError) {
          lastError += ` Checkpoint save also failed: ${String(saveError)}`;
        }
      }
      console.error('MessageHub export stopped', lastError);
    } finally {
      running = false;
    }
    console.log('MessageHub export result', status());
    return status();
  }

  window.messageHubExporter = {
    start,
    loadCheckpoint,
    status,
    stop() {
      stopping = true;
      return status();
    },
    reset() {
      if (running || inFlight) throw new Error('Wait for the current request to finish.');
      document = null;
      lastError = null;
      return status();
    },
  };
  console.log('MessageHub exporter ready. Call messageHubExporter.start() or messageHubExporter.loadCheckpoint().');
})();
