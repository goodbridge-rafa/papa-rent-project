import { Expo, type ExpoPushMessage } from "expo-server-sdk";

export interface PushResult {
  token: string;
  ok: boolean;
  error?: string | undefined; // ex.: DeviceNotRegistered
}
export interface PushTransport {
  send(messages: Array<ExpoPushMessage & { to: string }>): Promise<PushResult[]>;
}
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface EmailResult {
  ok: boolean;
  /** Nothing went out and it is not a failure: no transport is configured. Never mark as delivered. */
  skipped?: boolean | undefined;
  error?: string | undefined;
  id?: string | undefined;
}
export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailResult>;
}

/** Expo Push (free). Handles chunking; per-token errors come back in the tickets. */
export class ExpoPushTransport implements PushTransport {
  private readonly expo = new Expo();
  async send(messages: Array<ExpoPushMessage & { to: string }>): Promise<PushResult[]> {
    const valid = messages.filter((m) => Expo.isExpoPushToken(m.to));
    const results: PushResult[] = messages
      .filter((m) => !Expo.isExpoPushToken(m.to))
      .map((m) => ({ token: m.to, ok: false, error: "InvalidToken" }));
    for (const chunk of this.expo.chunkPushNotifications(valid)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((t, i) => {
          const token = chunk[i]?.to as string;
          if (t.status === "ok") results.push({ token, ok: true });
          else results.push({ token, ok: false, error: t.details?.error ?? t.message });
        });
      } catch (err) {
        for (const m of chunk)
          results.push({ token: m.to as string, ok: false, error: String(err).slice(0, 200) });
      }
    }
    return results;
  }
}

/** Resend via REST (no SDK). */
export class ResendEmailTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(message: EmailMessage): Promise<EmailResult> {
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
    });
    if (!res.ok)
      return { ok: false, error: `resend_${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: j.id };
  }
}

/**
 * No credentials (development only): stores the message for inspection and returns `skipped`.
 * Never returns `ok`: an email that did not go out cannot be recorded as delivered. In production
 * this transport does not exist — `transportsFromEnv` fails at startup without `RESEND_API_KEY`.
 */
export class NoopEmailTransport implements EmailTransport {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return { ok: false, skipped: true, error: "email_not_configured" };
  }
}

/** Test double that really delivers. */
export class FakeEmailTransport implements EmailTransport {
  public sent: EmailMessage[] = [];
  constructor(private readonly failing?: string) {}
  async send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return this.failing
      ? { ok: false, error: this.failing }
      : { ok: true, id: `fake-${this.sent.length}` };
  }
}
export class FakePushTransport implements PushTransport {
  public sent: Array<ExpoPushMessage & { to: string }> = [];
  constructor(private readonly failing: Record<string, string> = {}) {}
  async send(messages: Array<ExpoPushMessage & { to: string }>) {
    this.sent.push(...messages);
    return messages.map((m) =>
      this.failing[m.to]
        ? { token: m.to, ok: false, error: this.failing[m.to] }
        : { token: m.to, ok: true },
    );
  }
}
