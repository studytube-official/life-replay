import {
  GOOGLE_FIELD_MASK,
  GOOGLE_NEARBY_URL,
  LOOKUP_LIMITS,
  LookupValidationError,
  buildGoogleNearbyBody,
  buildUsage,
  isAllowedOrigin,
  normalizeGooglePlacesResponse,
  quotaErrorCode,
  validateLookupBody,
} from './logic.js'

type QuotaReservation = {
  allowed: boolean
  reason: 'monthly' | 'minute' | 'day' | null
  month_used: number
  month_limit: number
}

const encoder = new TextEncoder()

function responseHeaders(origin: string | null) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  })

  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set(
      'Access-Control-Allow-Headers',
      'authorization, apikey, content-type, x-client-info',
    )
    headers.set('Access-Control-Max-Age', '600')
  }

  return headers
}

function jsonResponse(
  status: number,
  value: Record<string, unknown>,
  origin: string | null,
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders(origin),
  })
}

function clientAddress(request: Request) {
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

async function hmacSha256Hex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  )
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function reserveQuota(
  supabaseUrl: string,
  serviceRoleKey: string,
  clientHash: string,
): Promise<QuotaReservation> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/jq_reserve_place_lookup`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_client_hash: clientHash }),
      signal: AbortSignal.timeout(5000),
    },
  )

  if (!response.ok) {
    throw new Error('quota_service_unavailable')
  }

  const value = await response.json()
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.allowed !== 'boolean' ||
    !Number.isInteger(value.month_used) ||
    !Number.isInteger(value.month_limit)
  ) {
    throw new Error('invalid_quota_response')
  }

  return value as QuotaReservation
}

async function parseRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > LOOKUP_LIMITS.maxRequestBytes
  ) {
    throw new LookupValidationError('リクエストが大きすぎます。')
  }

  const text = await request.text()
  if (encoder.encode(text).byteLength > LOOKUP_LIMITS.maxRequestBytes) {
    throw new LookupValidationError('リクエストが大きすぎます。')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new LookupValidationError('JSONを読み取れませんでした。')
  }

  return validateLookupBody(value)
}

function quotaError(reservation: QuotaReservation, origin: string) {
  const code = quotaErrorCode(reservation.reason)

  const message =
    reservation.reason === 'monthly'
      ? '今月の施設候補検索は上限に達しました。'
      : '短時間の検索回数が多いため、しばらく待ってください。'

  return jsonResponse(
    429,
    {
      code,
      message,
      usage: buildUsage(reservation.month_used, reservation.month_limit),
      quota: {
        monthUsed: reservation.month_used,
        monthLimit: reservation.month_limit,
      },
    },
    origin,
  )
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin')
  if (!origin || !isAllowedOrigin(origin)) {
    return jsonResponse(
      403,
      { error: 'origin_not_allowed', message: 'この接続元は許可されていません。' },
      null,
    )
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(origin) })
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      405,
      { error: 'method_not_allowed', message: 'POSTだけを利用できます。' },
      origin,
    )
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonResponse(
      415,
      {
        error: 'unsupported_media_type',
        message: 'application/jsonで送信してください。',
      },
      origin,
    )
  }

  let coordinates: Readonly<{ latitude: number; longitude: number }>
  try {
    coordinates = await parseRequestBody(request)
  } catch (error) {
    if (error instanceof LookupValidationError) {
      return jsonResponse(
        400,
        { error: error.code, message: error.message },
        origin,
      )
    }
    return jsonResponse(
      400,
      { error: 'invalid_request', message: 'リクエストを読み取れませんでした。' },
      origin,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
  const hashSecret = Deno.env.get('PLACE_RATE_HASH_SECRET')
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !googleApiKey ||
    !hashSecret ||
    hashSecret.length < 32
  ) {
    return jsonResponse(
      503,
      {
        error: 'service_not_configured',
        message: '施設候補検索は現在準備中です。',
      },
      origin,
    )
  }

  let reservation: QuotaReservation
  try {
    const clientHash = await hmacSha256Hex(
      clientAddress(request),
      hashSecret,
    )
    reservation = await reserveQuota(supabaseUrl, serviceRoleKey, clientHash)
  } catch {
    return jsonResponse(
      503,
      {
        error: 'quota_service_unavailable',
        message: '検索回数を確認できませんでした。少し待って再度お試しください。',
      },
      origin,
    )
  }

  if (!reservation.allowed) {
    return quotaError(reservation, origin)
  }

  let googleResponse: Response
  try {
    googleResponse = await fetch(GOOGLE_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify(buildGoogleNearbyBody(coordinates)),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return jsonResponse(
      502,
      {
        error: 'places_service_unavailable',
        message: '施設情報を取得できませんでした。',
      },
      origin,
    )
  }

  if (!googleResponse.ok) {
    return jsonResponse(
      502,
      {
        error: 'places_service_unavailable',
        message: '施設情報を取得できませんでした。',
      },
      origin,
    )
  }

  try {
    const googlePayload = await googleResponse.json()
    const candidates = normalizeGooglePlacesResponse(
      googlePayload,
      coordinates,
    )
    return jsonResponse(
      200,
      {
        candidates,
        usage: buildUsage(reservation.month_used, reservation.month_limit),
        quota: {
          monthUsed: reservation.month_used,
          monthLimit: reservation.month_limit,
        },
      },
      origin,
    )
  } catch {
    return jsonResponse(
      502,
      {
        error: 'invalid_places_response',
        message: '施設情報を読み取れませんでした。',
      },
      origin,
    )
  }
})
