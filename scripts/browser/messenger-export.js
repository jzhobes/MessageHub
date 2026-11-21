/**
 * Paste this file into DevTools Console on the Messenger conversation to export.
 *
 * Quick usage:
 *   await messageHubFastExporter.start()
 *   await messageHubFastExporter.start({ maxBatches: 500, batchSize: 20, saveEvery: 10 })
 *   await messageHubFastExporter.loadCheckpoint() // resume from a saved JSON file, then start()
 *   messageHubFastExporter.status()               // inspect progress
 *   messageHubFastExporter.stop()                 // stop after the current batch and save
 *   messageHubFastExporter.reset()                // clear loaded state in memory
 *
 * Start defaults: maxBatches = 50, batchSize = 20, timeoutMs = 30000,
 *   saveEvery = 10, stallRetries = 2, retryDelayMs = 2000.
 * Outputs `messagehub-facebook-messenger-extended` (v1) JSON for `scripts/merge_messenger.py`.
 */
(() => {
  'use strict';

  if (window.messageHubFastExporter?.status().running || window.messageHubFastExporter?.status().pendingRequest) {
    throw new Error('Stop the running export before installing the script again.');
  }

  const FORMAT = 'messagehub-facebook-messenger';
  const EXTENDED_SCHEMA = 'messagehub-facebook-messenger-extended';
  const EXTENDED_VERSION = 1;
  const INTEGER = /^\d+$/;
  let document = null;
  let running = false;
  let stopping = false;
  let inFlight = null;
  let lastError = null;

  /**
   * Returns the numeric thread ID from the active Messenger conversation URL.
   */
  function activeThreadId() {
    const match = window.location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/);
    if (!match) throw new Error('Open a Messenger conversation first.');
    return match[1];
  }

  /**
   * Validates and returns the exporter's internal resumable checkpoint shape.
   */
  function validateInternalCheckpoint(value) {
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

  /**
   * Converts an extended Facebook-compatible file back into the internal checkpoint shape.
   */
  function fromExtendedCheckpoint(value) {
    if (value?._messagehub?.schema !== EXTENDED_SCHEMA || value._messagehub.version !== EXTENDED_VERSION) {
      return value;
    }
    const metadata = value._messagehub;
    const exported = metadata.export;
    if (!exported || !Array.isArray(value.messages) || !Array.isArray(value.participants)) {
      throw new Error('Unsupported Messenger checkpoint.');
    }
    return {
      ...exported,
      threadId: metadata.thread_id,
      encrypted: metadata.encrypted,
      title: value.title,
      participants: value.participants.map((participant) => {
        const extension = participant?._messagehub;
        return {
          id: extension?.participant_id,
          name: Object.prototype.hasOwnProperty.call(extension ?? {}, 'name') ? extension.name : participant.name,
        };
      }),
      messages: value.messages.map((message) => {
        const extension = message?._messagehub;
        const reply = extension?.reply_to;
        return {
          id: extension?.message_id,
          timestampMs: String(message.timestamp_ms),
          senderId: extension?.sender_id,
          text: message.content ?? null,
          isUnsent: message.is_unsent === true,
          replyTo: reply
            ? {
                messageId: reply.message_id,
                senderId: reply.sender_id,
                text: reply.content ?? null,
              }
            : null,
        };
      }),
    };
  }

  function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /**
   * Converts an internal checkpoint into the persisted Facebook-compatible schema.
   */
  function toExtendedCheckpoint(value) {
    const participantsById = new Map(value.participants.map((participant) => [participant.id, participant.name]));
    const messages = value.messages
      .map((message) => {
        const extended = {
          sender_name: participantsById.get(message.senderId) ?? (message.senderId === '0' ? 'Facebook' : 'Unknown'),
          timestamp_ms: Number(message.timestampMs),
          is_unsent: message.isUnsent === true,
          type: 'Generic',
          _messagehub: {
            message_id: message.id,
            sender_id: message.senderId,
          },
        };
        if (message.text !== null) extended.content = message.text;
        if (message.replyTo) {
          extended._messagehub.reply_to = {
            message_id: message.replyTo.messageId,
            sender_id: message.replyTo.senderId,
            content: message.replyTo.text,
          };
        }
        return extended;
      })
      .sort((left, right) => right.timestamp_ms - left.timestamp_ms);
    const { messages: _messages, participants: _participants, title: _title, ...exportMetadata } = value;
    return {
      participants: value.participants.map((participant) => ({
        name: participant.name ?? (participant.id === '0' ? 'Facebook' : 'Unknown'),
        _messagehub: { participant_id: participant.id, name: participant.name },
      })),
      messages,
      title: value.title,
      is_still_participant: true,
      thread_path: `inbox/${slugify(value.title)}_${value.threadId}`,
      magic_words: [],
      _messagehub: {
        schema: EXTENDED_SCHEMA,
        version: EXTENDED_VERSION,
        thread_id: value.threadId,
        encrypted: value.encrypted,
        export: exportMetadata,
      },
    };
  }

  /**
   * Returns a serializable snapshot of the current exporter state.
   */
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

  /**
   * Awaits a promise while enforcing a descriptive timeout.
   */
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

  /**
   * Resolves the settled message range covering a pagination cursor.
   */
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

  /**
   * Atomically replaces the selected file with the latest extended checkpoint.
   */
  async function writeCheckpoint(handle) {
    document.updatedAt = new Date().toISOString();
    const stream = await handle.createWritable();
    try {
      await stream.write(JSON.stringify(toExtendedCheckpoint(document), null, 2) + '\n');
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }

  /**
   * Prompts for and restores either a legacy or extended checkpoint file.
   */
  async function loadCheckpoint() {
    if (running || inFlight) throw new Error('Wait for the current request to finish.');
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Messenger checkpoint', accept: { 'application/json': ['.json'] } }],
    });
    const checkpoint = validateInternalCheckpoint(
      fromExtendedCheckpoint(JSON.parse(await (await handle.getFile()).text())),
    );
    if (checkpoint.threadId !== activeThreadId())
      throw new Error('Open the conversation belonging to this checkpoint.');
    document = checkpoint;
    lastError = null;
    console.log('MessageHub checkpoint loaded', status());
    return status();
  }

  /**
   * Exports older history from the active thread and saves resumable checkpoints.
   */
  async function start({
    maxBatches = 50,
    batchSize = 20,
    timeoutMs = 30000,
    saveEvery = 10,
    stallRetries = 2,
    retryDelayMs = 2000,
  } = {}) {
    if (running || inFlight) throw new Error('A history request is already running.');
    for (const [name, value] of Object.entries({ maxBatches, batchSize, timeoutMs, saveEvery })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    }
    if (batchSize > 100) throw new Error('Use a batch size of 100 or fewer.');
    if (!Number.isSafeInteger(stallRetries) || stallRetries < 0 || stallRetries > 5)
      throw new Error('stallRetries must be between 0 and 5.');
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 30000)
      throw new Error('retryDelayMs must be between 1 and 30000.');
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

      const title =
        decode(thread.threadName ?? thread.name, threadId, 'title') ?? document?.title ?? `Messenger ${threadId}`;

      const messages = new Map((document?.messages ?? []).map((message) => [message.id, message]));
      const fingerprints = new Map();
      const startedAt = performance.now();
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
      document = {
        ...document,
        format: FORMAT,
        version: 2,
        threadId,
        encrypted,
        title,
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
          const i64String = (value) => (value == null ? null : i64.to_string(value));
          const fingerprint = JSON.stringify([
            row.text,
            row.isUnsent,
            row.replySourceId,
            row.replyMessageText,
            row.replySnippet,
            i64String(row.replyToUserId),
            i64String(row.timestampMs),
            i64String(row.senderId),
          ]);
          if (fingerprints.get(row.messageId) === fingerprint) continue;
          const previous = messages.get(row.messageId);
          const senderId = i64String(row.senderId);
          const decodedText = row.isUnsent ? null : decode(row.text, row.messageId, 'text');
          const replyTargetId = row.replySourceId || null;
          const previousReply = previous?.replyTo?.messageId === replyTargetId ? previous.replyTo : null;
          const decodedQuote = replyTargetId
            ? decode(row.replyMessageText ?? row.replySnippet, row.messageId, 'quote')
            : null;
          messages.set(row.messageId, {
            id: row.messageId,
            timestampMs: i64String(row.timestampMs),
            senderId,
            text: row.isUnsent ? null : (decodedText ?? previous?.text ?? null),
            isUnsent: row.isUnsent === true,
            replyTo: replyTargetId
              ? {
                  messageId: replyTargetId,
                  senderId: i64String(row.replyToUserId) ?? previousReply?.senderId ?? null,
                  text: decodedQuote ?? previousReply?.text ?? null,
                }
              : null,
          });
          if (!participants.has(senderId)) {
            const contact = await db.tables.contacts.get(row.senderId);
            participants.set(senderId, { id: senderId, name: decode(contact?.name, senderId, 'name') });
          }
          fingerprints.set(row.messageId, fingerprint);
        }
        document.messages = [...messages.values()];
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
        let oldest = null;
        let newest = null;
        for (const message of messages.values()) {
          const timestamp = BigInt(message.timestampMs);
          if (timestamp <= 0n) continue;
          if (oldest === null || timestamp < oldest) oldest = timestamp;
          if (newest === null || timestamp > newest) newest = timestamp;
        }
        document.coverage = {
          fromTimestampMs: oldest?.toString() ?? null,
          throughTimestampMs: newest?.toString() ?? null,
          availableHistoryComplete: range.hasMoreBefore === false,
          accountHistoryComplete: false,
          unresolvedReplies,
        };
        document.partial = range.hasMoreBefore !== false || decodeErrors.size > 0;
      }

      await collect();
      checkpoint();
      await writeCheckpoint(handle);
      let unchangedAttempts = 0;
      for (let batch = 0; batch < maxBatches && !stopping && current.range.hasMoreBefore; batch++) {
        checkConversation();
        const requestStarted = performance.now();
        const previousCount = messages.size;
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
        unchangedAttempts = unchanged && current.range.hasMoreBefore ? unchangedAttempts + 1 : 0;
        document.paginationDiagnostics = {
          before: { timestampMs: before.minTimestampMs, messageId: before.minMessageId },
          after: { timestampMs: afterMinimum, messageId: current.range.minMessageId },
          hasMoreBefore: current.range.hasMoreBefore,
          isLoadingBefore: current.range.isLoadingBefore,
          isLoadingAfter: current.range.isLoadingAfter,
          durationMs: Math.round(performance.now() - requestStarted),
          addedMessages: messages.size - previousCount,
          unchangedAttempts,
        };
        if (unchangedAttempts > stallRetries) document.status = 'stalled';
        document.elapsedMs = Math.round(performance.now() - startedAt);
        if ((batch + 1) % saveEvery === 0) await writeCheckpoint(handle);
        console.log('MessageHub export progress', status());
        if (document.status === 'stalled') break;
        if (unchangedAttempts) {
          // Save before retrying so a persistent stall remains resumable.
          await writeCheckpoint(handle);
          console.warn('MessageHub pagination unchanged; retrying', document.paginationDiagnostics);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
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

  window.messageHubFastExporter = {
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
  console.log(
    'MessageHub fast exporter ready. Use messageHubFastExporter.start(). Saves every 10 batches by default and on exit. Message order is unspecified.',
  );
})();
