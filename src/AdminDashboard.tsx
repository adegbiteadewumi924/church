import { useEffect, useState, type FormEvent } from 'react'
import './AdminDashboard.css'

type DonationRecord = {
  id: string
  status: 'succeeded' | 'failed' | 'pending' | string
  amountCents: number
  currency: string
  campaignTitle: string
  donorName: string
  donorEmail: string
  createdAt: string
  cardBrand: string | null
  cardLast4: string | null
  failureReason: string | null
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountCents / 100)
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
}

function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [records, setRecords] = useState<DonationRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')

  async function loadRecords() {
    setLoadingRecords(true)
    setError('')
    try {
      const response = await fetch('/api/admin/donations', { credentials: 'same-origin' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load donation records.')
      setRecords(result.donations)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load donation records.')
    } finally {
      setLoadingRecords(false)
    }
  }

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch('/api/admin/session', { credentials: 'same-origin' })
        const result = await response.json()
        setAuthenticated(Boolean(result.authenticated))
        if (result.authenticated) await loadRecords()
      } catch {
        setError('The admin service is unavailable. Start the application server and try again.')
      } finally {
        setCheckingSession(false)
      }
    }
    void checkSession()
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Sign-in failed.')
      setPassword('')
      setAuthenticated(true)
      await loadRecords()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.')
    }
  }

  async function signOut() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthenticated(false)
    setRecords([])
  }

  const visibleRecords = filter === 'all' ? records : records.filter((record) => record.status === filter)
  const succeeded = records.filter((record) => record.status === 'succeeded')
  const failed = records.filter((record) => record.status === 'failed')
  const totalRaised = succeeded.reduce((sum, record) => sum + record.amountCents, 0)

  if (checkingSession) {
    return <main className="admin-page"><p className="admin-loading">Checking admin session…</p></main>
  }

  if (!authenticated) {
    return (
      <main className="admin-page admin-login-page">
        <a className="admin-back" href="/">← Back to site</a>
        <section className="admin-login-panel">
          <p className="admin-eyebrow">Donation management</p>
          <h1>Admin sign in</h1>
          <p>Sign in to view donation status and campaign activity.</p>
          <form onSubmit={signIn}>
            <label htmlFor="admin-username">Username</label>
            <input id="admin-username" type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
            <label htmlFor="admin-password">Admin password</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button type="submit">Sign in <span aria-hidden="true">→</span></button>
          </form>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <small>Access is configured by the site administrator.</small>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <a className="admin-back" href="/">← Public site</a>
        <div><p className="admin-eyebrow">Giving overview</p><h1>Donations</h1></div>
        <div className="admin-header-actions"><button type="button" onClick={() => void loadRecords()} disabled={loadingRecords}>{loadingRecords ? 'Refreshing…' : 'Refresh'}</button><button type="button" className="admin-signout" onClick={() => void signOut()}>Sign out</button></div>
      </header>
      <section className="admin-summary" aria-label="Donation summary">
        <article><span>Successful total</span><strong>{formatMoney(totalRaised, 'USD')}</strong></article>
        <article><span>Successful donations</span><strong>{succeeded.length}</strong></article>
        <article><span>Failed payments</span><strong>{failed.length}</strong></article>
        <article><span>All records</span><strong>{records.length}</strong></article>
      </section>
      <section className="admin-records">
        <div className="admin-records-heading"><div><p className="admin-eyebrow">Payment activity</p><h2>Donation records</h2></div><label htmlFor="status-filter">Status<select id="status-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="succeeded">Successful</option><option value="failed">Failed</option><option value="pending">Pending</option></select></label></div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Donor</th><th>Campaign</th><th>Amount</th><th>Payment method</th><th>Date</th></tr></thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id}>
                  <td><span className={`payment-status status-${record.status}`}>{record.status}</span>{record.failureReason && <small className="failure-reason">{record.failureReason}</small>}</td>
                  <td><strong>{record.donorName}</strong><small>{record.donorEmail}</small></td>
                  <td>{record.campaignTitle}</td>
                  <td>{formatMoney(record.amountCents, record.currency)}</td>
                  <td>{record.cardBrand && record.cardLast4 ? `${record.cardBrand} ···· ${record.cardLast4}` : 'Card details unavailable'}</td>
                  <td>{formatDate(record.createdAt)}</td>
                </tr>
              ))}
              {!visibleRecords.length && <tr><td className="admin-empty" colSpan={6}>{loadingRecords ? 'Loading donation records…' : 'No donation records match this filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="admin-privacy-note">Card numbers and security codes are never stored or displayed. Only Stripe-provided card brand and last four digits may appear.</p>
      </section>
    </main>
  )
}

export default AdminDashboard
