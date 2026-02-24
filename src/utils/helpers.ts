import {
  decodeCashAddress,
  decodeCashAddressFormatWithoutPrefix,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { CashBlocksError } from './errors.js';

/** Dust limit for BCH outputs (546 satoshis). */
export const DUST_LIMIT = 546n;

/** Default hardcoded fee used in CashBlocks contracts (1000 satoshis). */
export const HARDCODED_FEE = 1000n;

/**
 * Convert a 4-character ASCII string to a 4-byte domain separator.
 * Example: domainFromString("VOTE") → Uint8Array([0x56, 0x4f, 0x54, 0x45])
 */
export function domainFromString(str: string): Uint8Array {
  if (str.length !== 4) {
    throw new CashBlocksError(
      `domainFromString requires exactly 4 ASCII characters, got ${str.length}`,
      'INVALID_PARAM',
    );
  }
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const code = str.charCodeAt(i);
    if (code > 127) {
      throw new CashBlocksError(
        `domainFromString requires ASCII characters, got non-ASCII at index ${i}`,
        'INVALID_PARAM',
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Extract the 20-byte public key hash (PKH) from a CashAddress string.
 * Accepts addresses with or without the prefix (e.g., "bchtest:qp..." or "qp...").
 */
export function addressToPkh(address: string): Uint8Array {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string') {
    const withoutPrefix = decodeCashAddressFormatWithoutPrefix(address);
    if (typeof withoutPrefix === 'string') {
      throw new CashBlocksError(
        `Invalid CashAddress: ${withoutPrefix}`,
        'INVALID_PARAM',
      );
    }
    return Uint8Array.from(withoutPrefix.payload);
  }
  return Uint8Array.from(decoded.payload);
}

/**
 * Encode a 20-byte PKH as a CashAddress.
 */
export function pkhToAddress(pkh: Uint8Array, network: 'mainnet' | 'chipnet'): string {
  if (pkh.length !== 20) {
    throw new CashBlocksError(
      `PKH must be 20 bytes, got ${pkh.length}`,
      'INVALID_PARAM',
    );
  }
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  const result = encodeCashAddress({
    payload: pkh,
    prefix,
    type: CashAddressType.p2pkh,
  });
  if (typeof result === 'string') {
    throw new CashBlocksError(`Failed to encode address: ${result}`, 'VALIDATION_FAILED');
  }
  return result.address as string;
}

/**
 * Generate a unique nonce from timestamp + random value.
 * Returns a positive bigint that fits in 4-byte LE encoding (max 2^32 - 1).
 */
export function generateNonce(): bigint {
  const timestamp = BigInt(Date.now());
  const random = BigInt(Math.floor(Math.random() * 0xFFFF));
  return ((timestamp % (1n << 16n)) << 16n) | random;
}

/**
 * Calculate the expected change value after a spend.
 * Returns 0n if the result would be at or below zero.
 */
export function predictChangeValue(
  inputSats: bigint,
  spendAmount: bigint,
  fee: bigint = HARDCODED_FEE,
): bigint {
  const change = inputSats - spendAmount - fee;
  return change > 0n ? change : 0n;
}

/**
 * Convert a token category hex string (display/wallet format) to VM byte order.
 * Wallets display token categories in reversed byte order.
 */
export function categoryToVMBytes(categoryHex: string): Uint8Array {
  const bytes = new Uint8Array(categoryHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return Uint8Array.from(bytes.reverse());
}
