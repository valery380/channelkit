export default function Footer() {
  return (
    <footer className="mt-auto py-8 border-t border-border flex flex-col items-center justify-center gap-4 text-dim">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px]">hub</span>
        <span className="text-sm font-bold tracking-tight">ChannelKit</span>
      </div>
      <p className="text-xs">&copy; {new Date().getFullYear()} ChannelKit. All systems operational.</p>
    </footer>
  );
}
