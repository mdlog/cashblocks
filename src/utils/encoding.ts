export function intToBytes4LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(4);
  let v = value;
  for (let i = 0; i < 4; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export function bytes4LEToInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

export function encodeOracleMessage(
  domain: Uint8Array,
  timestamp: bigint,
  nonce: bigint,
  payload: Uint8Array,
): Uint8Array {
  const tsBytes = intToBytes4LE(timestamp);
  const nonceBytes = intToBytes4LE(nonce);
  const result = new Uint8Array(4 + 4 + 4 + payload.length);
  result.set(domain, 0);
  result.set(tsBytes, 4);
  result.set(nonceBytes, 8);
  result.set(payload, 12);
  return result;
}

export function decodeOracleMessage(message: Uint8Array): {
  domain: Uint8Array;
  timestamp: bigint;
  nonce: bigint;
  payload: Uint8Array;
} {
  return {
    domain: message.slice(0, 4),
    timestamp: bytes4LEToInt(message.slice(4, 8)),
    nonce: bytes4LEToInt(message.slice(8, 12)),
    payload: message.slice(12),
  };
}
