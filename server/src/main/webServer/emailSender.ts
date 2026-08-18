/**
 * @module
 * Pluggable Email Delivery
 *
 * Architecture overview for Junior Devs:
 * Auth flows (email verification, password reset, magic links) need to "send"
 * email. To keep local development zero-config, the default sender just prints
 * the message to stdout — enough to copy a reset link during testing. In
 * production, call `setEmailSender()` to plug in a real provider (Resend, SMTP
 * via nodemailer, SES, etc.). The rest of the code only knows about the
 * `EmailMessage` shape, so swapping providers touches nothing else.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body. Falls back to `text` when absent. */
  html?: string;
}

export type EmailSender = (msg: EmailMessage) => Promise<void>;

const consoleSender: EmailSender = async (msg) => {
  // Deliberate direct-to-stdout fallback (not the leveled logger): this is the
  // dev/no-SMTP delivery channel, so the full message must always print intact.
  const sep = '─'.repeat(60);
  console.log(
    `\n[CB8 email]\n${sep}\nTo:      ${msg.to}\nSubject: ${msg.subject}\n${sep}\n${msg.text}\n${sep}\n`,
  );
};

let sender: EmailSender = consoleSender;

/** Replace the active email sender (e.g. install a real SMTP provider). */
export function setEmailSender(next: EmailSender): void {
  sender = next;
}

/** Send an email via the active sender (the console logger by default). */
export function sendEmail(msg: EmailMessage): Promise<void> {
  return sender(msg);
}
