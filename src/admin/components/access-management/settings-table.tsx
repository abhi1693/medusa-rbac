import type { ReactNode } from "react"
import {
  Alert,
  Container,
  DataTable,
  Heading,
  type DataTableProps,
} from "@medusajs/ui"
import { errorMessage } from "../../lib/access"

export function SettingsTable<T>({
  title,
  instance,
  action,
  search,
  sorting = false,
  error,
  empty,
  headingLevel = "h1",
}: {
  title: string
  instance: DataTableProps<T>["instance"]
  action?: ReactNode
  search?: string
  sorting?: boolean
  error?: unknown
  empty: string
  headingLevel?: "h1" | "h2"
}) {
  return (
    <Container
      className="divide-y overflow-hidden p-0"
      role="region"
      aria-label={title}
    >
      <DataTable instance={instance}>
        <DataTable.Toolbar className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <Heading level={headingLevel}>{title}</Heading>
          <div className="flex w-full items-center gap-x-2 sm:w-auto">
            {sorting && <DataTable.SortingMenu tooltip="Sort" />}
            {search && <DataTable.Search placeholder={search} />}
            {action}
          </div>
        </DataTable.Toolbar>
        {error ? (
          <div className="px-6 py-4">
            <Alert role="alert" variant="error">
              {errorMessage(error)}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable.Table
              emptyState={{
                empty: { heading: empty },
                filtered: {
                  heading: "No results",
                  description: "Try another search.",
                },
              }}
            />
            <DataTable.Pagination />
          </>
        )}
      </DataTable>
    </Container>
  )
}
