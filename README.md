# Essay Anonymizer

Made by [Hamed Yaghoobian](https://hamedyaghoobian.com) for the Writing Program Committee at Muhlenberg College. Free and open source under the [MIT License](LICENSE).

**Use it:** https://bergwriting.github.io/

Anonymizes student essays (.docx and PDF) for blind review by the writing program committee, and keeps a separate key so you can look up each author after judging.

- **Nothing to install.** It is one file, `essay-anonymizer.html`. Double-click it and it opens in your web browser, on macOS or Windows. It is tested in Google Chrome; Microsoft Edge uses the same engine. Safari and Firefox should work but have not been tested yet, so use Chrome or Edge for the first real batch.
- **Nothing leaves the computer.** All processing happens inside the browser tab. The page has a built-in security policy that blocks every network request, so it *cannot* upload anything even by mistake (see [Privacy](#privacy)).
- **No AI.** Detection uses rules only: the submission roster, document structure, regular expressions, and a lexicon-based name tagger ([compromise](https://github.com/spencermountain/compromise)). There is no machine-learning model and no OCR.

## Using it

1. **Settings.** Choose *What to remove*. The default is **the writer's name only**; everything else in the essay (citations, quoted authors, the title, the professor) is left exactly as written. The other presets are optional extras:
   - **All names:** the writer, the instructor, and other students on the roster.
   - **Names + contact details:** all names plus email, phone, student IDs and personal links.
   - **Everything:** also course codes, the school name and heading dates.
   - **Custom:** tick any combination of the checkboxes.

   Names hidden inside the file (document properties, comment authors, the thumbnail) are always removed. A **roster is optional**. If you have a submissions spreadsheet (.csv or .xlsx), load it and each essay is matched to its writer automatically. The roster stays in the open window only and is never saved.
2. **Essays.** Drop in the .docx and .pdf files.
   - Each essay has a **Writer's name** box. It is filled in when the tool is confident (for example a name on the first line above the title, a "By …" line, the name in the file name or page header, or the file's author field) and marked *check*.
   - **Tap the box for suggestions** (likely names found in the file, then roster names, then names mentioned in the essay). Typing filters them, as on a phone keyboard. Add a nickname after a semicolon, e.g. `Hamed Yaghoobian; Hami`.
   - Google Docs: *File › Download › Microsoft Word (.docx)*. Pages: *File › Export To › Word*. Old .doc files: *Save As .docx*.
3. **Review.** The writer's name is highlighted in red wherever it appears, in any form (full, first, last, initials, possessive).
   - Click a highlight to keep that text instead.
   - To remove anything else, type it in **Also remove…**, which autocompletes from names and words in that essay, or select text in the essay.
   - *Result* shows exactly what reviewers will see.
4. **Export.** First choose the labels and file names:
   - **Label style:** a random code (`WP-7K3Q`) or a number (`Essay 01`, `Essay 02`…). Numbers are handed out in random order, never upload or alphabetical order. The label is written into each essay's heading and page header, and you can change or remove the prefix.
   - **File name pattern:** for example `{label}`, or `Writing Award {date} - {label}`. You can also rename any single file in the results table.
   - **ZIP and key file names:** editable, with `{date}` available.

   If a file or ZIP name you type contains a student's or instructor's name, the download is held until you change it.

   *Create files* then builds a .docx for each essay, re-opens every file and searches it, including hidden parts, for the writer's name and everything you removed. Anything suspicious is listed before you can download. You then download two separate things:
   - The ZIP of essays (by default `anonymized-essays-DATE.zip`): send this to the reviewers.
   - The key (by default `KEY-CONFIDENTIAL-DATE.csv`, or `.enc` if you set a passphrase): keep this yourself. It lists each essay's label and file name, the writer, and what was removed.
5. **Look up key.** After judging, open the key in the *Look up key* tab. An encrypted key needs its passphrase, and it cannot be recovered without it.

Codes and numbers are assigned at random, so their order reveals nothing about who wrote what.

## What gets removed

| Where | How |
|---|---|
| **Default:** the writer's name in any form: full, first, last, "Last, First", initials such as "A. Okafor", possessives, hyphenated parts, nickname, with or without accents | Built from the writer's name box (roster or typed). A single first or last name is only matched when capitalised, so "young" is kept but "Young" (the surname) is removed. |
| The writer's line in the heading | Becomes "Essay WP-XXXX". Instructor, course and date lines are optional extras. |
| Running page headers ("Okafor 1") | Replaced with "WP-XXXX 1". |
| The instructor; other students and instructors on the roster | From the roster. "Professor X" is also caught by pattern. |
| Emails, phone numbers, student IDs, course codes, school names | Patterns (the ID format and course prefixes are set in Settings). |
| Document properties (author, last modified by, company), thumbnail, comments and their authors, tracked changes and their authors, revision IDs, template paths, custom XML, image EXIF data and alt text, `mailto:` links | Removed from the file. Tracked changes are accepted. |
| Names in PDF metadata, Word properties and the essay heading | Also searched for throughout the essay, so the author is caught even without a roster match. |

Every row except the first and the "always removed" file data is an optional extra, chosen under *What to remove*. Other people's names (cited authors, friends) are never removed unless you choose to; you can also switch on highlighting for them.

**Formatting.** Word files are edited in place, so fonts, italics, paragraphs and footnotes are kept. PDFs cannot be safely redacted inside a browser, so their text is rebuilt into a clean .docx. Italics and paragraphs are kept, but the layout is simplified.

## Limits (please read)

- **Scanned PDFs are rejected**, because reading text from images needs OCR, which is machine learning. Ask the student for a .docx or a text PDF.
- **Images are not read.** A photo or a screenshot showing a name will pass through. Essays with images get a warning.
- **Rules are not perfect.** A nickname that is not in the roster, a hometown, or a very distinctive personal detail can still identify someone. The review step is there for that, and the export check is a second safety net, not a guarantee.
- Embedded objects (for example a pasted spreadsheet) are not checked; the essay gets a warning.

## Privacy

The built HTML file starts with a Content-Security-Policy that sets `connect-src 'none'` and `default-src 'none'`. The browser therefore refuses any `fetch`, XHR, WebSocket, image, font, worker or form submission to any server. Every script is inlined and nothing is loaded from a CDN. To check this yourself:

- Turn Wi-Fi off and use the tool; everything still works.
- Or open the browser's developer tools, go to the *Network* tab, and run a batch: there are no requests.

The automated test (`npm run e2e`) does both. It blocks and records every request while running the whole workflow, and it confirms that an attempted `fetch` is refused.

## Where to get it

- **Online:** https://bergwriting.github.io/. The page runs entirely in your browser; essays are never uploaded.
- **Offline copy:** download https://bergwriting.github.io/essay-anonymizer.html (right-click › Save Link As…) and double-click the saved file. It works without internet.

## Sharing the tool

Share `essay-anonymizer.html` any way you like: email, a shared drive, the LMS. It can also be placed on any web server (for example GitHub Pages). Even then it only processes files locally and still cannot send anything back.

## For developers

```bash
npm install
npm run build      # -> dist/essay-anonymizer.html (single self-contained file)
npm test           # unit + pipeline tests on synthetic essays (all names fictional)
npm run fixtures   # writes the synthetic essays + roster to tests/fixtures/files/
npm run e2e        # opens the built file in Chrome from disk, runs the full flow offline
npm run dev        # live-reloading dev server (no CSP in dev mode)
```

Code map:

- `src/detect/`: detectors, including the roster names, heading block, running header, patterns and other names.
- `src/formats/docx.ts`: .docx reading, in-place redaction and metadata stripping.
- `src/formats/pdf.ts` and `src/formats/pdfOut.ts`: PDF text rebuilding and conversion to .docx.
- `src/verify.ts`: the leak check after export.
- `src/key.ts`: codes, the key CSV, and AES-GCM encryption.
- `src/ui/`: the interface (Preact).

Libraries: pdf.js, JSZip, docx, PapaParse, compromise, xmldom and Preact. All are bundled into the HTML file.

## License

Essay Anonymizer is released under the [MIT License](LICENSE). You may use, copy, change and share it, including at other departments and schools, as long as the copyright notice is kept.

Copyright © 2026 Hamed Yaghoobian.

The page bundles open-source libraries (pdf.js under Apache 2.0; JSZip, docx, PapaParse, compromise, xmldom and Preact under MIT) and the typefaces Source Serif 4 and IBM Plex (SIL Open Font License 1.1). Their full notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md); regenerate them with `node scripts/third-party-licenses.mjs`.
