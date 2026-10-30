import { useParams } from "react-router-dom"
import { RoleDetail } from "../../../../../components/access-management/role-detail"

const RoleDetailsPage = () => {
  const { id } = useParams()
  return <RoleDetail roleId={id!} />
}

export const handle = { breadcrumb: () => "Role details" }
export default RoleDetailsPage
