import { getDbClient } from "@/shared/database/client"
import { idGenerators } from "@/shared/identity/generator"

async function backfillProfiles() {
  const db = getDbClient()

  const usersWithoutProfile = await db`
    SELECT u.id, u.email
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE p.user_id IS NULL
  `

  if (usersWithoutProfile.length === 0) {
    console.log("All users already have profiles")
    await db.end()
    return
  }

  console.log(`Found ${usersWithoutProfile.length} user(s) without profile`)

  for (const user of usersWithoutProfile) {
    const username = idGenerators.displayId(10)

    // Leave avatar_url null; the UI derives a default from the username.
    await db`
      INSERT INTO profiles (user_id, username)
      VALUES (${user.id}, ${username})
    `

    console.log(`Created profile for ${user.email} with username: ${username}`)
  }

  await db.end()
}

backfillProfiles()
  .then(() => {
    console.log("Backfill complete")
    process.exit(0)
  })
  .catch(err => {
    console.error("Error backfilling profiles:", err)
    process.exit(1)
  })
