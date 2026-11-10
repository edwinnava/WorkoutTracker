import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a crash in the screen below it and shows what went wrong instead of
 * a blank page, with the technical detail so it can be reported.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string }> {
  state = { error: null as Error | null, where: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ where: (info.componentStack ?? '').trim().split('\n').slice(0, 4).join('\n') });
  }

  render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <h1 style={{ marginTop: 24 }}>Something went wrong</h1>
        <p className="subtle">This screen hit an error. Your workouts and routines are safe.</p>
        <pre className="crash-detail">
          {String(error.message || error)}
          {'\n\n'}
          {(error.stack ?? '').split('\n').slice(0, 5).join('\n')}
          {where ? `\n\n${where}` : ''}
        </pre>
        <p className="small subtle">A screenshot of this page helps get it fixed.</p>
        <button
          className="btn primary block"
          onClick={() => {
            location.hash = '#/';
            location.reload();
          }}
        >
          Back to the app
        </button>
      </div>
    );
  }
}
