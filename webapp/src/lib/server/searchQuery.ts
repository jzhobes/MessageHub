import type { ParsedToken } from '@/lib/shared/search';

/**
 * At or below this message count, use `idx_content_thread_id` for a thread-scoped search. That
 * keeps small searches under a millisecond and leaves global FTS5 and the CTEs for large threads.
 */
export const DIRECT_THREAD_SCOPE_LIMIT = 5000;

/**
 * Options for the query that fills `temp._search_base`.
 */
export interface SearchBaseQueryOptions {
  /** OR groups from the parser, with AND between tokens inside each group. */
  orGroups: ParsedToken[][];
  /** Optional list of thread IDs to restrict search scope. */
  threadIds: string[];
  /** Normalized DB platform identifiers to filter by. */
  platforms: string[];
  /** Thread category/label names to filter by. */
  categories: string[];
  /** Keep the rows and match flags needed to count each facet independently. */
  includeFacets: boolean;
  /** Scan the requested threads through `idx_content_thread_id` when enabled and `threadIds` is nonempty. */
  useDirectThreadScope?: boolean;
}

/**
 * A SQL statement with its positional bind values in order.
 */
export interface BuiltSql {
  sql: string;
  params: (string | number)[];
}

/**
 * Create the request's in-memory table with message metadata and platform/category match flags.
 * Keep it light so counts, facets, and sorting don't read large `content` blobs. Join the content
 * for the final 100-row page.
 */
export const CREATE_SEARCH_BASE_TEMP_TABLE_SQL = `
CREATE TEMP TABLE _search_base (
  id INTEGER PRIMARY KEY,
  thread_id TEXT,
  platform TEXT,
  sender_name TEXT,
  timestamp_ms INTEGER,
  matches_platform INTEGER,
  matches_category INTEGER
)`.trim();

interface ClassifiedToken {
  token: ParsedToken;
  ftsMatchExpr: string | null;
  needsContentLikeRefinement: boolean;
}

interface CandidateCteResult {
  withClause: string;
  candidateCteName: string;
  params: (string | number)[];
}

