import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createDataTableColumnHelper, useDataTable } from "@medusajs/ui"
import { accessApi, type AuditEvent } from "../../lib/access"
import { activityLabel } from "../../lib/access-presentation"
import { SettingsTable } from "./settings-table"

const column = createDataTableColumnHelper<AuditEvent>()
const columns = [
  column.accessor("created_at", {
    header: "Date",
    cell: ({ getValue }) =>
      new Date(getValue()).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  column.accessor("action", {
    header: "Activity",
    cell: ({ getValue }) => activityLabel(getValue()),
  }),
  column.accessor("actor_label", {
    header: "Changed by",
    cell: ({ getValue }) => getValue() || "Unknown user",
  }),
  column.accessor("target_label", {
    header: "Item",
    cell: ({ getValue }) => getValue() || "Removed item",
  }),
]
export function ActivityList({ userId }: { userId: string }) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const audit = useQuery({
    queryKey: ["medusa-rbac", userId, "audit", pagination.pageIndex],
    queryFn: () => accessApi.audit(pagination.pageIndex * 25),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const table = useDataTable({
    data: audit.data?.events || [],
    columns,
    getRowId: (event) => event.id,
    rowCount: audit.data?.count || 0,
    isLoading: audit.isPending,
    pagination: { state: pagination, onPaginationChange: setPagination },
  })
  return (
    <SettingsTable
      title="Activity"
      instance={table}
      empty="No access changes yet"
      error={audit.error}
    />
  )
}
