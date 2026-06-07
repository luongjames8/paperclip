/**
 * Discovery Module v2 - Deterministic Verification
 *
 * Verifies beliefs by checking that claimed quotes actually exist at claimed URLs.
 *
 * CORE PRINCIPLE:
 *   BEFORE: Claude extracts → Claude scores → Claude decides (can be gamed)
 *   AFTER:  Claude extracts → Fetch URL → Quote exists? → Verified (ground truth)
 *
 * NOTE: This module expects fetched content to be provided by the caller.
 *       The orchestrator handles actual URL fetching via MCP web_fetch.
 */

import {
  fuzzyMatch,
  fuzzyMatchMultiple,
  extractContext,
  normalizeText,
  type MatchResult,
} from './fuzzy-match.js';

// =============================================================================
// TYPES
// =============================================================================

export type VerificationStatus = 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED';

export interface QuoteVerification {
  url: string;
  claimed_quote: string;
  status: VerificationStatus;
  matched_text?: string;
  context?: string;
  match_score?: number;
  failure_reason?: 'fetch_failed' | 'quote_not_found' | 'timeout' | 'js_required';
}

export interface BeliefVerification {
  belief: string;
  quotes: QuoteVerification[];
  total_points: number;
  unique_domains: number;
  verified_count: number;
  supported_count: number;
  unverified_count: number;
  accepted: boolean;
  rejection_reason?: string;
}

export interface FetchedContent {
  url: string;
  content: string | null; // null if fetch failed
  fetch_status: 'fetched' | 'unfetchable' | 'js_required' | 'timeout';
  snippet?: string; // WebSearch snippet fallback
}

export interface VerificationThresholds {
  min_verified_quotes: number;
  min_unique_domains: number;
  fuzzy_match_threshold: number;
  snippet_match_threshold: number;
  min_points: number;
  min_verified: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const DEFAULT_THRESHOLDS: VerificationThresholds = {
  min_verified_quotes: 2,
  min_unique_domains: 2,
  fuzzy_match_threshold: 0.95,
  snippet_match_threshold: 0.90,
  min_points: 3,
  min_verified: 1,
};

// Points per verification status
const POINTS = {
  VERIFIED: 2,
  SUPPORTED: 1,
  UNVERIFIED: 0,
} as const;

// =============================================================================
// DOMAIN UTILITIES
// =============================================================================

/**
 * Extract second-level domain from URL.
 * For production, use PSL (Public Suffix List) library.
 */
export function getUniqueDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;

    // Simple extraction: take last two parts for common TLDs
    const parts = hostname.split('.');

    // Handle common multi-part TLDs
    const multiPartTlds = ['co.uk', 'co.jp', 'com.au', 'co.nz', 'org.uk'];
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join('.');
      if (multiPartTlds.includes(lastTwo)) {
        return parts.slice(-3).join('.');
      }
    }

    // Default: return last two parts
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }

    return hostname;
  } catch {
    return 'unknown';
  }
}

// Sister sites configuration
import sisterSites from './sister-sites.json' assert { type: 'json' };

/**
 * Check if two URLs are from the same domain group (sister sites).
 */
export function areSisterSites(url1: string, url2: string): boolean {
  const domain1 = getUniqueDomain(url1);
  const domain2 = getUniqueDomain(url2);

  if (domain1 === domain2) return true;

  // Check sister site groups
  for (const group of sisterSites.groups) {
    if (group.domains.includes(domain1) && group.domains.includes(domain2)) {
      return true;
    }
  }

  return false;
}

/**
 * Count unique domains from a list of URLs, accounting for sister sites.
 */
