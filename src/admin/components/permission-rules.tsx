import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Textarea,
  Text,
} from "@medusajs/ui"
import type { PermissionRule } from "../../lib/access/config"

export type RuleDraft = {
  permission: string
  effect: "allow" | "deny"
  priority: number
  conditions: string
}
export const ruleDrafts = (rules: PermissionRule[]) =>
  rules.map((rule) => ({
    permission: rule.permission,
    effect: rule.effect,
    priority: rule.priority || 0,
    conditions: JSON.stringify(rule.conditions || {}),
  }))
export const parseRuleDrafts = (rules: RuleDraft[]): PermissionRule[] =>
  rules.map((rule) => ({
    permission: rule.permission,
    effect: rule.effect,
    priority: rule.priority,
    conditions: JSON.parse(rule.conditions),
  }))

export function PermissionRules({
  value,
  onChange,
  readOnly,
}: {
  value: RuleDraft[]
  onChange: (value: RuleDraft[]) => void
  readOnly: boolean
}) {
  const update = (index: number, change: Partial<RuleDraft>) =>
    onChange(
      value.map((rule, position) =>
        position === index ? { ...rule, ...change } : rule
      )
    )
  return (
    <div className="flex flex-col gap-y-3">
      <Heading level="h2">Permission rules</Heading>
      <Text size="small">
        Scope access by context. Higher priority rules win; equally specific
        conflicts deny access. Conditions match values supplied by your
        application.
      </Text>
      {value.map((rule, index) => (
        <div
          className="flex flex-col gap-y-2 rounded-lg border p-3"
          key={index}
        >
          <Label htmlFor={`rule-${index}-permission`}>
            Permission or namespace
          </Label>
          <Input
            id={`rule-${index}-permission`}
            placeholder="orders.view or orders.*"
            disabled={readOnly}
            value={rule.permission}
            onChange={(event) =>
              update(index, { permission: event.target.value })
            }
          />
          <Label>Effect</Label>
          <Select
            disabled={readOnly}
            value={rule.effect}
            onValueChange={(effect) =>
              update(index, { effect: effect as "allow" | "deny" })
            }
          >
            <Select.Trigger aria-label={`Rule ${index + 1} effect`}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="allow">Allow</Select.Item>
              <Select.Item value="deny">Deny</Select.Item>
            </Select.Content>
          </Select>
          <Label htmlFor={`rule-${index}-priority`}>Priority</Label>
          <Input
            id={`rule-${index}-priority`}
            type="number"
            disabled={readOnly}
            value={rule.priority}
            onChange={(event) =>
              update(index, { priority: Number(event.target.value) })
            }
          />
          <Label htmlFor={`rule-${index}-conditions`}>Context conditions</Label>
          <Textarea
            id={`rule-${index}-conditions`}
            disabled={readOnly}
            value={rule.conditions}
            placeholder={'{"sales_channel_id":"sc_123"}'}
            onChange={(event) =>
              update(index, { conditions: event.target.value })
            }
          />
          {!readOnly && (
            <Button
              variant="secondary"
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
            >
              Remove rule
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          variant="secondary"
          onClick={() =>
            onChange([
              ...value,
              {
                permission: "",
                effect: "allow",
                priority: 0,
                conditions: "{}",
              },
            ])
          }
        >
          Add rule
        </Button>
      )}
    </div>
  )
}
