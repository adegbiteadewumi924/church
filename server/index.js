import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import Stripe from 'stripe'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT || 4242)
const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '')
const dataDirectory = path.resolve(here, '..', 'data')
const donationsPath = path.join(dataDirectory, 'donations.json')
const isProduction = process.env.NODE_ENV === 'production'
const sessionCookie = 'donation_admin'
const sessionLifetimeSeconds = 8 * 60 * 60
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

const campaigns = new Map([
  ['neighbor-relief', 'Care for Neighbors'],
  ['youth-learning', 'Youth Learning Fund'],
  ['family-support', 'Stronger Families'],
  ['children-home-support', 'Children’s Home Support'],
  ['homelessness-outreach', 'Homelessness Outreach'],
  ['essential-needs', 'Essentials for Those in Need'],
])

app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
app.use((request, response, next) => {
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

let writeQueue = Promise.resolve()

async function readStore() {
  try {
    const value = JSON.parse(await fs.readFile(donationsPath, 'utf8'))
    return {
      donations: Array.isArray(value.donations) ? value.donations : [],
      processedEvents: Array.isArray(value.processedEvents) ? value.processedEvents : [],
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { donations: [], processedEvents: [] }
    throw error
  }
}

function updateStore(update) {
  const operation = writeQueue.then(async () => {
    const store = await readStore()
    update(store)
    await fs.mkdir(dataDirectory, { recursive: true })
    const temporaryPath = `${donationsPath}.${process.pid}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 })
    await fs.rename(temporaryPath, donationsPath)
  })
  writeQueue = operation.catch(() => {})
  return operation
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function signSession(payload) {
  return crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url')
}

function makeSessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
  const payload = `${expires}.${crypto.randomBytes(24).toString('base64url')}`
  const value = `${payload}.${signSession(payload)}`
  const secure = isProduction ? '; Secure' : ''
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure}`
}

function hasAdminSession(request) {
  const cookieHeader = request.headers.cookie || ''
  const cookieValue = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1)
  if (!cookieValue || !process.env.ADMIN_SESSION_SECRET) return false
  const pieces = cookieValue.split('.')
  if (pieces.length !== 3) return false
  const [expires, nonce, signature] = pieces
  const payload = `${expires}.${nonce}`
  return Number(expires) > Math.floor(Date.now() / 1000) && equalSecret(signature, signSession(payload))
}

function requireAdmin(request, response, next) {
  if (!hasAdminSession(request)) return response.status(401).json({ error: 'Admin sign-in required.' })
  return next()
}

function safeDonationDetails(record) {
  return {
    id: record.id,
    status: record.status,
    amountCents: record.amountCents,
    currency: record.currency,
    campaignId: record.campaignId,
    campaignTitle: record.campaignTitle,
    donorName: record.donorName,
    donorEmail: record.donorEmail,
    createdAt: record.createdAt,
    cardBrand: record.cardBrand || null,
    cardLast4: record.cardLast4 || null,
    failureReason: record.failureReason || null,
  }
}

async function cardSummaryFromPaymentIntent(paymentIntentId) {
  if (!stripe || !paymentIntentId) return {}
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge', 'payment_method'] })
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    const details = charge?.payment_method_details?.card
    const paymentMethod = typeof intent.payment_method === 'object' ? intent.payment_method : null
    const card = details || paymentMethod?.card
    return card ? { cardBrand: card.brand || null, cardLast4: card.last4 || null } : {}
  } catch {
    return {}
  }
}

async function upsertDonation(record) {
  await updateStore((store) => {
    const existingIndex = store.donations.findIndex((item) => (
      item.id === record.id ||
      (record.paymentIntentId && item.paymentIntentId === record.paymentIntentId) ||
      (record.checkoutSessionId && item.checkoutSessionId === record.checkoutSessionId)
    ))
    if (existingIndex >= 0) {
      store.donations[existingIndex] = { ...store.donations[existingIndex], ...record }
    } else {
      store.donations.push(record)
    }
  })
}

const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false })
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false })

