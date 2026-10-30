import { useEffect, useRef } from "react"
import { Combobox } from "@medusajs/dashboard/components"
import { useComboboxData } from "@medusajs/dashboard/hooks"
import { Alert, Button, Text } from "@medusajs/ui"
import { accessApi, errorMessage } from "../../lib/access"

export function ActorPicker({
  actorType,
  userId,
  value,
  initialId,
  onChange,
  onSearchingChange,
}: {
  actorType: string
  userId: string
  value: string
  initialId?: string
  onChange: (id: string) => void
  onSearchingChange: (searching: boolean) => void
}) {
  const initialized = useRef(false)
  const accounts = useComboboxData({
    queryKey: ["medusa-rbac", userId, "actor-options", actorType],
    queryFn: async (query) => ({
      ...(await accessApi.actors(actorType, query)),
      requestedQuery: query.q?.trim() || "",
      isSelectionLookup: Boolean(query.id),
    }),
    getOptions: ({ actors, requestedQuery, isSelectionLookup }) =>
      actors.map((actor) => ({
        value: actor.id,
        requestedQuery,
        isSelectionLookup,
        label:
          actor.description && actor.description !== actor.id
            ? `${actor.label} · ${actor.description}`
            : actor.label,
      })),
    defaultValue: initialId,
    selectedValue: value || undefined,
    pageSize: 25,
  })
  useEffect(() => {
    if (
      !initialized.current &&
      initialId &&
      accounts.options.some((option) => option.value === initialId)
    ) {
      initialized.current = true
      onChange(initialId)
    }
  }, [initialId, accounts.options, onChange])
  const query = accounts.searchValue.trim()
  const options = accounts.isPlaceholderData
    ? []
    : accounts.options.filter(
        (option) =>
          !query ||
          (!option.isSelectionLookup && option.requestedQuery === query)
      )
  const selectActor = (id?: string) => {
    initialized.current = true
    onChange(
      accounts.options.find((option) => option.value === id)?.value || ""
    )
  }
  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            id="permission-account"
            aria-label="Account"
            aria-describedby="permission-account-feedback"
            placeholder="Search by name or email"
            value={value}
            onChange={selectActor}
            options={options}
            searchValue={accounts.searchValue}
            onSearchValueChange={(query) => {
              accounts.onSearchValueChange(query)
              onSearchingChange(Boolean(query.trim()))
              if (query.trim()) {
                initialized.current = true
              }
            }}
            fetchNextPage={accounts.fetchNextPage}
            isFetchingNextPage={accounts.isFetchingNextPage}
            disabled={
              accounts.isPending || accounts.isError || accounts.disabled
            }
            noResultsPlaceholder="No accounts available"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="small"
          aria-label="Clear account"
          disabled={!value}
          onClick={() => {
            accounts.onSearchValueChange("")
            onSearchingChange(false)
            selectActor()
          }}
        >
          Clear
        </Button>
      </div>
      <div id="permission-account-feedback">
        {accounts.isPending ? (
          <Text role="status" size="small" className="text-ui-fg-subtle">
            Loading accounts…
          </Text>
        ) : accounts.error ? (
          <div className="flex flex-col gap-y-2">
            <Alert role="alert" variant="error">
              {errorMessage(accounts.error)}
            </Alert>
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => {
                void accounts.refetch()
              }}
            >
              Retry accounts
            </Button>
          </div>
        ) : !accounts.options.length && !accounts.searchValue ? (
          <Text size="small" className="text-ui-fg-subtle">
            No accounts are available for this account type.
          </Text>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            Search the selected account type by name or email.
          </Text>
        )}
      </div>
    </div>
  )
}
