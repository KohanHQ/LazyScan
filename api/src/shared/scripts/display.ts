import { getDbClient } from "@/shared/database/client"

async function updateDisplayIds() {
  const db = getDbClient()

  console.log("Updating display IDs to remove 'user_' prefix...")

  const result = await db`
    UPDATE users 
    SET display_id = SUBSTRING(display_id FROM 6)
    WHERE display_id LIKE 'user_%'
    RETURNING id, display_id, email
  `

  if (result.length === 0) {
    console.log("No users found with 'user_' prefix")
  } else {
    console.log(`Updated ${result.length} user(s):`)
    for (const user of result) {
      console.log(`- ${user.email}: ${user.display_id}`)
    }
  }

  await db.end()
}

updateDisplayIds()
  .then(() => {
    console.log("Display ID update complete")
    process.exit(0)
  })
  .catch(err => {
    console.error("Error updating display IDs:", err)
    process.exit(1)
  })