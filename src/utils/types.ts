export interface VaultParams {
  ownerPk: Uint8Array;
  spendLimit: bigint;
  whitelistHash: Uint8Array;
}

export interface TimeStateParams {
  ownerPk: Uint8Array;
  phase1Time: bigint;
  phase2Time: bigint;
}

export interface OracleProofParams {
  oraclePk: Uint8Array;
  domainSeparator: Uint8Array;
  expiryDuration: bigint;
}

export interface OracleMessage {
  domain: Uint8Array;
  timestamp: bigint;
  nonce: bigint;
  payload: Uint8Array;
}

export interface TokenGateParams {
  requiredCategory: Uint8Array;
  minTokenAmount: bigint;
}

export enum TimePhase {
  LOCKED = 0,
  RESTRICTED = 1,
  UNRESTRICTED = 2,
}
