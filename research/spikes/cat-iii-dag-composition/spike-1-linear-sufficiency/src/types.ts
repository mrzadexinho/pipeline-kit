/**
 * Shared domain types for the agent-forge Studio lifecycle probes.
 *
 * 8-step lifecycle:
 *   research -> demand-gate -> plan -> execute -> validate -> deploy -> battle-test
 *   -> [marketing | consolidate] (parallel terminal branches, step 8)
 *
 * Each type represents the accumulated context passed between stages.
 */

// Primitive domain types
export interface ResearchOutput {
  topic: string;
  sources: string[];
  summary: string;
}

export interface DemandSignal {
  topic: string;
  sources: string[];
  summary: string;
  demand_score: number; // gate passes if score > threshold
}

export interface Plan {
  demand_score: number;
  milestones: string[];
  estimated_days: number;
}

export interface ExecutionResult {
  milestones: string[];
  artifacts: string[];
  build_id: string;
}

export interface ValidationReport {
  build_id: string;
  artifacts: string[];
  passed: boolean;
  findings: string[];
}

export interface DeploymentRecord {
  build_id: string;
  artifacts: string[];
  environment: 'production' | 'staging';
  deployed_at: string;
}

export interface BattleTestResult {
  build_id: string;
  environment: 'production' | 'staging';
  deployed_at: string;
  uptime_percent: number;
  incidents: number;
}

// Terminal branch outputs
export interface MarketingCampaign {
  build_id: string;
  channels: string[];
  launched_at: string;
}

export interface ConsolidationRecord {
  build_id: string;
  lessons: string[];
  archived_at: string;
}
