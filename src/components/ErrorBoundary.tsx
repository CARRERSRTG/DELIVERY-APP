"use client";

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { installedApkVersion } from "@/lib/app-update";
import type { UserRole } from "@/lib/types";

// ============================================================
// App-wide error boundary (#38). Catches render/runtime errors in the UI so a
// single broken component shows a friendly recovery card instead of a blank
// white screen.
// ============================================================

interface Props { children: ReactNode; role?: UserRole; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const apk = typeof navigator !== "undefined" ? installedApkVersion(navigator.userAgent) : null;
    Sentry.captureException(error, {
      tags: { role: this.props.role ?? "unknown", apkVersion: apk ?? "web" },
      contexts: { react: { componentStack: info.componentStack } },
    });
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
