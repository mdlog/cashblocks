import { CashBlocksError } from './errors.js';

export function validatePublicKey(pk: Uint8Array, label = 'publicKey'): void {
  if (!(pk instanceof Uint8Array) || pk.length !== 33) {
    throw new CashBlocksError(
      `${label} must be a 33-byte compressed public key, got ${pk instanceof Uint8Array ? pk.length : typeof pk} bytes`,
      'INVALID_PARAM',
    );
  }
}

export function validateHash160(hash: Uint8Array, label = 'hash160'): void {
  if (!(hash instanceof Uint8Array) || hash.length !== 20) {
    throw new CashBlocksError(
      `${label} must be a 20-byte hash160, got ${hash instanceof Uint8Array ? hash.length : typeof hash} bytes`,
      'INVALID_PARAM',
    );
  }
}

export function validateCategory(cat: Uint8Array, label = 'category'): void {
  if (!(cat instanceof Uint8Array) || cat.length !== 32) {
    throw new CashBlocksError(
      `${label} must be a 32-byte token category, got ${cat instanceof Uint8Array ? cat.length : typeof cat} bytes`,
      'INVALID_PARAM',
    );
  }
}

export function validatePositiveBigInt(val: bigint, label = 'value'): void {
  if (typeof val !== 'bigint' || val <= 0n) {
    throw new CashBlocksError(
      `${label} must be a positive bigint (> 0), got ${String(val)}`,
      'INVALID_PARAM',
    );
  }
}

export function validateDomainSeparator(domain: Uint8Array): void {
  if (!(domain instanceof Uint8Array) || domain.length !== 4) {
    throw new CashBlocksError(
      `domainSeparator must be exactly 4 bytes, got ${domain instanceof Uint8Array ? domain.length : typeof domain} bytes`,
      'INVALID_PARAM',
    );
  }
}
