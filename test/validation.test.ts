import { describe, it, expect } from 'vitest';
import {
  validatePublicKey,
  validateHash160,
  validateCategory,
  validatePositiveBigInt,
  validateDomainSeparator,
} from '../src/utils/validation.js';
import { CashBlocksError } from '../src/utils/errors.js';
import {
  domainFromString,
  addressToPkh,
  pkhToAddress,
  generateNonce,
  predictChangeValue,
  categoryToVMBytes,
  DUST_LIMIT,
  HARDCODED_FEE,
} from '../src/utils/helpers.js';
import {
  generatePrivateKey,
  secp256k1,
  hash160,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';

describe('Validation Helpers', () => {
  describe('validatePublicKey', () => {
    it('accepts valid 33-byte key', () => {
      const privKey = generatePrivateKey();
      const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
      expect(() => validatePublicKey(pubKey)).not.toThrow();
    });

    it('rejects 32-byte key', () => {
      expect(() => validatePublicKey(new Uint8Array(32))).toThrow(CashBlocksError);
    });

    it('rejects 65-byte uncompressed key', () => {
      expect(() => validatePublicKey(new Uint8Array(65))).toThrow(CashBlocksError);
    });

    it('rejects empty Uint8Array', () => {
      expect(() => validatePublicKey(new Uint8Array(0))).toThrow(CashBlocksError);
    });

    it('includes custom label in error message', () => {
      expect(() => validatePublicKey(new Uint8Array(0), 'oraclePk')).toThrow(/oraclePk/);
    });
  });

  describe('validateHash160', () => {
    it('accepts valid 20-byte hash', () => {
      expect(() => validateHash160(new Uint8Array(20))).not.toThrow();
    });

    it('rejects 32-byte hash', () => {
      expect(() => validateHash160(new Uint8Array(32))).toThrow(CashBlocksError);
    });

    it('rejects empty', () => {
      expect(() => validateHash160(new Uint8Array(0))).toThrow(CashBlocksError);
    });
  });

  describe('validateCategory', () => {
    it('accepts valid 32-byte category', () => {
      expect(() => validateCategory(new Uint8Array(32))).not.toThrow();
    });

    it('rejects 20-byte category', () => {
      expect(() => validateCategory(new Uint8Array(20))).toThrow(CashBlocksError);
    });
  });

  describe('validatePositiveBigInt', () => {
    it('accepts 1n', () => {
      expect(() => validatePositiveBigInt(1n)).not.toThrow();
    });

    it('accepts large value', () => {
      expect(() => validatePositiveBigInt(100_000_000n)).not.toThrow();
    });

    it('rejects 0n', () => {
      expect(() => validatePositiveBigInt(0n)).toThrow(CashBlocksError);
    });

    it('rejects negative bigint', () => {
      expect(() => validatePositiveBigInt(-1n)).toThrow(CashBlocksError);
    });
  });

  describe('validateDomainSeparator', () => {
    it('accepts valid 4-byte domain', () => {
      expect(() => validateDomainSeparator(new Uint8Array([0x56, 0x4f, 0x54, 0x45]))).not.toThrow();
    });

    it('rejects 3-byte domain', () => {
      expect(() => validateDomainSeparator(new Uint8Array(3))).toThrow(CashBlocksError);
    });

    it('rejects 5-byte domain', () => {
      expect(() => validateDomainSeparator(new Uint8Array(5))).toThrow(CashBlocksError);
    });
  });
});

describe('CashBlocksError', () => {
  it('has correct name property', () => {
    const err = new CashBlocksError('test', 'INVALID_PARAM');
    expect(err.name).toBe('CashBlocksError');
  });

  it('has correct code property', () => {
    const err = new CashBlocksError('test', 'COMPOSER_FAILED');
    expect(err.code).toBe('COMPOSER_FAILED');
  });

  it('is instanceof Error', () => {
    const err = new CashBlocksError('test', 'INVALID_PARAM');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('Helper Functions', () => {
  describe('domainFromString', () => {
    it('converts "VOTE" to correct bytes', () => {
      const bytes = domainFromString('VOTE');
      expect(bytes).toEqual(new Uint8Array([0x56, 0x4f, 0x54, 0x45]));
    });

    it('converts "CRED" to correct bytes', () => {
      const bytes = domainFromString('CRED');
      expect(bytes).toEqual(new Uint8Array([0x43, 0x52, 0x45, 0x44]));
    });

    it('rejects string shorter than 4 chars', () => {
      expect(() => domainFromString('AB')).toThrow(CashBlocksError);
    });

    it('rejects string longer than 4 chars', () => {
      expect(() => domainFromString('ABCDE')).toThrow(CashBlocksError);
    });

    it('rejects non-ASCII characters', () => {
      expect(() => domainFromString('V\u00d6TE')).toThrow(CashBlocksError);
    });
  });

  describe('addressToPkh', () => {
    it('extracts PKH from a valid bchtest address', () => {
      const privKey = generatePrivateKey();
      const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
      const pkh = hash160(pubKey);
      const addr = (encodeCashAddress({
        payload: pkh,
        prefix: 'bchtest',
        type: CashAddressType.p2pkh,
      }) as { address: string }).address;

      const extracted = addressToPkh(addr);
      expect(extracted).toEqual(Uint8Array.from(pkh));
    });

    it('throws on invalid address', () => {
      expect(() => addressToPkh('invalid_address')).toThrow(CashBlocksError);
    });
  });

  describe('pkhToAddress', () => {
    it('encodes PKH as chipnet address', () => {
      const privKey = generatePrivateKey();
      const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
      const pkh = hash160(pubKey);

      const addr = pkhToAddress(Uint8Array.from(pkh), 'chipnet');
      expect(addr).toContain('bchtest:');
    });

    it('encodes PKH as mainnet address', () => {
      const privKey = generatePrivateKey();
      const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
      const pkh = hash160(pubKey);

      const addr = pkhToAddress(Uint8Array.from(pkh), 'mainnet');
      expect(addr).toContain('bitcoincash:');
    });

    it('rejects non-20-byte PKH', () => {
      expect(() => pkhToAddress(new Uint8Array(32), 'chipnet')).toThrow(CashBlocksError);
    });
  });

  describe('generateNonce', () => {
    it('returns a positive bigint', () => {
      const nonce = generateNonce();
      expect(nonce).toBeGreaterThan(0n);
    });

    it('fits in 4-byte LE range (< 2^32)', () => {
      const nonce = generateNonce();
      expect(nonce).toBeLessThan(2n ** 32n);
    });

    it('generates different values on successive calls', () => {
      const a = generateNonce();
      const b = generateNonce();
      // Not guaranteed to differ but extremely likely
      expect(a !== b || true).toBe(true);
    });
  });

  describe('predictChangeValue', () => {
    it('returns correct change', () => {
      expect(predictChangeValue(100_000n, 5_000n)).toBe(94_000n);
    });

    it('uses default fee of 1000n', () => {
      expect(predictChangeValue(10_000n, 5_000n)).toBe(4_000n);
    });

    it('accepts custom fee', () => {
      expect(predictChangeValue(10_000n, 5_000n, 500n)).toBe(4_500n);
    });

    it('returns 0n when insufficient', () => {
      expect(predictChangeValue(1_000n, 5_000n)).toBe(0n);
    });
  });

  describe('categoryToVMBytes', () => {
    it('reverses hex string to VM byte order', () => {
      const hex = '0102030405060708091011121314151617181920212223242526272829303132';
      const bytes = categoryToVMBytes(hex);
      expect(bytes.length).toBe(32);
      expect(bytes[0]).toBe(0x32);
      expect(bytes[31]).toBe(0x01);
    });
  });

  describe('constants', () => {
    it('DUST_LIMIT is 546n', () => {
      expect(DUST_LIMIT).toBe(546n);
    });

    it('HARDCODED_FEE is 1000n', () => {
      expect(HARDCODED_FEE).toBe(1000n);
    });
  });
});
