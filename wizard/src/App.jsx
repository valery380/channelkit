import React, { useState, useRef, useEffect, useCallback } from 'react';

const CHANNELS = [
  { id: 'whatsapp', name: 'WhatsApp', icon: '💬', setup: 'qr' },
  { id: 'telegram', name: 'Telegram', icon: '✈️', setup: 'token', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
  { id: 'gmail', name: 'Gmail', icon: '📧', setup: 'oauth' },
  { id: 'resend', name: 'Resend', icon: '📨', setup: 'token', label: 'API Key', placeholder: 're_...' },
  { id: 'twilio-sms', name: 'Twilio SMS', icon: '📱', setup: 'token', label: 'Account SID', placeholder: 'AC...' },
  { id: 'twilio-voice', name: 'Twilio Voice', icon: '📞', setup: 'token', label: 'Account SID', placeholder: 'AC...' },
];

const WA_MESSAGES = [
  { from: '+1 555-0123', text: 'Hey! Is this thing working?' },
  { from: '+44 7700-9001', text: 'Can you send me the report? 📎' },
  { from: '+1 555-0456', text: 'Meeting at 3pm confirmed ✅' },
  { from: '+972 50-123-4567', text: 'Got it, thanks! 🙏' },
  { from: '+1 555-0789', text: 'Just saw your message 👀' },
  { from: '+44 7700-9002', text: 'Sounds good, let me know 🚀' },
];

const FAKE_NUMBERS = [
  { flag: '🇺🇸', number: '+1 (555) 012-3456', country: 'United States', price: '$1.00/mo' },
  { flag: '🇬🇧', number: '+44 7700 900123', country: 'United Kingdom', price: '$1.00/mo' },
  { flag: '🇮🇱', number: '+972 50-123-4567', country: 'Israel', price: '$2.00/mo' },
  { flag: '🇩🇪', number: '+49 170 1234567', country: 'Germany', price: '$1.50/mo' },
  { flag: '🇨🇦', number: '+1 (604) 555-0199', country: 'Canada', price: '$1.00/mo' },
  { flag: '🇦🇺', number: '+61 412 345 678', country: 'Australia', price: '$2.50/mo' },
];

function timeStr() {
  const d = new Date();
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Progress Bar ──
function Progress({ step }) {
  return (
    <div className="progress">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={`progress-step ${i < step ? 'done' : i === step ? 'active' : ''}`} />
      ))}
    </div>
  );
}

