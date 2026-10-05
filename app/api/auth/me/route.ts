import { currentUserId } from '@/lib/session'
import { findUserById } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const userId = await currentUserId()
  if (!userId) return Response.json({ user: null }, { status: 401 })
  const user = await findUserById(userId)
  if (!user) return Response.json({ user: null }, { status: 401 })
  return Response.json({ user: { id: user.id, name: user.name } })
}