app.get('/api/health', (_request, response) => response.json({
  ok: true,
  stripeConfigured: Boolean(stripe && process.env.STRIPE_WEBHOOK_SECRET),
}))

app.get('/api/campaigns', (_request, response) => response.json([
  ...campaigns.entries(),
].map(([id, title]) => ({ id, title })))
)

app.post('/api/checkout/create', checkoutLimiter, express.json({ limit: '8kb' }), async (request, response) => {
  if (!stripe) return response.status(503).json({ error: 'Donations are not configured yet. Please try again later.' })
  const { campaignId, amount, donorName, donorEmail } = request.body || {}
  const campaignTitle = campaigns.get(campaignId)
  const normalizedAmount = Number(amount)
  const normalizedName = typeof donorName === 'string' ? donorName.trim().slice(0, 120) : ''
  const normalizedEmail = typeof donorEmail === 'string' ? donorEmail.trim().slice(0, 254) : ''
  if (!campaignTitle) return response.status(400).json({ error: 'Choose a valid donation campaign.' })
  if (!Number.isInteger(normalizedAmount) || normalizedAmount < 1 || normalizedAmount > 10000) {
    return response.status(400).json({ error: 'Enter an amount between $1 and $10,000 USD.' })
  }
  if (!normalizedName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return response.status(400).json({ error: 'Enter your name and a valid email address.' })
  }

  try {
    const metadata = {
      campaign_id: campaignId,
      campaign_title: campaignTitle,
      donor_name: normalizedName,
      donor_email: normalizedEmail,
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      managed_payments: { enabled: false },
      customer_email: normalizedEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: normalizedAmount * 100,
          product_data: {
            name: `Donation: ${campaignTitle}`,
            description: 'One-time community program donation',
          },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?donation=cancel`,
    })
    return response.json({ url: session.url })
  } catch (error) {
    console.error('Stripe Checkout creation failed:', error.message)
    return response.status(502).json({ error: 'Secure checkout is unavailable. Please try again.' })
  }
})

app.get('/api/checkout/status', async (request, response) => {
  if (!stripe) return response.status(503).json({ error: 'Payment status is unavailable.' })
  const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : ''
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return response.status(400).json({ error: 'Invalid checkout session.' })
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') {
      return response.json({ status: session.status === 'expired' ? 'failed' : 'pending' })
    }
    const metadata = session.metadata || {}
    return response.json({
      status: 'succeeded',
      receipt: {
        receiptNumber: session.id,
        amountCents: session.amount_total || 0,
        currency: (session.currency || 'usd').toUpperCase(),
        campaignId: metadata.campaign_id || '',
        campaignTitle: metadata.campaign_title || 'Community donation',
        donorName: session.customer_details?.name || metadata.donor_name || 'Donor',
        donorEmail: session.customer_details?.email || metadata.donor_email || '',
        paidAt: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
      },
    })
  } catch {
    return response.status(404).json({ error: 'Checkout session was not found.' })
  }
})

app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (request, response) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return response.status(503).send('Webhook is not configured.')
  let event
  try {
    const signature = request.headers['stripe-signature']
    event = stripe.webhooks.constructEvent(request.body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    return response.status(400).send(`Webhook signature verification failed: ${error.message}`)
  }

  try {
    const store = await readStore()
    if (store.processedEvents.includes(event.id)) return response.json({ received: true, duplicate: true })

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object
      const metadata = session.metadata || {}
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      const cardSummary = await cardSummaryFromPaymentIntent(paymentIntentId)
      await upsertDonation({
        id: session.id,
        checkoutSessionId: session.id,
        paymentIntentId: paymentIntentId || null,
        status: session.payment_status === 'paid' ? 'succeeded' : 'pending',
        amountCents: session.amount_total || 0,
        currency: (session.currency || 'usd').toUpperCase(),
        campaignId: metadata.campaign_id || 'unknown',
        campaignTitle: metadata.campaign_title || 'Donation',
        donorName: session.customer_details?.name || metadata.donor_name || 'Donor',
        donorEmail: session.customer_details?.email || metadata.donor_email || '',
        cardBrand: cardSummary.cardBrand || null,
        cardLast4: cardSummary.cardLast4 || null,
        failureReason: null,
        createdAt: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
      })
    } else if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object
      const metadata = session.metadata || {}
      await upsertDonation({
        id: session.id,
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
        status: 'failed',
        amountCents: session.amount_total || 0,
        currency: (session.currency || 'usd').toUpperCase(),
        campaignId: metadata.campaign_id || 'unknown',
        campaignTitle: metadata.campaign_title || 'Donation',
        donorName: session.customer_details?.name || metadata.donor_name || 'Donor',
        donorEmail: session.customer_details?.email || metadata.donor_email || '',
        failureReason: 'The asynchronous payment did not complete.',
        createdAt: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
      })
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object
      const metadata = intent.metadata || {}
      const paymentMethodId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id
      let cardSummary = {}
      if (paymentMethodId) {
        try {
          const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
          if (paymentMethod.type === 'card' && paymentMethod.card) {
            cardSummary = { cardBrand: paymentMethod.card.brand, cardLast4: paymentMethod.card.last4 }
          }
        } catch { /* Stripe may not return details for a failed method. */ }
      }
      await upsertDonation({
        id: intent.id,
        paymentIntentId: intent.id,
        status: 'failed',
        amountCents: intent.amount || 0,
        currency: (intent.currency || 'usd').toUpperCase(),
        campaignId: metadata.campaign_id || 'unknown',
        campaignTitle: metadata.campaign_title || 'Donation',
        donorName: metadata.donor_name || 'Donor',
        donorEmail: metadata.donor_email || '',
        ...cardSummary,
        failureReason: (intent.last_payment_error?.message || 'Payment was not completed.').slice(0, 240),
        createdAt: new Date((intent.created || Date.now() / 1000) * 1000).toISOString(),
      })
    }

    await updateStore((current) => {
      current.processedEvents.push(event.id)
      current.processedEvents = current.processedEvents.slice(-5000)
    })
    return response.json({ received: true })
  } catch (error) {
    console.error('Stripe webhook processing failed:', error.message)
    return response.status(500).send('Webhook processing failed.')
  }
})

app.use(express.json({ limit: '16kb' }))

app.post('/api/admin/login', loginLimiter, (request, response) => {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) {
    return response.status(503).json({ error: 'Admin access is not configured on the server.' })
  }
  const username = typeof request.body?.username === 'string' ? request.body.username : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  if (!equalSecret(username, process.env.ADMIN_USERNAME) || !equalSecret(password, process.env.ADMIN_PASSWORD)) {
    return response.status(401).json({ error: 'Incorrect username or password.' })
  }
  response.setHeader('Set-Cookie', makeSessionCookie())
  return response.json({ authenticated: true })
})

app.post('/api/admin/logout', (_request, response) => {
  response.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProduction ? '; Secure' : ''}`)
  return response.json({ authenticated: false })
})

app.get('/api/admin/session', (request, response) => response.json({ authenticated: hasAdminSession(request) }))

app.get('/api/admin/donations', requireAdmin, async (_request, response) => {
  try {
    const store = await readStore()
    const donations = store.donations
      .map(safeDonationDetails)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return response.json({ donations })
  } catch (error) {
    console.error('Donation records could not be read:', error.message)
    return response.status(500).json({ error: 'Donation records are temporarily unavailable.' })
  }
})

if (isProduction) {
  const distDirectory = path.resolve(here, '..', 'dist')
  app.use(express.static(distDirectory, { index: false }))
  app.get('*path', (_request, response) => response.sendFile(path.join(distDirectory, 'index.html')))
}

app.listen(port, () => {
  console.log(`Donation server listening on http://localhost:${port}`)
  if (!stripe) console.warn('Stripe is not configured. Checkout endpoints will return 503 until STRIPE_SECRET_KEY is set.')
})
