const DAILY_WATERING_CHECK = '0 6 * * *'
const WEEKLY_AI_CARE_CHECK = '0 7 * * 0'

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (request.method === 'GET' && pathname === '/api/health') {
      return Response.json({ ok: true })
    }

    if (request.method === 'GET' && pathname === '/api/plants') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM plants ORDER BY created_at DESC',
      ).all()
      return Response.json(results)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },

  async scheduled(controller) {
    switch (controller.cron) {
      case DAILY_WATERING_CHECK:
        // TODO: push watering reminders for plants that are due.
        console.log('daily watering check')
        break
      case WEEKLY_AI_CARE_CHECK:
        // TODO: run the AI care check, push only if action is needed.
        console.log('weekly AI care check')
        break
    }
  },
} satisfies ExportedHandler<Env>
