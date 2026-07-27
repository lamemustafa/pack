# Portal integration findings

This log records live diagnostic findings that constrain Pack's local, target-bound acquisition.

1. Synthetic clicks work. Neither `isTrusted`, user activation, nor `chrome.debugger` is needed.
2. The portal generates artifacts client-side, then saves through `createObjectURL` and an anchor
   `dispatchEvent`. This was confirmed across seven GSTR-3B, GSTR-1, and GSTR-2B artifacts. The
   bounded non-suppressing shim captures the one expected blob; the former suppressing hook layer
   broke the flow it observed.
3. Request context caused authenticated-path rejections: background requests lack the portal-page
   request context, while a same-origin content-script fetch succeeds.
4. Constructed portal navigation is rejected and can end a session. Click the portal's own anchor.
5. `chrome.downloads.download({ saveAs: false })` does not override a browser profile configured
   to ask where to save files; Pack reports this limitation rather than claiming suppression.
6. `data:` versus `blob:` delivery was not the filename-loss cause. A competing extension changed
   filenames through `onDeterminingFilename`; Pack reasserts only its own download IDs.
7. Artifact identity must come from a live trace before binding a control. The apparent GSTR-1
   Excel control is an e-invoice export, not a GSTR-1 artifact. GSTR-2B has two Excel exports;
   Pack deliberately binds the summary-page details export and does not claim equivalence with the
   offline-page variant.
8. Returns Dashboard tile labels are ambiguous. Bind the GSTR-2B control by containing card, not
   by label text, document order, or index.
9. Preflight verifies the portal period before action: GSTR-3B uses `data.r3b.ret_period`, while
   GSTR-2B uses `data.rtnprd`. These values are compared only in memory and never logged.
10. XLSX container bytes and size do not establish document identity because ZIP entry timestamps
    vary. Compare workbook content before asserting two exports are the same document.
11. GSTR-2B JSON carries a root `chksum` that appears consistent with a digest. Its hashing and
    serialisation are unverified, so Pack does not use it yet.
12. A GSTR-3B JSON response may be saved verbatim; composing a PDF from it is forbidden because a
    Pack-produced document is not the portal artifact.
