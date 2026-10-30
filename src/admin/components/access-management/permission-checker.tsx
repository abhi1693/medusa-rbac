import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Label,
  Select,
  Text,
  Textarea,
} from "@medusajs/ui"
import { accessApi, errorMessage, type PermissionEntry } from "../../lib/access"
import { isPermissionContext } from "../../../lib/access/permission-context"
import { ActorPicker } from "./actor-picker"

const reasons = {
  inactive: "This account has no active access.",
  superuser: "Superuser grants every registered permission.",
  no_match: "No grant or contextual rule matches this permission and context.",
  allow: "The highest-ranked matching rule allows this permission.",
  deny: "The highest-ranked matching rule denies this permission.",
}

export function PermissionChecker({
  permission,
  actorTypes,
  userId,
  onClose,
}: {
  permission: PermissionEntry
  actorTypes: string[]
  userId: string
  onClose: () => void
}) {
  const [actorType, setActorType] = useState("user")
  const [actorId, setActorId] = useState("")
  const [defaultActorId, setDefaultActorId] = useState<string | undefined>(
    userId
  )
  const [context, setContext] = useState("{}")
  const [searching, setSearching] = useState(false)
  const [validation, setValidation] = useState("")
  const check = useMutation({ mutationFn: accessApi.evaluate })
  const clear = () => {
    setValidation("")
    check.reset()
  }
  return (
    <Drawer open onOpenChange={onClose}>
      <Drawer.Content aria-describedby="permission-check-description">
        <Drawer.Header>
          <Drawer.Title>Check permission</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
          <div>
            <Text weight="plus">{permission.label}</Text>
            <Text
              size="small"
              className="text-ui-fg-subtle font-mono break-all"
            >
              {permission.id}
            </Text>
          </div>
          <Text id="permission-check-description" className="text-ui-fg-subtle">
            Check an account against its current roles and the supplied context.
            This preview does not grant access. Route checks and data scoping
            still apply.
          </Text>
          <form
            id="permission-check"
            className="flex flex-col gap-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              clear()
              try {
                const parsed: unknown = JSON.parse(context)
                if (
                  !isPermissionContext(parsed) ||
                  !actorId.trim() ||
                  searching
                )
                  throw new Error("Invalid permission context")
                const input = {
                  actor_type: actorType,
                  actor_id: actorId.trim(),
                  permission: permission.id,
                  context: parsed,
                }
                check.mutate(input)
              } catch {
                setValidation(
                  "Choose an account and enter a JSON object containing at most 30 text, number, boolean or null context values."
                )
              }
            }}
          >
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="permission-actor-type">Account type</Label>
              <Select
                value={actorType}
                onValueChange={(value) => {
                  clear()
                  setActorId("")
                  setDefaultActorId(undefined)
                  setSearching(false)
                  setActorType(value)
                }}
              >
                <Select.Trigger id="permission-actor-type">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {actorTypes.map((type) => (
                    <Select.Item key={type} value={type}>
                      {type === "user"
                        ? "Admin user"
                        : type === "customer"
                          ? "Customer"
                          : type}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="permission-account">Account</Label>
              <ActorPicker
                key={actorType}
                actorType={actorType}
                userId={userId}
                value={actorId}
                initialId={defaultActorId}
                onChange={(id) => {
                  clear()
                  setSearching(false)
                  setActorId(id)
                }}
                onSearchingChange={(value) => {
                  clear()
                  setSearching(value)
                }}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="permission-context">Context</Label>
              <Textarea
                id="permission-context"
                value={context}
                rows={5}
                className="font-mono"
                onChange={(event) => {
                  clear()
                  setContext(event.target.value)
                }}
              />
              <Text size="small" className="text-ui-fg-subtle">
                For example, {`{"region_id":"north"}`}. Actor identity comes
                from the selected account.
              </Text>
            </div>
          </form>
          {(validation || check.error) && (
            <Alert role="alert" variant="error">
              {validation || errorMessage(check.error)}
            </Alert>
          )}
          {check.data && (
            <div
              role="status"
              className="bg-ui-bg-subtle border-ui-border-base rounded-lg border p-4"
            >
              <Badge color={check.data.decision.allowed ? "green" : "red"}>
                {check.data.decision.allowed ? "Allowed" : "Denied"}
              </Badge>
              <Text className="mt-3">
                {reasons[check.data.decision.reason]}
              </Text>
              {check.data.decision.matches.map((rule, index) => (
                <div
                  key={index}
                  className="border-ui-border-base mt-3 border-t pt-3"
                >
                  <Text size="small" weight="plus">
                    {index === 0 ? "Winning rule" : "Other matching rule"}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle break-all">
                    {rule.permission} · {rule.effect} · Priority{" "}
                    {rule.priority || 0}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            type="submit"
            form="permission-check"
            disabled={!actorId || searching}
            isLoading={check.isPending}
          >
            Check access
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
