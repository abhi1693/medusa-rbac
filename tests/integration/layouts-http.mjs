import assert from "node:assert/strict"

export async function verifyLayouts(base, fixture) {
  const tokens = {}
  for (const [name, actor] of Object.entries(fixture)) {
    const response = await fetch(`${base}/auth/user/emailpass`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: actor.email, password: actor.password }),
    })
    assert.equal(response.status, 200, `native authentication: ${name}`)
    tokens[name] = (await response.json()).token
    assert.equal(typeof tokens[name], "string")
  }
  const request = async (name, path, method = "GET", body, expected = 200) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(name ? { authorization: `Bearer ${tokens[name]}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    assert.equal(
      response.status,
      expected,
      `${name || "unauthenticated"} ${method} ${path}: ${JSON.stringify(result)}`
    )
    return result
  }
  const zone = "/admin/layouts/product.details/configuration"
  const configuration = (order) => ({
    widgets: { "core:product-general": { section: "main", order } },
  })
  await request(null, zone, "GET", undefined, 401)
  await request(
    "first",
    zone,
    "POST",
    {
      configuration: configuration(1),
      user_id: fixture.second.id,
    },
    400
  )
  await request(
    "second",
    zone,
    "POST",
    {
      is_default: false,
      configuration: configuration(2),
      user_id: fixture.first.id,
    },
    400
  )
  await request("first", zone, "POST", { configuration: configuration(1) })
  await request("second", zone, "POST", {
    is_default: false,
    configuration: configuration(2),
  })
  const first = await request("first", `${zone}?user_id=${fixture.second.id}`)
  const second = await request("second", zone)
  assert.equal(first.personal_configuration.user_id, fixture.first.id)
  assert.deepEqual(first.personal_configuration.configuration, configuration(1))
  assert.equal(second.personal_configuration.user_id, fixture.second.id)
  assert.deepEqual(
    second.personal_configuration.configuration,
    configuration(2)
  )
  await request(
    "first",
    zone,
    "POST",
    { is_default: true, configuration: configuration(3) },
    403
  )
  for (const is_default of ["false", "true", 0, 1, null, [], {}])
    for (const actor of ["first", "manager", "superuser"])
      await request(
        actor,
        zone,
        "POST",
        { is_default, configuration: configuration(3) },
        403
      )
  await request("manager", zone, "POST", {
    is_default: true,
    configuration: configuration(3),
  })
  const shared = await request("first", zone)
  assert.equal(shared.default_configuration.is_system_default, true)
  assert.equal(shared.default_configuration.user_id, null)
  assert.deepEqual(shared.default_configuration.configuration, configuration(3))
  for (const query of [
    "",
    `?user_id=${fixture.first.id}`,
    `?$or[0][user_id]=${fixture.first.id}`,
    "?fields=id,user_id,is_system_default,configuration",
  ]) {
    const result = await request(
      "second",
      `/admin/layouts/configurations${query}`
    )
    assert.ok(
      result.layout_configurations.every(
        (layout) =>
          layout.user_id === fixture.second.id ||
          layout.is_system_default === true
      ),
      "native list never reveals another user's personal layout"
    )
  }
  await request(
    "first",
    `${zone}?user_id=${fixture.second.id}&is_default=true`,
    "DELETE",
    { is_default: true }
  )
  assert.equal((await request("first", zone)).personal_configuration, null)
  assert.deepEqual(
    (await request("second", zone)).personal_configuration.configuration,
    configuration(2)
  )
  assert.deepEqual(
    (await request("first", zone)).default_configuration.configuration,
    configuration(3)
  )
  for (const method of ["GET", "POST", "DELETE"])
    await request(
      "inactive",
      zone,
      method,
      method === "POST" ? { configuration: configuration(4) } : undefined,
      403
    )
  for (const [path, method] of [
    [zone, "PUT"],
    ["/admin/layouts", "GET"],
    ["/admin/layouts/configurations", "POST"],
    [`${zone}/shared`, "POST"],
  ])
    await request("superuser", path, method, undefined, 403)
  await request(
    "second",
    "/admin/layouts/configurations?fields=*user.auth_identity",
    "GET",
    undefined,
    403
  )
  console.info(
    "PASS: native HTTP layouts preserve personal ownership, shared settings permission, active staff, strict scope and unknown-route denial"
  )
}
