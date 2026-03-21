import webpush from 'web-push'
import { createServerClient } from '@/lib/supabase'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:wes@shrsde.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

export async function sendPushToUser(recipientName, payload) {
  const supabase = createServerClient()

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_name', recipientName)

  if (error || !subscriptions || subscriptions.length === 0) return

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      )
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        console.log(`Removed expired push subscription ${sub.id}`)
      } else {
        console.error(`Push to ${recipientName} failed:`, err.message)
      }
    }
  }
}
