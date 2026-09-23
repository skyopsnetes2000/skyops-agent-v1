/**
 * SkyOps Agent V1 - Evidence Builder and Validator
 */

import * as crypto from 'node:crypto';
import {
  Evidence,
  EvidenceKind,
  EvidenceObservation,
  EvidenceSeverity,
  EvidenceSource,
  EvidenceType,
  CorrelationKeys,
} from '../types/evidence.ts';

export class EvidenceBuilder {
  private evidence: Partial<Evidence> = {
    timestamp: new Date().toISOString(),
    source: 'kubernetes',
    kind: 'OBSERVATION',
    severity: 'INFO',
    correlationKeys: {},
    metadata: {
      collector: 'kubernetes',
      fingerprint: '',
    },
  };

  public static create(): EvidenceBuilder {
    return new EvidenceBuilder();
  }

  public setEnvironment(environmentId: string, agentId: string): this {
    this.evidence.environmentId = environmentId;
    this.evidence.agentId = agentId;
    return this;
  }

  public setSource(source: EvidenceSource): this {
    this.evidence.source = source;
    return this;
  }

  public setResource(resourceId: string, resourceType: string): this {
    this.evidence.resourceId = resourceId;
    this.evidence.resourceType = resourceType;
    return this;
  }

  public setType(type: EvidenceType, kind: EvidenceKind = 'OBSERVATION', severity: EvidenceSeverity = 'INFO'): this {
    this.evidence.evidenceType = type;
    this.evidence.kind = kind;
    this.evidence.severity = severity;
    return this;
  }

  public setObservation(observation: EvidenceObservation): this {
    this.evidence.observation = observation;
    return this;
  }

  public setCorrelationKeys(keys: CorrelationKeys): this {
    this.evidence.correlationKeys = { ...this.evidence.correlationKeys, ...keys };
    return this;
  }

  public setCollector(collectorName: string, version?: string): this {
    if (!this.evidence.metadata) {
      this.evidence.metadata = { collector: collectorName, fingerprint: '' };
    }
    this.evidence.metadata.collector = collectorName;
    this.evidence.metadata.version = version;
    return this;
  }

  public setLabelsAndAnnotations(labels?: Record<string, string>, annotations?: Record<string, string>): this {
    if (!this.evidence.metadata) {
      this.evidence.metadata = { collector: 'kubernetes', fingerprint: '' };
    }
    this.evidence.metadata.labels = labels;
    this.evidence.metadata.annotations = annotations;
    return this;
  }

  public build(): Evidence {
    if (!this.evidence.environmentId || !this.evidence.agentId) {
      throw new Error('Evidence requires environmentId and agentId');
    }
    if (!this.evidence.resourceId || !this.evidence.resourceType) {
      throw new Error('Evidence requires resourceId and resourceType');
    }
    if (!this.evidence.evidenceType || !this.evidence.observation) {
      throw new Error('Evidence requires evidenceType and observation');
    }

    // Compute deterministic fingerprint to detect duplicates
    const fingerprintContent = `${this.evidence.resourceId}:${this.evidence.evidenceType}:${this.evidence.observation.reason || ''}:${this.evidence.observation.summary}`;
    const fingerprint = crypto.createHash('sha256').update(fingerprintContent).digest('hex').substring(0, 16);

    const evidenceId = `ev-${crypto.randomUUID()}`;

    return {
      evidenceId,
      environmentId: this.evidence.environmentId,
      agentId: this.evidence.agentId,
      timestamp: this.evidence.timestamp || new Date().toISOString(),
      source: this.evidence.source || 'kubernetes',
      resourceId: this.evidence.resourceId,
      resourceType: this.evidence.resourceType,
      evidenceType: this.evidence.evidenceType,
      kind: this.evidence.kind || 'OBSERVATION',
      severity: this.evidence.severity || 'INFO',
      observation: this.evidence.observation,
      metadata: {
        ...this.evidence.metadata,
        collector: this.evidence.metadata?.collector || 'kubernetes',
        fingerprint,
      },
      correlationKeys: this.evidence.correlationKeys || {},
    };
  }
}
