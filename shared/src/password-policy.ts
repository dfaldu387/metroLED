/**
 * Password policy. Deliberately plain-language so the sign-in and user
 * administration screens can show the user exactly what to fix.
 *
 * Same rules as `checkPasswordPolicy` in server/src/lib/auth/password.ts (which
 * the server uses to enforce them); this copy lets the client show the policy
 * live as the user types without importing a server module.
 */

export interface PasswordPolicyResult {
  ok: boolean
  problems: string[]
}

export function checkPasswordPolicy(plain: string): PasswordPolicyResult {
  const problems: string[] = []
  if (plain.length < 12) problems.push('Use at least 12 characters.')
  if (!/[a-z]/.test(plain)) problems.push('Include a lower-case letter.')
  if (!/[A-Z]/.test(plain)) problems.push('Include an upper-case letter.')
  if (!/[0-9]/.test(plain)) problems.push('Include a number.')
  if (/^\s|\s$/.test(plain)) problems.push('Remove the leading or trailing space.')
  return { ok: problems.length === 0, problems }
}
