'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error boundary caught an error:', error, errorInfo);
    }
    
    // In production, you would send this to your error monitoring service
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{
            background:
              'radial-gradient(900px 450px at 82% -10%, rgba(254,133,0,0.1), transparent 60%), var(--bg-page)',
          }}
        >
          <div className="card-primary w-full max-w-lg text-center" style={{ padding: '2.5rem' }}>
            <div className="flex items-center justify-center mb-5">
              <AlertTriangle className="w-11 h-11" style={{ color: 'var(--error)' }} />
            </div>

            <p
              className="text-sm font-semibold tracking-[0.18em] uppercase mb-2"
              style={{ color: 'var(--accent-primary)' }}
            >
              palpal
            </p>
            <h2 className="heading-primary">Something went wrong</h2>

            <p className="text-body mb-7">
              We encountered an unexpected error. Your library is safe — try again or reload the page.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button type="button" onClick={this.handleReset} className="btn-primary">
                Try again
              </button>
              <button type="button" onClick={this.handleReload} className="btn-secondary">
                Reload page
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-meta cursor-pointer">Error details</summary>
                <pre
                  className="mt-2 text-xs p-3 rounded-lg overflow-auto"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--error)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;