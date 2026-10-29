import { Button, Heading, Input, Label, Select, Text, Hint } from "@medusajs/ui"
import type { PermissionRule } from "../../lib/access/config"
import type { PermissionEntry } from "../lib/access"

type Scalar = string | number | boolean | null
export type ValueDraft = {
  type: "string" | "number" | "boolean" | "null"
  value: string
}
export type ConditionDraft = { key: string; any: boolean; values: ValueDraft[] }
export type RuleDraft = {
  permission: string
  effect: "allow" | "deny"
  priority: number
  conditions: ConditionDraft[]
}
const valueDraft = (value: Scalar): ValueDraft => ({
  type: value === null ? "null" : (typeof value as ValueDraft["type"]),
  value: value === null ? "" : String(value),
})
export const ruleDrafts = (rules: PermissionRule[]): RuleDraft[] =>
  rules.map((rule) => ({
    permission: rule.permission,
    effect: rule.effect,
    priority: rule.priority || 0,
    conditions: Object.entries(rule.conditions || {}).map(([key, value]) => ({
      key,
      any: Array.isArray(value),
      values: (Array.isArray(value) ? value : [value]).map(valueDraft),
    })),
  }))
function parseValue(value: ValueDraft): Scalar {
  if (value.type === "null") return null
  if (value.type === "boolean") return value.value === "true"
  if (value.type === "number") {
    if (!value.value.trim() || !Number.isFinite(Number(value.value)))
      throw new Error("Enter a valid number for each numeric condition.")
    return Number(value.value)
  }
  return value.value
}
export const parseRuleDrafts = (rules: RuleDraft[]): PermissionRule[] =>
  rules.map((rule) => {
    const keys = rule.conditions.map((condition) => condition.key.trim())
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length)
      throw new Error("Each condition needs a unique context field.")
    if (!rule.permission.trim())
      throw new Error("Choose a permission for every rule.")
    return {
      permission: rule.permission.trim(),
      effect: rule.effect,
      priority: rule.priority,
      conditions: Object.fromEntries(
        rule.conditions.map((condition, index) => [
          keys[index],
          condition.any
            ? condition.values.map(parseValue)
            : parseValue(condition.values[0]),
        ])
      ),
    }
  })