export function countUniqueDomains(urls: string[]): number {
  const domainGroups: Set<string>[] = [];

  for (const url of urls) {
    const domain = getUniqueDomain(url);

    // Check if this domain belongs to an existing group
    let foundGroup = false;
    for (const group of domainGroups) {
      for (const existingDomain of group) {
        if (areSisterSites(url, `https://${existingDomain}`)) {
          group.add(domain);
          foundGroup = true;
          break;
        }
      }
      if (foundGroup) break;
    }

    // Create new group if no match found
    if (!foundGroup) {
      domainGroups.push(new Set([domain]));
    }
  }

  return domainGroups.length;
}

// =============================================================================
// CONTEXT VALIDATION
// =============================================================================

export interface ContextFlags {
  negation_detected: boolean;
  sarcasm_indicators: boolean;
  quote_nesting: boolean;
  hostile_framing: boolean;
}

/**
 * Check for context issues that might indicate out-of-context quoting.
 */
export function validateContext(
  matchedText: string,
  surroundingContext: string
): ContextFlags {
  const contextLower = surroundingContext.toLowerCase();
  const textLower = matchedText.toLowerCase();

  // Check for negation patterns preceding the quote
  const negationPatterns = [
    /\bnot\s+true\s+that\b/,
    /\bdon't\s+(think|believe)\b/,
    /\bisn't\s+the\s+case\b/,
    /\bfalse\s+that\b/,
    /\bno\s+evidence\b/,
  ];
  const negation_detected = negationPatterns.some((p) => p.test(contextLower));

  // Check for sarcasm indicators
  const sarcasmPatterns = ['/s', 'obviously', 'clearly', 'of course', 'sure,'];
  const sarcasm_indicators = sarcasmPatterns.some((p) =>
    contextLower.includes(p)
  );

  // Check for quote nesting (quote inside another quote)
  const quoteChars = ['"', "'", '\u201C', '\u201D', '\u2018', '\u2019'];
  let quoteDepth = 0;
  let inQuoteBeforeMatch = false;
  const matchStart = contextLower.indexOf(textLower.slice(0, 20));

  for (let i = 0; i < matchStart && i < surroundingContext.length; i++) {
    if (quoteChars.includes(surroundingContext[i])) {
      quoteDepth = quoteDepth === 0 ? 1 : 0;
    }
  }
  inQuoteBeforeMatch = quoteDepth > 0;
  const quote_nesting = inQuoteBeforeMatch;

  // Check for hostile framing
  const hostilePatterns = [
    /idiots\s+(think|believe)/,
    /nobody\s+(really\s+)?(thinks|believes)/,
    /myth\s+that/,
    /wrong(ly)?\s+(think|believe)/,
  ];
  const hostile_framing = hostilePatterns.some((p) => p.test(contextLower));

  return {
    negation_detected,
    sarcasm_indicators,
    quote_nesting,
    hostile_framing,
  };
}

// =============================================================================
// QUOTE VERIFICATION
// =============================================================================

/**
 * Verify a single quote against fetched content.
 *
 * @param url - The URL where the quote should appear
 * @param quote - The claimed quote text
 * @param fetchedContent - Pre-fetched content from the URL
 * @param thresholds - Verification thresholds
 */
