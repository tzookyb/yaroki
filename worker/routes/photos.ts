import { createApp } from '../app'

export const photoRoutes = createApp().get('/:key{.+}', async (c) => {
  const photo = await c.env.PHOTOS.get(c.req.param('key'))
  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }
  const headers = new Headers()
  photo.writeHttpMetadata(headers)
  headers.set('ETag', photo.httpEtag)
  // Keys are random and photos are never overwritten. Private because they need a session.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')
  return new Response(photo.body, { headers })
})