// ── Live Message View ──
function LiveView({ messages, onSimulate, title, waStyle }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className={`live-view ${waStyle ? 'wa-live-view' : ''}`}>
      <div className="live-header">
        <span><span className={`live-dot ${waStyle ? 'wa-dot' : ''}`} />{title || 'Live Messages'}</span>
        {onSimulate && <button className={`sim-btn ${waStyle ? 'wa-sim-btn' : ''}`} onClick={onSimulate}>⚡ Simulate Message</button>}
      </div>
      <div className="live-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="live-empty">Waiting for messages…</div>
        ) : messages.map((m, i) => (
          <div className="msg-row" key={i}>
            <span className="msg-time">{m.time}</span>
            {m.waIcon && <span className="msg-wa-icon">💬</span>}
            <span className={`msg-from ${waStyle ? 'wa-from' : ''}`}>{m.from}</span>
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Request/Response View ──
function RequestView({ requests }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [requests]);

  return (
    <div className="live-view">
      <div className="live-header">
        <span><span className="live-dot" />Endpoint Log</span>
      </div>
      <div className="live-body" ref={bodyRef}>
        {requests.length === 0 ? (
          <div className="live-empty">Waiting for requests…</div>
        ) : requests.map((r, i) => (
          <div className="req-row" key={i}>
            <span className="msg-time">{r.time}</span>
            <span className="msg-text" style={{ flex: 1 }}>{r.text}</span>
            <span className={`req-status ${r.status < 400 ? 'ok' : 'err'}`}>{r.status}</span>
            <span className="msg-time">{r.ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── QR Code SVG ──
function QRCode({ pulsing }) {
  const size = 200;
  const modules = 25;
  const cellSize = size / modules;
  const cells = useRef(null);
  if (!cells.current) {
    const grid = [];
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        const inFinder = (r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7);
        if (inFinder) {
          const lr = r < 7 ? r : r - (modules - 7);
          const lc = c < 7 ? c : c - (modules - 7);
          const border = lr === 0 || lr === 6 || lc === 0 || lc === 6;
          const inner = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
          if (border || inner) grid.push({ r, c });
        } else {
          if (Math.random() > 0.5) grid.push({ r, c });
        }
      }
    }
    cells.current = grid;
  }

  return (
    <div className={`qr-container ${pulsing ? 'qr-pulsing' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect width={size} height={size} fill="white" rx="4" />
        {cells.current.map(({ r, c }, i) => (
          <rect key={i} x={c * cellSize} y={r * cellSize} width={cellSize} height={cellSize} fill="#000" />
        ))}
      </svg>
    </div>
  );
}

// ── WhatsApp Sub-Flow Screens ──

function WAWelcome({ onContinue }) {
  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">💬</div>
      <h1>Welcome to WhatsApp</h1>
      <p className="subtitle">
        ChannelKit connects to WhatsApp using <strong>Baileys</strong> — a popular open-source library that works just like WhatsApp Web.
      </p>
      <div className="wa-info-card">
        <span className="wa-info-icon">🌍</span>
        <span>Baileys is used by thousands of developers worldwide to build WhatsApp integrations.</span>
      </div>
      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 32 }}>
        <button className="btn btn-wa btn-lg" onClick={onContinue}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function WAInstalling({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Preparing installation...');

  useEffect(() => {
    const steps = [
      { at: 300, p: 15, s: 'Resolving @whiskeysockets/baileys...' },
      { at: 800, p: 30, s: 'Downloading baileys@6.7.16...' },
      { at: 1400, p: 50, s: 'Installing dependencies...' },
      { at: 2000, p: 70, s: 'Linking native modules...' },
      { at: 2500, p: 85, s: 'Building auth store...' },
      { at: 2900, p: 95, s: 'Finalizing...' },
      { at: 3200, p: 100, s: 'Done! ✅' },
    ];
    const timers = steps.map(({ at, p, s }) =>
      setTimeout(() => { setProgress(p); setStatus(s); }, at)
    );
    const done = setTimeout(onDone, 3600);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [onDone]);

  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📦</div>
      <h1>Installing Baileys</h1>
      <p className="subtitle">Setting up the WhatsApp connection library...</p>
      <div className="wa-progress-container">
        <div className="wa-progress-bar">
          <div className="wa-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="wa-progress-status">{status}</div>
        <div className="wa-progress-pct">{progress}%</div>
      </div>
    </div>
  );
}

function WAChooseNumber({ onChoose, onTwilio }) {
  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📱</div>
      <h1>Choose Your Number</h1>
      <p className="subtitle">Which phone number would you like to connect?</p>
      <div className="wa-info-card" style={{ marginBottom: 24 }}>
        <span className="wa-info-icon">🔗</span>
        <span>The connection works just like WhatsApp Web — your phone stays connected and messages are mirrored here.</span>
      </div>

      <div className="wa-number-options">
        <div className="wa-number-card" onClick={() => onChoose('personal')}>
          <span className="wa-number-icon">👤</span>
          <div>
            <h3>Use my personal number</h3>
            <p>Quick setup — use your existing WhatsApp</p>
          </div>
        </div>
        <div className="wa-number-card" onClick={() => onChoose('dedicated')}>
          <span className="wa-number-icon">🏢</span>
          <div>
            <h3>I have a dedicated number</h3>
            <p>A separate number just for this integration</p>
          </div>
        </div>
        <div className="wa-number-card wa-number-card-alt" onClick={onTwilio}>
          <span className="wa-number-icon">🆕</span>
          <div>
            <h3>I need to get a number</h3>
            <p>Purchase a new number via Twilio or set one up manually</p>
          </div>
        </div>
      </div>

      <div className="wa-tip">
        💡 <strong>Tip:</strong> Consider using a dedicated number for production use.
      </div>
    </div>
  );
}

// ── Twilio Sub-Flow Screens ──

function TwilioChoice({ onManual, onIntegration, onBack }) {
  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📱</div>
      <h1>Get a Dedicated Number</h1>
      <p className="subtitle">Choose how you'd like to get a phone number for WhatsApp:</p>

      <div className="wa-twilio-card">
        <h3>🛒 Buy a number yourself</h3>
        <p>Get a SIM card or buy a number from Twilio manually, register WhatsApp on it, then come back to connect.</p>
        <button className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={onManual}>Show me how →</button>
      </div>

      <div className="wa-twilio-card" style={{ marginTop: '1rem' }}>
        <h3>⚡ Use the Twilio integration</h3>
        <p>ChannelKit has a built-in Twilio integration that can purchase a number and help with WhatsApp registration — all running locally on your machine.</p>
        <ul>
          <li>Numbers start at ~$1/month</li>
          <li>Available in 100+ countries</li>
          <li>SMS + Voice capable</li>
        </ul>
        <button className="btn btn-wa" style={{ marginTop: '0.75rem' }} onClick={onIntegration}>Connect Twilio account →</button>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back to options</button>
      </div>
    </div>
  );
}

function TwilioGuide({ onDone, onBack }) {
  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📖</div>
      <h1>Buy a Number — Step by Step</h1>
      <div className="wa-twilio-card">
        <div className="wa-guide-steps">
          <div className="wa-guide-step">
            <span className="wa-guide-num">1</span>
            <div>
              <strong>Create a Twilio account</strong>
              <p>Go to <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" className="wa-link">twilio.com/try-twilio</a> and sign up (free trial available)</p>
            </div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">2</span>
            <div>
              <strong>Buy a mobile number that supports SMS</strong>
              <p>In your Twilio Console, navigate to Phone Numbers → Buy a Number. <strong>Important:</strong> WhatsApp won't work with landline numbers — make sure to pick a mobile number!</p>
            </div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">3</span>
            <div>
              <strong>Register WhatsApp on a phone</strong>
              <p>Install WhatsApp and register using the new number. You'll need to receive an SMS or call from WhatsApp for verification.</p>
            </div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">4</span>
            <div>
              <strong>Come back here</strong>
              <p>Once WhatsApp is set up and working on the new number, come back to link it to ChannelKit via QR code.</p>
            </div>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onBack}>← Back</button>
          <button className="btn btn-wa" onClick={onDone}>I've set up WhatsApp, let's connect →</button>
        </div>
      </div>
    </div>
  );
}

function TwilioCredentials({ onConnect, onBack }) {
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = () => {
    setLoading(true);
    setTimeout(() => onConnect(), 2000);
  };

  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">🔑</div>
      <h1>Enter Twilio Credentials</h1>
      <p className="subtitle">
        Don't have a Twilio account? Go to <a href="https://www.twilio.com" target="_blank" rel="noopener noreferrer" className="wa-link">twilio.com</a>, sign up, add payment, then find your Account SID and Auth Token in the console.
      </p>

      <div className="twilio-form">
        <div className="input-group">
          <label>Account SID</label>
          <input type="text" placeholder="AC..." value={sid} onChange={e => setSid(e.target.value)} />
        </div>
        <div className="input-group">
          <label>Auth Token</label>
          <input type="text" placeholder="your auth token" value={token} onChange={e => setToken(e.target.value)} />
        </div>
      </div>

      <div className="wa-info-card">
        <span className="wa-info-icon">🔒</span>
        <span>Credentials are stored locally on your machine and used only to communicate with Twilio's API.</span>
      </div>

      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        {loading ? (
          <div className="wa-scanning">
            <div className="wa-scanning-spinner" />
            <span>Connecting to Twilio...</span>
          </div>
        ) : (
          <button className="btn btn-wa" onClick={handleConnect}>Connect to Twilio →</button>
        )}
      </div>
    </div>
  );
}

function TwilioPickNumber({ onPurchase, onBack }) {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const handlePurchase = () => {
    setLoading(true);
    setTimeout(() => onPurchase(FAKE_NUMBERS[selected]), 2000);
  };

  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">🔢</div>
      <h1>Choose a Phone Number</h1>
      <p className="subtitle">Select a number to purchase from Twilio:</p>

      <div className="twilio-number-list">
        {FAKE_NUMBERS.map((n, i) => (
          <div
            key={i}
            className={`twilio-number-card ${selected === i ? 'selected' : ''}`}
            onClick={() => setSelected(i)}
          >
            <span className="twilio-number-flag">{n.flag}</span>
            <div className="twilio-number-info">
              <span className="twilio-number-num">{n.number}</span>
              <span className="twilio-number-country">{n.country}</span>
            </div>
            <span className="twilio-number-price">{n.price}</span>
          </div>
        ))}
      </div>

      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        {loading ? (
          <div className="wa-scanning">
            <div className="wa-scanning-spinner" />
            <span>Purchasing number...</span>
          </div>
        ) : (
          <button className="btn btn-wa" disabled={selected === null} onClick={handlePurchase}>Purchase this number →</button>
        )}
      </div>
    </div>
  );
}

function TwilioSmsWatch({ purchasedNumber, onDone, onBack }) {
  const [smsReceived, setSmsReceived] = useState(false);
  const number = purchasedNumber?.number || '+1 (555) 012-3456';

  useEffect(() => {
    const timer = setTimeout(() => setSmsReceived(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📨</div>
      <h1>Waiting for SMS...</h1>
      <p className="subtitle">Register this number with WhatsApp and the verification code will appear here.</p>

      <div className="sms-inbox">
        <div className="sms-inbox-header">
          <span><span className="live-dot wa-dot" /> Listening for incoming SMS on <strong>{number}</strong></span>
        </div>
        <div className="sms-inbox-body">
          {!smsReceived ? (
            <div className="live-empty">Waiting for messages…</div>
          ) : (
            <div className="sms-message wa-fade-in">
              <div className="sms-message-header">
                <span className="sms-from">WhatsApp</span>
                <span className="sms-time">{timeStr()}</span>
              </div>
              <div className="sms-message-text">Your WhatsApp code is: <span className="sms-code">847-293</span>. Don't share this code.</div>
            </div>
          )}
        </div>
      </div>

      <div className="wa-twilio-card" style={{ marginTop: 20 }}>
        <h3>📱 Register this number with WhatsApp:</h3>
        <div className="wa-guide-steps" style={{ margin: '0.75rem 0 0' }}>
          <div className="wa-guide-step">
            <span className="wa-guide-num">1</span>
            <div><p style={{ margin: 0 }}>Install WhatsApp on a phone (or use an existing installation)</p></div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">2</span>
            <div><p style={{ margin: 0 }}>Start registration with the number above</p></div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">3</span>
            <div><p style={{ margin: 0 }}>Choose "Verify by SMS"</p></div>
          </div>
          <div className="wa-guide-step">
            <span className="wa-guide-num">4</span>
            <div><p style={{ margin: 0 }}>The verification code will appear here automatically</p></div>
          </div>
        </div>
      </div>

      {smsReceived && (
        <div className="wa-info-card wa-fade-in" style={{ marginTop: 16 }}>
          <span className="wa-info-icon">👆</span>
          <span>Enter the code <strong>847-293</strong> in WhatsApp to complete registration.</span>
        </div>
      )}

      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <button className="btn btn-wa" disabled={!smsReceived} onClick={onDone}>I've registered WhatsApp ✓</button>
      </div>
    </div>
  );
}

function TwilioWaRegister({ onDone, onBack }) {
  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon" style={{ fontSize: 64 }}>🎉</div>
      <h1>Almost there!</h1>
      <p className="subtitle">
        WhatsApp should now be active on your new number.<br />
        Confirm that you can see WhatsApp chats on your phone, then link it to ChannelKit.
      </p>

      <div className="wa-info-card">
        <span className="wa-info-icon">✅</span>
        <span>Make sure WhatsApp is fully set up and you can send/receive messages before continuing.</span>
      </div>

      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Back, I need to try again</button>
        <button className="btn btn-wa btn-lg" onClick={onDone}>WhatsApp is ready, let's link it →</button>
      </div>
    </div>
  );
}

function WAQRScan({ onScanned }) {
  const [scanning, setScanning] = useState(false);

  const handleSimulate = () => {
    setScanning(true);
    setTimeout(onScanned, 2000);
  };

  return (
    <div className="wa-screen wa-fade-in">
      <div className="wa-hero-icon">📷</div>
      <h1>Scan QR Code</h1>
      <p className="subtitle">Link your WhatsApp to ChannelKit</p>

      <QRCode pulsing={!scanning} />

      <div className="wa-qr-instructions">
        <div className="wa-qr-step">1. Open <strong>WhatsApp</strong> on your phone</div>
        <div className="wa-qr-step">2. Go to <strong>Settings → Linked Devices</strong></div>
        <div className="wa-qr-step">3. Tap <strong>Link a Device</strong></div>
        <div className="wa-qr-step">4. Point your camera at this QR code</div>
      </div>

      {!scanning ? (
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-wa" onClick={handleSimulate}>
            📱 Simulate Scan
          </button>
        </div>
      ) : (
        <div className="wa-scanning">
          <div className="wa-scanning-spinner" />
          <span>Connecting to WhatsApp...</span>
        </div>
      )}
    </div>
  );
}

function WAConnected({ onContinue }) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    setTimeout(() => setShowContent(true), 300);
    const auto = setTimeout(onContinue, 3000);
    return () => clearTimeout(auto);
  }, [onContinue]);

  return (
    <div className="wa-screen wa-fade-in">
      <div className={`wa-success-check ${showContent ? 'wa-success-visible' : ''}`}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="38" fill="none" stroke="#25D366" strokeWidth="3" className="wa-check-circle" />
          <path d="M24 42 L34 52 L56 30" fill="none" stroke="#25D366" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="wa-check-mark" />
        </svg>
      </div>
      <h1 className={`wa-connected-title ${showContent ? 'wa-success-visible' : ''}`}>
        WhatsApp Connected! 🎉
      </h1>
      <p className={`subtitle ${showContent ? 'wa-success-visible' : ''}`}>
        Successfully linked to <strong>+1 555-0123</strong>
      </p>
      <div className={`wa-connected-info ${showContent ? 'wa-success-visible' : ''}`}>
        Now let's see it in action...
      </div>
    </div>
  );
}

// ── Step 1: Choose Channel (with WhatsApp sub-flow) ──
function Step1({ channel, setChannel, onNext }) {
  const ch = CHANNELS.find(c => c.id === channel);
  const [token, setToken] = useState('');
  const [waStep, setWaStep] = useState(null);
  const [purchasedNumber, setPurchasedNumber] = useState(null);

  const handleChannelSelect = (id) => {
    setChannel(id);
    setWaStep(null);
  };

  const handleWhatsAppNext = () => {
    if (channel === 'whatsapp') {
      setWaStep('welcome');
    } else {
      onNext();
    }
  };

  // WhatsApp sub-flow rendering
  if (channel === 'whatsapp' && waStep) {
    switch (waStep) {
      case 'welcome':
        return <WAWelcome onContinue={() => setWaStep('install')} />;
      case 'install':
        return <WAInstalling onDone={() => setWaStep('number')} />;
      case 'number':
        return (
          <WAChooseNumber
            onChoose={() => setWaStep('qr')}
            onTwilio={() => setWaStep('twilio-choice')}
          />
        );
      case 'twilio-choice':
        return (
          <TwilioChoice
            onManual={() => setWaStep('twilio-guide')}
            onIntegration={() => setWaStep('twilio-credentials')}
            onBack={() => setWaStep('number')}
          />
        );
      case 'twilio-guide':
        return (
          <TwilioGuide
            onDone={() => setWaStep('qr')}
            onBack={() => setWaStep('twilio-choice')}
          />
        );
      case 'twilio-credentials':
        return (
          <TwilioCredentials
            onConnect={() => setWaStep('twilio-pick-number')}
            onBack={() => setWaStep('twilio-choice')}
          />
        );
      case 'twilio-pick-number':
        return (
          <TwilioPickNumber
            onPurchase={(num) => { setPurchasedNumber(num); setWaStep('twilio-sms-watch'); }}
            onBack={() => setWaStep('twilio-credentials')}
          />
        );
      case 'twilio-sms-watch':
        return (
          <TwilioSmsWatch
            purchasedNumber={purchasedNumber}
            onDone={() => setWaStep('twilio-wa-register')}
            onBack={() => setWaStep('twilio-pick-number')}
          />
        );
      case 'twilio-wa-register':
        return (
          <TwilioWaRegister
            onDone={() => setWaStep('qr')}
            onBack={() => setWaStep('twilio-sms-watch')}
          />
        );
      case 'qr':
        return <WAQRScan onScanned={() => setWaStep('connected')} />;
      case 'connected':
        return <WAConnected onContinue={onNext} />;
    }
  }

  // Default channel selection grid
  return (
    <>
      <h1>What channel do you want to connect?</h1>
      <p className="subtitle">Pick a messaging channel to get started with ChannelKit.</p>

      <div className="channel-grid">
        {CHANNELS.map(c => (
          <div
            key={c.id}
            className={`channel-card ${channel === c.id ? 'selected' : ''} ${c.id === 'whatsapp' && channel === c.id ? 'wa-selected' : ''}`}
            onClick={() => handleChannelSelect(c.id)}
          >
            <span className="channel-icon">{c.icon}</span>
            <span className="channel-name">{c.name}</span>
          </div>
        ))}
      </div>

      {ch && ch.setup === 'token' && (
        <div className="input-group">
          <label>{ch.label}</label>
          <input type="text" placeholder={ch.placeholder} value={token} onChange={e => setToken(e.target.value)} />
        </div>
      )}

      {channel === 'gmail' && (
        <div style={{ margin: '20px 0' }}>
          <button className="btn btn-secondary">🔗 Connect with Google</button>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>Opens OAuth consent screen</p>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-primary" disabled={!channel} onClick={handleWhatsAppNext}>
          {channel === 'whatsapp' ? 'Set up WhatsApp →' : 'Connect Channel →'}
        </button>
      </div>
    </>
  );
}

// ── Step 2: Live View ──
function Step2({ channel, messages, onSimulate, onNext, onBack }) {
  const ch = CHANNELS.find(c => c.id === channel);
  const isWA = channel === 'whatsapp';
  return (
    <>
      <h1><span className="emoji">🎉</span>Your channel is live!</h1>
      <p className="subtitle">
        {ch?.name} is connected. Send a message through it and watch it appear here in real-time.
      </p>

      {isWA && (
        <div className="wa-chat-link-row">
          <button className="btn btn-wa" onClick={() => alert('In production, this opens wa.me/15550123')}>
            💬 Open WhatsApp Chat
          </button>
          <span className="wa-chat-hint">Send a message to your connected number and watch it appear here!</span>
        </div>
      )}

      <LiveView messages={messages} onSimulate={onSimulate} waStyle={isWA} title={isWA ? '💬 WhatsApp Messages' : undefined} />

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={onNext}>Next: Connect Endpoint →</button>
      </div>
    </>
  );
}

// ── Step 3: Connect Endpoint ──
function Step3({ messages, requests, onSimulate, onNext, onBack, serviceMode, setServiceMode }) {
  const [url, setUrl] = useState('');

  return (
    <>
      <h1>Connect your channel to something</h1>
      <p className="subtitle">
        A <strong>Service</strong> routes incoming messages to your endpoint. Pick how to handle them.
      </p>

      <div className="service-options">
        <div
          className={`service-card ${serviceMode === 'own' ? 'selected' : ''}`}
          onClick={() => setServiceMode('own')}
        >
          <h3>🔗 My own endpoint</h3>
          <p>Forward messages to your server via webhook</p>
        </div>
        <div
          className={`service-card ${serviceMode === 'demo' ? 'selected' : ''}`}
          onClick={() => setServiceMode('demo')}
        >
          <h3>🧪 Demo echo server</h3>
          <p>Built-in server that echoes messages back</p>
        </div>
      </div>

      {serviceMode === 'own' && (
        <>
          <div className="input-group">
            <label>Webhook URL</label>
            <input type="url" placeholder="https://api.example.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <RequestView requests={requests} />
        </>
      )}

      {serviceMode === 'demo' && (
        <div className="split-view">
          <LiveView messages={messages} onSimulate={onSimulate} title="Incoming" />
          <div className="live-view">
            <div className="live-header">
              <span><span className="live-dot" />Echo Server</span>
            </div>
            <div className="live-body">
              {messages.length === 0 ? (
                <div className="live-empty">Echo server ready…</div>
              ) : messages.map((m, i) => (
                <div className="msg-row" key={i}>
                  <span className="msg-time">{m.time}</span>
                  <span className="msg-text" style={{ color: 'var(--green)' }}>↩ echo: {m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" disabled={!serviceMode} onClick={onNext}>
          Finish Setup →
        </button>
      </div>
    </>
  );
}

// ── Step 4: Done ──
function Step4({ channel, serviceMode, onBack }) {
  const ch = CHANNELS.find(c => c.id === channel);
  return (
    <>
      <h1><span className="emoji">✅</span>All set!</h1>
      <p className="subtitle">Here's what's running:</p>

      <div className="summary-card">
        <div className="summary-row">
          <span className="summary-label">Channel</span>
          <span className="summary-value">{ch?.icon} {ch?.name}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Service</span>
          <span className="summary-value">{serviceMode === 'demo' ? '🧪 Demo Echo Server' : '🔗 Custom Endpoint'}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Status</span>
          <span className="summary-value" style={{ color: 'var(--green)' }}>● Running</span>
        </div>
      </div>

      <div className="next-steps">
        <h3>Next steps</h3>
        <ul>
          <li>Add more channels from the dashboard</li>
          <li>Configure API keys and authentication</li>
          <li>Set up message routing rules</li>
          <li>Read the <a href="#" style={{ color: 'var(--accent)' }}>documentation</a></li>
        </ul>
      </div>

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Start Over
        </button>
      </div>
    </>
  );
}

// ── App ──
export default function App() {
  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [requests, setRequests] = useState([]);
  const [serviceMode, setServiceMode] = useState(null);
  const sampleIdx = useRef(0);

  const simulate = useCallback(() => {
    const pool = WA_MESSAGES;
    const s = pool[sampleIdx.current % pool.length];
    sampleIdx.current++;
    const msg = { time: timeStr(), from: s.from, text: s.text, waIcon: channel === 'whatsapp' };
    setMessages(prev => [...prev, msg]);
    setRequests(prev => [...prev, {
      time: timeStr(),
      text: `POST → ${s.from}: "${s.text}"`,
      status: 200,
      ms: Math.floor(Math.random() * 80 + 20),
    }]);
  }, [channel]);

  return (
    <div className="wizard">
      <div className="wizard-inner">
        <Progress step={step} />
        {step === 0 && <Step1 channel={channel} setChannel={setChannel} onNext={() => setStep(1)} />}
        {step === 1 && <Step2 channel={channel} messages={messages} onSimulate={simulate} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <Step3 messages={messages} requests={requests} onSimulate={simulate} onNext={() => setStep(3)} onBack={() => setStep(1)} serviceMode={serviceMode} setServiceMode={setServiceMode} />}
        {step === 3 && <Step4 channel={channel} serviceMode={serviceMode} onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}
