import pino, { type Logger } from "pino";

/**
 * The API's e-mail transport. The API does not import from `apps/engine` (apps do not depend on
 * apps), so the Resend client lives here, with the same discipline the engine already follows:
 * in production we do not start without `RESEND_API_KEY`, and the empty transport never returns `ok`.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailResult {
  ok: boolean;
  /** Nothing went out and it is not a failure: no transport is configured. Never treat as delivered. */
  skipped?: boolean | undefined;
  error?: string | undefined;
  id?: string | undefined;
}

export interface Mailer {
  send(message: EmailMessage): Promise<EmailResult>;
}

/** An e-mail stuck on an open connection would block the request that produced it. */
const SEND_TIMEOUT_MS = 15_000;

/** Resend over REST (no SDK), same as the engine. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok)
        return { ok: false, error: `resend_${res.status}: ${(await res.text()).slice(0, 200)}` };
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id };
    } catch (err) {
      return { ok: false, error: `resend_request_failed: ${String(err).slice(0, 200)}` };
    }
  }
}

/**
 * No credentials (development only): keeps the message, writes it to the log (that is how a
 * developer picks up the recovery link) and returns `skipped`. Never returns `ok`: an e-mail that
 * did not go out cannot be recorded as delivered. In production this transport does not exist;
 * `mailerFromEnv` fails at startup without `RESEND_API_KEY`.
 */
export class NoopMailer implements Mailer {
  public sent: EmailMessage[] = [];
  constructor(private readonly log?: Logger | undefined) {}
  async send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    this.log?.warn(
      { to: message.to, subject: message.subject, text: message.text },
      "email not configured: message only in the log",
    );
    return { ok: false, skipped: true, error: "email_not_configured" };
  }
}

/** Test double that really delivers (or fails on command). */
export class FakeMailer implements Mailer {
  public sent: EmailMessage[] = [];
  constructor(private readonly failing?: string | undefined) {}
  async send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return this.failing
      ? { ok: false, error: this.failing }
      : { ok: true, id: `fake-${this.sent.length}` };
  }
  /** The last message sent, for readable assertions. */
  last(): EmailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

export interface MailEnv {
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  LOG_LEVEL?: string | undefined;
  NODE_ENV?: string | undefined;
}

/** Fallback only; deployments set `EMAIL_FROM` to an address on their own verified domain. */
export const DEFAULT_EMAIL_FROM = "PAPA RENT <alerts@example.com>";

/**
 * In production without `RESEND_API_KEY` we fail at startup: degrading silently would lock anyone
 * who forgot their password out of their account without anyone noticing.
 */
export function mailerFromEnv(env: MailEnv = process.env, log?: Logger): Mailer {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    if (env.NODE_ENV === "production")
      throw new Error(
        "RESEND_API_KEY missing: in production the API does not start without an e-mail transport (password recovery would be dead)",
      );
    const logger = log ?? pino({ level: env.LOG_LEVEL ?? "info", name: "api-mail" });
    logger.warn("RESEND_API_KEY missing: e-mails do not go out, they are skipped (NoopMailer)");
    return new NoopMailer(logger);
  }
  return new ResendMailer(key, env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM);
}
