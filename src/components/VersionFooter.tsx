"use client";

import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/constants";
import { installedApkVersion } from "@/lib/app-update";

/**
 * Small version tag shown at the bottom of every screen.
 *
 * On a phone this has to answer TWO questions, not one. The web version says
 * which deploy the page is running; the APK build says which shell it is
 * running inside. They move independently — a driver can be on the newest web
 * code inside a months-old shell — and when someone calls in with a problem,
 * "v1.3.4" alone doesn't say which half is stale.
 *
 * So inside the APK it reads `v1.3.4 · app 1`. In a browser there is no shell,
 * and the second half would be noise.
 *
 * `fixed` pins it to the bottom of the viewport (used on full-screen auth pages).
 */
export function VersionFooter({ fixed = false }: { fixed?: boolean }) {
  // Read after mount: the server has no user agent, and rendering something
  // different there than on the client breaks hydration.
  const [apk, setApk] = useState<number | null>(null);
  useEffect(() => { setApk(installedApkVersion(navigator.userAgent)); }, []);

  return (
    <footer
      className="no-print"
      style={{
        textAlign: "center",
        padding: fixed ? "0" : "16px 12px 24px",
        fontSize: 11,
        color: "var(--gray, #8a93a2)",
        opacity: 0.75,
        letterSpacing: ".02em",
        ...(fixed ? ({ position: "fixed", bottom: 10, left: 0, right: 0 } as const) : {}),
      }}
    >
      v{APP_VERSION}{apk != null ? ` · app ${apk}` : ""}
    </footer>
  );
}
