import type { ParsedToken } from '@/lib/shared/search';

/**
 * Maximum message count for a thread-scoped search to bypass global FTS5 + CTEs and run
 * a direct `idx_content_thread_id` scan instead. Keeps small-thread queries sub-millisecond
 * while preserving FTS5 performance on massive threads (hundreds of thousands of messages).
 */
export const DIRECT_THREAD_SCOPE_LIMIT = 5000;

/**
 * Inputs for constructing the `temp._search_base` population query.
 */
export interface SearchBaseQueryOptions {
  /** Parsed boolean OR groups, where each inner array represents AND-ed query tokens. */
  orGroups: ParsedToken[][];
  /** Optional list of thread IDs to restrict search scope. */
  threadIds: string[];
  /** Normalized DB platform identifiers to filter by. */
  platforms: string[];
  /** Thread category/label names to filter by. */
  categories: string[];
  /** Whether to retain self-excluding rows and flag columns for facet aggregation. */
  includeFacets: boolean;
  /** When true (and `threadIds` is non-empty), scans only the scoped threads directly via `idx_content_thread_id`. */
  useDirectThreadScope?: boolean;
}

/**
 * A parameterized SQL statement paired with its ordered positional bind values.
 */
export interface BuiltSql {
  sql: string;
  params: (string | number)[];
}

/**
 * DDL for the per-request in-memory temp table holding matched message metadata and precomputed
 * platform/category match flags. Storing lightweight columns avoids reading large `content` blobs
 * across count, facet, and sort passes until the final 100-row page join.
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
 * Builds a SQL `LIKE` predicate for multiline message content using `ESCAPE '\'` to match
 * `parseSearchQuery`'s `sqlPattern`. When `isStartOfWord` (`^`) is set, matches at index 0,
 * after a space, or after a newline.
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
 * Builds a SQL `LIKE` predicate for single-line metadata fields (`threads.title`, `sender_name`)
 * using `ESCAPE '\'`. When `isStartOfWord` (`^`) is set, matches at index 0 or after a space.
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
 * Combines `m.content`, `t.title`, and `m.sender_name` `LIKE` predicates with `OR` for a single token.
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
 * Extracts literal FTS5 `trigram` fragments (>= 3 Unicode code points) from a parsed token
 * and determines whether FTS5 rowid hits require a `LIKE` post-filter for exact wildcard or
 * `^` word-start semantics.
 */
function classifyToken(token: ParsedToken): ClassifiedToken {
  // SQLite's trigram tokenizer counts Unicode code points rather than UTF-16 code units.
  const ftsParts = token.clean.split(/[*?]/).filter((part) => Array.from(part.trim()).length >= 3);
  const hasWildcards = /[*?]/.test(token.clean);
  const ftsMatchExpr =
    ftsParts.length > 0 ? ftsParts.map((part) => `"${part.replace(/"/g, '""')}"`).join(' AND ') : null;
  const needsContentLikeRefinement =
    token.isStartOfWord || hasWildcards || ftsParts.length !== 1 || ftsParts[0] !== token.clean;

  return { token, ftsMatchExpr, needsContentLikeRefinement };
}

/**
 * Builds `SELECT` match flags and `WHERE` pushdowns for platform and category filters.
 *
 * When `includeFacets` is true, rows matching *either* filter are kept (if both are active)
 * so self-excluding platform and category facet counts remain accurate; when `includeFacets`
 * is false, non-matching rows are filtered out directly in `WHERE`.
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
      // Rows matching neither active filter cannot contribute to either self-excluding facet.
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
 * Builds a single boolean DNF predicate (`OR` of `AND`-ed multi-field `LIKE` groups)
 * for small thread-scoped scans that bypass FTS5 and CTEs.
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
 * Builds index-driven CTEs (`_tok_*`, `_grp_*`, `_candidates`) that discover matching `content.id`
 * values across `content_fts`, `threads.title`, and `content.sender_name` without falling back
 * to full-table `LIKE` scans when indexable (>= 3 code-point) fragments exist.
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
        // Post-filter FTS5 rowids so wildcards and ^ word-start constraints remain exact.
        const contentLike = buildContentLike('m.content', item.token);
        contentBranchSql = `SELECT m.id FROM content_fts JOIN content m ON m.id = content_fts.rowid WHERE content_fts MATCH ? AND ${contentLike.sql}`;
        contentBranchParams.push(...contentLike.params);
      }

      // Push threadIds into title and sender branches on large thread-scoped queries to avoid
      // expanding matching threads/senders from unrelated conversations.
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

      // Wrap each token's UNION inside its own CTE because SQLite gives UNION and INTERSECT
      // equal left-to-right precedence.
      ctes.push(
        `${cteName}(id) AS (\n    ${contentBranchSql}\n    UNION\n    ${titleBranchSql}\n    UNION\n    ${senderBranchSql}\n  )`,
      );
      params.push(...contentBranchParams, ...titleBranchParams, ...senderBranchParams);
      usesDistinctSenders = true;
      tokenCteNames.push(cteName);
    }

    if (indexable.length > 0 && nonIndexable.length === 0) {
      // All tokens in this OR group are indexable: intersect their candidate ID sets directly.
      if (tokenCteNames.length === 1) {
        groupCteNames.push(tokenCteNames[0]);
      } else {
        const grpName = `_grp_${groupIdx}`;
        const intersectSql = tokenCteNames.map((name) => `SELECT id FROM ${name}`).join('\n    INTERSECT\n    ');
        ctes.push(`${grpName}(id) AS (\n    ${intersectSql}\n  )`);
        groupCteNames.push(grpName);
      }
    } else if (indexable.length > 0 && nonIndexable.length > 0) {
      // Mixed group: intersect indexable tokens first, then apply LIKE only to that narrowed set.
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
      // No indexable tokens (< 3 code-point terms or short wildcard fragments): fall back to LIKE.
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
    // Loose index scan over idx_content_sender_name visits each distinct sender via O(distinct) B-tree probes
    // rather than scanning all rows in the content table/index.
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
 * Builds the parameterized SQL statement that populates `temp._search_base` with matched message rows
 * and precomputed platform/category match flags for facet and page queries.
 *
 * Uses a direct `idx_content_thread_id` scan when `useDirectThreadScope` is enabled for small
 * thread-scoped queries, and index-driven FTS5/loose-index CTEs otherwise.
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

  // Fast path for small thread scopes: scan only that thread's rows via idx_content_thread_id.
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

  // Standard path: discover candidate message IDs via FTS5 + indexed title/sender CTEs.
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
