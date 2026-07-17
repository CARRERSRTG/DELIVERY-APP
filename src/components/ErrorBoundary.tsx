"use client";

import { Component, type ReactNode } from "react";

// ============================================================
// App-wide error boundary (#38). Catches render/runtime errors in the UI so a
// single broken component shows a friendly recovery card instead of a blank
// white screen. Logs to the console (wire to Sentry here in production).
// ============================================================

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // TODO(prod): forward to an error-monitoring service (e.g. Sentry.captureException).
    console.error("UI error boundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="wrap">
          <div className="card" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>⚠️</div>
            <h2 style={{ margin: "10px 0" }}>Something went wrong</h2>
            <p className="hint" style={{ marginBottom: 16 }}>{this.state.error.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-ghost" onClick={() => this.setState({ error: null })}>Try again</button>
              <button className="btn btn-primary" onClick={() => location.reload()}>Reload app</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
