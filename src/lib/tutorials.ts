// Turn a pasted video link into something the app can render inline.
//   - YouTube / Loom / Vimeo / Google Drive → an embeddable iframe src
//   - a direct video file (.mp4/.webm/…)     → a <video> source
//   - anything else                          → just a link to open in a new tab

export interface TutorialEmbed {
  kind: "iframe" | "file" | "link";
  src: string;
}

export function tutorialEmbed(rawUrl: string): TutorialEmbed {
  const url = (rawUrl || "").trim();
  if (!url) return { kind: "link", src: url };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "link", src: url };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // YouTube (watch, short link, shorts, already-embed)
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v) return { kind: "iframe", src: `https://www.youtube.com/embed/${v}` };
    const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([\w-]+)/);
    if (m) return { kind: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
  }

  // Loom
  if (host === "loom.com") {
    const m = u.pathname.match(/\/(?:share|embed)\/([\w-]+)/);
    if (m) return { kind: "iframe", src: `https://www.loom.com/embed/${m[1]}` };
  }

  // Vimeo
  if (host === "vimeo.com") {
    const m = u.pathname.match(/\/(\d+)/);
    if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}` };
  }
  if (host === "player.vimeo.com") return { kind: "iframe", src: url };

  // Google Drive (file share link → preview player)
  if (host === "drive.google.com") {
    const m = u.pathname.match(/\/file\/d\/([\w-]+)/);
    if (m) return { kind: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  }

  // A direct video file we can play natively.
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: url };

  return { kind: "link", src: url };
}