export function PermissionRules({
  value,
  onChange,
  readOnly,
  permissions = [],
}: {
  value: RuleDraft[]
  onChange?: (value: RuleDraft[]) => void
  readOnly: boolean
  permissions?: PermissionEntry[]
}) {
  const update = (index: number, change: Partial<RuleDraft>) =>
    onChange!(
      value.map((rule, position) =>
        position === index ? { ...rule, ...change } : rule
      )
    )
  const conditionChange = (
    index: number,
    position: number,
    change: Partial<ConditionDraft>
  ) =>
    update(index, {
      conditions: value[index].conditions.map((condition, at) =>
        at === position ? { ...condition, ...change } : condition
      ),
    })
  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-col gap-y-2">
        <Heading level="h2">Permission rules</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Rules scope access using context supplied by your application. Higher
          priority wins, followed by permission specificity and number of
          conditions. Equal conflicts deny access.
        </Text>
      </div>
      <datalist id="rbac-permission-options">
        {[
          ...new Set([
            ...permissions.map((permission) => permission.id),
            ...permissions.map(
              (permission) => `${permission.id.split(".")[0]}.*`
            ),
          ]),
        ].map((permission) => (
          <option key={permission} value={permission} />
        ))}
      </datalist>
      {!value.length && (
        <Text size="small" className="text-ui-fg-muted">
          No permission rules. Select permissions to grant access without
          context conditions.
        </Text>
      )}
      {value.map((rule, index) => (
        <fieldset
          key={index}
          className="border-ui-border-base flex flex-col gap-y-4 rounded-lg border p-4"
          disabled={readOnly}
        >
          <legend className="px-1 text-sm font-medium">Rule {index + 1}</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-y-2">
              <Label htmlFor={`rule-${index}-permission`}>
                Permission or namespace
              </Label>
              <Input
                id={`rule-${index}-permission`}
                list="rbac-permission-options"
                placeholder="orders.view or orders.*"
                value={rule.permission}
                onChange={(event) =>
                  update(index, { permission: event.target.value })
                }
                required
              />
            </div>
            <div className="flex flex-col gap-y-2">
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
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor={`rule-${index}-priority`}>Priority</Label>
              <Input
                id={`rule-${index}-priority`}
                type="number"
                step="1"
                value={rule.priority}
                onChange={(event) =>
                  update(index, { priority: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <Text size="small" weight="plus">
            Conditions
          </Text>
          {!rule.conditions.length && (
            <Hint>
              Applies in every context. Add conditions to limit this rule.
            </Hint>
          )}
          {rule.conditions.map((condition, position) => (
            <div
              key={position}
              className="bg-ui-bg-subtle flex flex-col gap-y-3 rounded-md p-3"
            >
              <div className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-y-2">
                  <Label htmlFor={`context-${index}-${position}`}>
                    Context field
                  </Label>
                  <Input
                    id={`context-${index}-${position}`}
                    placeholder="sales_channel_id"
                    value={condition.key}
                    onChange={(event) =>
                      conditionChange(index, position, {
                        key: event.target.value,
                      })
                    }
                    required
                  />
                </div>
                {!readOnly && (
                  <Button
                    variant="transparent"
                    size="small"
                    type="button"
                    onClick={() =>
                      update(index, {
                        conditions: rule.conditions.filter(
                          (_, at) => at !== position
                        ),
                      })
                    }
                  >
                    Remove condition
                  </Button>
                )}
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {condition.any ? "Matches any of these values" : "Equals"}
              </Text>
              {condition.values.map((item, at) => (
                <div key={at} className="flex gap-2">
                  <Select
                    disabled={readOnly}
                    value={item.type}
                    onValueChange={(type) =>
                      conditionChange(index, position, {
                        values: condition.values.map((current, target) =>
                          target === at
                            ? {
                                type: type as ValueDraft["type"],
                                value: type === "boolean" ? "true" : "",
                              }
                            : current
                        ),
                      })
                    }
                  >
                    <Select.Trigger
                      className="w-28"
                      aria-label={`Rule ${index + 1} condition ${position + 1} value ${at + 1} type`}
                    >
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {["string", "number", "boolean", "null"].map((type) => (
                        <Select.Item key={type} value={type}>
                          {type === "string"
                            ? "Text"
                            : type === "number"
                              ? "Number"
                              : type === "boolean"
                                ? "Boolean"
                                : "Empty"}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <div className="min-w-0 flex-1">
                    {item.type === "boolean" ? (
                      <Select
                        disabled={readOnly}
                        value={item.value}
                        onValueChange={(next) =>
                          conditionChange(index, position, {
                            values: condition.values.map((current, target) =>
                              target === at
                                ? { ...current, value: next }
                                : current
                            ),
                          })
                        }
                      >
                        <Select.Trigger
                          aria-label={`Condition ${position + 1} value ${at + 1}`}
                        >
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="true">True</Select.Item>
                          <Select.Item value="false">False</Select.Item>
                        </Select.Content>
                      </Select>
                    ) : (
                      <Input
                        aria-label={`Condition ${position + 1} value ${at + 1}`}
                        disabled={item.type === "null"}
                        type={item.type === "number" ? "number" : "text"}
                        value={item.value}
                        placeholder={
                          item.type === "null" ? "Empty value" : "Value"
                        }
                        onChange={(event) =>
                          conditionChange(index, position, {
                            values: condition.values.map((current, target) =>
                              target === at
                                ? { ...current, value: event.target.value }
                                : current
                            ),
                          })
                        }
                      />
                    )}
                  </div>
                  {!readOnly && condition.values.length > 1 && (
                    <Button
                      type="button"
                      size="small"
                      variant="transparent"
                      aria-label={`Remove value ${at + 1}`}
                      onClick={() =>
                        conditionChange(index, position, {
                          values: condition.values.filter(
                            (_, target) => target !== at
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  className="self-start"
                  onClick={() =>
                    conditionChange(index, position, {
                      any: true,
                      values: [
                        ...condition.values,
                        { type: "string", value: "" },
                      ],
                    })
                  }
                >
                  Add alternative value
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex justify-between gap-3">
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() =>
                  update(index, {
                    conditions: [
                      ...rule.conditions,
                      {
                        key: "",
                        any: false,
                        values: [{ type: "string", value: "" }],
                      },
                    ],
                  })
                }
              >
                Add condition
              </Button>
              <Button
                type="button"
                size="small"
                variant="transparent"
                onClick={() =>
                  onChange!(value.filter((_, position) => position !== index))
                }
              >
                Remove rule
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      {!readOnly && (
        <Button
          variant="secondary"
          type="button"
          className="self-start"
          onClick={() =>
            onChange!([
              ...value,
              { permission: "", effect: "allow", priority: 0, conditions: [] },
            ])
          }
        >
          Add rule
        </Button>
      )}
    </div>
  )
}
