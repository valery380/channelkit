export default function Tabs({ tabs, active }) {
  return (
    <div className="border-b border-border">
      <div className="flex gap-8">
        {tabs.map(t => (
          <a
            key={t.hash}
            href={t.hash}
            className={`flex items-center gap-2 border-b-2 pb-3 px-1 transition-all text-sm ${
              active === t.hash
                ? 'border-primary text-text font-bold'
                : 'border-transparent text-dim hover:text-text font-medium'
            }`}
            onClick={e => {
              e.preventDefault();
              window.location.hash = t.hash;
            }}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            <span>{t.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
