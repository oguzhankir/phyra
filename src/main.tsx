import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import './styles.css';

const verificationMode =
  '__TAURI_INTERNALS__' in window
    ? invoke<boolean>('verification_mode').catch(() => false)
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
    <div
      className="app-shell"
      style={{ alignItems: 'center', justifyContent: 'center', padding: 30 }}
    >
      <section
        role="alert"
        style={{
          width: '100%',
          maxWidth: 560,
          padding: 26,
          background: '#192633',
          border: '1px solid #75494e',
          borderRadius: 9,
        }}
      >
        <h1 style={{ fontSize: 21, fontWeight: 500 }}>Phyra could not start</h1>
        <p style={{ marginTop: 15, color: '#a1bacb', fontSize: 13, lineHeight: 1.8 }}>
          Retry startup or restart the application. If the failure continues, include the error
          below when reporting the problem.
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: '#e1b1b4',
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          {message}
        </pre>
        <button className="primary" onClick={() => window.location.reload()}>
          Retry startup
        </button>
      </section>
    </div>
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
    const { default: App } = await import('./App');
    if (verification) await invoke('verification_trace', { message: 'app loaded' });
    root.render(
      <StartupBoundary>
        <React.StrictMode>
          <App />
        </React.StrictMode>
      </StartupBoundary>,
    );
  } catch (error) {
    root.render(<StartupFailure message={errorMessage(error)} />);
    void reportFailure(error);
  }
}
void start();
