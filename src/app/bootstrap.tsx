import React from 'react';
import ReactDOM from 'react-dom/client';
import { invokeVerification as invoke } from '../platform/desktop/verification';
import '../styles.css';

const verificationMode =
  '__TAURI_INTERNALS__' in window
    ? invoke('verification_mode').catch(() => false)
    : Promise.resolve(false);
let failureReported = false;

function errorMessage(error: unknown): string {
  return (
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown startup error'
  ).slice(0, 2000);
}

async function reportFailure(error: unknown): Promise<void> {
  if (!(await verificationMode) || failureReported) return;
  failureReported = true;
  await invoke('verification_complete', {
    report: { error: `Frontend failure: ${errorMessage(error)}` },
  }).catch(() => {});
}

function StartupFailure({ message }: { message: string }) {
  return (
    <main className="startup-shell">
      <section className="startup-failure" role="alert">
        <h1>Phyra could not start</h1>
        <p>
          Retry startup. If the problem continues, restart the application and review preserved
          recovery copies. Include the technical details when reporting the failure.
        </p>
        <details>
          <summary>Technical details</summary>
          <pre>{message}</pre>
        </details>
        <button className="primary" onClick={() => window.location.reload()}>
          Retry startup
        </button>
      </section>
    </main>
  );
}

class StartupBoundary extends React.Component<
  { children: React.ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) };
  }
  componentDidCatch(error: Error) {
    void reportFailure(error);
  }
  render() {
    return this.state.message ? (
      <StartupFailure message={this.state.message} />
    ) : (
      this.props.children
    );
  }
}

// Verification reports remain local and exist only for the explicitly requested run.
// Ordinary application errors retain their normal browser and workbench handling.
window.addEventListener('error', (event) => {
  void reportFailure(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  void reportFailure(event.reason);
});

const mount =
  document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
const root = ReactDOM.createRoot(mount);
async function start(): Promise<void> {
  try {
    const verification = await verificationMode;
    if (verification) await invoke('verification_trace', { message: 'frontend startup' });
    const { default: App } = await import('./AssistantWorkbench');
    if (verification) await invoke('verification_trace', { message: 'app loaded' });
    root.render(
      <StartupBoundary>
        <React.StrictMode>
          <App />
        </React.StrictMode>
      </StartupBoundary>,
    );
    if (verification)
      await invoke('verification_trace', { message: 'frontend root render requested' });
  } catch (error) {
    root.render(<StartupFailure message={errorMessage(error)} />);
    void reportFailure(error);
  }
}
void start();
