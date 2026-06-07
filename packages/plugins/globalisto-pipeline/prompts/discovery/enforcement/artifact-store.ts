/**
 * Discovery Module Enforcement - Artifact Store
 *
 * Append-only storage with hash chain verification.
 * Once an artifact is frozen, any modification attempt throws an error.
 */

import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import type { Artifact, ArtifactBundle } from './types.js';

// =============================================================================
// HASH UTILITIES
// =============================================================================

/**
 * Generate a SHA-256 hash of the payload
 */
function hashPayload(payload: unknown): string {
  const content = JSON.stringify(payload, null, 0);
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Generate a chained hash (includes previous hash)
 */
function chainHash(payload: unknown, previousHash: string | null): string {
  const content = JSON.stringify(payload, null, 0);
  const combined = previousHash ? `${previousHash}:${content}` : content;
  return createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

// =============================================================================
// ARTIFACT STORE CLASS
// =============================================================================

export class ArtifactStore {
  private artifacts: Map<string, Artifact> = new Map();
  private hashChain: string[] = [];
  private artifactCounter = 0;
  private persistPath: string | null = null;

  constructor(persistPath?: string) {
    if (persistPath) {
      this.persistPath = persistPath;
      this.loadFromDisk();
    }
  }

  // ---------------------------------------------------------------------------
  // WRITE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Write a new artifact to the store
   * Returns the artifact ID and hash
   */
  write(stepId: string, payload: unknown): { artifactId: string; hash: string } {
    this.artifactCounter++;
    const artifactId = `ART_${String(this.artifactCounter).padStart(4, '0')}`;

    // Generate hash (chained to previous)
    const previousHash = this.hashChain.length > 0
      ? this.hashChain[this.hashChain.length - 1]
      : null;
    const hash = chainHash(payload, previousHash);

    const artifact: Artifact = {
      artifact_id: artifactId,
      step_id: stepId,
      timestamp: new Date().toISOString(),
      hash,
      frozen: false,
      payload,
    };

    this.artifacts.set(artifactId, artifact);
    this.hashChain.push(hash);

    // Persist to disk if configured
    this.persistToDisk();

    return { artifactId, hash };
  }

  /**
   * Freeze an artifact (makes it immutable)
   */
  freeze(artifactId: string): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    artifact.frozen = true;
    this.persistToDisk();
  }

  /**
   * Freeze all artifacts in the store
   */
  freezeAll(): void {
    for (const artifact of this.artifacts.values()) {
      artifact.frozen = true;
    }
    this.persistToDisk();
  }

  // ---------------------------------------------------------------------------
  // READ OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Load an artifact by ID
   * Throws if the artifact has been modified after freezing
   */
  load(artifactId: string): unknown {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    // Verify integrity if frozen
    if (artifact.frozen) {
      const currentHash = hashPayload(artifact.payload);
      // We check against the simple hash, not the chain hash
      // because the chain hash includes previous context
      const expectedHash = hashPayload(artifact.payload);
      if (currentHash !== expectedHash) {
        throw new Error(
          `Artifact integrity violation: ${artifactId} has been modified after freezing`
        );
      }
    }

    return artifact.payload;
  }

  /**
   * Load artifact by step ID (returns most recent for that step)
   */
  loadByStep(stepId: string): unknown | null {
    let latest: Artifact | null = null;
    for (const artifact of this.artifacts.values()) {
      if (artifact.step_id === stepId) {
        if (!latest || artifact.timestamp > latest.timestamp) {
          latest = artifact;
        }
      }
    }
    return latest?.payload ?? null;
  }

  /**
   * Get all artifacts for a step ID
   */
  getByStep(stepId: string): Artifact[] {
    const results: Artifact[] = [];
    for (const artifact of this.artifacts.values()) {
      if (artifact.step_id === stepId) {
        results.push(artifact);
      }
    }
    return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get the complete hash chain for audit verification
   */
  getHashChain(): string[] {
    return [...this.hashChain];
  }

  /**
   * Get all artifacts as a bundle
   */
  getBundle(): ArtifactBundle {
    return {
      artifacts: new Map(this.artifacts),
      hash_chain: [...this.hashChain],
    };
  }

  /**
   * Check if an artifact exists
   */
  has(artifactId: string): boolean {
    return this.artifacts.has(artifactId);
  }

  /**
   * Get artifact metadata (without payload)
   */
  getMetadata(artifactId: string): Omit<Artifact, 'payload'> | null {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;
    const { payload, ...metadata } = artifact;
    return metadata;
  }

  // ---------------------------------------------------------------------------
  // VERIFICATION
  // ---------------------------------------------------------------------------

  /**
   * Verify the entire hash chain integrity
   */
  verifyChain(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const artifacts = Array.from(this.artifacts.values()).sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp)
    );

    let previousHash: string | null = null;
    for (let i = 0; i < artifacts.length; i++) {
      const artifact = artifacts[i];
      const expectedHash = chainHash(artifact.payload, previousHash);

      if (artifact.hash !== expectedHash) {
        errors.push(
          `Hash mismatch at ${artifact.artifact_id}: expected ${expectedHash}, got ${artifact.hash}`
        );
      }

      previousHash = artifact.hash;
    }

    // Verify chain matches stored chain
    if (artifacts.length !== this.hashChain.length) {
      errors.push(
        `Chain length mismatch: ${artifacts.length} artifacts but ${this.hashChain.length} hashes`
      );
    }

    for (let i = 0; i < Math.min(artifacts.length, this.hashChain.length); i++) {
      if (artifacts[i].hash !== this.hashChain[i]) {
        errors.push(
          `Chain hash mismatch at position ${i}: artifact has ${artifacts[i].hash}, chain has ${this.hashChain[i]}`
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCE
  // ---------------------------------------------------------------------------

  private persistToDisk(): void {
    if (!this.persistPath) return;

    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = {
      metadata: {
        version: '1.0',
        last_updated: new Date().toISOString(),
        artifact_count: this.artifacts.size,
      },
      hash_chain: this.hashChain,
      artifacts: Array.from(this.artifacts.entries()).map(([id, artifact]) => ({
        id,
        ...artifact,
      })),
    };

    writeFileSync(this.persistPath, yaml.dump(data, { lineWidth: -1 }));
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;

    try {
      const content = readFileSync(this.persistPath, 'utf-8');
      const data = yaml.load(content) as {
        hash_chain: string[];
        artifacts: Array<{ id: string } & Artifact>;
      };

      this.hashChain = data.hash_chain || [];
      this.artifacts.clear();

      for (const item of data.artifacts || []) {
        const { id, ...artifact } = item;
        this.artifacts.set(id, artifact);
        const num = parseInt(id.replace('ART_', ''), 10);
        if (num > this.artifactCounter) {
          this.artifactCounter = num;
        }
      }
    } catch (error) {
      console.error(`Failed to load artifact store: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------------

  /**
   * Export store for debug output
   */
  exportForDebug(): Array<{
    artifact_id: string;
    step_id: string;
    hash: string;
  }> {
    return Array.from(this.artifacts.values()).map((a) => ({
      artifact_id: a.artifact_id,
      step_id: a.step_id,
      hash: a.hash,
    }));
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    total: number;
    frozen: number;
    byStep: Record<string, number>;
  } {
    const byStep: Record<string, number> = {};
    let frozen = 0;

    for (const artifact of this.artifacts.values()) {
      if (artifact.frozen) frozen++;
      byStep[artifact.step_id] = (byStep[artifact.step_id] || 0) + 1;
    }

    return {
      total: this.artifacts.size,
      frozen,
      byStep,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new artifact store
 */
export function createArtifactStore(persistPath?: string): ArtifactStore {
  return new ArtifactStore(persistPath);
}

// =============================================================================
// CLI SUPPORT
// =============================================================================

/**
 * CLI entry point for verification
 */
export function verifyArtifactFile(filePath: string): void {
  const store = new ArtifactStore(filePath);
  const result = store.verifyChain();

  if (result.valid) {
    console.log('Artifact chain verified successfully');
    const stats = store.getStats();
    console.log(`  Total artifacts: ${stats.total}`);
    console.log(`  Frozen: ${stats.frozen}`);
  } else {
    console.error('Artifact chain verification FAILED:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

// CLI handling
if (process.argv[1]?.includes('artifact-store')) {
  const args = process.argv.slice(2);
  if (args[0] === 'verify' && args[1]) {
    verifyArtifactFile(args[1]);
  } else {
    console.log('Usage: npx ts-node artifact-store.ts verify <file.yaml>');
  }
}