export function verifyQuote(
  url: string,
  quote: string,
  fetchedContent: FetchedContent,
  thresholds: VerificationThresholds = DEFAULT_THRESHOLDS
): QuoteVerification {
  // Handle fetch failures
  if (fetchedContent.fetch_status !== 'fetched' || !fetchedContent.content) {
    // Try snippet fallback if available
    if (fetchedContent.snippet) {
      const snippetMatch = fuzzyMatch(fetchedContent.snippet, quote, {
        threshold: thresholds.snippet_match_threshold,
      });

      if (snippetMatch.found) {
        return {
          url,
          claimed_quote: quote,
          status: 'SUPPORTED',
          matched_text: snippetMatch.matched_text,
          match_score: snippetMatch.score,
        };
      }
    }

    return {
      url,
      claimed_quote: quote,
      status: 'UNVERIFIED',
      failure_reason:
        fetchedContent.fetch_status === 'timeout'
          ? 'timeout'
          : fetchedContent.fetch_status === 'js_required'
          ? 'js_required'
          : 'fetch_failed',
    };
  }

  // Search for quote in fetched content
  const match = fuzzyMatch(fetchedContent.content, quote, {
    threshold: thresholds.fuzzy_match_threshold,
  });

  if (match.found) {
    const context = extractContext(
      fetchedContent.content,
      match.start,
      match.end,
      200
    );

    return {
      url,
      claimed_quote: quote,
      status: 'VERIFIED',
      matched_text: match.matched_text,
      context,
      match_score: match.score,
    };
  }

  // Quote not found in content
  // Try snippet as last resort
  if (fetchedContent.snippet) {
    const snippetMatch = fuzzyMatch(fetchedContent.snippet, quote, {
      threshold: thresholds.snippet_match_threshold,
    });

    if (snippetMatch.found) {
      return {
        url,
        claimed_quote: quote,
        status: 'SUPPORTED',
        matched_text: snippetMatch.matched_text,
        match_score: snippetMatch.score,
      };
    }
  }

  return {
    url,
    claimed_quote: quote,
    status: 'UNVERIFIED',
    failure_reason: 'quote_not_found',
  };
}

// =============================================================================
// BELIEF VERIFICATION
// =============================================================================

/**
 * Verify a belief by checking all its supporting quotes.
 *
 * @param belief - The belief text
 * @param quotes - Array of claimed quotes with URLs
 * @param fetchedContents - Map of URL → fetched content
 * @param thresholds - Verification thresholds
 */
export function verifyBelief(
  belief: string,
  quotes: Array<{ url: string; quote: string }>,
  fetchedContents: Map<string, FetchedContent>,
  thresholds: VerificationThresholds = DEFAULT_THRESHOLDS
): BeliefVerification {
  // Verify each quote
  const verifiedQuotes: QuoteVerification[] = quotes.map((q) => {
    const content = fetchedContents.get(q.url) || {
      url: q.url,
      content: null,
      fetch_status: 'unfetchable' as const,
    };
    return verifyQuote(q.url, q.quote, content, thresholds);
  });

  // Calculate totals
  const verified_count = verifiedQuotes.filter(
    (q) => q.status === 'VERIFIED'
  ).length;
  const supported_count = verifiedQuotes.filter(
    (q) => q.status === 'SUPPORTED'
  ).length;
  const unverified_count = verifiedQuotes.filter(
    (q) => q.status === 'UNVERIFIED'
  ).length;

  const total_points = verifiedQuotes.reduce(
    (sum, q) => sum + POINTS[q.status],
    0
  );

  // Count unique domains (only from verified/supported quotes)
  const verifiedUrls = verifiedQuotes
    .filter((q) => q.status !== 'UNVERIFIED')
    .map((q) => q.url);
  const unique_domains = countUniqueDomains(verifiedUrls);

  // Check acceptance criteria
  const hasMinPoints = total_points >= thresholds.min_points;
  const hasMinVerified = verified_count >= thresholds.min_verified;
  const hasMinDomains = unique_domains >= thresholds.min_unique_domains;

  const accepted = hasMinPoints && hasMinVerified && hasMinDomains;

  // Determine rejection reason if not accepted
  let rejection_reason: string | undefined;
  if (!accepted) {
    const reasons: string[] = [];
    if (!hasMinPoints)
      reasons.push(`insufficient points (${total_points}/${thresholds.min_points})`);
    if (!hasMinVerified)
      reasons.push(`no verified quotes (${verified_count}/${thresholds.min_verified})`);
    if (!hasMinDomains)
      reasons.push(`insufficient domain diversity (${unique_domains}/${thresholds.min_unique_domains})`);
    rejection_reason = reasons.join('; ');
  }

  return {
    belief,
    quotes: verifiedQuotes,
    total_points,
    unique_domains,
    verified_count,
    supported_count,
    unverified_count,
    accepted,
    rejection_reason,
  };
}

