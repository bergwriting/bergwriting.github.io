declare const __APP_VERSION__: string;

export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const AUTHOR = 'Hamed Yaghoobian';
export const AUTHOR_URL = 'https://hamedyaghoobian.com';
export const REPO_URL = 'https://github.com/bergwriting/bergwriting.github.io';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const THIRD_PARTY_URL = `${REPO_URL}/blob/main/THIRD_PARTY_LICENSES.md`;
export const OFFLINE_URL = 'https://bergwriting.github.io/essay-anonymizer.html';

/** External links only navigate (in a new tab); this page itself still cannot send or fetch anything. */
function Ext({ href, children }: { href: string; children: preact.ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function LockIcon() {
  return (
    <svg class="lock" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

export function Footer({ onAbout }: { onAbout: () => void }) {
  return (
    <footer class="site-footer">
      <div class="footer-inner">
        <p>
          Made by <Ext href={AUTHOR_URL}>{AUTHOR}</Ext> for the Writing Program Committee at Muhlenberg College.
        </p>
        <p class="footer-links">
          <span>
            Open source · <Ext href={LICENSE_URL}>MIT License</Ext>
          </span>
          <Ext href={REPO_URL}>Source code</Ext>
          <Ext href={THIRD_PARTY_URL}>Third-party licenses</Ext>
          <button class="linklike" onClick={onAbout}>
            About &amp; privacy
          </button>
          <span class="muted">v{VERSION}</span>
        </p>
      </div>
    </footer>
  );
}

export function About() {
  return (
    <section class="step about">
      <div class="step-intro">
        <p class="eyebrow">About</p>
        <h2>A small, private tool for blind review</h2>
        <p>
          Essay Anonymizer removes the writer’s name from submitted essays so the Writing Program Committee can read and vote without knowing who wrote what.
          It was made by <Ext href={AUTHOR_URL}>{AUTHOR}</Ext> for the committee at Muhlenberg College, and it is free and open source.
        </p>
      </div>

      <div class="about-grid">
        <article>
          <h3>How your essays stay private</h3>
          <ul class="ticks">
            <li>
              <b>Nothing is uploaded.</b> Essays are opened and changed inside this browser tab, on your computer.
            </li>
            <li>
              <b>The page cannot use the internet.</b> A built-in security policy tells the browser to block every network request from this page, so it could
              not send anything even by mistake. It also works with Wi-Fi off.
            </li>
            <li>
              <b>No AI.</b> There is no ChatGPT, machine learning or outside service. The tool follows plain rules you can read in the source code.
            </li>
            <li>
              <b>Nothing is kept.</b> Closing the tab forgets every essay and roster. Only your preferences (such as which details to remove) are remembered on
              this computer.
            </li>
            <li>
              <b>The key is yours.</b> The list of who wrote which essay is a separate download, and it can be locked with a passphrase.
            </li>
          </ul>
        </article>

        <article>
          <h3>How it finds the writer’s name</h3>
          <p>For each essay it looks for the name in the places students usually put it, then removes every form of it everywhere in the file:</p>
          <ul>
            <li>the first lines of the essay (MLA/APA heading, a name above the title, “By …”, “Name: …”)</li>
            <li>the page header (“Surname 1”) and the file name</li>
            <li>the author saved in the file’s properties</li>
            <li>your roster, if you load one</li>
          </ul>
          <p>
            Full name, first name, last name, initials and possessives are all covered, with or without accents. You always confirm the name before anything is
            exported, and you can remove anything else by hand.
          </p>
        </article>

        <article>
          <h3>Good to know</h3>
          <ul>
            <li>Word files keep their formatting. PDFs are rebuilt as clean Word files with simpler layout.</li>
            <li>Scanned PDFs (photos of pages) can’t be read without OCR, which is a form of AI, so ask for a Word file instead.</li>
            <li>Text inside images is not read; essays with images get a warning.</li>
            <li>Rules are not perfect, so take a quick look in Review before exporting. Every exported file is re-checked for the name.</li>
          </ul>
          <p>
            Want to use it without the internet? <Ext href={OFFLINE_URL}>Save this page</Ext> and open the saved file. It works the same offline.
          </p>
        </article>

        <article>
          <h3>Open source &amp; license</h3>
          <p>
            Essay Anonymizer is released under the <Ext href={LICENSE_URL}>MIT License</Ext>: anyone may use, copy, change and share it, including other
            departments and schools, as long as the copyright notice is kept. The code is on <Ext href={REPO_URL}>GitHub</Ext>; suggestions and corrections
            are welcome.
          </p>
          <p class="muted small">
            Built with pdf.js (Apache 2.0), JSZip, docx, PapaParse, compromise, xmldom and Preact (MIT), and the typefaces Source Serif 4 and IBM Plex (SIL Open
            Font License). Full notices: <Ext href={THIRD_PARTY_URL}>third-party licenses</Ext>.
          </p>
          <p class="muted small">
            © 2026 {AUTHOR} · version {VERSION}
          </p>
        </article>
      </div>
    </section>
  );
}
