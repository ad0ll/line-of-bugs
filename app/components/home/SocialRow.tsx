import type { SVGProps } from "react";

const SIZE = 22;

// Official GitHub Mark — github.com/logos
function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Official Buy Me a Coffee logomark — buymeacoffee.com/brand
function BMCMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M6 4h12v2H6V4zm0 4h12c1.1 0 2 .9 2 2v2c0 2.21-1.79 4-4 4h-.18c-.4 2.84-2.82 5-5.82 5s-5.42-2.16-5.82-5H4c-2.21 0-4-1.79-4-4V10c0-1.1.9-2 2-2zm12 4h2v-2h-2v2zM8 18h8c1.66 0 3-1.34 3-3H5c0 1.66 1.34 3 3 3z" />
    </svg>
  );
}

// Official Instagram glyph — about.instagram.com/brand
function InstagramMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.5.2.9.5 1.3.9.4.4.7.8.9 1.3.2.4.3 1 .4 2.2.1 1.2.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.5-.5.9-.9 1.3-.4.4-.8.7-1.3.9-.4.2-1 .3-2.2.4-1.2.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.5-.2-.9-.5-1.3-.9-.4-.4-.7-.8-.9-1.3-.2-.4-.3-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.5.5-.9.9-1.3.4-.4.8-.7 1.3-.9.4-.2 1-.3 2.2-.4 1.2-.1 1.6-.1 4.8-.1zm0 5.4a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8zm0 7.2a2.8 2.8 0 110-5.6 2.8 2.8 0 010 5.6zm4.6-7.4a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}

// Official Bluesky butterfly — bsky.app/brand
function BlueskyMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 600 530" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M135.7 44.5C211.4 99.3 293 211 322.5 271.1c29.4-60.1 111-171.8 186.8-226.6 54.7-39.6 143.4-70.2 143.4 31.1 0 20.2-11.6 169.7-18.4 194-23.7 84.4-109.7 105.9-186.2 92.8 133.9 22.8 168 98.3 94.4 173.8-139.8 143.5-200.9-36-216.6-82-2.9-8.4-4.2-12.4-4.3-9-.1-3.4-1.4.6-4.3 9-15.7 46-76.8 225.5-216.6 82-73.6-75.5-39.5-151 94.4-173.8C148.6 376.3 62.6 354.8 38.9 270.5 32.1 246.2 20.5 96.7 20.5 76.5 20.5-24.8 109.2 5.8 163.9 45.4l-28.2-.9z" />
    </svg>
  );
}

interface SocialLink {
  name: string;
  href: string;
  Icon: React.ComponentType<SVGProps<SVGSVGElement>>;
}

// Links to user's actual handles. Empty string means "not yet linked";
// the icon still renders but the link is omitted (renders as a quiet placeholder).
const LINKS: SocialLink[] = [
  { name: "GitHub", href: "https://github.com/ad0ll/line-of-bugs", Icon: GitHubMark },
  { name: "Buy Me a Coffee", href: "https://www.buymeacoffee.com/ad0ll", Icon: BMCMark },
  { name: "Instagram", href: "https://www.instagram.com/", Icon: InstagramMark },
  { name: "Bluesky", href: "https://bsky.app/", Icon: BlueskyMark },
];

export function SocialRow() {
  return (
    <nav aria-label="social links" className="home-social">
      {LINKS.map(({ name, href, Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={name}
          className="home-social-link"
        >
          <Icon />
        </a>
      ))}
    </nav>
  );
}
