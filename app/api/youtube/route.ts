import { NextRequest } from 'next/server'

// Dummy channel data for development (until YouTube Data API key is configured)
const DUMMY_CHANNELS: Record<string, { title: string; thumbnail: string; subscriberCount: string; description: string }> = {
  default: {
    title: '크리에이터 채널',
    thumbnail: 'https://via.placeholder.com/88/FF0050/ffffff?text=YT',
    subscriberCount: '12.5만',
    description: '유튜브 크리에이터 채널입니다',
  },
}

function extractChannelHandle(url: string): string | null {
  // Match patterns: @handle, youtube.com/@handle, youtube.com/channel/ID
  const handleMatch = url.match(/@([\w.-]+)/)
  if (handleMatch) return handleMatch[1]

  const channelMatch = url.match(/channel\/([\w-]+)/)
  if (channelMatch) return channelMatch[1]

  // If it's just a plain string, treat it as a handle
  if (/^[\w.-]+$/.test(url)) return url

  return null
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return Response.json({ error: 'URL 파라미터가 필요합니다' }, { status: 400 })
  }

  const handle = extractChannelHandle(url)
  if (!handle) {
    return Response.json({ error: '유효한 유튜브 채널 URL이 아닙니다' }, { status: 400 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY

  if (apiKey) {
    try {
      // Try real YouTube Data API
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&key=${apiKey}`
      const searchRes = await fetch(searchUrl)
      const searchData = await searchRes.json()

      if (searchData.items && searchData.items.length > 0) {
        const channelId = searchData.items[0].snippet.channelId

        const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`
        const channelRes = await fetch(channelUrl)
        const channelData = await channelRes.json()

        if (channelData.items && channelData.items.length > 0) {
          const ch = channelData.items[0]
          const subCount = parseInt(ch.statistics.subscriberCount, 10)
          const formattedSubs =
            subCount >= 10000
              ? `${(subCount / 10000).toFixed(1)}만`
              : subCount.toLocaleString()

          return Response.json({
            id: ch.id,
            title: ch.snippet.title,
            thumbnail: ch.snippet.thumbnails.medium.url,
            subscriberCount: formattedSubs,
            description: ch.snippet.description,
          })
        }
      }

      return Response.json({ error: '채널을 찾을 수 없습니다' }, { status: 404 })
    } catch {
      return Response.json({ error: 'YouTube API 호출 중 오류가 발생했습니다' }, { status: 500 })
    }
  }

  // Fallback: return dummy data for development
  const dummy = DUMMY_CHANNELS.default
  return Response.json({
    id: `dummy-${handle}`,
    title: handle.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    thumbnail: dummy.thumbnail,
    subscriberCount: dummy.subscriberCount,
    description: dummy.description,
  })
}
