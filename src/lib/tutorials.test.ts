import { describe, it, expect } from "vitest";
import { tutorialEmbed } from "@/lib/tutorials";

describe("tutorialEmbed", () => {
  it("embeds a YouTube watch link", () => {
    expect(tutorialEmbed("https://www.youtube.com/watch?v=abc123XYZ_-")).toEqual({
      kind: "iframe", src: "https://www.youtube.com/embed/abc123XYZ_-",
    });
  });
  it("embeds a youtu.be short link", () => {
    expect(tutorialEmbed("https://youtu.be/abc123XYZ").src).toBe("https://www.youtube.com/embed/abc123XYZ");
  });
  it("embeds a YouTube Shorts link", () => {
    expect(tutorialEmbed("https://youtube.com/shorts/xY12z").src).toBe("https://www.youtube.com/embed/xY12z");
  });
  it("embeds a Loom share link", () => {
    expect(tutorialEmbed("https://www.loom.com/share/deadbeef1234").src).toBe("https://www.loom.com/embed/deadbeef1234");
  });
  it("embeds a Vimeo link", () => {
    expect(tutorialEmbed("https://vimeo.com/76979871").src).toBe("https://player.vimeo.com/video/76979871");
  });
  it("embeds a Google Drive file link as a preview", () => {
    expect(tutorialEmbed("https://drive.google.com/file/d/1A2b3C/view?usp=sharing").src)
      .toBe("https://drive.google.com/file/d/1A2b3C/preview");
  });
  it("plays a direct video file natively", () => {
    expect(tutorialEmbed("https://cdn.example.com/clips/intro.mp4")).toEqual({
      kind: "file", src: "https://cdn.example.com/clips/intro.mp4",
    });
  });
  it("falls back to a plain link for anything else", () => {
    expect(tutorialEmbed("https://example.com/some-page").kind).toBe("link");
    expect(tutorialEmbed("not a url").kind).toBe("link");
  });
});