// =============================================================================
// BATCH VERIFICATION
// =============================================================================

/**
 * Verify multiple beliefs.
 *
 * @param beliefs - Array of beliefs with their supporting quotes
 * @param fetchedContents - Map of URL → fetched content
 * @param thresholds - Verification thresholds
 */
export function verifyBeliefs(
  beliefs: Array<{
    belief: string;
    supporting_quotes: Array<{ url: string; quote: string }>;
  }>,
  fetchedContents: Map<string, FetchedContent>,
  thresholds: VerificationThresholds = DEFAULT_THRESHOLDS
): BeliefVerification[] {
  return beliefs.map((b) =>
    verifyBelief(b.belief, b.supporting_quotes, fetchedContents, thresholds)
  );
}

// =============================================================================
// GATE INTEGRATION
// =============================================================================

/**
 * Verification gate result for pipeline integration.
 */
export interface VerificationGateResult {
  pass: boolean;
  verified_beliefs: BeliefVerification[];
  rejected_beliefs: BeliefVerification[];
  summary: {
    total_beliefs: number;
    accepted_count: number;
    rejected_count: number;
    total_quotes_checked: number;
    verification_rate: number;
  };
}

/**
 * Run verification gate on candidate beliefs.
 * Used after 2c and 5c steps.
 */
export function runVerificationGate(
  beliefs: Array<{
    belief: string;
    supporting_quotes: Array<{ url: string; quote: string }>;
  }>,
  fetchedContents: Map<string, FetchedContent>,
  thresholds: VerificationThresholds = DEFAULT_THRESHOLDS
): VerificationGateResult {
  const results = verifyBeliefs(beliefs, fetchedContents, thresholds);

  const verified_beliefs = results.filter((r) => r.accepted);
  const rejected_beliefs = results.filter((r) => !r.accepted);

  const total_quotes_checked = results.reduce(
    (sum, r) => sum + r.quotes.length,
    0
  );
  const total_verified_quotes = results.reduce(
    (sum, r) => sum + r.verified_count,
    0
  );

  return {
    pass: verified_beliefs.length > 0,
    verified_beliefs,
    rejected_beliefs,
    summary: {
      total_beliefs: results.length,
      accepted_count: verified_beliefs.length,
      rejected_count: rejected_beliefs.length,
      total_quotes_checked,
      verification_rate:
        total_quotes_checked > 0
          ? total_verified_quotes / total_quotes_checked
          : 0,
    },
  };
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

/**
 * Parse CLI arguments and run verification.
 * Usage: npx tsx verification/deterministic.ts verify @beliefs_output.json
 */
export async function main(args: string[]): Promise<void> {
  const command = args[0];

  if (command === 'verify') {
    const inputArg = args[1];
    if (!inputArg) {
      console.error('Usage: npx tsx deterministic.ts verify @beliefs.json');
      process.exit(1);
    }

    // Load input file
    const fs = await import('fs/promises');
    const path = await import('path');

    const inputPath = inputArg.startsWith('@') ? inputArg.slice(1) : inputArg;
    const inputData = JSON.parse(await fs.readFile(inputPath, 'utf-8'));

    // Expect input format:
    // {
    //   beliefs: Array<{ belief: string, supporting_quotes: Array<{ url: string, quote: string }> }>,
    //   fetched_contents: Array<{ url: string, content: string | null, fetch_status: string, snippet?: string }>
    // }

    const fetchedContentsMap = new Map<string, FetchedContent>();
    for (const fc of inputData.fetched_contents || []) {
      fetchedContentsMap.set(fc.url, fc);
    }

    const result = runVerificationGate(
      inputData.beliefs,
      fetchedContentsMap
    );

    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Unknown command:', command);
    console.error('Available commands: verify');
    process.exit(1);
  }
}

// Run if called directly
const isMainModule =
  typeof require !== 'undefined'
    ? require.main === module
    : import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main(process.argv.slice(2));
}
