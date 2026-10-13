import { env } from '../env'

/**
 * Email delivery.
 *
 * Three providers, selected by `EMAIL_PROVIDER`:
 *   resend   production default
 *   ses      Amazon SES via the SMTP-less HTTPS API
 *   console  writes the rendered email to the server log instead of sending
 *
 * `console` is the default so that a fresh development install cannot
 * accidentally send a real email to a real executive.
 *
 * Phase 1 sends internal email only. No automated customer email or reminder
 * is ever sent by this system (section 20).
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

export interface EmailResult {
  ok: boolean
  providerMessageId: string | null
  error: string | null
  /** True when the email was logged rather than actually sent. */
  simulated: boolean
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const config = env()

  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return sendWithResend(message)
    case 'ses':
      return sendWithSes(message)
    default:
      return sendToConsole(message)
  }
}

function sendToConsole(message: EmailMessage): EmailResult {
  console.info(
    [
      '',
      '='.repeat(72),
      'EMAIL (not sent - EMAIL_PROVIDER is "console")',
      `To:      ${message.to}`,
      `From:    ${env().EMAIL_FROM}`,
      `Subject: ${message.subject}`,
      '-'.repeat(72),
      message.text,
      '='.repeat(72),
      '',
    ].join('\n'),
  )
  return {
    ok: true,
    providerMessageId: `console-${Date.now()}`,
    error: null,
    simulated: true,
  }
}

async function sendWithResend(message: EmailMessage): Promise<EmailResult> {
  const config = env()
  if (!config.RESEND_API_KEY) {
    return {
      ok: false,
      providerMessageId: null,
      error: 'EMAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.',
      simulated: false,
    }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo || config.EMAIL_REPLY_TO
          ? { reply_to: message.replyTo ?? config.EMAIL_REPLY_TO }
          : {}),
      }),
      cache: 'no-store',
    })

    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }

    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: null,
        error: `Resend returned HTTP ${response.status}: ${body.message ?? body.name ?? 'no detail'}`,
        simulated: false,
      }
    }

    return { ok: true, providerMessageId: body.id ?? null, error: null, simulated: false }
  } catch (error) {
    return {
      ok: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : 'Unknown error contacting Resend.',
      simulated: false,
    }
  }
}

/**
 * Amazon SES via the v2 HTTPS API, signed with SigV4.
 *
 * Implemented with the standard library rather than the AWS SDK so the
 * deployment does not carry the whole SDK for a single call.
 */
async function sendWithSes(message: EmailMessage): Promise<EmailResult> {
  const config = env()
  if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
    return {
      ok: false,
      providerMessageId: null,
      error: 'EMAIL_PROVIDER is "ses" but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set.',
      simulated: false,
    }
  }

  const crypto = await import('node:crypto')
  const region = config.AWS_REGION
  const host = `email.${region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'

  const payload = JSON.stringify({
    FromEmailAddress: config.EMAIL_FROM,
    Destination: { ToAddresses: [message.to] },
    ...(message.replyTo || config.EMAIL_REPLY_TO
      ? { ReplyToAddresses: [message.replyTo ?? config.EMAIL_REPLY_TO] }
      : {}),
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: message.html, Charset: 'UTF-8' },
          Text: { Data: message.text, Charset: 'UTF-8' },
        },
      },
    },
  })

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const hash = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex')
  const hmac = (key: Buffer | string, value: string) =>
    crypto.createHmac('sha256', key).update(value, 'utf8').digest()

  const payloadHash = hash(payload)
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const scope = `${dateStamp}/${region}/ses/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonicalRequest)}`

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.AWS_SECRET_ACCESS_KEY}`, dateStamp), region), 'ses'),
    'aws4_request',
  )
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  try {
    const response = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Amz-Date': amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${config.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: payload,
      cache: 'no-store',
    })

    const body = (await response.json().catch(() => ({}))) as { MessageId?: string; message?: string }

    if (!response.ok) {
      return {
        ok: false,
        providerMessageId: null,
        error: `Amazon SES returned HTTP ${response.status}: ${body.message ?? 'no detail'}`,
        simulated: false,
      }
    }

    return { ok: true, providerMessageId: body.MessageId ?? null, error: null, simulated: false }
  } catch (error) {
    return {
      ok: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : 'Unknown error contacting Amazon SES.',
      simulated: false,
    }
  }
}

export function emailProviderLabel(): string {
  switch (env().EMAIL_PROVIDER) {
    case 'resend':
      return 'Resend'
    case 'ses':
      return 'Amazon SES'
    default:
      return 'Console (emails are logged, not sent)'
  }
}

export function emailConfigured(): boolean {
  const config = env()
  if (config.EMAIL_PROVIDER === 'resend') return Boolean(config.RESEND_API_KEY)
  if (config.EMAIL_PROVIDER === 'ses') return Boolean(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY)
  return true
}
