
import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { humanizeEnum } from '@shared/format'
import { divisionColor } from '@shared/palette'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import { TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table'
import { useSettingsActions, type SettingsResult } from '../actions'

interface DivisionRow {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
}

interface RuleRow {
  id: string
  provider: string
  field: string
  matchType: string
  matchValue: string
  priority: number
  divisionName: string
  divisionCode: string
}

const MATCH_TYPES = [
  { value: 'equals', label: 'is exactly' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'regex', label: 'matches the pattern' },
]

export function DivisionSettings({
  divisions,
  rules,
  mappableFields,
  unassigned,
  canManage,
}: {
  divisions: DivisionRow[]
  rules: RuleRow[]
  mappableFields: Record<string, { field: string; label: string; hint: string }[]>
  unassigned: { invoices: number; quotes: number }
  canManage: boolean
}) {
  const [result, setResult] = React.useState<SettingsResult | null>(null)
  const { createDivision, createMappingRule, deleteMappingRule } = useSettingsActions()
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<RuleRow | null>(null)

  const [provider, setProvider] = React.useState('QUICKBOOKS')
  const [field, setField] = React.useState('class')
  const [matchType, setMatchType] = React.useState('equals')
  const [divisionId, setDivisionId] = React.useState(divisions[0]?.id ?? '')

  const availableFields = mappableFields[provider] ?? []

  React.useEffect(() => {
    const first = (mappableFields[provider] ?? [])[0]
    setField(first?.field ?? '')
  }, [provider, mappableFields])

  const run = async (action: (formData: FormData) => Promise<SettingsResult>, formData: FormData) => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await action(formData))
    } catch {
      setResult({ ok: false, message: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  return (
    <div className="space-y-4">
      {result ? (
        <Alert tone={result.ok ? 'positive' : 'negative'} title={result.ok ? 'Saved' : 'Not saved'}>
          {result.message}
        </Alert>
      ) : null}

      {unassigned.invoices > 0 || unassigned.quotes > 0 ? (
        <Alert tone="warning" title="Some records are not assigned to a division">
          {unassigned.invoices > 0 ? `${unassigned.invoices} invoices` : ''}
          {unassigned.invoices > 0 && unassigned.quotes > 0 ? ' and ' : ''}
          {unassigned.quotes > 0 ? `${unassigned.quotes} open quotes` : ''} match no mapping rule. They are reported
          as &ldquo;Unassigned&rdquo; and excluded from every per-division figure, rather than being attributed to a
          default division.
        </Alert>
      ) : null}

      {/* --- Divisions -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Divisions</CardTitle>
            <CardDescription>The business units every figure can be broken down by.</CardDescription>
          </div>
        </CardHeader>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Division</TH>
                <TH>Code</TH>
                <TH>Description</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {divisions.map((division) => (
                <TR key={division.id}>
                  <TD>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: divisionColor(division.code) }}
                        aria-hidden
                      />
                      <span className="font-medium text-ink-900">{division.name}</span>
                    </span>
                  </TD>
                  <TD className="font-mono text-[12px] text-ink-600">{division.code}</TD>
                  <TD className="max-w-[24rem] text-[12.5px] text-ink-600">
                    {division.description ?? <span className="italic text-ink-400">None</span>}
                  </TD>
                  <TD>
                    <Badge variant={division.isActive ? 'positive' : 'neutral'} size="sm">
                      {division.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>

        {canManage ? (
          <CardContent className="border-t border-ink-200">
            <form
              action={(formData) => void run(createDivision, formData)}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <Field label="New division name" htmlFor="divisionName">
                <Input id="divisionName" name="name" placeholder="Pixel LED Displays" required />
              </Field>
              <Field label="Short code" htmlFor="divisionCode" help="Capitals, numbers and underscores.">
                <Input id="divisionCode" name="code" placeholder="PIXEL" required className="uppercase" />
              </Field>
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                <Plus aria-hidden />
                Add division
              </Button>
            </form>
          </CardContent>
        ) : null}
      </Card>

      {/* --- Mapping rules ----------------------------------------------- */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Division mapping rules</CardTitle>
            <CardDescription>
              Evaluated in priority order, lowest number first. The first rule that matches wins; a record that
              matches nothing stays unassigned.
            </CardDescription>
          </div>
        </CardHeader>

        {rules.length === 0 ? (
          <EmptyState
            title="No mapping rules yet"
            description="Without a rule, every imported record is reported as Unassigned. Add a rule below that matches, for example, the QuickBooks class on an invoice."
          />
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH numeric>Priority</TH>
                  <TH>Source</TH>
                  <TH>Rule</TH>
                  <TH>Assigns to</TH>
                  {canManage ? (
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {rules.map((rule) => (
                  <TR key={rule.id} className="hover:bg-ink-50">
                    <TD numeric className="text-ink-600">
                      {rule.priority}
                    </TD>
                    <TD className="whitespace-nowrap">{humanizeEnum(rule.provider)}</TD>
                    <TD className="text-[12.5px]">
                      <span className="font-medium text-ink-900">{rule.field}</span>{' '}
                      <span className="text-ink-600">
                        {MATCH_TYPES.find((m) => m.value === rule.matchType)?.label ?? rule.matchType}
                      </span>{' '}
                      <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] text-ink-900">
                        {rule.matchValue}
                      </code>
                    </TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: divisionColor(rule.divisionCode) }}
                          aria-hidden
                        />
                        {rule.divisionName}
                      </span>
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete the rule for ${rule.field}`}
                          onClick={() => setConfirmDelete(rule)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}

        {canManage ? (
          <CardContent className="border-t border-ink-200">
            <h3 className="mb-3 text-[14px] font-semibold text-ink-900">Add a rule</h3>
            <form action={(formData) => void run(createMappingRule, formData)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Source system" htmlFor="provider">
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger aria-label="Source system">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QUICKBOOKS">QuickBooks Online</SelectItem>
                      <SelectItem value="METHOD_CRM">Method CRM</SelectItem>
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="provider" value={provider} />
                </Field>

                <Field
                  label="Field"
                  htmlFor="field"
                  help={availableFields.find((f) => f.field === field)?.hint}
                >
                  <Select value={field} onValueChange={setField}>
                    <SelectTrigger aria-label="Field to match on">
                      <SelectValue placeholder="Choose a field" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFields.map((option) => (
                        <SelectItem key={option.field} value={option.field}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="field" value={field} />
                </Field>

                <Field label="Condition" htmlFor="matchType">
                  <Select value={matchType} onValueChange={setMatchType}>
                    <SelectTrigger aria-label="Match condition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_TYPES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="matchType" value={matchType} />
                </Field>

                <Field label="Value" htmlFor="matchValue">
                  <Input id="matchValue" name="matchValue" placeholder="Pixel LED" required />
                </Field>

                <Field label="Assign to division" htmlFor="divisionId">
                  <Select value={divisionId} onValueChange={setDivisionId}>
                    <SelectTrigger aria-label="Division to assign">
                      <SelectValue placeholder="Choose a division" />
                    </SelectTrigger>
                    <SelectContent>
                      {divisions.map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="divisionId" value={divisionId} />
                </Field>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="Priority"
                  htmlFor="priority"
                  help="Lower numbers are evaluated first."
                  className="w-32"
                >
                  <Input id="priority" name="priority" type="number" min={1} max={10000} defaultValue={100} />
                </Field>
                <Button type="submit" variant="primary" size="md" loading={busy} disabled={!field || !divisionId}>
                  <Plus aria-hidden />
                  Add rule
                </Button>
              </div>
            </form>
          </CardContent>
        ) : null}

        <CardFooter>
          <p className="text-[12px] leading-5 text-ink-600">
            A new rule applies to records imported from the next sync onward. To re-apply it to records already
            imported, run a full backfill from the Data Health page.
          </p>
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete this mapping rule?"
        description={
          <>
            <p>
              Records imported from now on will no longer be assigned to{' '}
              <strong>{confirmDelete?.divisionName}</strong> by this rule.
            </p>
            <p className="mt-2">
              Records already imported keep their current division until the next full backfill, so no figure
              changes immediately.
            </p>
          </>
        }
        confirmLabel="Delete rule"
        tone="danger"
        loading={busy}
        onConfirm={() => {
          if (!confirmDelete) return
          const formData = new FormData()
          formData.set('ruleId', confirmDelete.id)
          void run(deleteMappingRule, formData)
        }}
      />
    </div>
  )
}
