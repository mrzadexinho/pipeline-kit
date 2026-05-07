// Minimal ambient declaration for nodemailer (no bundled types in v8).
// Only the subset used by the smtp provider is declared here.

declare module 'nodemailer' {
  interface SmtpTransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
    [key: string]: unknown;
  }

  interface MailMessage {
    from?: string;
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    html?: string;
    text?: string;
    attachments?: Array<{ filename?: string; content?: string | Buffer }>;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }

  interface SentMessageInfo {
    messageId?: string;
    [key: string]: unknown;
  }

  interface Transporter {
    sendMail(mailOptions: MailMessage): Promise<SentMessageInfo>;
  }

  function createTransport(options: SmtpTransportOptions): Transporter;

  const _default: { createTransport: typeof createTransport };
  export = _default;
}
