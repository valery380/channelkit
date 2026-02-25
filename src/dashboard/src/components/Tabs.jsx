export default function Tabs({ tabs, active }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button
          key={t.hash}
          className={`tab${active === t.hash ? ' active' : ''}`}
          onClick={() => { window.location.hash = t.hash; }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
