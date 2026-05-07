import { createHmac } from 'node:crypto';
import type { SignOptions } from './types.js';

export function sign(payload: string, secret: string, options?: SignOptions): string {
  const algorithm = options?.algorithm ?? 'v1';
  const timestamp = options?.timestamp ?? new Date();
  const unixTimestamp = Math.floor(timestamp.getTime() / 1000);

  const signedPayload = `${unixTimestamp}.${payload}`;
  const hex = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return `t=${unixTimestamp},${algorithm}=${hex}`;
}
