import { sign } from '../webhooks/sign.js';
import { verify } from '../webhooks/verify.js';

export interface WebhooksResource {
  sign: typeof sign;
  verify: typeof verify;
}

export function createWebhooksResource(): WebhooksResource {
  return { sign, verify };
}
