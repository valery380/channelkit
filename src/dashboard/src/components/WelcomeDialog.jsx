import { useAppState } from '../context.jsx';

export default function WelcomeDialog({ onNavigate }) {
  const { channels, services, configLoaded } = useAppState();

  // Don't show until config is actually loaded from the server
  if (!configLoaded) return null;

  const channelCount = Object.keys(channels || {}).length;
  const serviceCount = Object.keys(services || {}).length;

  if (channelCount === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-2xl">
          <div className="text-center space-y-4">
            <span className="text-4xl">👋</span>
            <h2 className="text-lg font-semibold text-text">Welcome to ChannelKit!</h2>
            <p className="text-sm text-dim">
              You don't have any channels configured yet. Add your first channel to start receiving messages.
            </p>
            <button
              onClick={() => onNavigate('#channels')}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover transition-colors"
            >
              Add a Channel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (serviceCount === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-2xl">
          <div className="text-center space-y-4">
            <span className="text-4xl">🔗</span>
            <h2 className="text-lg font-semibold text-text">Almost there!</h2>
            <p className="text-sm text-dim">
              You have {channelCount} channel{channelCount > 1 ? 's' : ''} configured but no services yet. Add a service to connect your channel to your app via webhook.
            </p>
            <button
              onClick={() => onNavigate('#services')}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover transition-colors"
            >
              Add a Service
            </button>
            <button
              onClick={() => onNavigate(null)}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-dim hover:text-text transition-colors"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
