import { useEffect, useState, type FormEvent } from 'react'
import AdminDashboard from './AdminDashboard'
import { donationCampaigns, type DonationCampaignId } from './campaigns'
import './App.css'

type DonationReceipt = {
  receiptNumber: string
  amountCents: number
  currency: string
  campaignId: string
  campaignTitle: string
  donorName: string
  donorEmail: string
  paidAt: string
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResult, setSearchResult] = useState('')
  const [place, setPlace] = useState('')
  const [searchedPlace, setSearchedPlace] = useState('')
  const [openQuestion, setOpenQuestion] = useState<number | null>(0)
  const [selectedCampaign, setSelectedCampaign] = useState<DonationCampaignId>(donationCampaigns[0].id)
  const [donationAmount, setDonationAmount] = useState('25')
  const [donorName, setDonorName] = useState('')
  const [donorEmail, setDonorEmail] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [donationReceipt, setDonationReceipt] = useState<DonationReceipt | null>(null)
  const [donationMessage, setDonationMessage] = useState(() => (
    new URLSearchParams(window.location.search).get('donation') === 'cancel'
      ? 'Checkout was canceled. No donation was completed.'
      : ''
  ))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (params.get('donation') === 'cancel') return
    if (!sessionId) return

    fetch(`/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        const result = await response.json()
        if (response.ok && result.status === 'succeeded' && result.receipt) {
          setDonationReceipt(result.receipt)
          setDonationMessage('')
          return
        }
        setDonationMessage(result.status === 'failed'
          ? 'This payment did not complete. No receipt was generated.'
          : 'Your payment is being confirmed. A receipt will appear here once Stripe confirms payment.')
      })
      .catch(() => setDonationMessage('Payment status could not be confirmed yet. Refresh this page shortly to check for your receipt.'))
  }, [])

  async function startDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDonationMessage('')
    setCheckoutBusy(true)
    try {
      const response = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaign,
          amount: Number(donationAmount),
          donorName: donorName.trim(),
          donorEmail: donorEmail.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Checkout could not be started.')
      window.location.assign(result.url)
    } catch (error) {
      setDonationMessage(error instanceof Error ? error.message : 'Checkout could not be started.')
      setCheckoutBusy(false)
    }
  }

  const questions = [
    {
      question: 'Are Latter-day Saints Christian?',
      answer:
        'Yes. Our faith centers on Jesus Christ as the Son of God and Savior. We seek to follow His teachings, trust in His grace, and share His love through the way we live.',
    },
    {
      question: 'What happens at a Sunday service?',
      answer:
        'The main worship meeting includes hymns, prayers, short messages from congregation members, and the sacrament. It is followed by smaller classes for different ages and interests. Visitors are welcome to participate or simply listen.',
    },
    {
      question: 'Why are temples important?',
      answer:
        'Temples are dedicated places for worship, reflection, and sacred promises with God. Members also take part in ceremonies connecting families across generations.',
    },
    {
      question: 'What is the Book of Mormon?',
      answer:
        'It is a volume of scripture that teaches about God and Jesus Christ. Latter-day Saints study it alongside the Bible as another witness of the Savior.',
    },
    {
      question: 'Do Latter-day Saints believe in the Bible?',
      answer:
        'Yes. We revere the Bible as scripture and as a record of God’s dealings with His people. We study it with other scripture to learn about Jesus Christ.',
    },
  ]

  if (window.location.pathname === '/admin') return <AdminDashboard />

  return (
    <div className="site-shell">
      <a className="announcement" href="#stories"><span>FEATURED</span> New messages and stories for the season <b aria-hidden="true">→</b></a>
      <div className="utility-bar">
        <span>FAITH · SERVICE · COMMUNITY</span>
        <div><a href="#visit">Find a gathering</a><a href="#stories">Stories</a><button type="button" onClick={() => setSearchOpen(!searchOpen)} aria-expanded={searchOpen} aria-label={searchOpen ? 'Close search' : 'Open search'}>{searchOpen ? 'Close' : 'Search'} <span aria-hidden="true">⌕</span></button><a href="#visit">English</a></div>
      </div>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="The Church of Jesus Christ of Latter-day Saints, unofficial design concept">
          <img className="brand-logo" src="/images/church-symbol.png" alt="" />
          <span className="brand-name">The Church of Jesus Christ<small>of Latter-day Saints</small></span>
        </a>
        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span /><span />
        </button>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
          <a href="#discover" onClick={() => setMenuOpen(false)}>Home</a>
          <a href="#beliefs" onClick={() => setMenuOpen(false)}>Learn</a>
          <a href="#donations" onClick={() => setMenuOpen(false)}>Give</a>
          <a href="#serve" onClick={() => setMenuOpen(false)}>Serve</a>
          <a href="#stories" onClick={() => setMenuOpen(false)}>News</a>
          <a href="#questions" onClick={() => setMenuOpen(false)}>About Us</a>
          <a className="nav-cta" href="/admin" onClick={() => setMenuOpen(false)}>Sign in <span aria-hidden="true">→</span></a>
        </nav>
      </header>

      {searchOpen && <form className="site-search" onSubmit={(event) => { event.preventDefault(); setSearchResult(searchTerm.trim()) }}><label htmlFor="site-search">Search this site</label><div><input id="site-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search messages, beliefs, and stories" /><button type="submit" aria-label="Submit search">→</button></div>{searchResult && <p role="status">Showing topics related to “{searchResult}” across beliefs, gatherings, and stories.</p>}</form>}

      <main id="top">
        {donationReceipt && <section className="receipt-section" aria-labelledby="receipt-title">
          <div className="receipt-card">
            <p className="eyebrow">Payment confirmed</p>
            <h1 id="receipt-title">Thank you for your donation.</h1>
            <p className="receipt-intro">Your payment was successful. This receipt is also sent to your email by Stripe when receipt emails are enabled for the account.</p>
            <dl className="receipt-details">
              <div><dt>Receipt</dt><dd>{donationReceipt.receiptNumber}</dd></div>
              <div><dt>Campaign</dt><dd>{donationReceipt.campaignTitle}</dd></div>
              <div><dt>Donor</dt><dd>{donationReceipt.donorName}</dd></div>
              <div><dt>Email</dt><dd>{donationReceipt.donorEmail}</dd></div>
              <div><dt>Date</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(donationReceipt.paidAt))}</dd></div>
              <div><dt>Amount paid</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: donationReceipt.currency }).format(donationReceipt.amountCents / 100)}</dd></div>
            </dl>
            <button className="button button-dark receipt-print" type="button" onClick={() => window.print()}>Print or save receipt <span aria-hidden="true">↓</span></button>
          </div>
        </section>}
        <section className="hero" aria-labelledby="hero-title" id="discover">
          <div className="hero-copy">
            <p className="eyebrow">October 2026 · Words to reflect on</p>
            <h1 id="hero-title">Messages for<br />a life of <em>faith.</em></h1>
            <p className="hero-intro">Listen to thoughtful messages about following Jesus Christ, finding peace, and serving the people around us.</p>
            <a className="button button-light" href="#stories">Watch and listen <span aria-hidden="true">→</span></a>
          </div>
          <img className="hero-image" src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1600&q=90" alt="A group of friends sharing a moment together outdoors" />
        </section>

        <section className="spotlight temple-section" aria-labelledby="spotlight-title">
          <div className="section-heading"><p className="eyebrow">Sacred places · Shared stories</p><h2 id="spotlight-title">A closer look at <em>temples.</em></h2></div>
          <div className="temple-grid">
            <a className="temple-card" href="#visit"><img src="https://images.unsplash.com/photo-1438032005730-c779502df39b?auto=format&fit=crop&w=900&q=85" alt="A quiet chapel filled with soft natural light" /><span>Visit</span><h3>Plan a meaningful visit</h3><b aria-hidden="true">→</b></a>
            <a className="temple-card" href="#stories"><img src="https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=900&q=85" alt="Sunlit architecture surrounded by open sky" /><span>Discover</span><h3>Stories of sacred places</h3><b aria-hidden="true">→</b></a>
            <a className="temple-card" href="#beliefs"><img src="https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=900&q=85" alt="Morning light falling across a peaceful landscape" /><span>Learn</span><h3>Why reflection matters</h3><b aria-hidden="true">→</b></a>
          </div>
        </section>

        <section className="visit-section" id="visit">
          <div className="visit-image" role="img" aria-label="People welcoming visitors at a community gathering" />
          <div className="visit-copy">
            <p className="eyebrow">All are welcome</p>
            <h2>Visit a church<br />near you.</h2>
            <p>Worship with a local congregation and meet people in your community. Find a time and place that works for you.</p>
            <form className="location-form" onSubmit={(event) => { event.preventDefault(); setSearchedPlace(place.trim()) }}>
              <label htmlFor="location">City, state, or postal code</label>
              <div className="location-control"><input id="location" value={place} onChange={(event) => setPlace(event.target.value)} placeholder="Enter a location" /><button type="submit" aria-label="Search nearby gatherings">→</button></div>
              {searchedPlace && <p className="search-result" role="status">We'd love to welcome you in {searchedPlace}. A local gathering is just around the corner.</p>}
            </form>
          </div>
        </section>

        <section className="donations-section" id="donations">
          <div className="donations-heading">
            <div><p className="eyebrow">Give with purpose</p><h2>Choose a cause<br />close to your heart.</h2></div>
            <p>Select a community program, choose an amount, and continue to secure Stripe checkout. Every campaign is grounded in a call to serve.</p>
          </div>
          <div className="campaign-grid" role="group" aria-label="Donation campaigns">
            {donationCampaigns.map((campaign) => (
              <article className={selectedCampaign === campaign.id ? 'campaign-card is-selected' : 'campaign-card'} key={campaign.id}>
                <button className="campaign-select" type="button" aria-pressed={selectedCampaign === campaign.id} onClick={() => setSelectedCampaign(campaign.id)}>
                  <img src={campaign.image} alt={campaign.imageAlt} />
                  <span className="campaign-card-copy"><strong>{campaign.title}</strong><span>{campaign.description}</span><em>{campaign.verse}<small>{campaign.reference}</small></em></span>
                  <span className="campaign-check" aria-hidden="true">{selectedCampaign === campaign.id ? '✓' : '+'}</span>
                </button>
              </article>
            ))}
          </div>
          <form className="donation-form" onSubmit={startDonation}>
            <div className="donation-form-heading"><p className="eyebrow">Make a donation</p><p>Choose an amount and provide contact details for the payment record.</p></div>
            <div className="donation-fields">
              <label>Amount (USD)<span className="amount-input"><span>$</span><input type="number" min="1" max="10000" step="1" value={donationAmount} onChange={(event) => setDonationAmount(event.target.value)} required /></span></label>
              <label htmlFor="donor-name">Name<input id="donor-name" autoComplete="name" value={donorName} onChange={(event) => setDonorName(event.target.value)} required /></label>
              <label htmlFor="donor-email">Email<input id="donor-email" type="email" autoComplete="email" value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} required /></label>
              <button className="button button-dark donate-submit" type="submit" disabled={checkoutBusy}>{checkoutBusy ? 'Connecting to Stripe…' : 'Continue to secure checkout'} <span aria-hidden="true">→</span></button>
            </div>
            <p className="donation-safety">Payments are processed by Stripe Checkout. Full card numbers and security codes are never stored on this site.</p>
            {donationMessage && <p className="donation-message" role="status">{donationMessage}</p>}
          </form>
        </section>

        <section className="beliefs-section" id="beliefs">
          <div className="section-heading"><p className="eyebrow">A foundation for a hopeful life</p><h2>What gives us <em>hope.</em></h2></div>
          <div className="beliefs-grid">
            <a href="#questions"><span className="belief-number">01</span><h3>Jesus Christ</h3><p>His life and teachings offer a way to love more deeply and meet life's hard moments with courage.</p><span className="belief-link">Learn about Jesus <b aria-hidden="true">→</b></span></a>
            <a href="#questions"><span className="belief-number">02</span><h3>A life with purpose</h3><p>We believe every person has worth, and that growth, connection, and a sense of purpose are possible.</p><span className="belief-link">Explore life's meaning <b aria-hidden="true">→</b></span></a>
            <a href="#questions"><span className="belief-number">03</span><h3>Strength through faith</h3><p>Faith can steady us through change and help us find the next good step, even when the way feels uncertain.</p><span className="belief-link">Find a place to begin <b aria-hidden="true">→</b></span></a>
          </div>
        </section>

        <section className="questions-section" id="questions">
          <div className="questions-intro"><p className="eyebrow">A few common questions</p><h2>Curious about<br />what we believe?</h2><p>Explore thoughtful answers to questions about Jesus Christ, worship, scripture, and faith.</p><a href="#beliefs" className="text-link">Explore our beliefs <span aria-hidden="true">→</span></a></div>
          <div className="question-list">
            {questions.map((item, index) => (
              <div className={openQuestion === index ? 'question is-open' : 'question'} key={item.question}>
                <button type="button" aria-expanded={openQuestion === index} onClick={() => setOpenQuestion(openQuestion === index ? null : index)}>
                  <span>{item.question}</span><span className="question-icon" aria-hidden="true">{openQuestion === index ? '−' : '+'}</span>
                </button>
                {openQuestion === index && <p>{item.answer}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="missionary-section">
          <img src="https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1100&q=85" alt="Two friends meeting with a couple for a welcoming conversation" />
          <div><p className="eyebrow">Have a question?</p><h2>Let's talk about<br />what matters to you.</h2><p>Meet with a local volunteer or start with a simple online conversation. Ask what you like, at your own pace.</p><a className="button button-dark" href="#visit">Request a conversation <span aria-hidden="true">→</span></a></div>
        </section>

        <section className="quote-section" aria-labelledby="perfect-example-title">
          <div className="quote-copy">
            <h2 id="perfect-example-title">Jesus Christ, Our Perfect Example</h2>
            <blockquote>“We need to love and do good to all. We need to avoid contention and be peacemakers in all our communications. This does not mean to compromise our principles and priorities, but to cease harshly attacking others for theirs. That is what our Perfect Role Model did in His ministry. That is the example He set for us, as He invited us to follow Him.”</blockquote>
            <a className="quote-attribution" href="https://www.churchofjesuschrist.org/learn/people/dallin-h-oaks/life-leadership?lang=eng" target="_blank" rel="noreferrer">
              <img src="https://www.churchofjesuschrist.org/imgs/c097fed24e358c5ae20f15601edc7b1b7f0f05c1/full/!64,/0/default" alt="President Dallin H. Oaks" />
              <span><strong>President Dallin H. Oaks</strong><small>Prophet and president of The Church of Jesus Christ of Latter-day Saints</small></span>
            </a>
          </div>
        </section>

        <section className="community-section" id="stories">
          <div className="community-heading">
            <div><p className="eyebrow">A community centered on Christ</p><h2>Faith is something<br />we live <em>together.</em></h2></div>
            <p>Come worship, learn, and find ways to care for the people around you. Everyone is welcome to take part.</p>
          </div>
          <div className="community-grid">
            <a className="community-item item-large" href="#visit" id="serve">
              <img src="https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1100&q=85" alt="People greeting each other at a church gathering" />
              <div className="item-overlay"><span>Gather</span><h3>What to expect at church</h3><span className="item-arrow" aria-hidden="true">↗</span></div>
            </a>
            <a className="community-item" href="#beliefs">
              <img src="https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=900&q=85" alt="A person quietly reading and reflecting" />
              <div className="item-overlay"><span>Believe</span><h3>Learn about Jesus Christ</h3><span className="item-arrow" aria-hidden="true">↗</span></div>
            </a>
            <a className="community-item" href="#serve">
              <img src="https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?auto=format&fit=crop&w=900&q=85" alt="Neighbors volunteering side by side" />
              <div className="item-overlay"><span>Serve</span><h3>Make a difference nearby</h3><span className="item-arrow" aria-hidden="true">↗</span></div>
            </a>
          </div>
        </section>

        <section className="news-section">
          <img src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1100&q=85" alt="Community members sharing a conversation" />
          <div><p className="eyebrow">News from our community</p><h2>Good things are<br />happening nearby.</h2><p>Read about local service, community events, and people finding practical ways to care for one another.</p><a className="text-link" href="#stories">Read community news <span aria-hidden="true">→</span></a></div>
        </section>

        <section className="community-callout">
          <p className="eyebrow">Take the next step</p><h2>You don't have to<br />figure it out alone.</h2><p>Meet a neighbor, ask a question, or simply come sit with us. A warm welcome is waiting.</p><a className="button button-dark" href="#visit">Find your community <span aria-hidden="true">→</span></a>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#top"><img className="brand-logo" src="/images/church-symbol.png" alt="" /><span className="brand-name">The Church of Jesus Christ<small>of Latter-day Saints</small></span></a>
        <div className="footer-links"><a href="#beliefs">Our beliefs</a><a href="#donations">Give</a><a href="#visit">Find a gathering</a><a href="#stories">Community stories</a><a href="#questions">About this concept</a><a href="/admin">Donation admin</a></div>
        <a className="footer-top" href="#top">Back to top ↑</a>
        <small className="footer-note"> The lord is great.</small>
      </footer>
    </div>
  )
}

export default App