interface FilterClauses {
  matchesPlatformExpr: string;
  matchesCategoryExpr: string;
  selectParams: (string | number)[];
  whereConditions: string[];
  whereParams: (string | number)[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/**
 * Build a multiline `LIKE` predicate using the parser's `sqlPattern` and a backslash escape.
 * With `^`, match at the start of the text or after a space or newline.
 */
function buildContentLike(column: string, token: ParsedToken): BuiltSql {
  if (token.isStartOfWord) {
    return {
      sql: `(${column} LIKE ? ESCAPE '\\' OR ${column} LIKE ? ESCAPE '\\' OR ${column} LIKE ? ESCAPE '\\')`,
      params: [`${token.sqlPattern}%`, `% ${token.sqlPattern}%`, `%\n${token.sqlPattern}%`],
    };
  }
  return {
    sql: `${column} LIKE ? ESCAPE '\\'`,
    params: [`%${token.sqlPattern}%`],
  };
}

/**
 * Build a `LIKE` predicate for single-line thread titles and sender names, using a backslash
 * escape.
 * With `^`, match at the start of the field or after a space.
 */
function buildSingleLineLike(column: string, token: ParsedToken): BuiltSql {
  if (token.isStartOfWord) {
    return {
      sql: `(${column} LIKE ? ESCAPE '\\' OR ${column} LIKE ? ESCAPE '\\')`,
      params: [`${token.sqlPattern}%`, `% ${token.sqlPattern}%`],
    };
  }
  return {
    sql: `${column} LIKE ? ESCAPE '\\'`,
    params: [`%${token.sqlPattern}%`],
  };
}

/**
 * Match a single token against the message body, thread title, or sender name.
 */
function buildMultiFieldLike(token: ParsedToken): BuiltSql {
  const contentLike = buildContentLike('m.content', token);
  const titleLike = buildSingleLineLike('t.title', token);
  const senderLike = buildSingleLineLike('m.sender_name', token);
  return {
    sql: `(${contentLike.sql} OR ${titleLike.sql} OR ${senderLike.sql})`,
    params: [...contentLike.params, ...titleLike.params, ...senderLike.params],
  };
}

/**
 * Find literal fragments of at least three Unicode code points for the FTS5 trigram index. Flag any
 * wildcard or `^` match that still needs a `LIKE` check.
 */
function classifyToken(token: ParsedToken): ClassifiedToken {
  // SQLite counts Unicode code points here, so count those instead of UTF-16 code units.
  const ftsParts = token.clean.split(/[*?]/).filter((part) => Array.from(part.trim()).length >= 3);
  const hasWildcards = /[*?]/.test(token.clean);
  const ftsMatchExpr =
    ftsParts.length > 0 ? ftsParts.map((part) => `"${part.replace(/"/g, '""')}"`).join(' AND ') : null;
  const needsContentLikeRefinement =
    token.isStartOfWord || hasWildcards || ftsParts.length !== 1 || ftsParts[0] !== token.clean;

  return { token, ftsMatchExpr, needsContentLikeRefinement };
}

/**
 * Build the platform/category match flags for `SELECT` and filters for `WHERE`.
 * If facets are requested and both filters are active, keep rows that match either one. Each facet
 * needs rows that match the other filter. Without facets, filter rows in `WHERE`.
 */
function buildFilterClauses(platforms: string[], categories: string[], includeFacets: boolean): FilterClauses {
  const selectParams: (string | number)[] = [];
  const whereConditions: string[] = [];
  const whereParams: (string | number)[] = [];

  let matchesPlatformExpr = '1';
  let matchesCategoryExpr = '1';

  if (includeFacets) {
    if (platforms.length > 0) {
      matchesPlatformExpr = `CASE WHEN t.platform IN (${placeholders(platforms.length)}) THEN 1 ELSE 0 END`;
      selectParams.push(...platforms);
    }
    if (categories.length > 0) {
      matchesCategoryExpr = `CASE WHEN EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = m.thread_id AND tl.label IN (${placeholders(categories.length)})) THEN 1 ELSE 0 END`;
      selectParams.push(...categories);
    }
    if (platforms.length > 0 && categories.length > 0) {
      // If a row misses both filters, neither facet needs it.
      whereConditions.push(
        `(t.platform IN (${placeholders(platforms.length)}) OR EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = m.thread_id AND tl.label IN (${placeholders(categories.length)})))`,
      );
      whereParams.push(...platforms, ...categories);
    }
  } else {
    if (platforms.length > 0) {
      whereConditions.push(`t.platform IN (${placeholders(platforms.length)})`);
      whereParams.push(...platforms);
    }
    if (categories.length > 0) {
      whereConditions.push(
        `EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = m.thread_id AND tl.label IN (${placeholders(categories.length)}))`,
      );
      whereParams.push(...categories);
    }
  }

  return {
    matchesPlatformExpr,
    matchesCategoryExpr,
    selectParams,
    whereConditions,
    whereParams,
  };
}

/**
 * Combine the multi-field `LIKE` groups into one OR-of-ANDs predicate for small thread searches
 * that skip FTS5 and CTEs.
 */
function buildGroupLikeClause(orGroups: ParsedToken[][]): BuiltSql {
  const params: (string | number)[] = [];
  const groupClauses = orGroups.map((groupTokens) => {
    const tokenClauses = groupTokens.map((token) => {
      const fieldLike = buildMultiFieldLike(token);
      params.push(...fieldLike.params);
      return fieldLike.sql;
    });
    return `(${tokenClauses.join(' AND ')})`;
  });

  return {
    sql: `(${groupClauses.join(' OR ')})`,
    params,
  };
}

/**
 * Build the `_tok_*`, `_grp_*`, and `_candidates` CTEs to find matching `content.id` values across
 * FTS5, thread titles, and sender names.
 * Use the indexes when a fragment has at least three code points so we can skip a full-table `LIKE`
 * scan.
 */
function buildCandidateCtes(orGroups: ParsedToken[][], threadIds: string[]): CandidateCteResult {
  const ctes: string[] = [];
  const params: (string | number)[] = [];
  const groupCteNames: string[] = [];
  let usesDistinctSenders = false;
  let tokenCounter = 0;

  orGroups.forEach((groupTokens, groupIdx) => {
    const classified = groupTokens.map(classifyToken);
    const indexable = classified.filter((c) => c.ftsMatchExpr !== null);
    const nonIndexable = classified.filter((c) => c.ftsMatchExpr === null);

    const tokenCteNames: string[] = [];

    for (const item of indexable) {
      const cteName = `_tok_${tokenCounter++}`;
      const ftsExpr = item.ftsMatchExpr!;
      const titleLike = buildSingleLineLike('title', item.token);
      const senderLike = buildSingleLineLike('s', item.token);

      let contentBranchSql: string;
      const contentBranchParams: (string | number)[] = [ftsExpr];

      if (!item.needsContentLikeRefinement) {
        contentBranchSql = `SELECT rowid AS id FROM content_fts WHERE content_fts MATCH ?`;
      } else {
        // Recheck FTS5 hits with LIKE so wildcards and ^ behave exactly as the query asks.
        const contentLike = buildContentLike('m.content', item.token);
        contentBranchSql = `SELECT m.id FROM content_fts JOIN content m ON m.id = content_fts.rowid WHERE content_fts MATCH ? AND ${contentLike.sql}`;
        contentBranchParams.push(...contentLike.params);
      }

      // Limit the title and sender branches to the requested thread IDs.
      // That keeps matches from other conversations out of large thread-scoped queries.
      const titleBranchSql =
        threadIds.length > 0
          ? `SELECT id FROM content WHERE thread_id IN (SELECT id FROM threads WHERE id IN (${placeholders(threadIds.length)}) AND ${titleLike.sql})`
          : `SELECT id FROM content WHERE thread_id IN (SELECT id FROM threads WHERE ${titleLike.sql})`;
      const titleBranchParams = threadIds.length > 0 ? [...threadIds, ...titleLike.params] : titleLike.params;

      const senderBranchSql =
        threadIds.length > 0
          ? `SELECT id FROM content WHERE sender_name IN (SELECT s FROM _distinct_senders WHERE s IS NOT NULL AND ${senderLike.sql}) AND thread_id IN (${placeholders(threadIds.length)})`
          : `SELECT id FROM content WHERE sender_name IN (SELECT s FROM _distinct_senders WHERE s IS NOT NULL AND ${senderLike.sql})`;
      const senderBranchParams = threadIds.length > 0 ? [...senderLike.params, ...threadIds] : senderLike.params;

      // Give each token's UNION its own CTE.
      // SQLite evaluates UNION and INTERSECT left to right at the same precedence.
      ctes.push(
        `${cteName}(id) AS (\n    ${contentBranchSql}\n    UNION\n    ${titleBranchSql}\n    UNION\n    ${senderBranchSql}\n  )`,
      );
      params.push(...contentBranchParams, ...titleBranchParams, ...senderBranchParams);
      usesDistinctSenders = true;
      tokenCteNames.push(cteName);
    }

    if (indexable.length > 0 && nonIndexable.length === 0) {
      // If every token is indexed, just intersect their candidate IDs.
      if (tokenCteNames.length === 1) {
        groupCteNames.push(tokenCteNames[0]);
      } else {
        const grpName = `_grp_${groupIdx}`;
        const intersectSql = tokenCteNames.map((name) => `SELECT id FROM ${name}`).join('\n    INTERSECT\n    ');
        ctes.push(`${grpName}(id) AS (\n    ${intersectSql}\n  )`);
        groupCteNames.push(grpName);
      }
    } else if (indexable.length > 0 && nonIndexable.length > 0) {
      // For a mix of tokens, intersect the indexed matches first and run LIKE on those rows.
      let idxCteName = tokenCteNames[0];
      if (tokenCteNames.length > 1) {
        idxCteName = `_grp_${groupIdx}_idx`;
        const intersectSql = tokenCteNames.map((name) => `SELECT id FROM ${name}`).join('\n    INTERSECT\n    ');
        ctes.push(`${idxCteName}(id) AS (\n    ${intersectSql}\n  )`);
      }

      const grpName = `_grp_${groupIdx}`;
      const nonIdxClauses: string[] = [];
      for (const item of nonIndexable) {
        const fieldLike = buildMultiFieldLike(item.token);
        nonIdxClauses.push(fieldLike.sql);
        params.push(...fieldLike.params);
      }
      ctes.push(
        `${grpName}(id) AS (\n    SELECT m.id\n    FROM ${idxCteName} c\n    JOIN content m ON m.id = c.id\n    JOIN threads t ON m.thread_id = t.id\n    WHERE ${nonIdxClauses.join('\n      AND ')}\n  )`,
      );
      groupCteNames.push(grpName);
    } else {
      // Use LIKE if all terms or wildcard fragments are too short for the index.
      const grpName = `_grp_${groupIdx}`;
      const whereParts: string[] = [];
      for (const item of nonIndexable) {
        const fieldLike = buildMultiFieldLike(item.token);
        whereParts.push(fieldLike.sql);
        params.push(...fieldLike.params);
      }
      if (threadIds.length > 0) {
        whereParts.push(`m.thread_id IN (${placeholders(threadIds.length)})`);
        params.push(...threadIds);
      }
      ctes.push(
        `${grpName}(id) AS (\n    SELECT m.id\n    FROM content m\n    JOIN threads t ON m.thread_id = t.id\n    WHERE ${whereParts.join('\n      AND ')}\n  )`,
      );
      groupCteNames.push(grpName);
    }
  });

  let candidateCteName = groupCteNames[0];
  if (groupCteNames.length > 1) {
    candidateCteName = '_candidates';
    const unionSql = groupCteNames.map((name) => `SELECT id FROM ${name}`).join('\n    UNION\n    ');
    ctes.push(`${candidateCteName}(id) AS (\n    ${unionSql}\n  )`);
  }

  if (usesDistinctSenders) {
    // Walk distinct sender names through idx_content_sender_name.
    // That takes one B-tree probe per distinct sender instead of scanning every message.
    const distinctSendersCte = `_distinct_senders(s) AS MATERIALIZED (
    SELECT min(sender_name) FROM content WHERE sender_name IS NOT NULL
    UNION ALL
    SELECT (SELECT min(sender_name) FROM content WHERE sender_name > _distinct_senders.s)
    FROM _distinct_senders
    WHERE _distinct_senders.s IS NOT NULL
  )`;
    ctes.unshift(distinctSendersCte);
  }

  const withKeyword = usesDistinctSenders ? 'WITH RECURSIVE' : 'WITH';
  return {
    withClause: `${withKeyword}\n  ${ctes.join(',\n  ')}`,
    candidateCteName,
    params,
  };
}

/**
 * Build the parameterized INSERT that fills `temp._search_base` with matching messages and flags
 * for facets and pagination.
 * Small thread searches can use `idx_content_thread_id` directly through `useDirectThreadScope`.
 * Otherwise use FTS5 and the loose-index CTEs.
 *
 * @param options - Parsed query tokens, scope/facet filters, and execution strategy flags.
 * @returns The SQL `INSERT` statement and ordered bind parameters.
 */
export function buildPopulateSearchBaseQuery(options: SearchBaseQueryOptions): BuiltSql {
  const nonEmptyGroups = options.orGroups.filter((group) => group.length > 0);
  if (nonEmptyGroups.length === 0) {
    return {
      sql: `INSERT OR IGNORE INTO temp._search_base (id, thread_id, platform, sender_name, timestamp_ms, matches_platform, matches_category) SELECT 1, '', '', '', 0, 0, 0 WHERE 0`,
      params: [],
    };
  }

  const { threadIds, platforms, categories, includeFacets, useDirectThreadScope = false } = options;
  const filters = buildFilterClauses(platforms, categories, includeFacets);

  // For a small thread scope, go straight to its rows via idx_content_thread_id.
  if (useDirectThreadScope && threadIds.length > 0) {
    const groupLike = buildGroupLikeClause(nonEmptyGroups);
    const whereConditions = [
      `m.thread_id IN (${placeholders(threadIds.length)})`,
      groupLike.sql,
      ...filters.whereConditions,
    ];

    const sql = `
INSERT OR IGNORE INTO temp._search_base (
  id,
  thread_id,
  platform,
  sender_name,
  timestamp_ms,
  matches_platform,
  matches_category
)
SELECT
  m.id,
  m.thread_id,
  t.platform,
  m.sender_name,
  m.timestamp_ms,
  ${filters.matchesPlatformExpr},
  ${filters.matchesCategoryExpr}
FROM content m
JOIN threads t ON m.thread_id = t.id
WHERE ${whereConditions.join('\n  AND ')}`.trim();

    return {
      sql,
      params: [...filters.selectParams, ...threadIds, ...groupLike.params, ...filters.whereParams],
    };
  }

  // Use FTS5 and the title/sender indexes to find candidate message IDs.
  const candidate = buildCandidateCtes(nonEmptyGroups, threadIds);
  const whereConditions: string[] = [];
  const whereParams: (string | number)[] = [];

  if (threadIds.length > 0) {
    whereConditions.push(`m.thread_id IN (${placeholders(threadIds.length)})`);
    whereParams.push(...threadIds);
  }
  whereConditions.push(...filters.whereConditions);
  whereParams.push(...filters.whereParams);

  const whereClause = whereConditions.length > 0 ? `\nWHERE ${whereConditions.join('\n  AND ')}` : '';

  const sql = `
${candidate.withClause}
INSERT OR IGNORE INTO temp._search_base (
  id,
  thread_id,
  platform,
  sender_name,
  timestamp_ms,
  matches_platform,
  matches_category
)
SELECT
  m.id,
  m.thread_id,
  t.platform,
  m.sender_name,
  m.timestamp_ms,
  ${filters.matchesPlatformExpr},
  ${filters.matchesCategoryExpr}
FROM ${candidate.candidateCteName} c
JOIN content m ON m.id = c.id
JOIN threads t ON m.thread_id = t.id${whereClause}`.trim();

  return {
    sql,
    params: [...candidate.params, ...filters.selectParams, ...whereParams],
  };
}
