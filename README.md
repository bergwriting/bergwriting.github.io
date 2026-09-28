# Essay Anonymizer

Anonymizes student essays (.docx and PDF) for blind review by the writing program committee, and keeps a separate key so you can look up each author after judging.

- **Nothing to install.** It is one file, `essay-anonymizer.html`. Double-click it and it opens in your web browser, on macOS or Windows. It is tested in Google Chrome; Microsoft Edge uses the same engine. Safari and Firefox should work but have not been tested yet, so use Chrome or Edge for the first real batch.
- **Nothing leaves the computer.** All processing happens inside the browser tab. The page has a built-in security policy that blocks every network request, so it *cannot* upload anything even by mistake (see [Privacy](#privacy)).
- **No AI.** Detection uses rules only: the submission roster, document structure, regular expressions, and a lexicon-based name tagger ([compromise](https://github.com/spencermountain/compromise)). There is no machine-learning model and no OCR.

## Using it

1. **Roster.** Load the submissions spreadsheet as .csv or .xlsx, or paste the rows. Then map the columns: student name (required), and optionally file name, instructor, course, email, and preferred name. The roster is kept only in the open window and is never saved.
   Under *Settings*, add your school name(s) (for example `Muhlenberg College` and `Muhlenberg`) and any other words to always remove. Settings are remembered on this computer.
   Under *What to remove*, choose a preset or tick exactly what you want:
   - **Everything** (recommended): names, instructor, classmates, course, school, email, phone, IDs, personal links and heading dates.
   - **Names only**: the student, the instructor and other students on the roster.
   - **Names + contact details**: names plus email, phone, IDs and personal links.
   - **Custom**: any combination of the checkboxes.

   Anything you leave unticked stays in the essay but is still highlighted in Review, so you can remove single cases. Names hidden inside the file itself (document properties, comment authors, the thumbnail) are always removed.
2. **Essays.** Drop in all the .docx and .pdf files. Each one is matched to a roster row by its file name or by the name found inside it; check the matches and fix any that are wrong.
   - Google Docs: *File › Download › Microsoft Word (.docx)*.
   - Pages: *File › Export To › Word*.
   - Old .doc files: open them in Word and *Save As .docx*.
3. **Review.** Each essay is shown with its highlights:
   - **Red** means the text will be replaced (`[STUDENT]`, `[INSTRUCTOR]`, `[EMAIL]`, and so on).
   - **Amber** means the text is kept but worth a glance. These are cited authors, other people's names, and links.

   Click a highlight to switch it. The switch applies to all identical text; Alt-click switches just one. Select any text and press *Remove selected text* to catch something that was missed. *Result* shows exactly what reviewers will see.
4. **Export.** First choose the labels and file names:
   - **Label style:** a random code (`WP-7K3Q`) or a number (`Essay 01`, `Essay 02`…). Numbers are handed out in random order, never upload or alphabetical order. The label is written into each essay's heading and page header, and you can change or remove the prefix.
   - **File name pattern:** for example `{label}`, or `Writing Award {date} - {label}`. You can also rename any single file in the results table.
   - **ZIP and key file names:** editable, with `{date}` available.

   If a file or ZIP name you type contains a student's or instructor's name, the download is held until you change it.

   *Create files* then builds a .docx for each essay, then re-opens every file and searches it, including hidden parts, for the student's name, email and everything you removed. Anything suspicious is listed before you can download. You then download two separate things:
   - The ZIP of essays (by default `anonymized-essays-DATE.zip`): send this to the reviewers.
   - The key (by default `KEY-CONFIDENTIAL-DATE.csv`, or `.enc` if you set a passphrase): keep this yourself. It lists each essay's label and file name, the student, and what was removed.
5. **Look up key.** After judging, open the key in the *Look up key* tab. An encrypted key needs its passphrase, and it cannot be recovered without it.

Codes and numbers are assigned at random, so their order reveals nothing about who wrote what.

## What gets removed

| Where | How |
|---|---|
| The student's name in any form: full, first, last, "Last, First", initials such as "A. Okafor", possessives, hyphenated parts, preferred name, with or without accents | Built from the roster row. A single first or last name is only matched when capitalised, so "young" is kept but "Young" (the surname) is removed. |
| The heading block: name, instructor, course and date lines (MLA or APA) | Recognised by position and pattern. The name line becomes "Essay WP-XXXX". |
| Running page headers ("Okafor 1") | Replaced with "WP-XXXX 1". |
| The instructor; other students and instructors on the roster | From the roster. "Professor X" is also caught by pattern. |
| Emails, phone numbers, student IDs, course codes, school names | Patterns (the ID format and course prefixes are set in Settings). |
| Document properties (author, last modified by, company), thumbnail, comments and their authors, tracked changes and their authors, revision IDs, template paths, custom XML, image EXIF data and alt text, `mailto:` links | Removed from the file. Tracked changes are accepted. |
| Names in PDF metadata, Word properties and the essay heading | Also searched for throughout the essay, so the author is caught even without a roster match. |

Kept, but highlighted for review: other people's names (cited authors, historical figures, friends), "Dr./Mr./Ms. + name", high school names, and links to published sources. Links to personal pages or shared documents (Google Docs, LinkedIn and similar) are removed.

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
